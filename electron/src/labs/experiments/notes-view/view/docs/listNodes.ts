// VENDORED from yaseen-docs-app client/src/editor/outline/listNodes.ts @ 4608f7a8 (2026-10-26). ADAPTED for notes-view: imports flattened (./imageSrc). Keep it diffable against the source.
/** List node helpers shared by the folding plugin, zoom and the outliner keymap. */
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { parseAlt } from './imageSrc'

export const LIST_NODE_NAMES: ReadonlySet<string> = new Set(['bullet_list', 'ordered_list'])

export const isListItem = (node: ProseNode | null | undefined): node is ProseNode =>
  node?.type.name === 'list_item'

/** What `itemLabelText` answers for an item with no label: the table of contents reads it as "no row" (`toc/tocPlugin.ts`). */
export const UNTITLED_ITEM = 'Untitled item'

/**
 * First-block text of a list item — the label behind fold keys, zoom keys and breadcrumbs alike.
 * An image counts as its alt text (width stripped, src as the fallback), the same stand-in the
 * plain-text copy uses (clipboardPlainText.ts), so an image bullet has an identity of its own
 * instead of every one of them being "Untitled item" (YAZ-1709).
 */
export const itemLabelText = (item: ProseNode): string => {
  const first = item.firstChild
  if (!first) return UNTITLED_ITEM
  const text = first.textBetween(0, first.content.size, '', (leaf) =>
    leaf.type.name === 'image'
      ? parseAlt(leaf.attrs.alt as string).text || (leaf.attrs.src as string)
      : '',
  )
  return text.trim() || UNTITLED_ITEM
}

export interface NestedList {
  list: ProseNode
  /** Offset of the list inside the item (`itemPos + 1 + offset` is its document position). */
  offset: number
}

/**
 * Every nested list owned by a list_item, in order. Mixed markers (`*` vs `-`) parse as sibling
 * lists.
 */
export const findNestedLists = (item: ProseNode): NestedList[] => {
  const found: NestedList[] = []
  item.forEach((child, offset) => {
    if (LIST_NODE_NAMES.has(child.type.name)) found.push({ list: child, offset })
  })
  return found
}

export interface OwnImage {
  node: ProseNode
  /** Offset of the image inside the item (`itemPos + 1 + offset` is its document position). */
  offset: number
}

/** Every image in the item's OWN blocks (nested lists excluded), in order (YAZ-1709). */
export const findOwnImages = (item: ProseNode): OwnImage[] => {
  const found: OwnImage[] = []
  item.forEach((block, blockOffset) => {
    if (LIST_NODE_NAMES.has(block.type.name)) return
    block.descendants((node, pos) => {
      if (node.type.name === 'image') found.push({ node, offset: blockOffset + 1 + pos })
      return true
    })
  })
  return found
}

/** The first nested list owned by a list_item, or null for a leaf item. */
export const findNestedList = (item: ProseNode): NestedList | null =>
  findNestedLists(item)[0] ?? null

/**
 * Positions of the list_item ancestors of `$pos` (outermost first); `$pos` itself may sit inside
 * an item.
 */
export const ancestorItemPositions = ($pos: ResolvedPos): number[] => {
  const positions: number[] = []
  for (let depth = 1; depth <= $pos.depth; depth++) {
    if (isListItem($pos.node(depth))) positions.push($pos.before(depth))
  }
  return positions
}

/** Position of the innermost list_item containing `$pos`, or null outside lists. */
export const innermostItemPos = ($pos: ResolvedPos): number | null => {
  const positions = ancestorItemPositions($pos)
  return positions.length > 0 ? positions[positions.length - 1] : null
}
