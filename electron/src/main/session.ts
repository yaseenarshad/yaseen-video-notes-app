import { clipboard, shell, WebContentsView, webFrameMain, type WebFrameMain } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { device, homeOf, readProgress, writeProgress } from '../core/progress'
import { homeTracker } from '../core/home'
import { addNote, changeFile, deleteNote, editNote, NoteChanged, noteJSON, parse as parseNotes, releaseClaimAt, setCategory, setResolved, type Note, type NoteCategory } from '../core/notes'
import { LockTimeout } from '../core/fileLock'
import { noteAnchor } from '../core/noteAnchor'
import { advanceOnOpen } from '../core/status'
import { decodeSidecar, type Sidecar } from '../core/transcript'
import type { TranscriptFolder } from '../core/folderMaker'
import { DebugLog } from './debugLog'
import { json, LocalServer, text, type Request, type Response } from './server'
import { Settings } from './settings'
import PLAYER_HTML from './player.html?raw'
import INJECTED from './injected.js?raw'

// Where a note card goes in the transcript: the same function the unit tests check, served to the page.
const NOTE_ANCHOR_JS = `window.noteAnchor = (${noteAnchor.toString()});\n`
// The 📍 home / back-forward logic (core/home.ts, unit-tested there), served the same way.
const HOME_JS = `window.homeTracker = (${homeTracker.toString()});\n`

/** The notes as JSON for the page (claims carry `expired`, computed now). */
const notesForPage = (notes: Note[]): Record<string, unknown>[] => { const now = Date.now(); return notes.map((n) => noteJSON(n, now)) }

const EMBED = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//
/** Seconds of real playback before a video counts as started (status → In progress). */
const WATCHED_TO_START = 30

export interface SessionOptions {
  preload: string
  zoom: number
  muted: boolean
}

/**
 * One open video: a local server for the page + data + notes, and its WebContentsView.
 * A tab of the main window shows `view`.
 */
export class PlayerSession {
  readonly sidecar: Sidecar
  readonly view: WebContentsView
  private server: LocalServer
  private notesCache: { mtime: number; size: number; minute: number; json: string } | null = null
  private lastPos: { t: number; dur: number; home: number | null } | null = null
  /** Playback ticks (~1 s each) seen while playing in a visible tab, until WATCHED_TO_START. */
  private watchedTicks = 0
  private startedWatching = false
  private written: { t: number; at: number } | null = null
  private scan: NodeJS.Timeout | null = null
  private connected = false
  private lastHiddenPause = 0
  /** Only the visible tab plays (set by the window when it shows / hides this tab). */
  visible = false
  closed = false

  private constructor(public transcript: TranscriptFolder, opts: SessionOptions) {
    this.sidecar = decodeSidecar(readFileSync(transcript.sidecar, 'utf8'))
    // What the file already says counts as written: opening a video writes nothing.
    const p = readProgress(transcript.folder)
    if (p) this.written = { t: p.seconds, at: Date.now() }
    this.server = new LocalServer((req) => this.handle(req))
    this.view = new WebContentsView({
      webPreferences: {
        preload: opts.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    const wc = this.view.webContents
    wc.setZoomFactor(opts.zoom)
    if (opts.muted) wc.setAudioMuted(true)
    // Links leave the app.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (e, url) => {
      const u = new URL(url)
      if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1' && u.protocol !== 'about:') {
        e.preventDefault()
        void shell.openExternal(url)
      }
    })
    // The script that controls the video runs INSIDE the cross-origin YouTube iframe: injected
    // from here into that frame each time it (re)loads. It is idempotent per document.
    // Every load / navigation of a subframe re-injects (idempotent: the script runs once per document).
    wc.on('did-frame-finish-load', (_e, isMain, processId, routingId) => {
      if (!isMain) this.inject(webFrameMain.fromId(processId, routingId))
    })
    wc.on('did-frame-navigate', (_e, _url, _code, _status, isMain, processId, routingId) => {
      if (!isMain) this.inject(webFrameMain.fromId(processId, routingId), 'navigate')
    })
    wc.on('frame-created', (_e, { frame }) => {
      if (frame && frame !== wc.mainFrame) frame.on('dom-ready', () => this.inject(frame, 'dom-ready'))
    })
    wc.on('did-finish-load', () => this.injectAll())
    wc.on('render-process-gone', (_e, d) => {
      DebugLog.log(`web content process gone (${d.reason}); reloading`)
      if (!this.closed) setTimeout(() => !this.closed && wc.loadURL(this.pageURL), 500)
    })
    // Belt and braces: until the page says the player reports, look for the embed frame every 2 s.
    this.scan = setInterval(() => { if (!this.connected) this.injectAll() }, 2000)
  }

