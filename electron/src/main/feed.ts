import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWrite } from '../core/atomic'
import { withFileLock } from '../core/fileLock'
import {
  capShortsCache, channelURL, dayOf, encodeHidden, expandHome, followInMarkdown, HIDDEN_FILE, hideVideo, libraryIndex, mergeVideos,
  needsShortsCheck, newCount, parseHidden, parseSubscriptions, resolveBareLine, SUBSCRIPTIONS_FILE, SUBSCRIPTIONS_TEMPLATE, thumbnailURL,
  unfollowInMarkdown, visibleVideos, watchURLFor, type BareLine, type FeedChannel, type FeedVideo,
} from '../core/feed'
import { checkShort, fetchChannel, RateLimited, resolveChannel, type YTDLPRunner } from '../core/feedFetch'
import { findYTDLP, markdownFile, runYTDLP, videoIDInMarkdown } from '../core/folderMaker'
import { whileDownloading } from '../core/ytdlpUpdate'
import type { FeedState } from '../shared/api'
import { DebugLog } from './debugLog'
import { Settings } from './settings'
import type { MainWindow } from './window'

/**
 * The 📺 Feed (main process).
 * - Followed channels: `<feedDir>/subscriptions.md`, a markdown list the user can edit (feedDir: setting `feedDir`,
 *   default `~/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app`, the synced skills repo;
 *   `VIDEO_NOTES_FEED_DIR` overrides it for tests). Hidden ids: `<feedDir>/feed-hidden.json`. Both are re-read on
 *   every look and watched, so a channel added on another Mac (or typed by hand) shows up; a bare link the user
 *   typed is resolved and only that line is rewritten.
 * - Fetched videos, the Shorts checks (RSS fallback only) and "last opened": a per-machine cache,
 *   `<userData>/feed-cache.json`.
 * - Fetching: yt-dlp lists each channel's Videos tab (no Shorts), one channel at a time, ~1 s apart, waiting while
 *   yt-dlp updates; a 429 stops the round and keeps the cache. When the Feed opens (channels older than 30 min),
 *   hourly in the background, and once more 10 min after a round where a channel failed.
 */

interface ChannelCache { videos: FeedVideo[]; fetchedAt?: string; error?: string }
interface Cache {
  channels: Record<string, ChannelCache>
  /** `/shorts/<id>` check answers (RSS fallback only): true = Short. */
  shorts: Record<string, boolean>
  lastOpened?: string
}

const MIN = 60_000
const HOUR = 60 * MIN
const STALE = 30 * MIN
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isDir = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }

class FeedService {
  private cache: Cache = { channels: {}, shorts: {} }
  private loaded = false
  private refreshing = false
  private retryTimer: NodeJS.Timeout | null = null
  /** No fetching before this time (after a 429). */
  private backoffUntil = 0
  /** "Last opened" before the current opening: rows newer than it get the "new" dot. */
  private previousOpened: string | undefined
  private listeners: (() => void)[] = []
  /** Channels to fetch once the running round is done ('all' = every channel). */
  private pending: Set<string> | 'all' | null = null
  private lib: { at: number; map: Map<string, string> } | null = null
  /** Bare lines being resolved, and recent failures (line text → error, time), so a bad line is not retried in a loop. */
  private resolving = false
  private bareErrors = new Map<string, { error: string; at: number }>()

