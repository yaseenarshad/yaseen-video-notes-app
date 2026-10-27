// VENDORED from yaseen-docs-app client/src/editor/outline/outlineFolding.ts @ 4608f7a8 (2026-10-26). ADAPTED for notes-view: imports flattened (./imageView). Keep it diffable against the source.
/**
 * Collapsible parent bullets (GRO-2011). Ported from yaseen-excalidraw
 * `docs/outlineFolding.ts`; logic unchanged apart from always reporting the
 * resolved key set once on mount (so persisted keys that no longer resolve get pruned).
 *
 * Design: fold state lives ONLY in plugin state (the document's outline entries + the collapsed
 * list_item positions, mapped through every transaction) + decorations. Toggling dispatches a
 * metadata-only transaction (`tr.setMeta(pluginKey, itemPos)`), so `tr.docChanged` is false, the
 * listener plugin never fires `markdownUpdated`, and the markdown on disk is untouched.
 * Persistence is by stable fold key (see outlineFoldKeys.ts), not by position.
 * ⌘Z panic-undo (GRO-2075): the state also remembers the most recent fold action while it is
 * the latest USER action; `undoLastFold` (bound to Mod-z in hotkeys.ts) reverts exactly that.
 * Any foreign view action — a zoom (zoom.ts) or an individual heading fold (headingFolding.ts,
 * YAZ-1140) — clears the pending fold undo (GRO-2091 B, see viewActions.ts). The one deliberate
 * exception is `document-fold`: foldAllHotkeys.ts updates bullets + headings atomically, so both
 * halves remain eligible and one ⌘Z restores both exact prior sets.
 * Image bullets (YAZ-1709): a list_item holding an `image` in its own blocks is foldable too, even
 * as a leaf. Its fold hides nested lists exactly as a parent's does and, on top, stamps every own
 * image with `data-outline-folded-image` so imageView.css shrinks it to a one-line chip; a click on
 * that chip is the chevron's toggle. Same plugin state, same meta-only transactions, same keys —
 * the image node view knows nothing about folding (decorations first, rule 5 / rule 30).
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Mapping } from '@milkdown/kit/prose/transform'
import { $prose } from '@milkdown/kit/utils'
import { findNestedLists, findOwnImages, innermostItemPos, itemLabelText, LIST_NODE_NAMES } from './listNodes'
import { IMAGE_FOLD_CLASS } from './imageView'
import { outlineFoldKeyFromStem, outlineFoldKeyStem, outlineFoldLabel } from './outlineFoldKeys'
import { collapsedKey, nodeRangesLand, widgetLands } from './foldCarry'
import { VIEW_ACTION_META, type ViewAction } from './viewActions'

interface OutlineEntry {
  foldKey: string
  itemPos: number
  label: string
  /**
   * Document ranges of every nested list (mixed markers parse as sibling lists; folding hides
   * them all).
   */
  nestedListRanges: readonly { from: number; to: number }[]
  /**
   * Document ranges of every image in the item's own blocks; folding shrinks them to a chip
   * (YAZ-1709).
   */
  imageRanges: readonly { from: number; to: number }[]
}

/** The most recent fold action while it is still the latest action (GRO-2075 panic-undo). */
type LastToggle =
  | { kind: 'toggle'; itemPos: number }
  /** fold-all / unfold-all: the collapsed set as it was right before the action. */
  | { kind: 'set'; previousCollapsed: ReadonlySet<number> }

interface OutlineFoldingState {
  /**
   * Every foldable list_item — one that owns a nested list or holds an image — in document order
   * (recomputed from the per-block cache only when the doc changes; its identity keys `decorationCache`).
   */
  entries: readonly OutlineEntry[]
  collapsedItemPositions: ReadonlySet<number>
  /** Cleared by any document change: ⌘Z only reverts a fold that is the latest action. */
  lastToggle: LastToggle | null
}

