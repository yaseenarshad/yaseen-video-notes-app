// VENDORED from yaseen-docs-app client/src/editor/outline/guideLines.ts @ 4608f7a8 (2026-10-26). ADAPTED for notes-view: cssZoom from ./shims. Keep it diffable against the source.
/**
 * List guide lines — click to fold (GRO-2030, obsidian-outliner `listLines`; click semantics
 * re-ruled in GRO-2107: a click acts on the bullets ALONGSIDE the line, not on its owner).
 *
 * The line itself is pure CSS (guideLines.css): a `::before` strip on every nested
 * `ul`/`ol`, absolutely positioned in the parent item's gutter so the 1px line runs under the
 * parent's bullet glyph. Pseudo-element boxes hit-test as their originating element, so a
 * pointer over the strip targets the list element at a `clientX` LEFT of its border box —
 * that is the whole detection: no extra DOM, no layout shift, chevron and glyph (separate
 * elements) are never involved. This plugin turns those strip hits into behaviour:
 *  - mousedown → collapse the parent items directly inside the list, or recursively unfold every
 *    parent below them (`toggleOutlineFoldChildren`, GRO-2107/YAZ-1317; meta-only transaction,
 *    markdown untouched), and swallow the event so the caret never moves — the list's owner folds
 *    only via its chevron, ⌘↑ or the line one level up;
 *  - mousemove/mouseleave → `outline-guide-hover` on the list, so ONLY strip hover highlights
 *    the line (CSS `ul:hover::before` would light up while merely editing text inside).
 */
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { cssZoom } from './shims'
import { isListItem, LIST_NODE_NAMES } from './listNodes'
import { toggleOutlineFoldChildren } from './outlineFolding'

export const GUIDE_HOVER_CLASS = 'outline-guide-hover'

/** Keep in sync with guideLines.css / bullets.css: strip is `--list-label-gap` (10px) wide, centred `--list-indent`/2 + 5px left of the list (jsdom resolves no pseudo-element styles, so these stay constants). Exported for the block-handle gate (blockHandleGate.ts), which mutes the drag handle over the same bands. */
export const STRIP_HALF_WIDTH = 5
export const STRIP_CENTRE_GAP = 5
/** `--list-indent` (bullets.css) is 2.15em of the editor's base font. */
export const LIST_INDENT_EM = 2.15
export const FALLBACK_FONT_PX = 16

const pluginKey = new PluginKey('mdapp-outline-guide-lines')

/** True when viewport `x` is over the CSS strip rendered beside `list`. */
export function inStripBand(x: number, ulLeft: number, fontPx: number, zoom = 1): boolean {
  const centre = ulLeft - ((LIST_INDENT_EM * fontPx) / 2 + STRIP_CENTRE_GAP) * zoom
  return Math.abs(x - centre) <= STRIP_HALF_WIDTH * zoom
}

/** Shared by the guide action and the block-handle gate so both hit the same rendered strip. */
export function isGuideStripHit(x: number, list: Element): boolean {
  const fontPx = Number.parseFloat(getComputedStyle(list).fontSize) || FALLBACK_FONT_PX
  return inStripBand(x, list.getBoundingClientRect().left, fontPx, cssZoom(list))
}

/** The nested list element whose guide-line strip is under (`clientX`, target), or null. */
const stripHit = (view: EditorView, event: MouseEvent): HTMLElement | null => {
  const target = event.target
  // Only the strip pseudo extends a nested list's hit area beyond its border box, so a list
  // target at a clientX left of the box can only mean the strip was hit.
  if (!(target instanceof HTMLElement) || (target.tagName !== 'UL' && target.tagName !== 'OL')) return null
  if (!view.dom.contains(target) || !target.parentElement?.classList.contains('content-dom')) return null
  return isGuideStripHit(event.clientX, target) ? target : null
}

/** Document position of the nested list rendered as `list` (its owner must be a list_item), or null. */
const nestedListPos = (view: EditorView, list: HTMLElement): number | null => {
  const $pos = view.state.doc.resolve(view.posAtDOM(list, 0))
  if ($pos.depth < 2 || !LIST_NODE_NAMES.has($pos.parent.type.name)) return null
  return isListItem($pos.node($pos.depth - 1)) ? $pos.before($pos.depth) : null
}

export const guideLines = $prose(
  () => {
    let hovered: HTMLElement | null = null
    const setHovered = (list: HTMLElement | null) => {
      if (hovered === list) return
      hovered?.classList.remove(GUIDE_HOVER_CLASS)
      list?.classList.add(GUIDE_HOVER_CLASS)
      hovered = list
    }
    return new Plugin({
      key: pluginKey,
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            const list = stripHit(view, event)
            if (list === null) return false
            const listPos = nestedListPos(view, list)
            if (listPos === null) return false
            // Swallow the event BEFORE toggling: the caret must not move and no text may select —
            // also when the line's bullets are all leaves and there is nothing to fold.
            event.preventDefault()
            toggleOutlineFoldChildren(listPos)(view.state, view.dispatch)
            return true
          },
          mousemove: (view, event) => {
            setHovered(stripHit(view, event))
            return false
          },
          mouseleave: () => {
            setHovered(null)
            return false
          },
        },
      },
      view: () => ({ destroy: () => setHovered(null) }),
    })
  },
)
