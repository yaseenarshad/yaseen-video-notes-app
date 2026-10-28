import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react'
import { arrangeColumn, cardId, columnLabel, newestFirst, type BoardOrder, type DropSpot } from '../core/board'
import type { FolderEntry } from '../shared/api'

/** The status-less column (cards with no status, or one the folder's options do not have). Not a drop target. */
const NONE = '\u0000none'
const DRAG_TYPE = 'text/x-follow-along-folder'

export const thumbURL = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

/**
 * Drag image for a video: a small pill (thumbnail + short title) to the lower right of the cursor, instead of the
 * whole card, so the sidebar folders under the cursor stay visible while dragging.
 */
export function setDragPill(e: DragEvent, r: FolderEntry): void {
  const look = getComputedStyle(e.currentTarget as Element)
  const wrap = document.createElement('div')   // transparent margin = offset from the cursor
  wrap.style.cssText = 'position:fixed;top:-1000px;left:-1000px;padding:14px 0 0 18px;pointer-events:none'
  const pill = document.createElement('div')
  pill.style.cssText = `display:flex;align-items:center;gap:8px;max-width:240px;padding:5px 10px 5px 5px;border-radius:999px;
    font:600 13px -apple-system,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.28);
    background:${look.backgroundColor === 'rgba(0, 0, 0, 0)' ? '#fff' : look.backgroundColor};color:${look.color}`
  const card = (e.currentTarget as HTMLElement).querySelector('img')
  if (card && card.complete && card.naturalWidth) {
    const img = card.cloneNode() as HTMLImageElement
    img.style.cssText = 'width:44px;height:25px;object-fit:cover;border-radius:5px;flex:none'
    pill.appendChild(img)
  }
  const name = document.createElement('span')
  name.textContent = r.title.length > 32 ? r.title.slice(0, 31).trimEnd() + '…' : r.title
  name.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
  pill.appendChild(name)
  wrap.appendChild(pill)
  document.body.appendChild(wrap)
  e.dataTransfer.setDragImage(wrap, 0, 0)
  setTimeout(() => wrap.remove(), 0)
}

/** The furthest of where the playhead was and the 📍 home spot (as in the table). */
const furthest = (r: FolderEntry): number => (r.progress ? Math.max(r.progress.seconds, r.progress.home ?? r.progress.seconds) : 0)