export interface OutlineFoldingOptions {
  /**
   * Read on EVERY state init — first mount and the `setMarkdown` rebuild (YAZ-1342). Since
   * YAZ-1347 a live external/AI edit is a diff TRANSACTION that never re-inits the state, so this
   * seed is the cold-start and rebuild-fallback path only; live folds ride position mapping.
   */
  seedCollapsedKeys?: () => ReadonlySet<string>
  /** Called with the sorted live collapsed keys whenever the set changes (and once on mount). */
  onCollapsedKeysChange?: (keys: readonly string[]) => void
}

export const OUTLINE_TOGGLE_CLASS = 'outline-toggle'
export const OUTLINE_FOLDED_ATTR = 'data-outline-folded'
/** On each image of a folded item; imageView.css turns the image into a one-line chip (YAZ-1709). */
export const OUTLINE_FOLDED_IMAGE_ATTR = 'data-outline-folded-image'
/**
 * On every image of a FOLDABLE item, folded or not; imageView.css shows the image's own fold
 * button only then (YAZ-1709).
 */
export const OUTLINE_FOLDABLE_IMAGE_ATTR = 'data-outline-foldable-image'

/**
 * ProseMirror asks for `decorations` on EVERY view update, caret moves included. `entries` keeps its
 * identity until the doc changes, so the set built for it and the same folded positions is exactly
 * what a rebuild would produce (YAZ-2131 4C).
 */
const decorationCache = new WeakMap<readonly OutlineEntry[], { collapsedKey: string; set: DecorationSet }>()

/** Shared across instances: a PluginKey only identifies the plugin within one EditorState. */
const pluginKey = new PluginKey<OutlineFoldingState>('mdapp-outline-folding')

/**
 * Transaction meta understood by the plugin: toggle one item (by position), fold/unfold every
 * foldable item, fold/unfold an explicit set (`FoldSetMeta`), or revert the latest fold.
 */
type FoldMeta = number | 'fold-all' | 'unfold-all' | 'undo-fold' | FoldSetMeta
/** Guide-line click (GRO-2107): fold (`collapsed: true`) or unfold every foldable item in `set`. */
interface FoldSetMeta {
  set: readonly number[]
  collapsed: boolean
  /**
   * A fold the USER did not ask for — CMD+F's fold-reveal (YAZ-968). It leaves `lastToggle` alone
   * and carries no view-action stamp, so ⌘Z panic-undo (fold and zoom alike) is untouched by it.
   */
  silent?: boolean
}

/** Every fold transaction: the plugin meta plus the shared view-action stamp (zoom.ts watches for it). */
const foldTransaction = (state: EditorState, meta: FoldMeta) =>
  state.tr.setMeta(pluginKey, meta).setMeta(VIEW_ACTION_META, 'fold' satisfies ViewAction)

/** Whether the list_item starting at `itemPos` is currently folded (false when the plugin is absent). */
export const isOutlineItemCollapsed = (state: EditorState, itemPos: number): boolean =>
  pluginKey.getState(state)?.collapsedItemPositions.has(itemPos) ?? false

/**
 * The collapsed items whose nested lists contain `pos` — everything hiding that position, from the
 * nearest parent up. CMD+F (YAZ-968) reveals exactly these to show a match, and puts them back.
 */
export const collapsedItemsHiding = (state: EditorState, pos: number): number[] => {
  const foldingState = pluginKey.getState(state)
  if (!foldingState) return []
  return foldingState.entries
    .filter(
      ({ itemPos, nestedListRanges }) =>
        foldingState.collapsedItemPositions.has(itemPos) && nestedListRanges.some((range) => pos >= range.from && pos < range.to),
    )
    .map(({ itemPos }) => itemPos)
}

/** Add this plugin's half of a document-wide fold-all transaction without dispatching it. */
export const addOutlineFoldAllMeta = (state: EditorState, transaction: Transaction, collapsed: boolean): boolean => {
  const foldingState = pluginKey.getState(state)
  if (!foldingState || foldingState.entries.length === 0) return false
  const allCollapsed = foldingState.entries.every(({ itemPos }) => foldingState.collapsedItemPositions.has(itemPos))
  if (collapsed ? allCollapsed : foldingState.collapsedItemPositions.size === 0) return false
  transaction.setMeta(pluginKey, collapsed ? 'fold-all' : 'unfold-all')
  return true
}

