/**
 * notes-view: the thin shims the vendored docs-app modules import in place of the docs app's own stores / IPC.
 *
 * - `api.writeAsset` / `BridgeRequestError` (docs app: client/src/api.ts, an IPC bridge to its main process) → a POST
 *   of the image bytes to this experiment's route `/labs/x/notes-view/image`, which writes
 *   `labs-cache/<id>/notes-images/<name>` (never overwriting: a taken name answers 409 → ALREADY_EXISTS, so
 *   insertImage.ts's own retry loop works unchanged).
 * - `basename` / `stripExt` (docs app: client/src/lib/paths.ts), `cssZoom` (client/src/lib/cssZoom.ts @ 4608f7a8, copied).
 * - `coveredLines` / `onCoveredLines` (client/src/editor/lineSelection.ts @ 4608f7a8, copied) with `isHiddenTextblock`
 *   reduced to bullet folds: the Notes view has no zoom and no heading folds.
 * - `blockEscapingLift` (client/src/editor/outline/zoom.ts): always false — no zoom here.
 */
import type { ResolvedPos } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, NodeSelection, Selection, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { collapsedItemsHiding } from './outlineFolding'

export class BridgeRequestError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'BridgeRequestError' }
}

const toBase64 = (bytes: Uint8Array): string => {
  let s = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(s)
}

export const api = {
  async writeAsset({ path, content }: { root: string; path: string; content: Uint8Array; create: boolean }): Promise<void> {
    const r = await fetch('/labs/x/notes-view/image', { method: 'POST', body: JSON.stringify({ path, data: toBase64(content) }) })
    if (r.status === 409) throw new BridgeRequestError('exists', 'ALREADY_EXISTS')
    if (!r.ok) {
      let msg = `HTTP ${r.status}`
      try { msg = (await r.json()).error || msg } catch { /* not json */ }
      throw new BridgeRequestError(msg, 'WRITE_FAILED')
    }
  },
}

export const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
export const stripExt = (name: string): string => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name }

/** Effective CSS `zoom` at an element; jsdom/older engines fall back to the unscaled layout. */
export function cssZoom(element: Element): number {
  const zoom = (element as Element & { currentCSSZoom?: number }).currentCSSZoom
  return zoom !== undefined && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

export const blockEscapingLift: Command = () => false

const isHiddenTextblock = (state: EditorState, $pos: ResolvedPos): boolean => collapsedItemsHiding(state, $pos.pos).length > 0

const nextVisibleTextblock = (state: EditorState, $head: ResolvedPos, dir: 1 | -1): ResolvedPos | 'leaf' | null => {
  let from = dir > 0 ? $head.after() : $head.before()
  for (;;) {
    const found = Selection.findFrom(state.doc.resolve(from), dir, false)
    if (found === null) return null
    if (found instanceof NodeSelection) return 'leaf'
    const $n = found.$from
    if (!isHiddenTextblock(state, $n)) return $n
    from = dir > 0 ? $n.after() : $n.before()
  }
}

export const coveredLines = (state: EditorState): Selection => {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return sel
  let { $from, $to } = sel
  if ($to.parentOffset === 0 && !$to.sameParent($from)) {
    const $prev = nextVisibleTextblock(state, $to, -1)
    if ($prev !== null && $prev !== 'leaf' && $prev.end() >= $from.pos) $to = state.doc.resolve($prev.end())
  }
  if ($from.parentOffset === $from.parent.content.size && !$from.sameParent($to)) {
    const $next = nextVisibleTextblock(state, $from, 1)
    if ($next !== null && $next !== 'leaf' && $next.start() <= $to.pos) $from = state.doc.resolve($next.start())
  }
  return $from.pos === sel.from && $to.pos === sel.to ? sel : new TextSelection($from, $to)
}

const runOn = (sel: Selection, cmd: Command): Command => (state, dispatch, view) => {
  const own = state.selection
  const swapped = state.apply(state.tr.setSelection(sel))
  const restore = (tr: Transaction) => tr.setSelection(own.map(tr.doc, tr.mapping))
  return cmd(swapped, dispatch && ((tr) => dispatch(restore(tr))), view)
}

export const onCoveredLines = (cmd: Command): Command => (state, dispatch, view) => {
  const covered = coveredLines(state)
  return covered === state.selection ? cmd(state, dispatch, view) : runOn(covered, cmd)(state, dispatch, view)
}