  static async open(t: TranscriptFolder, opts: SessionOptions): Promise<PlayerSession> {
    const s = new PlayerSession(t, opts)
    const port = await s.server.start()
    DebugLog.log(`server http://127.0.0.1:${port}/ for ${t.markdown}`)
    // Watching a video (WATCHED_TO_START seconds of playback, see received()) moves an empty / Backlog / Todo
    // status to In progress. Just opening it doesn't, so a freshly added video stays in Backlog. Done is manual.
    void s.view.webContents.loadURL(s.pageURL)
    return s
  }

  get pageURL(): string { return `http://localhost:${this.server.port}/` }

  /** Injects the bridge script into a YouTube embed frame; true when the frame is one. */
  private inject(frame: WebFrameMain | null | undefined, why = 'load'): boolean {
    try {
      if (!frame || frame.isDestroyed?.() || !EMBED.test(frame.url)) return false
    } catch { return false }
    frame.executeJavaScript(INJECTED)
      .then((r) => DebugLog.log(`injected into ${frame.url.split('?')[0]} (${why}${r === 'already' ? ', already there' : ''})`))
      .catch((e: Error) => DebugLog.log(`inject failed (${why}): ${e.message}`))
    return true
  }

  /** Injects into every YouTube embed frame of the page; returns how many there are. */
  private injectAll(why = 'scan'): number {
    let n = 0
    try {
      const main = this.view.webContents.mainFrame
      for (const f of main.framesInSubtree) if (f !== main && this.inject(f, why)) n++
    } catch { /* destroyed */ }
    return n
  }

  /** Reloads the player page when it seems stuck (View → Reload Video). It resumes at the saved spot. */
  reload(): void {
    if (this.closed) return
    this.savePosition()
    this.connected = false
    DebugLog.log('reload video (menu)')
    this.view.webContents.reload()
  }

  /**
   * The video's folder was moved (to another topic, or its topic was renamed): from now on every read and write
   * (notes, position, status, data.json) uses the new paths. The page keeps playing; it only talks to this server.
   */
  relocate(t: TranscriptFolder): void {
    if (this.closed) return
    DebugLog.log(`relocated ${this.transcript.folder} → ${t.folder}`)
    this.transcript = t
    this.notesCache = null
  }

  /** Runs a page command (window.FA, see player.html). */
  run(js: string): void {
    if (this.closed) return
    this.view.webContents.executeJavaScript(`window.FA && (${js})`).catch(() => {})
  }

  // ---------- HTTP ----------

  private handle(req: Request): Response {
    const key = `${req.method} ${req.path}`
    switch (key) {
      case 'GET /':
      case 'GET /index.html':
        return text(PLAYER_HTML, 200, 'text/html; charset=utf-8')
      case 'GET /note-anchor.js':
        return text(NOTE_ANCHOR_JS, 200, 'text/javascript; charset=utf-8')
      case 'GET /home.js':
        return text(HOME_JS, 200, 'text/javascript; charset=utf-8')
      case 'GET /data.json':
        try { return { status: 200, type: 'application/json; charset=utf-8', body: readFileSync(this.transcript.sidecar) } } catch { return json({ error: 'no sidecar' }, 500) }
      case 'GET /api/notes':
        return { status: 200, type: 'application/json; charset=utf-8', body: this.notesJSON() }
      case 'POST /api/notes':
        return this.addNote(req.body)
      case 'POST /api/notes/delete':
      case 'POST /api/notes/edit':
      case 'POST /api/notes/category':
      case 'POST /api/notes/resolved':
      case 'POST /api/notes/release':
        return this.changeNote(req.path, req.body)
      case 'GET /api/position': {
        // read fresh: another computer may have moved it (the vault syncs)
        const p = readProgress(this.transcript.folder)
        const other = p?.device && p.device !== device() ? p.device : '' // named only when it was another computer
        // home: where to resume (the 📍 main spot; old files: seconds)
        return json({ t: p?.seconds ?? 0, home: p ? homeOf(p) : 0, dur: p?.duration ?? 0, device: other })
      }
      case 'GET /api/prefs':
        return json(Settings.playerPrefs)
      case 'POST /api/prefs':
        Settings.savePlayerPrefs(req.body)
        return json({ ok: true })
      default:
        return text('not found', 404)
    }
  }

