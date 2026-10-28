import { app, BaseWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, screen, shell, WebContentsView, type MenuItemConstructorOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { ensure, entry, inProgress, make, markdownFile, NeedsFormatting, type FolderEntry, type TranscriptFolder } from '../core/folderMaker'
import { createTopic, deleteEmptyTopic, folderTree, listFolder, listLibrary, moveVideoFolder, relocatePath, renameTopic, videoFolders, type FolderNode } from '../core/library'
import { cardId, type BoardOrder, type DropSpot } from '../core/board'
import { moveOnBoard, readBoard } from '../core/boardFile'
import { getLibraryRoots, readStatus, startInBacklog, statusFolder, statusRootOf, writeStatus } from '../core/status'
import { parseYouTubeID } from '../core/transcript'
import type { FolderResult, LauncherInfo, MenuSpec, MoveAnswer, ShellCommand, ShellState, Source, TabInfo, WorkEvent } from '../shared/api'
import { DebugLog } from './debugLog'
import { Feed } from './feed'
import { PlayerSession } from './session'
import { Settings } from './settings'

interface Tab { id: string; kind: 'new' | 'player'; title: string; session?: PlayerSession }

export interface WindowOptions {
  /** False in the --open test mode: then the open tabs and Recent of the user are left alone. */
  remember: boolean
  muted: boolean
  inactive: boolean
  preloadDir: string
  rendererURL: string | null
  rendererFile: string
}

const BAR = 44

/**
 * The app's window: a tab strip on top (the shell view, which also draws the New Tab pages), and
 * one WebContentsView per open video below it. Only the visible tab plays: switching tabs pauses
 * the one left behind.
 */
/** Tab menu "Copy for Agent": a short prompt that points an agent at the skill and this video's transcript. */
export function agentPrompt(title: string, markdown: string): string {
  const skill = join(homedir(), 'Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app/SKILL.md')
  return [
    `Use the yaseen-video-notes-app skill (read ${skill} first).`,
    `Video: ${title}`,
    `Transcript: ${markdown}`,
    'Make Mochi cards from the open #mochi notes.',
  ].join('\n')
}

export class MainWindow {
  readonly win: BaseWindow
  readonly shell: WebContentsView
  tabs: Tab[] = []
  activeId: string | null = null
  private closing = false

  constructor(private opts: WindowOptions) {
    const b = Settings.bounds
    const visible = b && screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y
    })
    this.win = new BaseWindow({
      width: 1440, height: 900, minWidth: 620, minHeight: 480,
      ...(visible ? b : {}),
      title: 'Yaseen Video Notes',
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#fbfaf7',
    })
    if (!visible) this.win.center()
    this.shell = new WebContentsView({
      webPreferences: { preload: join(opts.preloadDir, 'shell.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    this.shell.webContents.setZoomFactor(Settings.uiScale)
    this.shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.shell.webContents.on('will-navigate', (e) => e.preventDefault())
    this.win.contentView.addChildView(this.shell)
    if (opts.rendererURL) void this.shell.webContents.loadURL(opts.rendererURL)
    else void this.shell.webContents.loadFile(opts.rendererFile)
    this.layout()
    this.win.on('resize', () => this.layout())
    this.win.on('close', () => this.onClose())
    if (opts.inactive) this.win.showInactive()
    else this.win.show()
    DebugLog.log(`window ${this.win.getMediaSourceId()}`)
  }

  get barHeight(): number { return Math.round(BAR * Settings.uiScale) }
  get activeTab(): Tab | undefined { return this.tabs.find((t) => t.id === this.activeId) }
  get activeSession(): PlayerSession | undefined { return this.activeTab?.session }

  layout(): void {
    const { width, height } = this.win.getContentBounds()
    this.shell.setBounds({ x: 0, y: 0, width, height })
    const bar = this.barHeight
    for (const t of this.tabs) t.session?.view.setBounds({ x: 0, y: bar, width, height: Math.max(0, height - bar) })
  }

  state(): ShellState {
    const tabs: TabInfo[] = this.tabs.map((t) => ({
      id: t.id, kind: t.kind, title: t.title,
      tooltip: t.session ? t.session.transcript.markdown : t.title,
    }))
    return { tabs, active: this.activeId, scale: Settings.uiScale }
  }

  pushState(): void {
    if (this.closing) return
    this.shell.webContents.send('shell:state', this.state())
    const t = this.activeTab
    this.win.setTitle(t ? t.title : 'Yaseen Video Notes')
  }

  work(e: WorkEvent): void { if (!this.closing) this.shell.webContents.send('shell:work', e) }
  command(c: ShellCommand): void { if (!this.closing) this.shell.webContents.send('shell:command', c) }

  // ---------- tabs ----------

  private insert(tab: Tab, after: string | null): void {
    const i = after ? this.tabs.findIndex((t) => t.id === after) : -1
    if (i >= 0) this.tabs.splice(i + 1, 0, tab)
    else this.tabs.push(tab)
  }

  /** A New Tab page. `openPanel` also shows the "Open existing…" panel. */
  newTab(openPanel = false): Tab {
    const tab: Tab = { id: randomUUID(), kind: 'new', title: 'New Tab' }
    this.insert(tab, this.activeId)
    this.select(tab.id)
    if (openPanel) setTimeout(() => void this.openExisting(tab.id), 0)
    return tab
  }

  /** Opens a video in a tab (in place of `replacing`, a New Tab), or shows its tab if it is open. */
  async openPlayer(t: TranscriptFolder, replacing: string | null = null): Promise<void> {
    const open = this.tabs.find((x) => x.session && x.session.transcript.folder === t.folder)
    if (open) {
      if (replacing && replacing !== open.id) this.close(replacing, true)
      this.select(open.id)
      return
    }
    try {
      const s = await PlayerSession.open(t, {
        preload: join(this.opts.preloadDir, 'player.js'), zoom: Settings.uiScale, muted: this.opts.muted,
      })
      if (this.closing) { s.close(); return }
      const tab: Tab = { id: randomUUID(), kind: 'player', title: s.sidecar.title, session: s }
      s.view.setVisible(false)
      this.win.contentView.addChildView(s.view)
      this.insert(tab, replacing ?? this.activeId)
      if (replacing) this.close(replacing, true)
      this.layout()
      this.select(tab.id)
      if (this.opts.remember) {
        Settings.addRecent({ title: s.sidecar.title, folder: t.folder, url: `https://www.youtube.com/watch?v=${s.sidecar.id}`, opened: Date.now() })
      }
      DebugLog.log(`opened ${t.folder} in tab ${this.tabs.length}`)
    } catch (e) {
      const tab = this.activeTab?.kind === 'new' ? this.activeTab : this.newTab()
      this.work({ tabId: tab.id, step: 'failed', error: `Could not open the player: ${e instanceof Error ? e.message : String(e)}` })
    }
    this.saveOpenTabs()
  }

  select(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const old = this.activeTab
    if (old && old.id !== id && old.session) {
      old.session.visible = false
      old.session.run('FA.pause()') // only the visible tab plays
      old.session.view.setVisible(false)
    }
    this.activeId = id
    if (tab.session) {
      tab.session.visible = true
      tab.session.view.setVisible(true)
      tab.session.view.webContents.focus()
    } else {
      this.shell.webContents.focus()
    }
    this.pushState()
    DebugLog.log(`tab select ${this.tabs.findIndex((t) => t.id === id) + 1}/${this.tabs.length}: ${tab.title}`)
  }

  selectIndex(n: number): void {
    if (!this.tabs.length) return
    const i = n >= 9 ? this.tabs.length - 1 : Math.min(n - 1, this.tabs.length - 1)
    this.select(this.tabs[i].id)
  }

  step(d: number): void {
    const i = this.tabs.findIndex((t) => t.id === this.activeId)
    if (i < 0 || !this.tabs.length) return
    this.select(this.tabs[(i + d + this.tabs.length) % this.tabs.length].id)
  }

  /** Closes a tab. Closing the last video leaves a New Tab; closing the last New Tab closes the window. */
  close(id: string, force = false): void {
    const i = this.tabs.findIndex((t) => t.id === id)
    if (i < 0) return
    const tab = this.tabs[i]
    if (!force && this.tabs.length === 1) {
      if (!tab.session) { this.win.close(); return }
      this.newTab()
    }
    if (tab.session) {
      this.win.contentView.removeChildView(tab.session.view)
      tab.session.close()
    }
    this.tabs = this.tabs.filter((t) => t.id !== id)
    if (this.activeId === id && this.tabs.length) this.select(this.tabs[Math.min(i, this.tabs.length - 1)].id)
    else this.pushState()
    this.saveOpenTabs()
  }

  closeActive(): void { if (this.activeId) this.close(this.activeId) }

  saveOpenTabs(): void {
    if (!this.opts.remember || this.closing) return
    Settings.openTabs = this.tabs.filter((t) => t.session).map((t) => t.session!.transcript.folder)
  }

  private onClose(): void {
    if (this.closing) return
    this.saveOpenTabs()
    this.closing = true
    Settings.bounds = this.win.getBounds()
    for (const t of this.tabs) t.session?.close()
    Settings.flush()
  }

  /** Quit: write every tab's position. */
  savePositions(): void { for (const t of this.tabs) t.session?.savePosition() }

  // ---------- zoom (⌘+ / ⌘− / ⌘0): the whole window, all tabs ----------

  zoom(d: number): void {
    const z = Settings.stepScale(d)
    this.shell.webContents.setZoomFactor(z)
    for (const t of this.tabs) t.session?.view.webContents.setZoomFactor(z)
    this.layout()
    this.pushState()
    const text = Settings.percent
    if (this.activeSession) this.activeSession.run(`FA.zoomToast(${JSON.stringify(text)})`)
    else this.command({ kind: 'toast', text })
    DebugLog.log(`zoom ${text}`)
  }

  /** A short message over whatever the active tab shows (the player's toast, or the shell's on a New Tab). */
  notify(text: string, ms = 4000): void {
    if (this.closing) return
    if (this.activeSession) this.activeSession.run(`FA.notice(${JSON.stringify(text)}, ${ms})`)
    else this.command({ kind: 'toast', text, ms })
    DebugLog.log(`notice: ${text}`)
  }

  find(): void {
    if (this.activeSession) this.activeSession.run('FA.find()')
    else if (this.activeId) this.command({ kind: 'focusFilter', tabId: this.activeId })
  }

  toggleFocus(): void { this.activeSession?.run('FA.toggleFocus()') }

  /** View → Reload Video (⌘R): reloads the active video's page, which resumes at the saved spot; on a New Tab, reloads the shell. */
  reloadActive(): void {
    if (this.activeSession) this.activeSession.reload()
    else this.shell.webContents.reload()
  }

  // ---------- New Tab: open / create ----------

  /** Opens a video folder. A plain transcript from another tool is reformatted only after the user says yes. */
  async openFolder(tabId: string, path: string, allowFormat = false): Promise<void> {
    await this.runWork(tabId, (progress) => ensure(path, { allowFormat, progress }))
  }

  async create(tabId: string, link: string, destination: string): Promise<void> {
    const l = link.trim()
    if (!parseYouTubeID(l)) return
    const parent = destination.startsWith('~/') ? homedir() + destination.slice(1) : destination
    Settings.outputParent = parent
    // a new destination becomes a library in the sidebar, unless it is a topic folder of one already
    const pinIt = () => { if (!inLibrary(parent) && existsSync(parent)) Settings.pinnedFolders = [...Settings.pinnedFolders, parent] }
    pinIt()
    // the same video anywhere in this library (another topic) is reused, never made twice
    const root = libraryOf(parent)
    await this.runWork(tabId, async (progress) => {
      const t = await make(l, parent, { allowFormat: false, progress, existingIn: root ? videoFolders(root) : [] })
      if (!t.reused) startInBacklog(t.folder, t.markdown, DebugLog.log)   // a new video starts in Backlog (status of the library)
      return t
    })
    pinIt()
  }

  /**
   * A folder moved (a video into another topic, a topic renamed): everything that holds its path follows — the
   * saved settings (Recent, open tabs, pinned, destination, collapsed tree folders), and every open tab playing a
   * video in it is re-pointed in place (no reload: the page only talks to its session's server).
   */
  relocate(from: string, to: string): void {
    Settings.relocate(from, to)
    let tabs = 0
    for (const t of this.tabs) {
      const s = t.session
      if (!s || relocatePath(s.transcript.folder, from, to) === s.transcript.folder) continue
      const r = (p: string) => relocatePath(p, from, to)
      s.relocate({ ...s.transcript, folder: r(s.transcript.folder), markdown: r(s.transcript.markdown), sidecar: r(s.transcript.sidecar) })
      tabs++
    }
    Feed.libraryMoved()
    this.saveOpenTabs()
    this.pushState()
    DebugLog.log(`moved ${from} → ${to}${tabs ? ` (${tabs} open tab${tabs === 1 ? '' : 's'} re-pointed)` : ''}`)
  }

  async openExisting(tabId: string, startAt?: string): Promise<void> {
    const r = await dialog.showOpenDialog(this.dialogParent(), {
      properties: ['openDirectory', 'openFile'],
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      buttonLabel: 'Open',
      message: 'Choose a video folder (or its .md).',
      defaultPath: startAt && existsSync(startAt) ? startAt : Settings.pinnedFolders[0],
    })
    if (r.canceled || !r.filePaths[0]) return
    await this.openFolder(tabId, r.filePaths[0])
  }

  private dialogParent(): BaseWindow { return this.win }

  private async runWork(tabId: string, work: (p: (l: string) => void) => Promise<TranscriptFolder>): Promise<void> {
    this.work({ tabId, step: 'working' })
    try {
      const t = await work((line) => { DebugLog.log(`prepare: ${line}`); this.work({ tabId, step: 'working', line }) })
      this.work({ tabId, step: 'browse' })
      await this.openPlayer(t, this.tabs.some((x) => x.id === tabId) ? tabId : null)
    } catch (e) {
      if (e instanceof NeedsFormatting) {
        this.work({ tabId, step: 'browse' })
        await this.confirmFormat(tabId, e)
        return
      }
      this.work({ tabId, step: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Asks before a plain transcript is reformatted. Yes: format and open. No: stay here. */
  private async confirmFormat(tabId: string, need: NeedsFormatting): Promise<void> {
    DebugLog.log(`asking to format ${need.markdown}`)
    const r = await dialog.showMessageBox(this.dialogParent(), {
      type: 'question',
      message: 'Format this transcript for Yaseen Video Notes?',
      detail: `${basename(need.markdown)} is a plain transcript. Yaseen Video Notes will rewrite it as timestamped paragraphs (the header and any frontmatter stay at the top). The original is kept as ${basename(need.backup)}.`,
      buttons: ['Format', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (r.response === 0) await this.openFolder(tabId, need.folder, true)
  }

  // ---------- context menus ----------

  tabMenu(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const items: MenuItemConstructorOptions[] = []
    const s = tab.session
    if (s) {
      items.push(
        { label: 'Copy for Agent', click: () => clipboard.writeText(agentPrompt(s.sidecar.title, s.transcript.markdown)) },
        { label: 'Copy YouTube Link', click: () => clipboard.writeText(`https://www.youtube.com/watch?v=${s.sidecar.id}`) },
        { label: 'Copy .md Path', click: () => clipboard.writeText(s.transcript.markdown) },
        { label: 'Show in Finder', click: () => shell.showItemInFolder(s.transcript.markdown) },
        { type: 'separator' },
      )
    }
    items.push({ label: 'Close Tab', click: () => this.close(id) })
    Menu.buildFromTemplate(items).popup({ window: this.win as unknown as Electron.BrowserWindow })
  }

  popup(specs: MenuSpec[]): Promise<string | null> {
    const scripted = scriptedAnswer(`menu ${JSON.stringify(specs)}`)
    if (scripted !== undefined) return Promise.resolve(scripted)
    return new Promise((resolve) => {
      let chosen: string | null = null
      const build = (list: MenuSpec[]): MenuItemConstructorOptions[] => list.map((m) => m.separator
        ? { type: 'separator' as const }
        : {
            label: m.label ?? '',
            enabled: m.enabled ?? true,
            ...(m.checked !== undefined ? { type: 'checkbox' as const, checked: m.checked } : {}),
            ...(m.submenu ? { submenu: build(m.submenu) } : { click: () => { chosen = m.id ?? null } }),
          })
      Menu.buildFromTemplate(build(specs)).popup({ window: this.win as unknown as Electron.BrowserWindow, callback: () => setTimeout(() => resolve(chosen), 0) })
    })
  }
}

// ---------- IPC (one window) ----------

export function registerIPC(get: () => MainWindow | null): void {
  const w = () => get()
  ipcMain.handle('shell:state', () => w()?.state())
  ipcMain.on('tab:new', () => w()?.newTab())
  ipcMain.on('tab:select', (_e, id: string) => w()?.select(id))
  ipcMain.on('tab:close', (_e, id: string) => w()?.close(id))
  ipcMain.on('tab:menu', (_e, id: string) => w()?.tabMenu(id))
  ipcMain.handle('launcher:info', (): LauncherInfo => launcherInfo())
  ipcMain.handle('launcher:list', (_e, source: Source) => listSource(source))
  ipcMain.handle('launcher:addFolder', async (_e, startAt?: string) => {
    const win = w()
    if (!win) return null
    const r = await dialog.showOpenDialog(win.win, {
      properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Add',
      message: 'Choose a folder of video folders (like learning-log).',
      defaultPath: startAt && existsSync(startAt) ? startAt : undefined,
    })
    const p = r.canceled ? null : r.filePaths[0] ?? null
    if (p && !Settings.pinnedFolders.includes(p)) Settings.pinnedFolders = [...Settings.pinnedFolders, p]
    return p
  })
  ipcMain.handle('launcher:removeFolder', (_e, path: string): LauncherInfo => {
    Settings.pinnedFolders = Settings.pinnedFolders.filter((p) => p !== path)
    return launcherInfo()
  })
  ipcMain.on('launcher:open', (_e, tabId: string, path: string) => void w()?.openFolder(tabId, path))
  ipcMain.on('launcher:openExisting', (_e, tabId: string, startAt?: string) => void w()?.openExisting(tabId, startAt))
  ipcMain.on('launcher:create', (_e, tabId: string, link: string, dest: string) => void w()?.create(tabId, link, dest))
  ipcMain.handle('launcher:setStatus', (_e, folder: string, value: string) => {
    try {
      const md = markdownFile(folder)
      if (!md) return 'no transcript .md'
      writeStatus(folder, md, value)
      DebugLog.log(`status set ${value} for ${basename(folder)}`)
      return null
    } catch (e) {
      return `Could not set the status: ${e instanceof Error ? e.message : String(e)}`
    }
  })
  ipcMain.on('launcher:groupByStatus', (_e, on: boolean) => { Settings.groupByStatus = !!on })
  ipcMain.on('launcher:columnWidths', (_e, w: unknown) => {
    const out: Record<string, number> = {}
    if (w && typeof w === 'object') for (const [k, v] of Object.entries(w as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v)
    Settings.columnWidths = out
  })
  ipcMain.on('launcher:collapsed', (_e, keys: unknown) => { Settings.collapsedColumns = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [] })
  // the order file is the library's (status folder), for its videos at any depth; a topic shows it filtered
  ipcMain.handle('board:order', (_e, parent: string) => (isDir(parent) ? readBoard(statusRootOf(parent)) : {}))
  // 📚 All videos: every library's order, column by column (ids are video ids; each card is written to its own library's file)
  ipcMain.handle('board:orderAll', (): BoardOrder => {
    const out: BoardOrder = {}
    for (const root of new Set(Settings.pinnedFolders.filter(isDir).map((p) => statusRootOf(p)))) {
      for (const [k, ids] of Object.entries(readBoard(root))) out[k] = [...new Set([...(out[k] ?? []), ...ids])]
    }
    return out
  })
  ipcMain.handle('board:move', (_e, folder: string, to: string, spot: DropSpot) => {
    try {
      const md = markdownFile(folder)
      if (!md) return 'no transcript .md'
      if (readStatus(folder, md) !== to) {
        writeStatus(folder, md, to)
        DebugLog.log(`status set ${to} for ${basename(folder)} (board)`)
      }
      const e = entry(folder)
      if (!e) return null
      moveOnBoard(statusFolder(folder), cardId(e), to, spot ?? {})
      return null
    } catch (e) {
      return `Could not move the card: ${e instanceof Error ? e.message : String(e)}`
    }
  })
  // ---------- the sidebar's folder tree: libraries (pinned) and their topic folders ----------
  ipcMain.handle('library:tree', (): FolderNode[] => Settings.pinnedFolders.filter(isDir).map((p) => folderTree(p)))
  ipcMain.on('library:collapsed', (_e, paths: unknown) => { Settings.collapsedFolders = Array.isArray(paths) ? paths.filter((k): k is string => typeof k === 'string') : [] })
  ipcMain.handle('library:newFolder', (_e, parent: string, name: string): FolderResult => {
    if (!inLibrary(parent)) return { error: 'New folders go inside a library folder of the sidebar.' }
    try {
      const path = createTopic(parent, String(name ?? ''))
      DebugLog.log(`new folder ${path}`)
      return { path }
    } catch (e) { return { error: message(e) } }
  })
  ipcMain.handle('library:renameFolder', (_e, path: string, name: string): FolderResult => {
    if (!inLibrary(path) || Settings.pinnedFolders.includes(path)) return { error: 'Only topic folders inside a library can be renamed here.' }
    try {
      const to = renameTopic(path, String(name ?? ''))
      if (to !== path) w()?.relocate(path, to)
      return { path: to }
    } catch (e) { return { error: message(e) } }
  })
  ipcMain.handle('library:deleteFolder', async (_e, path: string): Promise<string | null> => {
    const win = w()
    if (!win || !inLibrary(path) || Settings.pinnedFolders.includes(path)) return 'Only topic folders inside a library can be deleted here.'
    const scripted = scriptedAnswer(`confirm delete ${path}`)
    const ok = scripted !== undefined ? scripted === 'delete' : (await dialog.showMessageBox(win.win, {
      type: 'warning', message: `Delete the folder "${basename(path)}"?`, detail: 'It is empty. This cannot be undone.',
      buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1,
    })).response === 0
    if (!ok) return 'cancel'
    try {
      deleteEmptyTopic(path)
      Settings.collapsedFolders = Settings.collapsedFolders.filter((p) => p !== path)
      if (Settings.outputParent === path) Settings.outputParent = dirname(path)
      DebugLog.log(`deleted empty folder ${path}`)
      return null
    } catch (e) { return message(e) }
  })
  ipcMain.handle('library:move', (_e, folder: string, destParent: string): MoveAnswer => {
    if (!inLibrary(destParent)) return { error: 'Videos move only into the folders of a library in the sidebar.' }
    try {
      const r = moveVideoFolder(folder, destParent)
      if (!r) return null
      w()?.relocate(r.from, r.to)
      return r
    } catch (e) { return { error: message(e) } }
  })
  ipcMain.handle('menu:popup', (_e, items: MenuSpec[]) => w()?.popup(items) ?? null)
  ipcMain.on('finder:show', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.on('player:native', (e, m: Record<string, unknown>) => {
    const s = w()?.tabs.find((t) => t.session && !t.session.closed && t.session.view.webContents.id === e.sender.id)?.session
    s?.received(m)
  })
}

function launcherInfo(): LauncherInfo {
  return {
    pinned: Settings.pinnedFolders, outputParent: Settings.outputParent, groupByStatus: Settings.groupByStatus,
    collapsedColumns: Settings.collapsedColumns, collapsedFolders: Settings.collapsedFolders, columnWidths: Settings.columnWidths, home: homedir(),
  }
}

function listSource(source: Source): FolderEntry[] {
  const recentEntries = () => Settings.recents.map((r) => entry(r.folder)).filter((e): e is FolderEntry => e !== null)
  switch (source.kind) {
    case 'folder':
      // a library or topic, Finder-style: only the videos right in it (a topic's show when the topic is clicked)
      return isDir(source.path) ? listFolder(source.path) : []
    case 'all': {
      // 📚 All videos: every library's videos at any depth (topic chips relative to its library), newest first
      const seen = new Set<string>()
      return Settings.pinnedFolders.filter(isDir).flatMap((p) => listLibrary(p))
        .filter((e) => !seen.has(e.folder) && (seen.add(e.folder), true))
        .sort((a, b) => (a.date !== b.date ? b.date - a.date : b.modified - a.modified))
    }
    case 'recent':
      return recentEntries()
    case 'inProgress': {
      const seen = new Set<string>()
      return [...Settings.pinnedFolders.flatMap((p) => listLibrary(p)), ...recentEntries()]
        .filter((e) => inProgress(e) && !seen.has(e.folder) && (seen.add(e.folder), true))
        .sort((a, b) => ((b.progress?.updated ?? '') > (a.progress?.updated ?? '') ? 1 : (b.progress?.updated ?? '') < (a.progress?.updated ?? '') ? -1 : 0))
    }
  }
}

const isDir = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }
/**
 * Test instances: VIDEO_NOTES_MENU_SCRIPT=<file> answers each context menu / confirm with the file's next line (a
 * menu item id, "delete", or empty for none) instead of showing it, and logs what was asked, so CDP tests can drive
 * them. undefined: not scripted (show the real one).
 */
function scriptedAnswer(what: string): string | null | undefined {
  const script = process.env.VIDEO_NOTES_MENU_SCRIPT
  if (!script) return undefined
  let lines: string[] = []
  try { lines = readFileSync(script, 'utf8').split('\n') } catch { /* none */ }
  const pick = lines.length ? lines.shift()!.trim() : ''
  try { writeFileSync(script, lines.join('\n')) } catch { /* ignore */ }
  DebugLog.log(`scripted → ${pick || 'none'}: ${what}`)
  return pick || null
}
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
/** The library (pinned folder) that holds `p` (or is `p`), or null. */
const libraryOf = (p: string): string | null => getLibraryRoots().find((r) => p === r || p.startsWith(r + '/')) ?? null
/** True for a library folder or a folder inside one. */
const inLibrary = (p: string): boolean => typeof p === 'string' && libraryOf(p) !== null

export const appReady = (): Promise<void> => app.whenReady()
