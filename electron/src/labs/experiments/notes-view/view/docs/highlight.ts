// VENDORED from yaseen-docs-app client/src/editor/marks/highlight.ts @ 4608f7a8 (2026-10-26). ADAPTED for notes-view: only the syntax (`==…==` + `<mark class>`) and the mark schema — no toolbar command / keymap / typing rule (the Notes view applies the mark itself to what Yasin types: view/yasinMarks.ts); the schema's `inclusive` is set explicitly. Keep it diffable against the source.
/**
 * Highlight mark (YAZ-1480): one mark, one optional `color`, two forms on disk. The contract is
 * CONTRACTS rule 31; this header is the mechanism.
 *
 *  - `color: null` (yellow) is real Markdown, Obsidian's `==text==`: a vendored micromark
 *    tokenizer (gfm-strikethrough's attention run with `=` and exactly two), the mdast handlers,
 *    and stringify `unsafe` rules that write `\=` for any `=` touching another `=`.
 *  - A named colour has no Markdown syntax, so — like underline's `<u>` — it is inline HTML
 *    `<mark class="highlight-<name>">`, read back through the shared `htmlPairs.ts` walk.
 *  - `setHighlightCommand(color)` is the one command behind the four toolbar swatches,
 *    `Mod-Shift-h` (yellow) and the `==x==` typing rule (yellow) — Bold's toggle rule (🔒 D5).
 */
import { $markSchema, $remark } from '@milkdown/kit/utils'
import type { Parent, PhrasingContent } from 'mdast'
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown'
import type { ConstructName, Handle, Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { splice } from 'micromark-util-chunked'
import { classifyCharacter } from 'micromark-util-classify-character'
import { resolveAll } from 'micromark-util-resolve-all'
import type { Event, Extension, Resolver, State, Token, TokenizeContext, Tokenizer } from 'micromark-util-types'
import { wrapHtmlPairs, type HtmlPairSpec } from './htmlPairs'

/** The named colours; yellow is `null` (the default, and the only one with Markdown syntax). */
export const HIGHLIGHT_COLORS = ['green', 'blue', 'pink'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number] | null

/** mdast node for a highlight; registered with mdast so remark-stringify's `Handlers` knows the type. */
export interface Highlight extends Parent {
  type: 'highlight'
  /** Absent or null = the default yellow, written as `==…==`. */
  color?: HighlightColor
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    highlight: Highlight
  }
  interface RootContentMap {
    highlight: Highlight
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    highlight: 'highlight'
    highlightSequence: 'highlightSequence'
    highlightSequenceTemporary: 'highlightSequenceTemporary'
    highlightText: 'highlightText'
  }
}

const EQUALS = 61 // '='

/** Pair each closing `==` with the nearest same-length opener; unmatched runs fall back to text. */
const resolveAllHighlight: Resolver = (events, context) => {
  let index = -1
  while (++index < events.length) {
    const closer = events[index][1]
    if (events[index][0] !== 'enter' || closer.type !== 'highlightSequenceTemporary' || !closer._close) continue
    let open = index
    while (open--) {
      const opener = events[open][1]
      if (events[open][0] !== 'exit' || opener.type !== 'highlightSequenceTemporary' || !opener._open) continue
      if (closer.end.offset - closer.start.offset !== opener.end.offset - opener.start.offset) continue
      closer.type = 'highlightSequence'
      opener.type = 'highlightSequence'
      const highlight: Token = { type: 'highlight', start: { ...opener.start }, end: { ...closer.end } }
      const text: Token = { type: 'highlightText', start: { ...opener.end }, end: { ...closer.start } }
      const next: Event[] = [
        ['enter', highlight, context],
        ['enter', opener, context],
        ['exit', opener, context],
        ['enter', text, context],
      ]
      const insideSpan = context.parser.constructs.insideSpan.null
      if (insideSpan) splice(next, next.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context))
      splice(next, next.length, 0, [
        ['exit', text, context],
        ['enter', closer, context],
        ['exit', closer, context],
        ['exit', highlight, context],
      ])
      splice(events, open - 1, index - open + 3, next)
      index = open + next.length - 2
      break
    }
  }
  for (const event of events) if (event[1].type === 'highlightSequenceTemporary') event[1].type = 'data'
  return events
}

