import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { parseYouTubeID } from '../core/transcript'
import { arrangeColumn, cardId, moveCard, newestFirst, type BoardOrder, type DropSpot } from '../core/board'
import type { FeedState, FolderEntry, FolderNode, LauncherInfo, LibraryView, MenuSpec, Source, WorkEvent } from '../shared/api'
import { Board, setDragPill, Thumb, type BoardColumn } from './Board'
import { FeedView } from './Feed'
import { DRAG_TYPE, FolderTree, flatten, libraryOf, parentOf, type Editing } from './FolderTree'

/** yaseen-docs-app's default status options (core/status.ts DEFAULT_OPTIONS). */
const DEFAULT_OPTIONS = ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done']
const name = (p: string): string => p.split('/').filter(Boolean).pop() ?? p
const tilde = (p: string, home: string): string => (home && p.startsWith(home + '/') ? '~' + p.slice(home.length) : p)
/** `p` after folder `from` was renamed to `to` (core/library.ts relocatePath). */
const relocated = (p: string, from: string, to: string): string => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
/** Indent for a nested folder in a native menu. */
const indent = (depth: number): string => '\u2003'.repeat(depth)
const sameSource = (a: Source | null, b: Source | null): boolean =>
  !!a && !!b && a.kind === b.kind && (a.kind !== 'folder' || (b.kind === 'folder' && a.path === b.path))
/** Views with a manual board order (a folder, 📚 All videos); Recent / In progress keep their own order. */
const hasBoardOrder = (s: Source | null): boolean => s?.kind === 'folder' || s?.kind === 'all'

type SortKey = 'title' | 'date' | 'progress' | 'status' | 'notes'

/** The furthest of where the playhead was and the 📍 home spot (progress and "min left" use it; see core/progress.ts). */
const furthest = (r: FolderEntry): number => (r.progress ? Math.max(r.progress.seconds, r.progress.home ?? r.progress.seconds) : 0)
const started = (r: FolderEntry): boolean => furthest(r) > 5
/** For sorting by progress: needs setup < not started < started < finished. */
const progressRank = (r: FolderEntry): number => (!r.ready ? -1 : !r.progress || furthest(r) <= 5 ? 0 : r.finished ? 2 : r.fraction)
/** For sorting by status: option order, unset first. */
const statusRank = (r: FolderEntry): number => (r.status ? r.statusOptions.indexOf(r.status) : -1)