function leftLabel(s: number): string {
  const m = Math.round(s / 60)
  if (m < 1) return '< 1m left'
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`
}

export interface BoardColumn { key: string; label: string; cards: FolderEntry[] }

/** The key a column's collapsed state is saved under (settings `collapsedColumns`): the status value, or ":none". */
export const collapseKey = (col: BoardColumn): string => (col.key === NONE ? ':none' : col.key)

/** The board's columns: the status options in order (a "No status" column first when some cards have none). */
export function boardColumns(rows: FolderEntry[], options: string[], order: BoardOrder | null): BoardColumn[] {
  const cols: BoardColumn[] = options.map((o) => {
    const cards = rows.filter((r) => r.status === o)
    return { key: o, label: columnLabel(o), cards: order ? arrangeColumn(cards, order[o], cardId, newestFirst) : cards }
  })
  const none = rows.filter((r) => !r.status || !options.includes(r.status))
  if (none.length) cols.unshift({ key: NONE, label: 'No status', cards: order ? [...none].sort(newestFirst) : none })
  return cols
}

interface Props {
  rows: FolderEntry[]
  options: string[]
  /** The folder's manual order; null: no manual order (Recent / In progress keep their own order, no reordering). */
  order: BoardOrder | null
  selected: string | null
  onSelect: (folder: string) => void
  onOpen: (r: FolderEntry) => void
  onMenu: (e: MouseEvent, r: FolderEntry, column: BoardColumn) => void
  /**
   * A card was dropped: in another column (status change), or at another spot in its own (reorder). `collapsedLabel`:
   * it was dropped on a collapsed column (which stays collapsed; the card goes to the top of its order).
   */
  onMove: (r: FolderEntry, to: string, spot: DropSpot, collapsedLabel?: string) => void
  /** Collapsed columns (`collapseKey`). */
  collapsed: ReadonlySet<string>
  onToggleCollapse: (key: string) => void
  /** Column widths in px (`collapseKey`, or "<key>:collapsed" for a strip); missing = the default flexible width. */
  widths?: Readonly<Record<string, number>>
  /** A column edge was dragged (null = double-click: back to the default width). */
  onResize?: (key: string, width: number | null) => void
}

const OPEN_W = { min: 200, max: 900 }
const STRIP_W = { min: 36, max: 240 }

interface DropAt { column: string; index: number }

/** The Kanban board (New Tab → Board). Drag a card to another column to change its status, within one to reorder. */
export function Board({ rows, options, order, selected, onSelect, onOpen, onMenu, onMove, collapsed, onToggleCollapse, widths = {}, onResize }: Props) {
  /** The width while an edge is being dragged (saved on release). */
  const [live, setLive] = useState<{ key: string; w: number } | null>(null)
  const widthOf = (key: string): number | undefined => (live?.key === key ? live.w : widths[key])
  const sized = (key: string): CSSProperties | undefined => {
    const w = widthOf(key)
    return w === undefined ? undefined : { flex: `0 0 ${w}px`, minWidth: w, maxWidth: w }
  }
  /** The drag handle on a column's edge (the left edge for strips pinned to the right): drag to resize, double-click to reset. */
  const edge = (key: string, lim: { min: number; max: number }, left = false) => onResize && (
    <div className={'bcol__resize' + (left ? ' bcol__resize--left' : '')} role="separator" aria-orientation="vertical" title="Drag to resize · double-click to reset"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); onResize(key, null) }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault(); e.stopPropagation()
        const handle = e.currentTarget
        const w0 = (handle.parentElement as HTMLElement).getBoundingClientRect().width
        const x0 = e.clientX
        let w = w0
        handle.setPointerCapture(e.pointerId)
        const move = (ev: PointerEvent) => { w = Math.min(lim.max, Math.max(lim.min, w0 + (left ? x0 - ev.clientX : ev.clientX - x0))); setLive({ key, w }) }
        const up = () => {
          handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up)
          setLive(null)
          if (Math.abs(w - w0) >= 1) onResize(key, w)
        }
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up)
      }} />
  )
  const columns = useMemo(() => boardColumns(rows, options, order), [rows, options, order])
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<DropAt | null>(null)
  const draggingRef = useRef<string | null>(null)

  const dragged = (): FolderEntry | null => rows.find((r) => r.folder === draggingRef.current) ?? null

  /** Can the dragged card go to column `key`, and is the spot meaningful (reorder needs a manual order)? */
  const accepts = (key: string, r: FolderEntry | null = dragged()): 'move' | 'column' | null => {
    if (!r || key === NONE) return null
    if (r.status === key) return order ? 'move' : null
    return order ? 'move' : 'column'
  }

  const over = (e: DragEvent, key: string, index: number) => {
    const a = accepts(key)
    if (!a) { e.dataTransfer.dropEffect = 'none'; if (dropAt) setDropAt(null); return }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const next = { column: key, index: a === 'move' ? index : -1 }
    if (!dropAt || dropAt.column !== next.column || dropAt.index !== next.index) setDropAt(next)
  }

  const drop = (e: DragEvent, col: BoardColumn) => {
    e.preventDefault()
    const r = dragged()
    const at = dropAt
    setDropAt(null); setDragging(null); draggingRef.current = null
    if (!r || !at || at.column !== col.key || !accepts(col.key, r)) return
    const shown = col.cards.map(cardId)
    const id = cardId(r)
    let spot: DropSpot = {}
    if (at.index >= 0) {
      // the cards just below and above the drop line (the dragged card itself does not count)
      const below = shown.slice(at.index).find((x) => x !== id) ?? null
      const above = [...shown.slice(0, at.index)].reverse().find((x) => x !== id) ?? null
      spot = below ? { before: below } : above ? { after: above } : { top: true }
      // dropped back on its own spot: nothing to do
      if (r.status === col.key) {
        const i = shown.indexOf(id)
        if (i >= 0 && (at.index === i || at.index === i + 1)) return
      }
    }
    onMove(r, col.key, spot)
  }

  /** A drop anywhere on a collapsed column's strip: sets the status, the card goes to the top, the column stays collapsed. */
  const dropCollapsed = (e: DragEvent, col: BoardColumn) => {
    e.preventDefault()
    const r = dragged()
    setDropAt(null); setDragging(null); draggingRef.current = null
    if (!r || r.status === col.key || !accepts(col.key, r)) return
    onMove(r, col.key, { top: true }, col.label)
  }

  // collapsed strips after the last open column hug the board's right edge
  let lastOpen = -1
  columns.forEach((c, i) => { if (!collapsed.has(collapseKey(c))) lastOpen = i })
  const pinnedRight = (i: number) => lastOpen >= 0 && i > lastOpen

  return (
    <div className="board" onDragEnd={() => { setDragging(null); setDropAt(null); draggingRef.current = null }}>
      {columns.map((col, i) => {
        const isDrop = dropAt?.column === col.key
        const ck = collapseKey(col)
        if (collapsed.has(ck)) {
          return (
            <section key={col.key} className={'bcol bcol--collapsed' + (pinnedRight(i) ? ' bcol--right' : '') + (i === lastOpen + 1 && pinnedRight(i) ? ' bcol--right-first' : '') + (isDrop ? ' bcol--drop' : '') + (col.key === NONE ? ' bcol--none' : '')}
              style={sized(ck + ':collapsed')}
              aria-label={`${col.label} (collapsed)`} title={`${col.label}: click to expand`} data-column={col.key}
              onClick={() => onToggleCollapse(ck)}
              onDragOver={(e) => over(e, col.key, -1)}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && dropAt?.column === col.key) setDropAt(null) }}
              onDrop={(e) => dropCollapsed(e, col)}>
              <button className="bcol__chev" aria-label={`Expand ${col.label}`} aria-expanded={false}
                onClick={(e) => { e.stopPropagation(); onToggleCollapse(ck) }}>{chevron(false)}</button>
              <span className="bcol__vtext"><span className="bcol__name">{col.label}</span> <span className="bcol__count">{col.cards.length}</span></span>
              {edge(ck + ':collapsed', STRIP_W, pinnedRight(i))}
            </section>
          )
        }
        return (
          <section key={col.key} className={'bcol' + (isDrop ? ' bcol--drop' : '') + (col.key === NONE ? ' bcol--none' : '')} aria-label={col.label} data-column={col.key}
            style={sized(ck)}>
            {edge(ck, OPEN_W)}
            <header className="bcol__head">
              <span className="bcol__name">{col.label}</span>
              <span className="bcol__count">{col.cards.length}</span>
              <span className="grow" />
              <button className="bcol__chev" aria-label={`Collapse ${col.label}`} aria-expanded={true} title="Collapse"
                onClick={() => onToggleCollapse(ck)}>{chevron(true)}</button>
            </header>
            <div className="bcol__body"
              onDragOver={(e) => over(e, col.key, col.cards.length)}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && dropAt?.column === col.key) setDropAt(null) }}
              onDrop={(e) => drop(e, col)}>
              {col.cards.map((r, i) => (
                <div key={r.folder} className="bcard__slot">
                  {isDrop && dropAt?.index === i && <div className="bcol__line" />}
                  <Card r={r} selected={selected === r.folder} dragging={dragging === r.folder}
                    onClick={() => { onSelect(r.folder); onOpen(r) }}
                    onContextMenu={(e) => { e.preventDefault(); onSelect(r.folder); onMenu(e, r, col) }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, r.folder)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragPill(e, r)
                      draggingRef.current = r.folder
                      setTimeout(() => setDragging(r.folder), 0)
                    }}
                    onDragOver={(e) => {
                      e.stopPropagation()
                      const box = e.currentTarget.getBoundingClientRect()
                      over(e, col.key, e.clientY < box.top + box.height / 2 ? i : i + 1)
                    }} />
                </div>
              ))}
              {isDrop && dropAt?.index === col.cards.length && <div className="bcol__line" />}
              {col.cards.length === 0 && <div className="bcol__empty">{col.key === NONE ? '' : 'Drop a video here'}</div>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Open: points left (collapse toward a strip); collapsed: points right (expand). */
const chevron = (open: boolean) => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d={open ? 'M10 3.5 5.5 8l4.5 4.5' : 'm6 3.5 4.5 4.5L6 12.5'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

function Card({ r, selected, dragging, onClick, onContextMenu, onDragStart, onDragOver }: {
  r: FolderEntry; selected: boolean; dragging: boolean
  onClick: () => void; onContextMenu: (e: MouseEvent) => void; onDragStart: (e: DragEvent) => void; onDragOver: (e: DragEvent) => void
}) {
  const started = furthest(r) > 5
  return (
    <div className={'bcard' + (selected ? ' bcard--sel' : '') + (dragging ? ' bcard--dragging' : '')} data-folder={r.folder}
      draggable onDragStart={onDragStart} onDragOver={onDragOver} onClick={onClick} onContextMenu={onContextMenu} title={r.folder}>
      <Thumb id={r.videoId} className="bcard__thumb" />
      <div className="bcard__body">
        <div className="bcard__title">{r.title}</div>
        {r.topic && <div className="bcard__topic"><span className="topicchip" title={`In ${r.topic}`}>{r.topic}</span></div>}
        {r.channel && <div className="bcard__channel">{r.channel}</div>}
        {!r.ready ? (
          <div className="bcard__row"><span className="badge">{r.needsFormat ? 'needs setup' : 'needs timing'}</span></div>
        ) : (
          <div className="bcard__row">
            <span className="bcard__bar"><span className={'bcard__fill' + (r.finished ? ' bcard__fill--done' : '')}
              style={{ width: started ? `${Math.max(4, (r.finished ? 1 : r.fraction) * 100)}%` : 0 }} /></span>
            <span className={'bcard__left' + (r.finished ? ' bcard__left--done' : '')}>
              {r.finished ? 'Finished' : started && r.progress ? leftLabel(Math.max(0, r.progress.duration - furthest(r))) : 'Not started'}
            </span>
          </div>
        )}
        {(r.notes > 0 || r.mochiOpen > 0) && (
          <div className="bcard__meta">
            {r.notes > 0 && <span>{r.notes} {r.notes === 1 ? 'note' : 'notes'}</span>}
            {r.mochiOpen > 0 && <span className="bcard__mochi" title={`${r.mochiOpen} open #mochi ${r.mochiOpen === 1 ? 'note' : 'notes'} (flashcards to make)`}>🃏 {r.mochiOpen}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/** A 16:9 YouTube thumbnail, or a plain block when there is no id or it does not load. */
export function Thumb({ id, className }: { id: string | null; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!id || failed) {
    return <div className={className + ' thumb--none'} aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6.2 4.8v6.4L11.2 8z" fill="currentColor" /></svg></div>
  }
  return <img className={className} src={thumbURL(id)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
}
