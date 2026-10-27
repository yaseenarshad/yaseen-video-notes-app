// VENDORED from yaseen-docs-app client/src/editor/outline/listCommands.ts @ 4608f7a8 (2026-10-26). ADAPTED for notes-view: onCoveredLines / blockEscapingLift from ./shims (no zoom, no heading folds in the Notes view). Keep it diffable against the source.
/**
 * Outliner keymap for bullet / ordered / task lists (GRO-2012). Obsidian-outliner / Logseq
 * feel on top of Crepe's own list keymap; only the gaps are patched here, Milkdown is not forked.
 *
 * What Crepe (commonmark `listItemKeymap` + ProseMirror schema-list) already does right and is
 * reused: Tab = sinkListItem, Shift-Tab = liftListItem (level 1 → paragraph, following siblings
 * nest under the lifted item), Enter = splitListItem mid/end of an item. Tab and Shift-Tab run
 * those same commands from our bindings below (YAZ-3003). Markers/indent after any of these
 * serialise correctly (GRO-1844).
 *
 * Gaps fixed here (registered with priority 100 so they run before Crepe's 50s):
 *  - Tab inside a list item never falls through to `@milkdown/plugin-indent`, which would
 *    insert literal spaces into the text when the item cannot sink (first sibling).
 *  - Tab, Shift-Tab, Mod-] and Mod-[ act on the lines the selection COVERS (YAZ-3003): a keyboard
 *    line selection touches the parent or the next sibling at zero width, and that line stays put.
 *    So Shift-Tab and Mod-[ are ours now: the zoom guard first, then Crepe's own lift. A text
 *    selection over two or more lines that are not all list items consumes both keys.
 *  - Enter on an EMPTY item (no children) outdents it; at level 1 it leaves the list as a
 *    paragraph. Crepe's `liftEmptyBlock` fallback instead dropped a stray paragraph inside the
 *    parent item when the empty item was not last.
 *  - Enter at the END of an item that owns a nested list creates the new item as its FIRST
 *    CHILD (Workflowy/Logseq); when the item is folded (GRO-2011) the new item goes AFTER the
 *    whole subtree instead, so hidden children never move. Crepe handed the children to the
 *    new empty item.
 *  - Backspace at the START of an item's first block joins its text into the previous
 *    paragraph (the visually previous item, or the parent item for a first child) and removes
 *    the item — the Logseq merge. An EMPTY parent is removed and its children take its place;
 *    other items that own children (or extra blocks) are left alone, and with no paragraph
 *    before them the item is lifted to a paragraph. Crepe's `joinBackward` produced stray
 *    `* * child` lists and second paragraphs instead.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { listItemSchema, paragraphSchema } from '@milkdown/kit/preset/commonmark'
import type { NodeType, ResolvedPos } from '@milkdown/kit/prose/model'
import { liftListItem, sinkListItem } from '@milkdown/kit/prose/schema-list'
import { type Command, type EditorState, Selection, TextSelection } from '@milkdown/kit/prose/state'
import { $shortcut } from '@milkdown/kit/utils'
import { onCoveredLines } from './shims'
import { findNestedList } from './listNodes'
import { isOutlineItemCollapsed } from './outlineFolding'
import { blockEscapingLift } from './shims'

/** Priority above Crepe's list/indent/base keymaps (default 50). */
const PRIORITY = 100

/** Both selection ends sit in a textblock that is a direct child of a list_item. */
const selectionInListItems = (state: EditorState, itemType: NodeType): boolean => {
  const { $from, $to } = state.selection
  return $from.depth >= 2 && $from.node(-1).type === itemType && $to.depth >= 2 && $to.node(-1).type === itemType
}

/** Caret (empty selection) inside the FIRST block of a list_item, or null. */
const caretInFirstBlock = (state: EditorState, itemType: NodeType): ResolvedPos | null => {
  const { $from, empty } = state.selection
  if (!empty || $from.depth < 2 || $from.node(-1).type !== itemType || $from.index(-1) !== 0) return null
  return $from
}

/** A text selection over two or more lines (YAZ-3003): Tab / Shift-Tab consume it there instead of typing spaces or moving focus. */
const spansLines = (state: EditorState): boolean => {
  const sel = state.selection
  return sel instanceof TextSelection && !sel.$from.sameParent(sel.$to)
}

