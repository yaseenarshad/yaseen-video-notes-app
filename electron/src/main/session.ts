import { clipboard, shell, WebContentsView, webFrameMain, type WebFrameMain } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { atomicWrite as atomicWriteText } from '../core/atomic'
import { device, readProgress, writeProgress } from '../core/progress'
import { addNote, deleteNote, editNote, NoteChanged, noteJSON, parse as parseNotes } from '../core/notes'
import { advanceStatus } from '../core/status'
import { decodeSidecar, type Sidecar } from '../core/transcript'
import type { TranscriptFolder } from '../core/folderMaker'
import { DebugLog } from './debugLog'
import { json, LocalServer, text, type Request, type Response } from './server'
import { Settings } from './settings'
import PLAYER_HTML from './player.html?raw'
import INJECTED from './injected.js?raw'

const EMBED = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//

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
  private notesCache: { mtime: number; size: number; json: string } | null = null
  private lastPos: { t: number; dur: number } | null = null
  private markedWatched = false
  private written: { t: number; at: number } | null = null
  private scan: NodeJS.Timeout | null = null
  private connected = false
  private lastHiddenPause = 0
  /** Only the visible tab plays (set by the window when it shows / hides this tab). */
  visible = false
  closed = false

  private constructor(readonly transcript: TranscriptFolder, opts: SessionOptions) {
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
    wc.on('did-frame-finish-load', (_e, isMain, processId, routingId) => {
      if (!isMain) this.inject(webFrameMain.fromId(processId, routingId))
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
    // Status moves forward only: opening a video makes it "watching" (option 2).
    setImmediate(() => advanceStatus(t.folder, t.markdown, 1, DebugLog.log))
    void s.view.webContents.loadURL(s.pageURL)
    return s
  }

  get pageURL(): string { return `http://localhost:${this.server.port}/` }

  private inject(frame: WebFrameMain | null | undefined): void {
    if (!frame || frame.isDestroyed?.() || !EMBED.test(frame.url)) return
    frame.executeJavaScript(INJECTED)
      .then(() => DebugLog.log(`injected into ${frame.url.split('?')[0]}`))
      .catch((e: Error) => DebugLog.log(`inject failed: ${e.message}`))
  }

  private injectAll(): void {
    try {
      for (const f of this.view.webContents.mainFrame.framesInSubtree) if (f !== this.view.webContents.mainFrame) this.inject(f)
    } catch { /* destroyed */ }
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
      case 'GET /data.json':
        try { return { status: 200, type: 'application/json; charset=utf-8', body: readFileSync(this.transcript.sidecar) } } catch { return json({ error: 'no sidecar' }, 500) }
      case 'GET /api/notes':
        return { status: 200, type: 'application/json; charset=utf-8', body: this.notesJSON() }
      case 'POST /api/notes':
        return this.addNote(req.body)
      case 'POST /api/notes/delete':
      case 'POST /api/notes/edit':
        return this.changeNote(req.path, req.body)
      case 'GET /api/position': {
        // read fresh: another computer may have moved it (the vault syncs)
        const p = readProgress(this.transcript.folder)
        const other = p?.device && p.device !== device() ? p.device : '' // named only when it was another computer
        return json({ t: p?.seconds ?? 0, dur: p?.duration ?? 0, device: other })
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
    const c = this.notesCache
    if (c && c.mtime === mtime && c.size === size) return c.json
    let md = ''
    try { md = readFileSync(path, 'utf8') } catch { /* empty */ }
    const out = JSON.stringify(parseNotes(md).map(noteJSON))
    this.notesCache = { mtime, size, json: out }
    return out
  }

  private addNote(body: string): Response {
    let o: Record<string, unknown>
    try { o = JSON.parse(body) } catch { return json({ error: 'bad note' }, 400) }
    if (typeof o.para !== 'number' || typeof o.time !== 'number' || typeof o.text !== 'string') return json({ error: 'bad note' }, 400)
    const end = typeof o.end === 'number' ? o.end : null
    const quote = typeof o.quote === 'string' ? o.quote : null
    try {
      const notes = addNote(this.transcript.markdown, Math.trunc(o.para), o.time, o.text, end, quote)
      this.notesCache = null
      DebugLog.log(`note saved para=${o.para} time=${o.time} end=${end ?? '-'} text=${JSON.stringify(o.text)}`)
      return json(notes.map(noteJSON))
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  }

  /**
   * Delete / edit of one note. The page sends the note's paragraph, its place among that
   * paragraph's notes and the text it shows; a mismatch with the file is a 409.
   */
  private changeNote(path: string, body: string): Response {
    let o: Record<string, unknown>
    try { o = JSON.parse(body) } catch { return json({ error: 'bad request' }, 400) }
    if (typeof o.para !== 'number' || typeof o.index !== 'number' || typeof o.text !== 'string') return json({ error: 'bad request' }, 400)
    const time = typeof o.time === 'number' ? Math.trunc(o.time) : null
    const file = this.transcript.markdown
    try {
      const md = readFileSync(file, 'utf8')
      let out: string
      if (path.endsWith('/delete')) {
        out = deleteNote(md, Math.trunc(o.para), Math.trunc(o.index), o.text, time)[0]
      } else {
        if (typeof o.newText !== 'string' || o.newText.trim() === '') return json({ error: 'empty note' }, 400)
        out = editNote(md, Math.trunc(o.para), Math.trunc(o.index), o.text, time, o.newText)
      }
      // atomic write (temp file + rename)
      atomicWriteText(file, out)
      this.notesCache = null
      DebugLog.log(`note ${path.split('/').pop()} ok`)
      return json({ notes: parseNotes(out).map(noteJSON) })
    } catch (e) {
      if (e instanceof NoteChanged) {
        DebugLog.log(`note ${path}: ${e.message}`)
        return json({ error: e.message }, 409)
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
      writeProgress(this.transcript.folder, p.t, p.dur)
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
    // A tab that is not on screen never plays (e.g. a restored tab whose resume seek started it).
    if (type === 'tick' && m.paused === false && !this.visible && Date.now() - this.lastHiddenPause > 2000) {
      this.lastHiddenPause = Date.now()
      DebugLog.log('hidden tab was playing: pause')
      this.run('FA.pause()')
    }
    if ((type === 'tick' || type === 'pos') && typeof m.t === 'number' && m.ok !== false && m.resumed !== false) {
      // "tick" every second; "pos" on pause, after a seek, and every 10 s while playing ("playing": true)
      const dur = typeof m.dur === 'number' ? m.dur : 0
      this.lastPos = { t: m.t, dur: dur > 0 ? dur : this.sidecar.duration }
      if (type === 'pos') this.savePosition(m.playing === true)
      const p = this.lastPos
      if (!this.markedWatched && p.dur > 0 && p.t >= p.dur - Math.max(30, p.dur * 0.02)) {
        this.markedWatched = true // finished (the resume rule): "watched" (option 3)
        setImmediate(() => advanceStatus(this.transcript.folder, this.transcript.markdown, 2, DebugLog.log))
      }
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