const foldAllCommand = (meta: 'fold-all' | 'unfold-all'): Command => (state, dispatch) => {
  const transaction = state.tr
  if (!addOutlineFoldAllMeta(state, transaction, meta === 'fold-all')) return false
  dispatch?.(transaction.setMeta(VIEW_ACTION_META, 'fold' satisfies ViewAction))
  return true
}

/**
 * Toggle the fold of the foldable list_item at `itemPos`; metadata-only (programmatic toggle —
 * the chevron and the guide line have their own paths).
 */
export const toggleOutlineFold = (itemPos: number): Command => (state, dispatch) => {
  const foldingState = pluginKey.getState(state)
  if (!foldingState) return false
  const isFoldable = foldingState.entries.some((entry) => entry.itemPos === itemPos)
  if (!isFoldable && !foldingState.collapsedItemPositions.has(itemPos)) return false
  dispatch?.(foldTransaction(state, itemPos))
  return true
}

/**
 * ⌘↑ / ⌘↓ (GRO-2092): fold (`collapsed: true`) or unfold the caret's innermost list_item. Inside a
 * list the key is always consumed — leaf or already in that state is a no-op — so ⌘↑ never flings
 * the caret to the top of the document mid-outline; outside lists it declines and the browser's
 * native document jump runs.
 */
export const setOutlineFoldAtSelection = (collapsed: boolean): Command => (state, dispatch) => {
  const foldingState = pluginKey.getState(state)
  const itemPos = innermostItemPos(state.selection.$from)
  if (!foldingState || itemPos === null) return false
  const isFoldable = foldingState.entries.some((entry) => entry.itemPos === itemPos)
  if (isFoldable && foldingState.collapsedItemPositions.has(itemPos) !== collapsed) {
    dispatch?.(foldTransaction(state, itemPos))
  }
  return true
}

/**
 * Guide-line click (GRO-2107, YAZ-1317): the direct foldable items inside the list — parents and
 * image bullets — decide the direction. Any of them expanded → collapse those direct items; all
 * collapsed → unfold every foldable item in the list's subtree. The list's owner and text leaves
 * are untouched; a list with nothing foldable declines.
 */
export const toggleOutlineFoldChildren = (listPos: number): Command => (state, dispatch) => {
  const foldingState = pluginKey.getState(state)
  const list = state.doc.nodeAt(listPos)
  if (!foldingState || !list || !LIST_NODE_NAMES.has(list.type.name)) return false
  const foldablePositions = new Set(foldingState.entries.map((entry) => entry.itemPos))
  const directFoldables: number[] = []
  list.forEach((_child, offset) => {
    const pos = listPos + 1 + offset
    if (foldablePositions.has(pos)) directFoldables.push(pos)
  })
  if (directFoldables.length === 0) return false
  const collapsed = directFoldables.some((pos) => !foldingState.collapsedItemPositions.has(pos))
  const set = collapsed
    ? directFoldables
    : foldingState.entries
        .filter(({ itemPos }) => itemPos > listPos && itemPos < listPos + list.nodeSize)
        .map(({ itemPos }) => itemPos)
  dispatch?.(foldTransaction(state, { set, collapsed }))
  return true
}

/**
 * Fold (`collapsed: true`) or unfold an explicit set of foldable items at once. `silent` marks a
 * fold the user did not ask for — CMD+F's fold-reveal (YAZ-968) — which must leave ⌘Z panic-undo
 * (fold and zoom alike) exactly as it found it. Declines an empty set.
 */