const indentCommand = (itemType: NodeType): Command =>
  onCoveredLines((state, dispatch) => {
    if (!selectionInListItems(state, itemType)) return spansLines(state)
    sinkListItem(itemType)(state, dispatch)
    // Handled either way: a first sibling cannot sink, and the indent plugin must not insert spaces.
    return true
  })

const outdentCommand = (itemType: NodeType): Command =>
  onCoveredLines((state, dispatch) => {
    if (!selectionInListItems(state, itemType)) return spansLines(state)
    // Handled either way: GRO-2029's zoom guard reads the covered lines too, then Crepe's lift.
    if (!blockEscapingLift(state)) liftListItem(itemType)(state, dispatch)
    return true
  })

const enterCommand = (itemType: NodeType, paragraphType: NodeType): Command => (state, dispatch) => {
  const $from = caretInFirstBlock(state, itemType)
  if (!$from) return false
  const item = $from.node(-1)
  const block = $from.parent

  if (block.content.size === 0 && item.childCount === 1) return liftListItem(itemType)(state, dispatch)

  if ($from.parentOffset !== block.content.size) return false
  const nested = findNestedList(item)
  if (!nested) return false
  if (!dispatch) return true

  const itemPos = $from.before(-1)
  const collapsed = isOutlineItemCollapsed(state, itemPos)
  const template = collapsed ? item : (nested.list.firstChild ?? item)
  const newItem = itemType.create(
    { ...template.attrs, checked: template.attrs.checked == null ? null : false },
    paragraphType.create(),
  )
  const insertAt = collapsed ? itemPos + item.nodeSize : itemPos + 1 + nested.offset + 1
  const tr = state.tr.insert(insertAt, newItem)
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 2))
  dispatch(tr.scrollIntoView())
  return true
}

const backspaceCommand = (itemType: NodeType): Command => (state, dispatch) => {
  const $from = caretInFirstBlock(state, itemType)
  if (!$from || $from.parentOffset !== 0) return false
  const item = $from.node(-1)
  const itemPos = $from.before(-1)

  if (item.childCount > 1) {
    // Empty parent: remove the bullet and promote its children into its place.
    const nested = findNestedList(item)
    if ($from.parent.content.size !== 0 || item.childCount !== 2 || !nested) return true
    if (dispatch) {
      const tr = state.tr.replaceWith(itemPos, itemPos + item.nodeSize, nested.list.content)
      tr.setSelection(Selection.near(tr.doc.resolve(itemPos), -1))
      dispatch(tr.scrollIntoView())
    }
    return true
  }

  const $prev = Selection.findFrom(state.doc.resolve(itemPos), -1, true)?.$from
  if (!$prev || $prev.parent.type.name !== 'paragraph' || $prev.parentOffset !== $prev.parent.content.size) {
    return liftListItem(itemType)(state, dispatch)
  }
  if (!dispatch) return true

  const list = $from.node(-2)
  const listPos = $from.before(-2)
  const tr = list.childCount === 1 ? state.tr.delete(listPos, listPos + list.nodeSize) : state.tr.delete(itemPos, itemPos + item.nodeSize)
  tr.insert($prev.pos, $from.parent.content)
  tr.setSelection(TextSelection.create(tr.doc, $prev.pos))
  dispatch(tr.scrollIntoView())
  return true
}

/** Keymap plugin; register with `editor.use(outlinerKeymap)`. */
export const outlinerKeymap = $shortcut((ctx: Ctx) => {
  const itemType = listItemSchema.type(ctx)
  const paragraphType = paragraphSchema.type(ctx)
  return {
    Tab: { key: 'Tab', priority: PRIORITY, onRun: () => indentCommand(itemType) },
    IndentBracket: { key: 'Mod-]', priority: PRIORITY, onRun: () => indentCommand(itemType) },
    Outdent: { key: 'Shift-Tab', priority: PRIORITY, onRun: () => outdentCommand(itemType) },
    OutdentBracket: { key: 'Mod-[', priority: PRIORITY, onRun: () => outdentCommand(itemType) },
    Enter: { key: 'Enter', priority: PRIORITY, onRun: () => enterCommand(itemType, paragraphType) },
    Backspace: { key: 'Backspace', priority: PRIORITY, onRun: () => backspaceCommand(itemType) },
  }
})