  /** Re-parses the .md only when it changed (the page polls every second). */
  private notesJSON(): string {
    const path = this.transcript.markdown
    let mtime = Date.now(), size = -1
    try { const st = statSync(path); mtime = st.mtimeMs; size = st.size } catch { /* gone */ }
    // a claim expires with time, not with a file change: re-parse at least once a minute
    const minute = Math.floor(Date.now() / 60_000)
    const c = this.notesCache
    if (c && c.mtime === mtime && c.size === size && c.minute === minute) return c.json
    let md = ''
    try { md = readFileSync(path, 'utf8') } catch { /* empty */ }
    const out = JSON.stringify(notesForPage(parseNotes(md)))
    this.notesCache = { mtime, size, minute, json: out }
    return out
  }

  private addNote(body: string): Response {
    let o: Record<string, unknown>
    try { o = JSON.parse(body) } catch { return json({ error: 'bad note' }, 400) }
    if (typeof o.para !== 'number' || typeof o.time !== 'number' || typeof o.text !== 'string') return json({ error: 'bad note' }, 400)
    const end = typeof o.end === 'number' ? o.end : null
    const quote = typeof o.quote === 'string' ? o.quote : null
    const category: NoteCategory = o.category === 'mochi' ? 'mochi' : 'general'
    try {
      const notes = addNote(this.transcript.markdown, Math.trunc(o.para), o.time, o.text, end, quote, category)
      this.notesCache = null
      DebugLog.log(`note saved para=${o.para} time=${o.time} end=${end ?? '-'} category=${category} text=${JSON.stringify(o.text)}`)
      return json(notesForPage(notes))
    } catch (e) {
      if (e instanceof LockTimeout) return json({ error: e.message }, 503)
      return json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  }

  /**
   * Delete / edit / category / resolved change of one note. The page sends the note's paragraph, its place among that
   * paragraph's notes and the text it shows; a mismatch with the file is a 409.
   */
  private changeNote(path: string, body: string): Response {
    let o: Record<string, unknown>
    try { o = JSON.parse(body) } catch { return json({ error: 'bad request' }, 400) }
    if (typeof o.para !== 'number' || typeof o.index !== 'number' || typeof o.text !== 'string') return json({ error: 'bad request' }, 400)
    const time = typeof o.time === 'number' ? Math.trunc(o.time) : null
    const file = this.transcript.markdown
    const category: NoteCategory | undefined = o.category === 'mochi' || o.category === 'general' ? o.category : undefined
    const para = Math.trunc(o.para), index = Math.trunc(o.index), shown = o.text
    let change: (md: string) => string
    if (path.endsWith('/delete')) {
      change = (md) => deleteNote(md, para, index, shown, time)[0]
    } else if (path.endsWith('/resolved')) {
      if (typeof o.resolved !== 'boolean') return json({ error: 'bad request' }, 400)
      const resolved = o.resolved
      change = (md) => setResolved(md, para, index, shown, time, resolved)
    } else if (path.endsWith('/release')) {
      change = (md) => releaseClaimAt(md, para, index, shown, time)
    } else if (path.endsWith('/category')) {
      if (!category) return json({ error: 'bad category' }, 400)
      change = (md) => setCategory(md, para, index, shown, time, category)
    } else {
      const newText = o.newText
      if (typeof newText !== 'string' || newText.trim() === '') return json({ error: 'empty note' }, 400)
      change = (md) => editNote(md, para, index, shown, time, newText, category)
    }
    try {
      // under the file lock (agents' video-notes CLI writes the same file): read fresh, change, atomic write
      // (nothing is written when nothing changed); a written file gets the current agent guide too (idempotent)
      const out = changeFile(file, change).after
      this.notesCache = null
      DebugLog.log(`note ${path.split('/').pop()} ok`)
      return json({ notes: notesForPage(parseNotes(out)) })
    } catch (e) {
      if (e instanceof NoteChanged) {
        DebugLog.log(`note ${path}: ${e.message}`)
        return json({ error: e.message }, 409)
      }
      if (e instanceof LockTimeout) {
        DebugLog.log(`note ${path}: ${e.message}`)
        return json({ error: e.message }, 503)
      }
      return json({ error: e instanceof Error ? e.message : String(e) }, 500)
    }
  }

  // ---------- messages from the page ----------

  /**
   * Writes the position to the folder's progress file — rarely, because the vault is synced with
   * git: not when it moved < 5 s since the last write, and while playing (`periodic`) at most once
   * a minute. Pause, seek, tab switch / close and quit write at once.
   */
  savePosition(periodic = false): void {
    const p = this.lastPos
    if (!p || p.t <= 0) return
    const w = this.written
    if (w) {
      if (Math.abs(p.t - w.t) < 5) return
      if (periodic && Date.now() - w.at < 60_000) return
    }
    try {
      writeProgress(this.transcript.folder, p.t, p.dur, new Date(), p.home)
      this.written = { t: p.t, at: Date.now() }
      DebugLog.log(`progress saved ${Math.trunc(p.t)}s of ${Math.trunc(p.dur)}s${periodic ? ' (periodic)' : ''}`)
    } catch (e) {
      DebugLog.log(`could not save progress: ${e}`)
    }
  }

  received(m: Record<string, unknown>): void {
    const type = m && typeof m.type === 'string' ? m.type : ''
    if (type === 'copy' && typeof m.text === 'string') clipboard.writeText(m.text)
    if (type === 'connected') this.connected = true
    // The page heard nothing from the YouTube frame for > 2.5 s: inject again; with no live YouTube
    // frame (it crashed or went blank) the page reloads the video where it was.
    if (type === 'reconnect' && !this.closed) {
      const n = this.injectAll('reconnect')
      DebugLog.log(`reconnect #${m.tries} (no status for ${m.stale} ms${this.visible ? '' : ', tab hidden'}): ${n ? `re-injected into ${n} frame(s)` : 'no YouTube frame → reload video'}`)
      if (!n) this.run(`FA.reloadVideo('no-frame')`)
    }
    // A tab that is not on screen never plays (e.g. a restored tab whose resume seek started it).
    if (type === 'tick' && m.paused === false && !this.visible && Date.now() - this.lastHiddenPause > 2000) {
      this.lastHiddenPause = Date.now()
      DebugLog.log('hidden tab was playing: pause')
      this.run('FA.pause()')
    }
    // ~30 s of real playback in a visible tab = started watching → In progress (once per session).
    if (type === 'tick' && m.paused === false && this.visible && !this.startedWatching && ++this.watchedTicks >= WATCHED_TO_START) {
      this.startedWatching = true
      setImmediate(() => advanceOnOpen(this.transcript.folder, this.transcript.markdown, DebugLog.log))
    }
    if ((type === 'tick' || type === 'pos') && typeof m.t === 'number' && m.ok !== false && m.resumed !== false) {
      // "tick" every second; "pos" on pause, after a seek, and every 10 s while playing ("playing": true)
      const dur = typeof m.dur === 'number' ? m.dur : 0
      // home rides along with the position; it never triggers a write by itself (same rules as before)
      const home = typeof m.home === 'number' && Number.isFinite(m.home) ? m.home : (this.lastPos?.home ?? null)
      this.lastPos = { t: m.t, dur: dur > 0 ? dur : this.sidecar.duration, home }
      if (type === 'pos') this.savePosition(m.playing === true)
    }
    if (DebugLog.on) DebugLog.log('page ' + JSON.stringify(sortKeys(m)))
  }

  /** Stops the video and the server. The session is not used after this. */
  close(): void {
    if (this.closed) return
    this.savePosition()
    this.closed = true
    if (this.scan) clearInterval(this.scan)
    try { this.view.webContents.close() } catch { /* gone */ }
    this.server.stop()
    DebugLog.log(`closed ${this.transcript.folder}`)
  }
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o).sort()) out[k] = o[k]
  return out
}