export const setOutlineFoldSet =
  (set: readonly number[], collapsed: boolean, options?: { silent?: boolean }): Command =>
  (state, dispatch) => {
    if (set.length === 0) return false
    const meta: FoldSetMeta = { set, collapsed, silent: options?.silent }
    dispatch?.(meta.silent === true ? state.tr.setMeta(pluginKey, meta) : foldTransaction(state, meta))
    return true
  }

/** Collapse every foldable item (GRO-2027 `Mod-Shift-u`); metadata-only, the doc is untouched. */
export const foldAllOutline: Command = foldAllCommand('fold-all')
/** Expand every foldable item (GRO-2027 `Mod-Shift-i`). */
export const unfoldAllOutline: Command = foldAllCommand('unfold-all')

/** Add this plugin's half of a combined fold undo without dispatching it. Declines when stale. */
export const addOutlineFoldUndoMeta = (state: EditorState, transaction: Transaction): boolean => {
  if (!pluginKey.getState(state)?.lastToggle) return false
  transaction.setMeta(pluginKey, 'undo-fold')
  return true
}

/** ⌘Z: revert the latest eligible bullet fold, otherwise let ProseMirror's undo run. */
export const undoLastFold: Command = (state, dispatch) => {
  const transaction = state.tr
  if (!addOutlineFoldUndoMeta(state, transaction)) return false
  dispatch?.(transaction.setMeta(VIEW_ACTION_META, 'fold' satisfies ViewAction))
  return true
}

/**
 * Chevron glyph (GRO-2093): one stroked SVG (chevron-down), sized by `--fold-chevron-size` and
 * rotated -90° by CSS when collapsed, so the 18px widget box — and with it the guide-line strip
 * and block-handle-gate geometry — never changes.
 */
const chevronSvg = (): SVGSVGElement => {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', 'M6 9l6 6 6-6')
  svg.appendChild(path)
  return svg
}

/** A foldable list_item as its top-level block alone decides it: positions relative to that block's content, no occurrence yet. */
interface BlockEntry {
  keyLabel: string
  keyStem: string
  label: string
  itemPos: number
  nestedListRanges: readonly { from: number; to: number }[]
  imageRanges: readonly { from: number; to: number }[]
}

/**
 * Per top-level block, its foldable items (YAZ-2236). Nodes are immutable and an edit leaves every
 * untouched block the SAME object, so a keystroke scans only the block it changed; the rest come
 * from here. Only the occurrence numbering spans blocks, and `getOutlineEntries` redoes that.
 */
const blockEntries = new WeakMap<ProseNode, readonly BlockEntry[]>()

const entriesOfBlock = (block: ProseNode): readonly BlockEntry[] => {
  const cached = blockEntries.get(block)
  if (cached !== undefined) return cached
  const entries: BlockEntry[] = []
  block.descendants((node, itemPos) => {
    if (node.type.name !== 'list_item') return true
    const nestedLists = findNestedLists(node)
    const images = findOwnImages(node)
    if (nestedLists.length === 0 && images.length === 0) return true

    const label = itemLabelText(node)
    entries.push({
      keyLabel: outlineFoldLabel(label),
      keyStem: outlineFoldKeyStem(label),
      label,
      itemPos,
      nestedListRanges: nestedLists.map(({ list, offset }) => {
        const from = itemPos + 1 + offset
        return { from, to: from + list.nodeSize }
      }),
      imageRanges: images.map(({ node, offset }) => {
        const from = itemPos + 1 + offset
        return { from, to: from + node.nodeSize }
      }),
    })
    return true
  })
  blockEntries.set(block, entries)
  return entries
}

const getOutlineEntries = (doc: ProseNode): OutlineEntry[] => {
  const entries: OutlineEntry[] = []
  const labelOccurrences = new Map<string, number>()
  doc.forEach((block, offset) => {
    const base = offset + 1
    const shift = ({ from, to }: { from: number; to: number }) => ({ from: base + from, to: base + to })
    for (const entry of entriesOfBlock(block)) {
      const occurrence = labelOccurrences.get(entry.keyLabel) ?? 0
      labelOccurrences.set(entry.keyLabel, occurrence + 1)
      entries.push({
        foldKey: outlineFoldKeyFromStem(entry.keyStem, occurrence),
        itemPos: base + entry.itemPos,
        label: entry.label,
        nestedListRanges: entry.nestedListRanges.map(shift),
        imageRanges: entry.imageRanges.map(shift),
      })
    }
  })
  return entries
}

