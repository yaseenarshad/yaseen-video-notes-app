// VENDORED from yaseen-docs-app client/src/editor/marks/htmlPairs.ts @ 4608f7a8 (2026-10-26). Unchanged. Keep it diffable against the source.
/**
 * Inline-HTML pair wrapping, shared by `underline.ts` (`<u>…</u>`) and the coloured half of
 * `highlight.ts` (`<mark class="highlight-green">…</mark>`).
 *
 * Markdown has no syntax for either, so the vault stores them as inline HTML. remark parses
 * `a <u>b</u> c` as `text, html("<u>"), text, html("</u>"), text`, and Milkdown's commonmark
 * preset turns each `html` node into an atom `html` inline node. This walk maps the matched
 * pairs onto real mdast nodes instead, so they can become ProseMirror marks.
 */
import type { Parent, PhrasingContent, RootContent } from 'mdast'

export interface HtmlPairSpec<A> {
  /** Returns the attrs for an opening html node, or null when this html node is not an opener for this mark. */
  open: (html: string) => A | null
  /** The exact closing html value, e.g. `</u>` or `</mark>`. */
  close: string
  /** Build the mdast node from the matched attrs and the in-between siblings. */
  make: (attrs: A, children: PhrasingContent[]) => RootContent
}

/** The attrs this spec reads out of `child`, or null when `child` is not one of its openers. */
const openerAttrs = <A>(child: RootContent, spec: HtmlPairSpec<A>): A | null =>
  child.type === 'html' ? spec.open(child.value) : null

/** Index of the closing tag matching the opener at `open` (any opener of this spec nests), or -1. */
const findClose = <A>(children: RootContent[], open: number, spec: HtmlPairSpec<A>): number => {
  let depth = 0
  for (let i = open + 1; i < children.length; i++) {
    const child = children[i]
    if (child.type !== 'html') continue
    if (spec.open(child.value) !== null) depth++
    else if (child.value === spec.close) {
      if (depth === 0) return i
      depth--
    }
  }
  return -1
}

/**
 * Recursively wrap every `open … close` inline-HTML pair (nearest match, depth-aware, inside any
 * inline parent) into the mark's mdast node. Unmatched tags and every other inline HTML are left
 * alone and keep going through Milkdown's `html` atom node. The wrapped node is walked again, so
 * nested pairs resolve inside-out.
 */
export function wrapHtmlPairs<A>(node: Parent, spec: HtmlPairSpec<A>): void {
  for (const child of node.children) if ('children' in child) wrapHtmlPairs(child, spec)
  const children = node.children
  for (let i = 0; i < children.length; i++) {
    const attrs = openerAttrs(children[i], spec)
    if (attrs === null) continue
    const close = findClose(children, i, spec)
    if (close < 0) continue
    const made = spec.make(attrs, children.slice(i + 1, close) as PhrasingContent[])
    if ('children' in made) wrapHtmlPairs(made, spec)
    children.splice(i, close - i + 1, made)
  }
}