function dateLabel(ms: number): string {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

function leftLabel(s: number): string {
  const m = Math.round(s / 60)
  if (m < 1) return '< 1m left'
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`
}

const Icon = {
  clock: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  play: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6.6 5.4v5.2L10.6 8z" fill="currentColor" /></svg>,
  folder: <svg viewBox="0 0 16 16"><path d="M1.8 4.2c0-.6.5-1.1 1.1-1.1h3.2l1.4 1.5h5.6c.6 0 1.1.5 1.1 1.1v6.2c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  plus: <svg viewBox="0 0 16 16"><path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>,
  other: <svg viewBox="0 0 16 16"><path d="M1.8 4.2c0-.6.5-1.1 1.1-1.1h3.2l1.4 1.5h5.6c.6 0 1.1.5 1.1 1.1v6.2c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1z" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M7 7.4c0-.7.5-1.1 1.1-1.1s1.1.4 1.1 1c0 .9-1.1.9-1.1 1.7M8.1 10.5v.1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
  link: <svg viewBox="0 0 16 16"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  search: <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.3" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="m10.2 10.2 3.3 3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  chevron: (open: boolean) => <svg viewBox="0 0 16 16" style={{ transform: open ? 'rotate(90deg)' : undefined }}><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
}

/** The New Tab page: a Finder-style browser of video folders, with a paste-a-link box on top. */
export function NewTab({ tabId, active, work, clearWork }: { tabId: string; active: boolean; work: WorkEvent | null; clearWork: () => void }) {
  const [info, setInfo] = useState<LauncherInfo | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [destination, setDestination] = useState('')
  const [rows, setRows] = useState<FolderEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState('')
  const [filter, setFilter] = useState('')
  const [group, setGroup] = useState(false)
  /** Board is the default and what every view opens in; Table lasts only until another view is chosen (not saved). */
  const [view, setView] = useState<LibraryView>('board')
  /** The board order (a folder's view: its library's order, filtered; All videos: every library's); null for Recent / In progress. */
  const [order, setOrder] = useState<BoardOrder | null>(null)
  /** A board move that could not be written (shown as a chip; the board goes back to what the files say). */
  const [moveError, setMoveError] = useState<string | null>(null)
  /** Collapsed board columns (settings `collapsedColumns`; every board view). */
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set())
  /** Board column widths (settings `columnWidths`; px by column key, "<key>:collapsed" for a strip). */
  const [colWidths, setColWidths] = useState<Record<string, number>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'date', asc: false })
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [dropOn, setDropOn] = useState<string | null>(null)
  /** The 📺 Feed is shown instead of the Library list. */
  const [feedOn, setFeedOn] = useState(false)
  const [feed, setFeed] = useState<FeedState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** The sidebar's folder tree: one per library (pinned folder), with its topic folders. */
  const [trees, setTrees] = useState<FolderNode[]>([])
  /** Collapsed folders of the tree (settings `collapsedFolders`). */
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  /** The inline name field of New Folder… / Rename…. */
  const [editing, setEditing] = useState<Editing | null>(null)
  /** The last move of a video ("Moved to AI agents · Undo"). */
  const [moved, setMoved] = useState<{ from: string; to: string; dest: string } | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<Source | null>(null)
  sourceRef.current = source

  // first load: the sidebar, the destination, the first source
  useEffect(() => {
    void window.fa.launcherInfo().then((i) => {
      setInfo(i)
      setGroup(i.groupByStatus)
      setCollapsedCols(new Set(i.collapsedColumns))
      setColWidths(i.columnWidths ?? {})
      setCollapsedFolders(new Set(i.collapsedFolders))
      setDestination(i.pinned[0] ?? i.outputParent)
      setSource(i.pinned[0] ? { kind: 'folder', path: i.pinned[0] } : { kind: 'recent' })
    })
  }, [])

  const loadTree = useCallback(() => { void window.fa.folderTree().then(setTrees) }, [])

  const reload = useCallback(() => {
    loadTree()
    const s = sourceRef.current
    if (!s) return
    setLoading(true)
    const orderP = s.kind === 'folder' ? window.fa.boardOrder(s.path) : s.kind === 'all' ? window.fa.boardOrderAll() : Promise.resolve(null)
    void Promise.all([window.fa.list(s), orderP]).then(([list, o]) => {
      if (sameSource(s, sourceRef.current)) { setRows(list); setOrder(o); setLoading(false) }
    })
  }, [loadTree])

  useEffect(() => { setSelected(null); reload() }, [source, reload])
  useEffect(() => { if (active) { reload(); setTimeout(() => linkRef.current?.focus(), 0) } }, [active, reload])
  useEffect(() => {
    const onFocus = () => { if (active) reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [active, reload])
  useEffect(() => window.fa.onCommand((c) => { if (c.kind === 'focusFilter' && c.tabId === tabId) { filterRef.current?.focus(); filterRef.current?.select() } }), [tabId])

  // the 📺 Feed: its state (and the sidebar badge) comes from the main process
  useEffect(() => {
    void window.fa.feedState().then(setFeed)
    return window.fa.onFeed(setFeed)
  }, [])
  // opening the Feed refreshes it (when stale) and clears the badge; new videos that arrive while it is open count as seen
  useEffect(() => { if (feedOn && active) window.fa.feedOpened() }, [feedOn, active])
  useEffect(() => { if (feedOn && active && feed && feed.newCount > 0) window.fa.feedOpened(true) }, [feedOn, active, feed])
  useEffect(() => { if (active) void window.fa.feedState().then(setFeed) }, [active])
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 2500); return () => clearTimeout(t) }, [notice])
  useEffect(() => { if (!moveError) return; const t = setTimeout(() => setMoveError(null), 8000); return () => clearTimeout(t) }, [moveError])
  useEffect(() => { if (!moved) return; const t = setTimeout(() => setMoved(null), 8000); return () => clearTimeout(t) }, [moved])

  const choose = (s: Source) => {
    setFeedOn(false)
    setView('board')
    setSource(s)
    if (s.kind === 'folder') setDestination(s.path)
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? rows.filter((r) => r.title.toLowerCase().includes(q) || name(r.folder).toLowerCase().includes(q)) : rows
  }, [rows, filter])

  const sorted = useMemo(() => {
    const cmp: Record<SortKey, (a: FolderEntry, b: FolderEntry) => number> = {
      title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
      date: (a, b) => a.date - b.date,
      progress: (a, b) => progressRank(a) - progressRank(b),
      status: (a, b) => statusRank(a) - statusRank(b),
      notes: (a, b) => a.notes - b.notes,
    }
    const f = cmp[sort.key]
    return [...filtered].sort((a, b) => (sort.asc ? f(a, b) : f(b, a)))
  }, [filtered, sort])

  /** The groups for "Group by status": the column's options in order, then rows with no / another value first. */
  const groups = useMemo(() => {
    const options = filtered[0]?.statusOptions ?? DEFAULT_OPTIONS
    const out = options.map((o) => ({ name: o, rows: sorted.filter((r) => r.status === o) }))
    const other = sorted.filter((r) => !r.status || !options.includes(r.status))
    if (other.length) out.unshift({ name: 'No status', rows: other })
    return out
  }, [filtered, sorted])

  const visibleRows = group ? groups.flatMap((g) => (collapsed.has(g.name) ? [] : g.rows)) : sorted

  const open = (r: FolderEntry) => { clearWork(); window.fa.openFolder(tabId, r.folder) }

  const create = () => {
    const l = link.trim()
    if (!parseYouTubeID(l)) { setLinkError(l ? 'That is not a YouTube link.' : ''); return }
    setLinkError('')
    window.fa.create(tabId, l, destination)
  }
  // a finished create clears the link box
  useEffect(() => { if (work?.step === 'browse') setLink('') }, [work])

  const setStatus = async (r: FolderEntry, value: string) => {
    const err = await window.fa.setStatus(r.folder, value)
    if (err) setError(err)
    reload()
  }

  const statusMenu = (r: FolderEntry): MenuSpec[] => r.statusOptions.map((o) => ({ id: 'status:' + o, label: o, checked: o === r.status }))

  const changeView = (v: LibraryView) => setView(v)

  /** A column was resized (null = back to the default width). */
  const resizeColumn = (key: string, width: number | null) => setColWidths((w) => {
    const n = { ...w }
    if (width === null) delete n[key]; else n[key] = Math.round(width)
    window.fa.setColumnWidths(n)
    return n
  })

  const toggleColumn = (key: string) => setCollapsedCols((c) => {
    const n = new Set(c)
    if (n.has(key)) n.delete(key); else n.add(key)
    window.fa.setCollapsedColumns([...n])
    return n
  })

  /**
   * A card dropped on the board: shown at once (optimistic), then written — the status (locked frontmatter write)
   * and, in a folder, the order file. A failed write shows a chip and reloads what the files say.
   */
  const moveCardTo = async (r: FolderEntry, to: string, spot: DropSpot) => {
    const manual = hasBoardOrder(source) && order !== null
    setRows((rs) => rs.map((x) => (x.folder === r.folder ? { ...x, status: to } : x)))
    if (manual) {
      const column = rows.map((x) => (x.folder === r.folder ? { ...x, status: to } : x)).filter((x) => x.status === to)
      setOrder((o) => moveCard(o ?? {}, cardId(r), to, arrangeColumn(column, (o ?? {})[to], cardId, newestFirst).map(cardId), spot))
    }
    const err = manual ? await window.fa.boardMove(r.folder, to, spot) : r.status === to ? null : await window.fa.setStatus(r.folder, to)
    if (err) setMoveError(err)
    reload()
  }

  const copyLink = async (r: FolderEntry) => {
    if (!r.videoId) return
    const url = `https://www.youtube.com/watch?v=${r.videoId}`
    try { await navigator.clipboard.writeText(url) } catch {
      const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
    }
    setNotice('Copied the YouTube link')
  }

  const cardMenu = async (_e: MouseEvent, r: FolderEntry, col: BoardColumn) => {
    const manual = hasBoardOrder(source) && order !== null
    const inColumn = !!r.status && r.statusOptions.includes(r.status)
    const id = await window.fa.popup([
      { label: 'Set Status', submenu: statusMenu(r) },
      { id: 'top', label: 'Move to Top', enabled: manual && inColumn && col.cards[0]?.folder !== r.folder },
      moveMenu(r),
      { separator: true },
      { id: 'finder', label: 'Show in Finder' },
      { id: 'copy', label: 'Copy YouTube Link', enabled: !!r.videoId },
    ])
    if (id === 'finder') window.fa.showInFinder(r.folder)
    else if (id?.startsWith('move:')) void moveVideo(r.folder, id.slice(5))
    else if (id === 'copy') void copyLink(r)
    else if (id === 'top' && r.status) void moveCardTo(r, r.status, { top: true })
    else if (id?.startsWith('status:')) {
      const to = id.slice(7)
      if (to === r.status) return
      if (manual) void moveCardTo(r, to, { top: true })
      else void setStatus(r, to)
    }
  }

  const rowMenu = async (e: MouseEvent, r: FolderEntry) => {
    e.preventDefault()
    setSelected(r.folder)
    const id = await window.fa.popup([
      { id: 'open', label: 'Open' },
      { label: 'Set Status', submenu: statusMenu(r).map((m) => ({ ...m, checked: undefined })) },
      moveMenu(r),
      { id: 'finder', label: 'Show in Finder' },
      { separator: true },
      { id: 'follow', label: 'Follow this channel' },
    ])
    if (id === 'open') open(r)
    else if (id?.startsWith('move:')) void moveVideo(r.folder, id.slice(5))
    else if (id === 'finder') window.fa.showInFinder(r.folder)
    else if (id === 'follow') {
      const err = await window.fa.feedFollowFolder(r.folder)
      if (err) setError(err)
      else setNotice('Following — its new videos show in 📺 Feed')
    }
    else if (id?.startsWith('status:')) void setStatus(r, id.slice(7))
  }

  const statusCellMenu = async (e: MouseEvent, r: FolderEntry) => {
    e.stopPropagation()
    const id = await window.fa.popup(statusMenu(r))
    if (id?.startsWith('status:')) void setStatus(r, id.slice(7))
  }

  /**
   * Moves a video's folder into `dest` (a library or topic folder). Same folder: nothing happens. A folder view shows
   * only its own videos, so a card moved out of it leaves the board at once (a failed move reloads it back).
   */
  const moveVideo = async (folder: string, dest: string) => {
    if (parentOf(folder) === dest) return
    if (source?.kind === 'folder' && parentOf(folder) === source.path) setRows((rs) => rs.filter((x) => x.folder !== folder))
    const r = await window.fa.moveVideo(folder, dest)
    if (r && 'error' in r) setMoveError(r.error)
    else if (r) {
      setMoved({ from: r.from, to: r.to, dest: name(dest) })
      if (selected === folder) setSelected(r.to)
    }
    reload()
  }

  const undoMove = async () => {
    const m = moved
    if (!m) return
    setMoved(null)
    const r = await window.fa.moveVideo(m.to, parentOf(m.from))
    if (r && 'error' in r) setMoveError(r.error)
    else setNotice(`Moved back to ${name(parentOf(m.from))}`)
    reload()
  }

  /** "Move to ▸": the folders of the video's library (indented), its own folder checked. */
  const moveMenu = (r: FolderEntry): MenuSpec => {
    const lib = libraryOf(trees, r.folder)
    const here = parentOf(r.folder)
    return {
      label: 'Move to', enabled: !!lib,
      submenu: lib ? flatten([lib]).map(({ node, depth }) => ({ id: 'move:' + node.path, label: indent(depth) + node.name, checked: node.path === here, enabled: node.path !== here }))
        : [{ label: 'Not in a library folder', enabled: false }],
    }
  }

  const toggleFolder = (path: string) => setCollapsedFolders((c) => {
    const n = new Set(c)
    if (n.has(path)) n.delete(path); else n.add(path)
    window.fa.setCollapsedFolders([...n])
    return n
  })

  /** The inline name field was confirmed: make or rename the folder. Returns an error to show, or null. */
  const commitName = async (typed: string): Promise<string | null> => {
    const ed = editing
    if (!ed) return null
    if (ed.mode === 'new') {
      const r = await window.fa.newFolder(ed.parent, typed)
      if ('error' in r) return r.error
      setEditing(null)
      loadTree()
      return null
    }
    const r = await window.fa.renameFolder(ed.path, typed)
    if ('error' in r) return r.error
    setEditing(null)
    const from = ed.path, to = r.path
    // the main process moved every saved path; follow it here too
    if (source?.kind === 'folder') { const p = relocated(source.path, from, to); if (p !== source.path) setSource({ kind: 'folder', path: p }) }
    setDestination((d) => relocated(d, from, to))
    setCollapsedFolders((c) => new Set([...c].map((x) => relocated(x, from, to))))
    reload()
    return null
  }

  const folderMenu = async (e: MouseEvent, node: FolderNode, isLibrary: boolean) => {
    e.preventDefault()
    const path = node.path
    const id = await window.fa.popup([
      { id: 'new', label: 'New Folder…' },
      ...(isLibrary ? [] : [{ id: 'rename', label: 'Rename…' }]),
      { id: 'finder', label: 'Show in Finder' },
      { separator: true },
      isLibrary ? { id: 'remove', label: 'Remove from Sidebar' } : { id: 'delete', label: node.empty ? 'Delete' : 'Delete (only an empty folder)', enabled: node.empty },
    ])
    if (id === 'new') {
      setCollapsedFolders((c) => { if (!c.has(path)) return c; const n = new Set(c); n.delete(path); window.fa.setCollapsedFolders([...n]); return n })
      setEditing({ mode: 'new', parent: path })
    }
    if (id === 'rename') setEditing({ mode: 'rename', path, name: node.name })
    if (id === 'finder') window.fa.showInFinder(path)
    if (id === 'delete') {
      const err = await window.fa.deleteFolder(path)
      if (err && err !== 'cancel') setMoveError(err)
      if (!err) {
        if (source?.kind === 'folder' && (source.path === path || source.path.startsWith(path + '/'))) choose({ kind: 'folder', path: parentOf(path) })
        if (destination === path) setDestination(parentOf(path))
        setNotice(`Deleted ${node.name}`)
      }
      reload()
    }
    if (id === 'remove') {
      const i = await window.fa.removeFolder(path)
      setInfo(i)
      if (source?.kind === 'folder' && source.path === path) choose(i.pinned[0] ? { kind: 'folder', path: i.pinned[0] } : { kind: 'recent' })
      if (destination === path) setDestination(i.pinned[0] ?? i.outputParent)
    }
  }

  const currentFolder = source?.kind === 'folder' ? source.path : info?.pinned[0]

  const addFolder = async () => {
    const p = await window.fa.addFolder(currentFolder)
    if (!p) return
    setInfo(await window.fa.launcherInfo())
    choose({ kind: 'folder', path: p })
  }

  const destinationMenu = async () => {
    const id = await window.fa.popup([
      // each library and its topic folders (indented)
      ...(trees.length ? flatten(trees) : (info?.pinned ?? []).map((p) => ({ node: { path: p, name: name(p) }, depth: 0 })))
        .map(({ node, depth }) => ({ id: 'dest:' + node.path, label: indent(depth) + node.name, checked: node.path === destination })),
      { separator: true },
      { id: 'add', label: 'Add Folder…' },
    ])
    if (id === 'add') {
      const p = await window.fa.addFolder(currentFolder)
      if (p) { setInfo(await window.fa.launcherInfo()); setDestination(p) }
    } else if (id?.startsWith('dest:')) setDestination(id.slice(5))
  }

  const onTableKey = (e: KeyboardEvent) => {
    if (!visibleRows.length) return
    const i = visibleRows.findIndex((r) => r.folder === selected)
    const go = (k: number) => {
      const r = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, k))]
      setSelected(r.folder)
      tableRef.current?.querySelector(`[data-folder="${CSS.escape(r.folder)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    if (e.key === 'ArrowDown' && !e.metaKey) { e.preventDefault(); go(i < 0 ? 0 : i + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i < 0 ? 0 : i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); go(0) }
    else if (e.key === 'End') { e.preventDefault(); go(visibleRows.length - 1) }
    else if ((e.key === 'Enter' || (e.key === 'ArrowDown' && e.metaKey)) && i >= 0) { e.preventDefault(); open(visibleRows[i]) }
    else if (e.key === 'Escape') setSelected(null)
  }

  const drop = (e: DragEvent, groupName: string) => {
    e.preventDefault()
    setDropOn(null)
    const folder = e.dataTransfer.getData(DRAG_TYPE)
    const r = rows.find((x) => x.folder === folder)
    if (!r || groupName === 'No status' || r.status === groupName) return
    void setStatus(r, groupName)
  }

  const title = !source ? '' : source.kind === 'recent' ? 'Recent' : source.kind === 'inProgress' ? 'In progress' : source.kind === 'all' ? 'All videos' : name(source.path)
  const emptyText = filter ? `Nothing matches “${filter}”.`
    : source?.kind === 'recent' ? 'Videos you open show up here.'
      : source?.kind === 'inProgress' ? 'Videos you started and did not finish show up here.'
        : source?.kind === 'all' ? 'No videos in your library folders yet.\nPaste a YouTube link above to make one.'
          : 'No videos here yet — drag videos onto this folder, or paste a link with this folder selected.'

  const header = (key: SortKey, label: string, cls: string) => (
    <div className={'th ' + cls} role="columnheader" aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'title' }))}>
      {label}{sort.key === key && <span className="th__arrow">{sort.asc ? '▲' : '▼'}</span>}
    </div>
  )

  const row = (r: FolderEntry, inGroup: string | null) => (
    <div key={r.folder} data-folder={r.folder} role="row" aria-selected={selected === r.folder}
      className={'tr' + (selected === r.folder ? ' tr--sel' : '') + (group ? ' tr--grouped' : '')}
      draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, r.folder); e.dataTransfer.effectAllowed = 'move'; setDragPill(e, r) }}
      onDragOver={inGroup ? (e) => { e.preventDefault(); setDropOn(inGroup) } : undefined}
      onDrop={inGroup ? (e) => drop(e, inGroup) : undefined}
      onClick={() => { setSelected(r.folder); tableRef.current?.focus() }} onDoubleClick={() => open(r)} onContextMenu={(e) => rowMenu(e, r)}>
      <div className="td td--thumb"><Thumb id={r.videoId} className="rowthumb" /></div>
      <div className="td td--title" title={r.folder}>{r.title}{r.topic && <span className="topicchip" title={`In ${r.topic}`}>{r.topic}</span>}</div>
      <div className="td td--date">{dateLabel(r.date)}</div>
      <div className="td td--progress"><ProgressCell r={r} /></div>
      <div className="td td--status">
        <button className={'statusbtn' + (r.status ? '' : ' statusbtn--none')} disabled={!r.ready && r.needsFormat} onClick={(e) => statusCellMenu(e, r)}>
          {r.status ?? '–'}<span className="statusbtn__caret">⌄</span>
        </button>
      </div>
      {!group && <div className={'td td--notes' + (r.notes > 0 ? '' : ' td--faint')}>{r.notes > 0 ? r.notes : '–'}</div>}
    </div>
  )

  return (
    <div className="newtab">
      <nav className="sidebar">
        <SideItem icon={<span className="sideitem__emoji">📺</span>} label="Feed" on={feedOn} badge={feed?.newCount ?? 0}
          title="The latest videos of channels you follow (not in your Library until you add them)" onClick={() => setFeedOn(true)} />
        <div className="sidebar__divider" />
        <div className="sidebar__section">Library</div>
        <SideItem icon={Icon.clock} label="Recent" on={!feedOn && source?.kind === 'recent'} onClick={() => choose({ kind: 'recent' })} />
        <SideItem icon={Icon.play} label="In progress" on={!feedOn && source?.kind === 'inProgress'} onClick={() => choose({ kind: 'inProgress' })} />
        <SideItem icon={<span className="sideitem__emoji">📚</span>} label="All videos" on={!feedOn && source?.kind === 'all'}
          title="Every video in your library folders, topics included" onClick={() => choose({ kind: 'all' })} />
        <div className="sidebar__section">Folders</div>
        <FolderTree trees={trees} selected={!feedOn && source?.kind === 'folder' ? source.path : null} collapsed={collapsedFolders}
          onToggle={toggleFolder} onSelect={(p) => choose({ kind: 'folder', path: p })} onMenu={folderMenu}
          onDropVideo={(folder, dest) => void moveVideo(folder, dest)}
          editing={editing} onCommit={commitName} onCancel={() => setEditing(null)}
          folderIcon={Icon.folder} chevron={Icon.chevron} titleOf={(p) => tilde(p, info?.home ?? '')} />
        <SideItem icon={Icon.plus} label="Add Folder…" quiet onClick={addFolder} />
        <SideItem icon={Icon.other} label="Other Folder…" quiet onClick={() => window.fa.openExisting(tabId, currentFolder)} />
      </nav>
      <main className="detail">
        <div className="linkbar">
          <div className="linkbox">
            <span className="linkbox__icon">{Icon.link}</span>
            <input ref={linkRef} className="linkbox__input" placeholder="Paste a YouTube link and press Enter to follow along" value={link}
              spellCheck={false} onChange={(e) => { setLink(e.target.value); setLinkError('') }} onKeyDown={(e) => { if (e.key === 'Enter') create() }} />
            <button className="chip" title={`New folders go in ${tilde(destination, info?.home ?? '')}`} onClick={destinationMenu}>→ {name(destination)}</button>
            <button className="createbtn" disabled={!parseYouTubeID(link)} onClick={create}>Create</button>
          </div>
          {linkError && <div className="linkerror">{linkError}</div>}
        </div>
        {feedOn ? (
          <FeedView feed={feed} tabId={tabId} destination={destination} onOpenFolder={(f) => { clearWork(); window.fa.openFolder(tabId, f) }} />
        ) : (<>
        <div className="listheader">
          <h2 className="listheader__title">{title}</h2>
          {loading && <span className="spinner" />}
          <span className="grow" />
          {view === 'board' && Object.keys(colWidths).length > 0 && (
            <button className="togglebtn" title="Put every board column back to its default width"
              onClick={() => { setColWidths({}); window.fa.setColumnWidths({}) }}>Reset columns</button>
          )}
          <div className="segmented" role="group" aria-label="View">
            <button className={'segmented__btn' + (view === 'board' ? ' segmented__btn--on' : '')} aria-pressed={view === 'board'} onClick={() => changeView('board')}>Board</button>
            <button className={'segmented__btn' + (view === 'table' ? ' segmented__btn--on' : '')} aria-pressed={view === 'table'} onClick={() => changeView('table')}>Table</button>
          </div>
          {view === 'table' && (
            <button className={'togglebtn' + (group ? ' togglebtn--on' : '')} aria-pressed={group}
              onClick={() => { setGroup(!group); window.fa.setGroupByStatus(!group) }}>Group by status</button>
          )}
          <label className="filter">
            {Icon.search}
            <input ref={filterRef} placeholder="Filter" value={filter} spellCheck={false} onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setFilter(''); tableRef.current?.focus() } if (e.key === 'ArrowDown') { e.preventDefault(); tableRef.current?.focus(); onTableKey(e) } }} />
          </label>
        </div>
        {filtered.length === 0 && !loading ? (
          <div className="empty">
            <div className="empty__icon">{filter ? Icon.search : source?.kind === 'recent' ? Icon.clock : source?.kind === 'inProgress' ? Icon.play : source?.kind === 'all' ? <span className="sideitem__emoji">📚</span> : Icon.folder}</div>
            <div className="empty__text">{emptyText}</div>
          </div>
        ) : view === 'board' ? (
          <Board rows={filtered} options={filtered[0]?.statusOptions ?? DEFAULT_OPTIONS}
            order={hasBoardOrder(source) ? (order ?? {}) : null} selected={selected} onSelect={setSelected}
            onOpen={open} onMenu={cardMenu} onMove={(r, to, spot, collapsedLabel) => { if (collapsedLabel) setNotice(`Moved to ${collapsedLabel}`); void moveCardTo(r, to, spot) }}
            collapsed={collapsedCols} onToggleCollapse={toggleColumn}
            widths={colWidths} onResize={resizeColumn} />
        ) : (
          <div className={'table' + (group ? ' table--grouped' : '')} role="grid" tabIndex={0} ref={tableRef} onKeyDown={onTableKey}>
            <div className="thead" role="row">
              <div className="th td--thumb" aria-hidden="true" />
              {header('title', 'Title', 'td--title')}
              {header('date', 'Date', 'td--date')}
              {header('progress', 'Progress', 'td--progress')}
              {header('status', 'Status', 'td--status')}
              {!group && header('notes', 'Notes', 'td--notes')}
            </div>
            <div className="tbody">
              {group ? groups.map((g) => (
                <div key={g.name} className={'group' + (dropOn === g.name ? ' group--drop' : '')}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = g.name === 'No status' ? 'none' : 'move'; setDropOn(g.name) }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn(null) }}
                  onDrop={(e) => drop(e, g.name)}>
                  <button className="group__head" onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.name)) n.delete(g.name); else n.add(g.name); return n })}>
                    <span className="group__chev">{Icon.chevron(!collapsed.has(g.name))}</span>
                    <span className="group__name">{g.name}</span>
                    <span className="group__count">{g.rows.length}</span>
                  </button>
                  {!collapsed.has(g.name) && g.rows.map((r) => row(r, g.name))}
                </div>
              )) : sorted.map((r) => row(r, null))}
            </div>
          </div>
        )}
        </>)}
      </main>
      {(work && work.step !== 'browse') || error ? (
        <div className="overlay">
          <div className="card">
            {work?.step === 'working' && !error ? (
              <>
                <div className="card__title"><span className="spinner" /> Getting the captions…</div>
                <div className="card__log">{work.line ?? 'Starting yt-dlp…'}</div>
              </>
            ) : (
              <>
                <div className="card__title">That did not work</div>
                <pre className="card__error">{error || work?.error}</pre>
                <div className="card__buttons"><button className="okbtn" autoFocus onClick={() => { setError(''); clearWork() }}>OK</button></div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {notice && <div className="zoomtoast">{notice}</div>}
      {moved && (
        <div className="movetoast" role="status">
          <span>Moved to {moved.dest}</span><span className="movetoast__dot">·</span>
          <button className="movetoast__undo" onClick={() => void undoMove()}>Undo</button>
        </div>
      )}
      {moveError && (
        <div className="errorchip" role="alert">
          <span className="errorchip__text">{moveError}</span>
          <button className="errorchip__close" aria-label="Dismiss" onClick={() => setMoveError(null)}>×</button>
        </div>
      )}
    </div>
  )
}

function SideItem({ icon, label, on, quiet, title, badge, onClick, onContextMenu }: {
  icon: ReactNode; label: string; on?: boolean; quiet?: boolean; title?: string; badge?: number; onClick: () => void; onContextMenu?: (e: MouseEvent) => void
}) {
  return (
    <button className={'sideitem' + (on ? ' sideitem--on' : '') + (quiet ? ' sideitem--quiet' : '')} title={title} onClick={onClick} onContextMenu={onContextMenu}>
      <span className="sideitem__icon">{icon}</span><span className="sideitem__label">{label}</span>
      {!!badge && <span className="sideitem__badge" aria-label={`${badge} new`}>{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}

/** Thin bar + "34m left" / "Finished" / "needs setup". */
function ProgressCell({ r }: { r: FolderEntry }) {
  if (!r.ready) {
    return (
      <span className="badge" title={r.needsFormat
        ? 'Made by another tool. Opening it gets the captions and asks before formatting the .md.'
        : 'Opening it gets the captions to rebuild the word timing (.follow-along.json).'}>
        {r.needsFormat ? 'needs setup' : 'needs timing'}
      </span>
    )
  }
  if (r.progress && started(r)) {
    return (
      <span className="progress">
        <span className="progress__bar"><span className={'progress__fill' + (r.finished ? ' progress__fill--done' : '')}
          style={{ width: `${Math.max(4, (r.finished ? 1 : r.fraction) * 100)}%` }} /></span>
        <span className="progress__text">{r.finished ? 'Finished' : leftLabel(Math.max(0, r.progress.duration - furthest(r)))}</span>
      </span>
    )
  }
  return <span className="td--faint">–</span>
}