const getCollapsedKeys = ({ entries, collapsedItemPositions }: OutlineFoldingState): string[] =>
  entries
    .filter(({ itemPos }) => collapsedItemPositions.has(itemPos))
    .map(({ foldKey }) => foldKey)
    .sort()

/**
 * An edit that leaves every foldable item where the mapping puts it, with the same key, label and
 * fold, needs no new decorations: the previous set, mapped, is exactly what `decorations` builds
 * (YAZ-2131 5C, pinned by foldDecorations.test.ts). Typing inside a bullet is that case, so a keystroke skips
 * the rebuild. A carried chevron reads its live position at click time, so it acts like a new one.
 */
const carryDecorations = (previous: OutlineFoldingState, entries: readonly OutlineEntry[], collapsed: ReadonlySet<number>, mapping: Mapping, doc: ProseNode): void => {
  const cached = decorationCache.get(previous.entries)
  if (cached === undefined || cached.collapsedKey !== collapsedKey(previous.collapsedItemPositions) || entries.length !== previous.entries.length) return
  const unchanged = entries.every((entry, i) => {
    const before = previous.entries[i]
    const folded = collapsed.has(entry.itemPos)
    return (
      entry.foldKey === before.foldKey &&
      entry.label === before.label &&
      folded === previous.collapsedItemPositions.has(before.itemPos) &&
      widgetLands(mapping, before.itemPos + 1, entry.itemPos + 1) &&
      nodeRangesLand(mapping, before.imageRanges, entry.imageRanges) &&
      (!folded || nodeRangesLand(mapping, before.nestedListRanges, entry.nestedListRanges))
    )
  })
  if (unchanged) decorationCache.set(entries, { collapsedKey: collapsedKey(collapsed), set: cached.set.map(mapping, doc) })
}