/** Exactly two `=`: a lone `=` is text, a third `=` cancels the run, `\==` is an escape. */
const tokenizeHighlight: Tokenizer = function (this: TokenizeContext, effects, ok, nok) {
  const { previous, events } = this
  let size = 0
  const more: State = (code) => {
    const before = classifyCharacter(previous)
    if (code === EQUALS) {
      if (size > 1) return nok(code)
      effects.consume(code)
      size++
      return more
    }
    if (size < 2) return nok(code)
    const token = effects.exit('highlightSequenceTemporary')
    const after = classifyCharacter(code)
    token._open = !after || (after === 2 && Boolean(before))
    token._close = !before || (before === 2 && Boolean(after))
    return ok(code)
  }
  return (code) => {
    if (previous === EQUALS && events[events.length - 1][1].type !== 'characterEscape') return nok(code)
    effects.enter('highlightSequenceTemporary')
    return more(code)
  }
}

const highlightSyntax = (): Extension => {
  const tokenizer = { name: 'highlight', tokenize: tokenizeHighlight, resolveAll: resolveAllHighlight }
  return { text: { [EQUALS]: tokenizer }, insideSpan: { null: [tokenizer] }, attentionMarkers: { null: [EQUALS] } }
}

const fromMarkdown: FromMarkdownExtension = {
  canContainEols: ['highlight'],
  enter: {
    highlight(token) {
      this.enter({ type: 'highlight', children: [] }, token)
    },
  },
  exit: {
    highlight(token) {
      this.exit(token)
    },
  },
}

const highlightHandle: Handle & { peek?: Handle } = (node: Highlight, _parent, state, info) =>
  node.color
    ? `<mark class="highlight-${node.color}">${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}</mark>`
    : `==${state.containerPhrasing(node, { ...info, before: '=', after: '=' })}==`
highlightHandle.peek = (node: Highlight) => (node.color ? '<' : '=')

/** The coloured half: inline HTML, read through the same walk underline uses. */
const MARK_OPEN = new RegExp(`^<mark class="highlight-(${HIGHLIGHT_COLORS.join('|')})">$`)
const HIGHLIGHT_PAIRS: HtmlPairSpec<{ color: HighlightColor }> = {
  open: (value) => {
    if (value === '<mark>') return { color: null }
    const match = MARK_OPEN.exec(value)
    return match === null ? null : { color: match[1] as HighlightColor }
  },
  close: '</mark>',
  make: ({ color }, children) => ({ type: 'highlight', color, children }),
}

/** Phrasing constructs that can never contain a highlight (mirrors mdast-util-gfm-strikethrough). */
const CONSTRUCTS_WITHOUT_HIGHLIGHT: ConstructName[] = ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe']

/**
 * Any `=` touching another `=` is written `\=`: a run of two could open or close a highlight on
 * reload, and a text `=` beside a highlight's own `==` would merge into its run and kill the mark.
 * A lone `=` (`a = b`, `x=5`) is never touched; URLs never (notInConstruct).
 */
const toMarkdown: ToMarkdownOptions = {
  unsafe: [
    { character: '=', after: '=', inConstruct: 'phrasing', notInConstruct: CONSTRUCTS_WITHOUT_HIGHLIGHT },
    { character: '=', before: '=', inConstruct: 'phrasing', notInConstruct: CONSTRUCTS_WITHOUT_HIGHLIGHT },
  ],
  handlers: { highlight: highlightHandle },
}

/** remark plugin, the remark-gfm shape: syntax + from + to, all through `this.data()`. */
export const highlightRemark = $remark('mdapp-highlight', () => function highlight() {
  const data = this.data()
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), highlightSyntax()]
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), fromMarkdown]
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), toMarkdown]
  return (tree) => wrapHtmlPairs(tree, HIGHLIGHT_PAIRS)
})

/** The element's `highlight-<known>` class, else null (a bare `<mark>` is yellow). */
const colorOf = (dom: HTMLElement): HighlightColor => HIGHLIGHT_COLORS.find((c) => dom.classList.contains(`highlight-${c}`)) ?? null

export const highlightSchema = $markSchema('highlight', () => ({
  inclusive: true,
  attrs: { color: { default: null } },
  parseDOM: [{ tag: 'mark', getAttrs: (dom) => ({ color: colorOf(dom as HTMLElement) }) }],
  toDOM: (mark) => ['mark', mark.attrs.color ? { class: `highlight-${mark.attrs.color}` } : {}, 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType, { color: (node.color as HighlightColor | undefined) ?? null })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight', undefined, { color: (mark.attrs.color ?? null) as HighlightColor })
    },
  },
}))

/** Register with `editor.use(highlight)`. */
export const highlight = [highlightRemark, highlightSchema].flat()
