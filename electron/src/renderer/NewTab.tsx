import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { parseYouTubeID } from '../core/transcript'
import type { FolderEntry, LauncherInfo, MenuSpec, Source, WorkEvent } from '../shared/api'

const DEFAULT_OPTIONS = ['1-To-Watch', '2-Watching', '3-Watched', '4-Carded']
const name = (p: string): string => p.split('/').filter(Boolean).pop() ?? p
const tilde = (p: string, home: string): string => (home && p.startsWith(home + '/') ? '~' + p.slice(home.length) : p)
const sameSource = (a: Source | null, b: Source | null): boolean =>
  !!a && !!b && a.kind === b.kind && (a.kind !== 'folder' || (b.kind === 'folder' && a.path === b.path))

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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'date', asc: false })
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [dropOn, setDropOn] = useState<string | null>(null)
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
      setDestination(i.pinned[0] ?? i.outputParent)
      setSource(i.pinned[0] ? { kind: 'folder', path: i.pinned[0] } : { kind: 'recent' })
    })
  }, [])

  const reload = useCallback(() => {
    const s = sourceRef.current
    if (!s) return
    setLoading(true)
    void window.fa.list(s).then((list) => {
      if (sameSource(s, sourceRef.current)) { setRows(list); setLoading(false) }
    })
  }, [])

  useEffect(() => { setSelected(null); reload() }, [source, reload])
  useEffect(() => { if (active) { reload(); setTimeout(() => linkRef.current?.focus(), 0) } }, [active, reload])
  useEffect(() => {
    const onFocus = () => { if (active) reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [active, reload])
  useEffect(() => window.fa.onCommand((c) => { if (c.kind === 'focusFilter' && c.tabId === tabId) { filterRef.current?.focus(); filterRef.current?.select() } }), [tabId])

  const choose = (s: Source) => {
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

  const rowMenu = async (e: MouseEvent, r: FolderEntry) => {
    e.preventDefault()
    setSelected(r.folder)
    const id = await window.fa.popup([
      { id: 'open', label: 'Open' },
      { label: 'Set Status', submenu: statusMenu(r).map((m) => ({ ...m, checked: undefined })) },
      { id: 'finder', label: 'Show in Finder' },
    ])
    if (id === 'open') open(r)
    else if (id === 'finder') window.fa.showInFinder(r.folder)
    else if (id?.startsWith('status:')) void setStatus(r, id.slice(7))
  }

  const statusCellMenu = async (e: MouseEvent, r: FolderEntry) => {
    e.stopPropagation()
    const id = await window.fa.popup(statusMenu(r))
    if (id?.startsWith('status:')) void setStatus(r, id.slice(7))
  }

  const folderMenu = async (e: MouseEvent, path: string) => {
    e.preventDefault()
    const id = await window.fa.popup([{ id: 'finder', label: 'Show in Finder' }, { id: 'remove', label: 'Remove from Sidebar' }])
    if (id === 'finder') window.fa.showInFinder(path)
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
      ...(info?.pinned ?? []).map((p) => ({ id: 'dest:' + p, label: name(p), checked: p === destination })),
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
    const folder = e.dataTransfer.getData('text/x-follow-along-folder')
    const r = rows.find((x) => x.folder === folder)
    if (!r || groupName === 'No status' || r.status === groupName) return
    void setStatus(r, groupName)
  }

  const title = !source ? '' : source.kind === 'recent' ? 'Recent' : source.kind === 'inProgress' ? 'In progress' : name(source.path)
  const emptyText = filter ? `Nothing matches “${filter}”.`
    : source?.kind === 'recent' ? 'Videos you open show up here.'
      : source?.kind === 'inProgress' ? 'Videos you started and did not finish show up here.'
        : 'No video folders here yet.\nPaste a YouTube link above to make one.'

  const header = (key: SortKey, label: string, cls: string) => (
    <div className={'th ' + cls} role="columnheader" aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'title' }))}>
      {label}{sort.key === key && <span className="th__arrow">{sort.asc ? '▲' : '▼'}</span>}
    </div>
  )

  const row = (r: FolderEntry, inGroup: string | null) => (
    <div key={r.folder} data-folder={r.folder} role="row" aria-selected={selected === r.folder}
      className={'tr' + (selected === r.folder ? ' tr--sel' : '') + (group ? ' tr--grouped' : '')}
      draggable={group} onDragStart={(e) => { e.dataTransfer.setData('text/x-follow-along-folder', r.folder); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={inGroup ? (e) => { e.preventDefault(); setDropOn(inGroup) } : undefined}
      onDrop={inGroup ? (e) => drop(e, inGroup) : undefined}
      onClick={() => { setSelected(r.folder); tableRef.current?.focus() }} onDoubleClick={() => open(r)} onContextMenu={(e) => rowMenu(e, r)}>
      <div className="td td--title" title={r.folder}>{r.title}</div>
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
        <div className="sidebar__section">Videos</div>
        <SideItem icon={Icon.clock} label="Recent" on={source?.kind === 'recent'} onClick={() => choose({ kind: 'recent' })} />
        <SideItem icon={Icon.play} label="In progress" on={source?.kind === 'inProgress'} onClick={() => choose({ kind: 'inProgress' })} />
        <div className="sidebar__section">Folders</div>
        {(info?.pinned ?? []).map((p) => (
          <SideItem key={p} icon={Icon.folder} label={name(p)} title={tilde(p, info?.home ?? '')}
            on={source?.kind === 'folder' && source.path === p} onClick={() => choose({ kind: 'folder', path: p })} onContextMenu={(e) => folderMenu(e, p)} />
        ))}
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
        <div className="listheader">
          <h2 className="listheader__title">{title}</h2>
          {loading && <span className="spinner" />}
          <span className="grow" />
          <button className={'togglebtn' + (group ? ' togglebtn--on' : '')} aria-pressed={group}
            onClick={() => { setGroup(!group); window.fa.setGroupByStatus(!group) }}>Group by status</button>
          <label className="filter">
            {Icon.search}
            <input ref={filterRef} placeholder="Filter" value={filter} spellCheck={false} onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setFilter(''); tableRef.current?.focus() } if (e.key === 'ArrowDown') { e.preventDefault(); tableRef.current?.focus(); onTableKey(e) } }} />
          </label>
        </div>
        {filtered.length === 0 && !loading ? (
          <div className="empty">
            <div className="empty__icon">{filter ? Icon.search : source?.kind === 'recent' ? Icon.clock : source?.kind === 'inProgress' ? Icon.play : Icon.folder}</div>
            <div className="empty__text">{emptyText}</div>
          </div>
        ) : (
          <div className={'table' + (group ? ' table--grouped' : '')} role="grid" tabIndex={0} ref={tableRef} onKeyDown={onTableKey}>
            <div className="thead" role="row">
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
    </div>
  )
}

function SideItem({ icon, label, on, quiet, title, onClick, onContextMenu }: {
  icon: ReactNode; label: string; on?: boolean; quiet?: boolean; title?: string; onClick: () => void; onContextMenu?: (e: MouseEvent) => void
}) {
  return (
    <button className={'sideitem' + (on ? ' sideitem--on' : '') + (quiet ? ' sideitem--quiet' : '')} title={title} onClick={onClick} onContextMenu={onContextMenu}>
      <span className="sideitem__icon">{icon}</span><span className="sideitem__label">{label}</span>
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
