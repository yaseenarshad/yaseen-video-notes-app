import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { FolderNode } from '../shared/api'

/** The drag type of a Board card / Table row (its value is the video folder's path). */
export const DRAG_TYPE = 'text/x-follow-along-folder'

const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/'

/** Every folder of the trees, in display order, with its depth (0 = a library). */
export function flatten(nodes: FolderNode[], depth = 0): { node: FolderNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flatten(n.children, depth + 1)])
}

/** The library (top node) that holds `path`, or null. */
export function libraryOf(trees: FolderNode[], path: string): FolderNode | null {
  return trees.find((t) => path === t.path || path.startsWith(t.path + '/')) ?? null
}

/** The tooltip's count line: the folder's own videos, and the total with its subfolders when that differs. */
export function countTip(n: FolderNode): string {
  const own = `${n.videos} ${n.videos === 1 ? 'video' : 'videos'} here`
  return '\n' + (n.total !== n.videos ? `${own} · ${n.total} with subfolders` : own)
}

/** An inline name field: a new folder in `parent`, or renaming `path`. */
export type Editing = { mode: 'new'; parent: string } | { mode: 'rename'; path: string; name: string }

interface Props {
  trees: FolderNode[]
  selected: string | null
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  onMenu: (e: MouseEvent, node: FolderNode, isLibrary: boolean) => void
  /** A video folder (path) was dropped on folder `dest`. */
  onDropVideo: (folder: string, dest: string) => void
  editing: Editing | null
  /** The name typed in the inline field (Enter / leaving the field); returns an error to show, or null when done. */
  onCommit: (name: string) => Promise<string | null>
  onCancel: () => void
  folderIcon: ReactNode
  chevron: (open: boolean) => ReactNode
  /** Title (tooltip) of a folder. */
  titleOf: (path: string) => string
}

/**
 * The sidebar's Folders section: each library (pinned folder) with its topic folders, recursively, a video count
 * per folder (Finder-style: only its own videos, what clicking it shows; the tooltip adds the total with its
 * subfolders), expand / collapse, drop a card or row on a folder to move that video there, and the inline name
 * field of New Folder… / Rename….
 */
export function FolderTree({ trees, selected, collapsed, onToggle, onSelect, onMenu, onDropVideo, editing, onCommit, onCancel, folderIcon, chevron, titleOf }: Props) {
  const [dropOn, setDropOn] = useState<string | null>(null)

  const over = (e: DragEvent, path: string) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropOn !== path) setDropOn(path)
  }
  const drop = (e: DragEvent, path: string) => {
    const folder = e.dataTransfer.getData(DRAG_TYPE)
    setDropOn(null)
    if (!folder) return
    e.preventDefault()
    onDropVideo(folder, path)
  }

  const row = (n: FolderNode, depth: number): ReactNode => {
    const open = !collapsed.has(n.path)
    const editingThis = editing?.mode === 'rename' && editing.path === n.path
    const newHere = editing?.mode === 'new' && editing.parent === n.path
    const hasKids = n.children.length > 0 || newHere
    return (
      <div key={n.path} className="tree__node" role="treeitem" aria-expanded={hasKids ? open : undefined} aria-selected={selected === n.path}>
        {editingThis ? (
          <NameField depth={depth} initial={editing.name} icon={folderIcon} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <div className={'sideitem tree__row' + (selected === n.path ? ' sideitem--on' : '') + (dropOn === n.path ? ' tree__row--drop' : '')}
            style={{ paddingLeft: 4 + depth * 14 }} title={titleOf(n.path) + countTip(n)} data-folder-path={n.path} role="button" tabIndex={0}
            onClick={() => onSelect(n.path)} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(n.path) }}
            onContextMenu={(e) => { e.preventDefault(); onMenu(e, n, depth === 0) }}
            onDragOver={(e) => over(e, n.path)} onDragEnter={(e) => over(e, n.path)}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && dropOn === n.path) setDropOn(null) }}
            onDrop={(e) => drop(e, n.path)}>
            <span className={'tree__chev' + (hasKids ? '' : ' tree__chev--none')} aria-label={open ? 'Collapse' : 'Expand'}
              onClick={(e) => { e.stopPropagation(); if (hasKids) onToggle(n.path) }}>{hasKids ? chevron(open) : null}</span>
            <span className="sideitem__icon">{folderIcon}</span>
            <span className="sideitem__label">{n.name}</span>
            <span className="tree__count" aria-label={`${n.videos} ${n.videos === 1 ? 'video' : 'videos'} here`}>{n.videos > 0 ? n.videos : ''}</span>
          </div>
        )}
        {open && hasKids && (
          <div role="group">
            {newHere && <NameField depth={depth + 1} initial="" icon={folderIcon} onCommit={onCommit} onCancel={onCancel} />}
            {n.children.map((c) => row(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return <div className="tree" role="tree" onDragEnd={() => setDropOn(null)}>{trees.map((t) => row(t, 0))}</div>
}

function NameField({ depth, initial, icon, onCommit, onCancel }: {
  depth: number; initial: string; icon: ReactNode; onCommit: (name: string) => Promise<string | null>; onCancel: () => void
}) {
  const [value, setValue] = useState(initial || 'untitled folder')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])

  const commit = async () => {
    if (busy || done.current) return
    const v = value.trim()
    if (!v || v === initial) { done.current = true; onCancel(); return }
    setBusy(true)
    const err = await onCommit(v)
    setBusy(false)
    if (err) { setError(err); ref.current?.focus(); return }
    done.current = true
  }

  return (
    <div className="tree__edit" style={{ paddingLeft: 4 + depth * 14 }}>
      <div className="tree__editrow">
        <span className="tree__chev tree__chev--none" />
        <span className="sideitem__icon">{icon}</span>
        <input ref={ref} className="tree__input" value={value} spellCheck={false} aria-label="Folder name" disabled={busy}
          onChange={(e) => { setValue(e.target.value); setError('') }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
            if (e.key === 'Escape') { e.preventDefault(); done.current = true; onCancel() }
          }}
          onBlur={() => { if (!error) void commit() }} />
      </div>
      {error && <div className="tree__error" role="alert">{error}</div>}
    </div>
  )
}

export { parentOf }
