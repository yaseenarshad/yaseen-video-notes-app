/**
 * notes-view: name corrections in the editor — `Palmer Luckey <!-- was: Palmer Lucky -->` (notes-format.md: a name
 * fixed from the model's own knowledge, marked with the captions' spelling right after it).
 *
 * In the editor it is a MARK on the name (`was_name`, attr `was`), not a separate node: typing next to the name never
 * splits it (the mark is not inclusive, so words typed after the name are plain), deleting the name deletes the marker
 * with it, and it renders as a dotted underline with the tooltip "Captions said: …". On disk it is the comment right
 * after the name: a remark transform turns `text "… Palmer Luckey " + html "<!-- was: Palmer Lucky -->"` into a
 * `wasName` node around the name (`nameBefore`: the capitalised words before it), and the stringify handler
 * writes `Palmer Luckey <!-- was: Palmer Lucky -->` back (one space before the comment, as written).
 */
import { $markSchema, $remark } from '@milkdown/kit/utils'
import type { Handle, Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { nameBefore } from '../notesFile'

interface Md { type: string; value?: string; was?: string; children?: Md[] }

const WAS_HTML = /^<!--\s*was:\s*([^>]*?)\s*-->$/

/** html comment nodes → `wasName` around the words before them (in place, every level). */
export function wrapWas(node: Md): void {
  const kids = node.children
  if (!kids) return
  for (const c of kids) wrapWas(c)
  for (let i = 0; i < kids.length; i++) {
    const h = kids[i]
    const m = h.type === 'html' && typeof h.value === 'string' ? WAS_HTML.exec(h.value) : null
    if (!m || i === 0) continue
    const was = m[1].trim()
    const prev = kids[i - 1]
    if (prev.type === 'text' && typeof prev.value === 'string') {
      const before = prev.value.replace(/\s+$/, '')
      const name = nameBefore(before, was)
      if (!name) continue
      const head = before.slice(0, before.length - name.length)
      const made: Md[] = [...(head ? [{ type: 'text', value: head }] : []), { type: 'wasName', was, children: [{ type: 'text', value: name }] }]
      kids.splice(i - 1, 2, ...made)
      i += made.length - 2
    } else {
      kids.splice(i - 1, 2, { type: 'wasName', was, children: [prev] })
      i -= 1
    }
  }
}

const wasHandle: Handle = (node, _parent, state, info) =>
  `${state.containerPhrasing(node as never, { ...info, after: ' ' })} <!-- was: ${(node as unknown as Md).was ?? ''} -->`
export const wasToMarkdown: ToMarkdownOptions = { handlers: { wasName: wasHandle } as unknown as ToMarkdownOptions['handlers'] }

export const wasRemark = $remark('nv-was-names', () => function was() {
  const data = this.data()
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), wasToMarkdown]
  return (tree) => wrapWas(tree as unknown as Md)
})

export const wasSchema = $markSchema('was_name', () => ({
  inclusive: false,
  attrs: { was: { default: '' } },
  parseDOM: [{ tag: 'span[data-was]', getAttrs: (dom) => ({ was: (dom as HTMLElement).dataset.was ?? '' }) }],
  toDOM: (mark) => ['span', { class: 'nv-was', 'data-was': mark.attrs.was, title: `Captions said: ${mark.attrs.was}` }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'wasName',
    runner: (state, node, markType) => {
      state.openMark(markType, { was: String((node as unknown as Md).was ?? '') })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'was_name',
    runner: (state, mark) => { state.withMark(mark, 'wasName', undefined, { was: mark.attrs.was }) },
  },
}))

/** Register with `editor.use(wasName)`. */
export const wasName = [wasRemark, wasSchema].flat()