export const createOutlineFolding = ({ seedCollapsedKeys = () => new Set(), onCollapsedKeysChange }: OutlineFoldingOptions = {}) =>
  $prose(
    () =>
      new Plugin<OutlineFoldingState>({
        key: pluginKey,
        state: {
          init: (_config, state) => {
            const entries = getOutlineEntries(state.doc)
            const seed = seedCollapsedKeys()
            return {
              entries,
              collapsedItemPositions: new Set(
                entries.filter(({ foldKey }) => seed.has(foldKey)).map(({ itemPos }) => itemPos),
              ),
              lastToggle: null,
            }
          },
          apply: (transaction, previousState, _oldState, newState) => {
            // A caret move changes no entry, fold or ⌘Z eligibility: keep the SAME state object (YAZ-2131 4C).
            if (!transaction.docChanged && transaction.getMeta(pluginKey) === undefined && transaction.getMeta(VIEW_ACTION_META) === undefined)
              return previousState
            const entries = transaction.docChanged ? getOutlineEntries(newState.doc) : previousState.entries
            const foldablePositions = new Set(entries.map(({ itemPos }) => itemPos))
            const collapsedItemPositions = new Set<number>()
            previousState.collapsedItemPositions.forEach((position) => {
              const mappedPosition = transaction.mapping.map(position, 1)
              if (foldablePositions.has(mappedPosition)) collapsedItemPositions.add(mappedPosition)
            })

            // A fold is only ⌘Z-revertible while it is the latest USER action. Plugin-appended
            // transactions (e.g. Crepe's trailing paragraph) are not user actions: they keep the
            // pending fold alive, with positions mapped through their doc change.
            const appended = transaction.getMeta('appendedTransaction') !== undefined
            const viewAction: unknown = transaction.getMeta(VIEW_ACTION_META)
            let lastToggle = previousState.lastToggle
            if (transaction.docChanged && !appended) lastToggle = null
            // A newer view action of another kind — a zoom or a heading fold (YAZ-1140) — owns ⌘Z now.
            else if (viewAction !== undefined && viewAction !== 'fold' && viewAction !== 'document-fold') lastToggle = null
            else if (transaction.docChanged && lastToggle !== null) {
              lastToggle =
                lastToggle.kind === 'toggle'
                  ? { kind: 'toggle', itemPos: transaction.mapping.map(lastToggle.itemPos, 1) }
                  : {
                      kind: 'set',
                      previousCollapsed: new Set(
                        [...lastToggle.previousCollapsed].map((p) => transaction.mapping.map(p, 1)),
                      ),
                    }
            }

            const meta: FoldMeta | undefined = transaction.getMeta(pluginKey)
            if (meta === 'fold-all')
              return {
                entries,
                collapsedItemPositions: foldablePositions,
                lastToggle: { kind: 'set', previousCollapsed: collapsedItemPositions },
              }
            if (meta === 'unfold-all')
              return {
                entries,
                collapsedItemPositions: new Set(),
                lastToggle: { kind: 'set', previousCollapsed: collapsedItemPositions },
              }
            if (meta === 'undo-fold' && lastToggle !== null) {
              if (lastToggle.kind === 'set') {
                const restored = new Set([...lastToggle.previousCollapsed].filter((p) => foldablePositions.has(p)))
                return { entries, collapsedItemPositions: restored, lastToggle: null }
              }
              if (collapsedItemPositions.has(lastToggle.itemPos)) collapsedItemPositions.delete(lastToggle.itemPos)
              else if (foldablePositions.has(lastToggle.itemPos)) collapsedItemPositions.add(lastToggle.itemPos)
              return { entries, collapsedItemPositions, lastToggle: null }
            }
            if (typeof meta === 'number') {
              if (collapsedItemPositions.has(meta)) collapsedItemPositions.delete(meta)
              else if (foldablePositions.has(meta)) collapsedItemPositions.add(meta)
              lastToggle = { kind: 'toggle', itemPos: meta }
            } else if (typeof meta === 'object') {
              // FoldSetMeta (never null: meta is either absent, a string, a number or the set object).
              const previousCollapsed = new Set(collapsedItemPositions)
              for (const pos of meta.set) {
                if (meta.collapsed && foldablePositions.has(pos)) collapsedItemPositions.add(pos)
                else if (!meta.collapsed) collapsedItemPositions.delete(pos)
              }
              // A silent set is not a user fold action: ⌘Z keeps whatever it was already pointing at.
              if (meta.silent !== true) lastToggle = { kind: 'set', previousCollapsed }
            } else if (transaction.docChanged) carryDecorations(previousState, entries, collapsedItemPositions, transaction.mapping, newState.doc)
            return { entries, collapsedItemPositions, lastToggle }
          },
        },
        props: {
          // Folded chip (YAZ-1709): a click on the THUMBNAIL is the chevron's toggle. Only the <img>
          // counts, so a click aimed at the text around the chip never pops the image open.
          handleClickOn: (view, _pos, node, nodePos, event) => {
            if (node.type.name !== 'image' || !(event.target instanceof HTMLImageElement)) return false
            const foldingState = pluginKey.getState(view.state)
            if (!foldingState) return false
            const entry = foldingState.entries.find((e) =>
              e.imageRanges.some((r) => r.from === nodePos),
            )
            if (!entry || !foldingState.collapsedItemPositions.has(entry.itemPos)) return false
            event.preventDefault()
            view.dispatch(foldTransaction(view.state, entry.itemPos))
            return true
          },
          handleDOMEvents: {
            // Expanded image: its corner button folds the bullet — the chip's click in reverse. Taken
            // on mousedown so ProseMirror never turns the press into a node selection or caret move.
            mousedown: (view, event) => {
              // Only the primary button folds: a right-click must keep reaching the native context
              // menu (Copy Image / Reveal) instead of being swallowed as a fold.
              if (event.button !== 0) return false
              const target = event.target
              if (!(target instanceof Element) || !target.closest(`.${IMAGE_FOLD_CLASS}`)) return false
              const pos = view.posAtDOM(target, 0)
              const entry = pluginKey
                .getState(view.state)
                ?.entries.find((e) => e.imageRanges.some((r) => pos >= r.from && pos <= r.to))
              if (!entry) return false
              event.preventDefault()
              view.dispatch(foldTransaction(view.state, entry.itemPos))
              return true
            },
          },
          decorations: (state) => {
            const foldingState = pluginKey.getState(state)
            if (!foldingState) return DecorationSet.empty
            const key = collapsedKey(foldingState.collapsedItemPositions)
            const cached = decorationCache.get(foldingState.entries)
            if (cached?.collapsedKey === key) return cached.set

            const decorations: Decoration[] = []
            foldingState.entries.forEach((entry) => {
              const collapsed = foldingState.collapsedItemPositions.has(entry.itemPos)
              decorations.push(
                Decoration.widget(
                  entry.itemPos + 1,
                  (view, getPos) => {
                    const button = document.createElement('button')
                    button.type = 'button'
                    button.className = OUTLINE_TOGGLE_CLASS
                    button.dataset.outlineFoldKey = entry.foldKey
                    button.setAttribute('aria-expanded', String(!collapsed))
                    button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${entry.label}`)
                    button.replaceChildren(chevronSvg())
                    // The LIVE position, not `entry.itemPos`: ProseMirror keeps this DOM (same key) while edits above
                    // shift the bullet, and a stale position folded nothing.
                    const toggle = () => {
                      const widgetPos = getPos()
                      if (widgetPos !== undefined) view.dispatch(foldTransaction(view.state, widgetPos - 1))
                    }
                    // Keep the caret where it is: the toggle must not steal focus or move the selection.
                    button.addEventListener('mousedown', (event) => event.preventDefault())
                    button.addEventListener('click', (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      toggle()
                    })
                    // The widget sits inside the contenteditable, so ProseMirror's keymap would swallow
                    // Enter/Space before the button's native activation; handle them here and keep focus
                    // on the (re-rendered) toggle so keyboard users can fold/unfold repeatedly.
                    button.addEventListener('keydown', (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      toggle()
                      view.dom
                        .querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}[data-outline-fold-key="${entry.foldKey}"]`)
                        ?.focus()
                    })
                    return button
                  },
                  { key: `outline-toggle:${entry.foldKey}:${collapsed ? 'collapsed' : 'expanded'}` },
                ),
              )
              entry.imageRanges.forEach(({ from, to }) => {
                const attrs = collapsed
                  ? { [OUTLINE_FOLDABLE_IMAGE_ATTR]: 'true', [OUTLINE_FOLDED_IMAGE_ATTR]: 'true' }
                  : { [OUTLINE_FOLDABLE_IMAGE_ATTR]: 'true' }
                decorations.push(Decoration.node(from, to, attrs))
              })
              if (collapsed) {
                entry.nestedListRanges.forEach(({ from, to }) => {
                  decorations.push(Decoration.node(from, to, { [OUTLINE_FOLDED_ATTR]: 'true' }))
                })
              }
            })
            const set = DecorationSet.create(state.doc, decorations)
            decorationCache.set(foldingState.entries, { collapsedKey: key, set })
            return set
          },
        },
        view: (view) => {
          let previousKeys: string | null = null
          const notify = () => {
            const foldingState = pluginKey.getState(view.state)
            if (!foldingState || !onCollapsedKeysChange) return
            const keys = getCollapsedKeys(foldingState)
            const serializedKeys = keys.join(' ')
            if (serializedKeys !== previousKeys) {
              previousKeys = serializedKeys
              onCollapsedKeysChange(keys)
            }
          }
          notify()
          return { update: notify }
        },
      }),
  )