  private get cacheFile(): string { return join(app.getPath('userData'), 'feed-cache.json') }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const c = JSON.parse(readFileSync(this.cacheFile, 'utf8')) as Partial<Cache>
      this.cache = { channels: c.channels ?? {}, shorts: c.shorts ?? {}, lastOpened: c.lastOpened }
    } catch { /* first run */ }
    this.previousOpened = this.cache.lastOpened
  }

  private saveCache(): void {
    this.cache.shorts = capShortsCache(this.cache.shorts)
    try { atomicWrite(this.cacheFile, JSON.stringify(this.cache)) } catch (e) { DebugLog.log(`feed: could not save the cache: ${e}`) }
  }

  onChange(f: () => void): void { this.listeners.push(f) }
  private changed(): void { for (const f of this.listeners) f() }

  // ---------- subscriptions.md + feed-hidden.json (synced) ----------

  private watcher: FSWatcher | null = null
  private watchedDir = ''
  private watchTimer: NodeJS.Timeout | null = null

  /** The feed folder: `VIDEO_NOTES_FEED_DIR`, else the `feedDir` setting; `~` is the home folder. */
  get folder(): string { return expandHome(process.env.VIDEO_NOTES_FEED_DIR || Settings.feedDir, homedir()) }
  get subscriptionsFile(): string { return join(this.folder, SUBSCRIPTIONS_FILE) }
  get hiddenFile(): string { return join(this.folder, HIDDEN_FILE) }

  /** Creates the folder and the two files when missing (never touches other files there), and watches them. */
  private ensureFiles(): void {
    try {
      if (!existsSync(this.folder)) mkdirSync(this.folder, { recursive: true })
      if (!existsSync(this.subscriptionsFile)) atomicWrite(this.subscriptionsFile, SUBSCRIPTIONS_TEMPLATE)
      if (!existsSync(this.hiddenFile)) atomicWrite(this.hiddenFile, encodeHidden([]))
    } catch (e) { DebugLog.log(`feed: could not set up ${this.folder}: ${e}`) }
    this.watchFolder()
  }

  /** Changes on disk (another Mac synced, or a hand edit): resolve typed links, fetch new channels, push the state. */
  private watchFolder(): void {
    if (this.watchedDir === this.folder && this.watcher) return
    this.watcher?.close()
    this.watcher = null
    this.watchedDir = this.folder
    try {
      this.watcher = watch(this.folder, { persistent: false }, (_ev, name) => {
        if (name && name !== SUBSCRIPTIONS_FILE && name !== HIDDEN_FILE) return
        if (this.watchTimer) clearTimeout(this.watchTimer)
        this.watchTimer = setTimeout(() => { this.watchTimer = null; this.onDiskChange() }, 500)
      })
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = null })
    } catch (e) { DebugLog.log(`feed: cannot watch ${this.folder}: ${e}`) }
  }

  private onDiskChange(): void {
    void this.resolveBare()
    const fresh = this.channels().filter((c) => !this.cache.channels[c.id]).map((c) => c.id)
    if (fresh.length) { DebugLog.log(`feed: ${fresh.length} channel(s) new in ${SUBSCRIPTIONS_FILE}`); void this.refresh(fresh) }
    this.changed()
  }

  private readSubscriptions(): string {
    try { return readFileSync(this.subscriptionsFile, 'utf8') } catch { return '' }
  }

  private channels(): FeedChannel[] { return parseSubscriptions(this.readSubscriptions()).channels }

  private hidden(): string[] {
    try { return parseHidden(readFileSync(this.hiddenFile, 'utf8')) } catch { return [] }
  }

  /**
   * Read-modify-write of subscriptions.md: re-read right before (another Mac or the user may have changed it), apply
   * a minimal line edit, write atomically only when it changed.
   */
  private editSubscriptions(f: (md: string) => string): void {
    this.ensureFiles()
    // Same <file>.lock as transcript writes, so two writers never overwrite each other's edit.
    withFileLock(this.subscriptionsFile, () => {
      const before = this.readSubscriptions()
      const after = f(before)
      if (after !== before) {
        atomicWrite(this.subscriptionsFile, after)
        DebugLog.log(`feed: wrote ${this.subscriptionsFile}`)
      }
    })
  }

  private updateHidden(f: (x: string[]) => string[]): void {
    this.ensureFiles()
    withFileLock(this.hiddenFile, () => {
      const before = this.hidden()
      const after = f(before)
      if (after !== before) atomicWrite(this.hiddenFile, encodeHidden(after))
    })
  }

  /** Resolves the bare links the user typed (`- https://www.youtube.com/@handle`), one at a time, rewriting only that line. */
  private async resolveBare(): Promise<void> {
    if (this.resolving) return
    this.resolving = true
    try {
      for (;;) {
        const bare = parseSubscriptions(this.readSubscriptions()).bare
          .find((b) => { const e = this.bareErrors.get(b.text); return !e || Date.now() - e.at > 10 * MIN })
        if (!bare) break
        await this.resolveOne(bare)
      }
    } finally {
      this.resolving = false
    }
  }

  private async resolveOne(bare: BareLine): Promise<void> {
    try {
      const ch = await resolveChannel(bare.input)
      const c: FeedChannel = { id: ch.id, title: ch.title, url: channelURL(ch.id, ch.handle), added: dayOf(new Date()) }
      const fresh = !this.cache.channels[ch.id]
      this.cache.channels[ch.id] ??= { videos: [] }
      this.editSubscriptions((md) => resolveBareLine(md, bare, c))
      this.bareErrors.delete(bare.text)
      DebugLog.log(`feed: resolved "${bare.input}" → ${ch.id} ${ch.title}`)
      if (fresh) void this.refresh([ch.id])
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      this.bareErrors.set(bare.text, { error, at: Date.now() })
      DebugLog.log(`feed: could not resolve "${bare.input}": ${error}`)
    }
    this.changed()
  }

  // ---------- state for the New Tab pages ----------

  /** Video id → folder for the folders the New Tab page lists (pinned folders and Recent). */
  private library(): Map<string, string> {
    if (this.lib && Date.now() - this.lib.at < 3000) return this.lib.map
    const folders: { folder: string; id: string | null }[] = []
    const add = (d: string) => {
      const md = markdownFile(d)
      folders.push({ folder: d, id: md ? videoIDInMarkdown(md) : null })
    }
    for (const p of Settings.pinnedFolders) {
      let names: string[] = []
      try { names = readdirSync(p).sort() } catch { continue }
      for (const n of names) if (!n.startsWith('.') && isDir(join(p, n))) add(join(p, n))
    }
    for (const r of Settings.recents) add(r.folder)
    this.lib = { at: Date.now(), map: libraryIndex(folders) }
    return this.lib.map
  }

  state(): FeedState {
    this.load()
    this.ensureFiles()
    const subs = parseSubscriptions(this.readSubscriptions())
    const channels = subs.channels
    const lib = this.library()
    const videos = visibleVideos(Object.fromEntries(Object.entries(this.cache.channels).map(([k, v]) => [k, v.videos])), {
      followed: channels.map((c) => c.id), hidden: this.hidden(), shorts: this.cache.shorts,
    })
    const prev = this.previousOpened ? Date.parse(this.previousOpened) : NaN
    if (subs.bare.length && !this.resolving) void this.resolveBare()
    return {
      channels: channels.map((c) => {
        const cc = this.cache.channels[c.id]
        return { id: c.id, title: c.title, error: cc?.error ?? null, fetchedAt: cc?.fetchedAt ?? null, videos: videos.filter((v) => v.channelId === c.id).length }
      }),
      items: videos.map((v) => ({
        id: v.id, title: v.title, channelId: v.channelId,
        channelTitle: channels.find((c) => c.id === v.channelId)?.title ?? v.channelTitle,
        published: v.published, thumbnail: thumbnailURL(v.id), url: watchURLFor(v.id), duration: v.duration ?? null, folder: lib.get(v.id) ?? null,
        isNew: Number.isFinite(prev) && Date.parse(v.published) > prev,
      })),
      newCount: newCount(videos, this.cache.lastOpened, (id) => lib.has(id)),
      refreshing: this.refreshing || this.resolving,
      file: this.subscriptionsFile,
      problems: subs.bare.flatMap((b) => { const e = this.bareErrors.get(b.text); return e ? [`${b.input}: ${e.error}`] : [] }),
    }
  }

  // ---------- actions ----------

  /** The Feed view opened: re-read the files, refresh stale channels, clear the badge. `again` (still open): only clear the badge. */
  opened(again: boolean): void {
    this.load()
    if (!again) this.previousOpened = this.cache.lastOpened
    this.cache.lastOpened = new Date().toISOString()
    this.saveCache()
    if (again) { this.changed(); return }
    void this.resolveBare()
    const stale = this.channels().filter((c) => {
      const t = this.cache.channels[c.id]?.fetchedAt
      return !t || Date.now() - Date.parse(t) > STALE
    }).map((c) => c.id)
    if (stale.length) void this.refresh(stale)
    else this.changed()
  }

  async follow(input: string): Promise<string | null> {
    this.load()
    try {
      const ch = await resolveChannel(input)
      const c: FeedChannel = { id: ch.id, title: ch.title, url: channelURL(ch.id, ch.handle), added: dayOf(new Date()) }
      this.cache.channels[ch.id] ??= { videos: [] } // known here: the file watcher does not fetch it a second time
      this.editSubscriptions((md) => followInMarkdown(md, c))
      DebugLog.log(`feed: follow ${ch.id} ${ch.title} ${ch.handle ?? ''}`)
      if (!this.cache.lastOpened) { this.cache.lastOpened = new Date().toISOString(); this.saveCache() }
      this.changed()
      void this.refresh([ch.id])
      return null
    } catch (e) {
      DebugLog.log(`feed: follow ${input} failed: ${e}`)
      return e instanceof Error ? e.message : String(e)
    }
  }

  async followFolder(folder: string): Promise<string | null> {
    const md = markdownFile(folder)
    const id = md ? videoIDInMarkdown(md) : null
    if (!id) return 'This folder has no YouTube link.'
    return this.follow(watchURLFor(id))
  }

  unfollow(channelId: string): void {
    this.load()
    DebugLog.log(`feed: unfollow ${channelId}`)
    try { this.editSubscriptions((md) => unfollowInMarkdown(md, channelId)) } catch (e) { DebugLog.log(`feed: could not unfollow ${channelId}: ${e}`) }
    delete this.cache.channels[channelId]
    this.saveCache()
    this.changed()
  }

  hide(videoId: string): void {
    DebugLog.log(`feed: hide ${videoId}`)
    try { this.updateHidden((x) => hideVideo(x, videoId)) } catch (e) { DebugLog.log(`feed: could not hide ${videoId}: ${e}`) }
    this.changed()
  }

  /** yt-dlp listing runner: waits while yt-dlp updates (and counts as a download, so no update starts meanwhile). */
  private ytdlp(): YTDLPRunner | null {
    const bin = findYTDLP()
    if (!bin) return null
    return (args) => whileDownloading(async () => {
      const lines: string[] = []
      await runYTDLP(bin, args, (l) => lines.push(l))
      return lines
    })
  }

  /**
   * Fetches the followed channels (or just `only`), one at a time, ~1 s apart. Errors are kept per channel (a small
   * note in the Feed); the cached videos stay. A 429 stops the round and pauses fetching for 30 min.
   */
  async refresh(only?: string[]): Promise<void> {
    this.load()
    if (this.refreshing) {
      if (!only || this.pending === 'all') this.pending = 'all'
      else this.pending = new Set([...(this.pending ?? []), ...only])
      return
    }
    if (Date.now() < this.backoffUntil) { DebugLog.log('feed: backing off after a 429'); return }
    this.ensureFiles()
    const channels = this.channels().filter((c) => !only || only.includes(c.id))
    if (!channels.length) { this.changed(); return }
    this.refreshing = true
    this.changed()
    let failed = 0
    const ytdlp = this.ytdlp()
    try {
      for (const [n, c] of channels.entries()) {
        if (n > 0) await sleep(1000)
        const cc: ChannelCache = this.cache.channels[c.id] ?? { videos: [] }
        try {
          const r = await fetchChannel(c.id, { title: c.title, ytdlp })
          cc.videos = mergeVideos(cc.videos, r.videos)
          cc.fetchedAt = new Date().toISOString()
          delete cc.error
          DebugLog.log(`feed: ${c.title}: ${r.videos.length} via ${r.source}`)
        } catch (e) {
          cc.error = e instanceof Error ? e.message : String(e)
          failed++
          DebugLog.log(`feed: ${c.title}: ${cc.error}`)
          if (e instanceof RateLimited) {
            this.cache.channels[c.id] = cc
            this.backoffUntil = Date.now() + 30 * MIN
            break
          }
        }
        this.cache.channels[c.id] = cc
        // RSS fallback only: a video with a /watch link is checked once with /shorts/<id>
        for (const v of cc.videos) {
          if (!needsShortsCheck(v, this.cache.shorts)) continue
          const verdict = await checkShort(v.id)
          if (verdict !== 'unknown') this.cache.shorts[v.id] = verdict === 'short'
          await sleep(150)
        }
        this.saveCache()
        this.changed()
      }
    } finally {
      this.refreshing = false
      this.saveCache()
      this.changed()
    }
    if (failed && !this.retryTimer) {
      const ids = channels.filter((c) => this.cache.channels[c.id]?.error).map((c) => c.id)
      const wait = Math.max(10 * MIN, this.backoffUntil - Date.now())
      this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.refresh(ids) }, wait)
      this.retryTimer.unref()
    }
    const next = this.pending
    this.pending = null
    if (next) void this.refresh(next === 'all' ? undefined : [...next])
  }
}

export const Feed = new FeedService()

/** IPC of the Feed. */
export function registerFeed(get: () => MainWindow | null): void {
  Feed.onChange(() => {
    const w = get()
    if (w && !w.shell.webContents.isDestroyed()) w.shell.webContents.send('feed:state', Feed.state())
  })
  ipcMain.handle('feed:state', () => Feed.state())
  ipcMain.on('feed:opened', (_e, again: boolean) => Feed.opened(!!again))
  ipcMain.on('feed:refresh', () => void Feed.refresh())
  ipcMain.handle('feed:follow', (_e, input: string) => Feed.follow(String(input ?? '')))
  ipcMain.handle('feed:followFolder', (_e, folder: string) => Feed.followFolder(String(folder ?? '')))
  ipcMain.on('feed:unfollow', (_e, id: string) => Feed.unfollow(String(id)))
  ipcMain.on('feed:hide', (_e, id: string) => Feed.hide(String(id)))
}

/** A first round shortly after start (for the badge), then every hour. */
export function startFeedTimer(): void {
  setTimeout(() => void Feed.refresh(), 15_000).unref()
  setInterval(() => void Feed.refresh(), HOUR).unref()
}
