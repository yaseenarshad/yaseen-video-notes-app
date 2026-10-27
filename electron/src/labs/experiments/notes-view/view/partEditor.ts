/**
 * notes-view: the editor of one part — Milkdown Crepe set up like the docs app's note editor (yaseen-docs-app
 * client/src/editor/createCrepe.ts + crepe.ts @ 4608f7a8), holding the AI bullets, the slides AND Yasin's own words:
 *
 * - `CrepeBuilder` + only the features loaded here, in Crepe's own order: Cursor (`virtual: false`), ListItem,
 *   LinkTooltip, Placeholder, Toolbar. Not loaded: BlockEdit (slash menu / drag handle — so the `/mochi` `/note` menu
 *   below is the only slash menu), CodeMirror, Table, ImageBlock, Latex.
 * - The docs app's add-ons, vendored in ./docs: collapsible bullets + guide lines, the image node view, paste / drop of
 *   image bytes, the outliner keymap (Tab / ⇧Tab / Enter / Backspace), and its highlight mark (`==…==`).
 * - **Markers are node attributes of the list item** (`nvP` paragraph, `nvSlide`, `nvT` time, `nvO` original's index,
 *   `nvNotes` 💬 note ids), read from / written to the bullet's trailing `<!-- p:N … -->` comments. They ride on the
 *   bullet, not its text: Yasin can reword, merge (Backspace keeps the first bullet's marker) or split (Enter: both
 *   halves keep it) — copy / paste keeps them too (`data-nv-*` DOM attributes). A new EMPTY bullet that copied a marker
 *   another bullet still has (Enter at the end of a bullet) drops it: it is Yasin's own bullet.
 * - **Yasin's words:** whatever he types or pastes gets the highlight mark (an appendTransaction over the inserted
 *   ranges; moves — a Backspace join, a drag — keep their own marks; undo / redo and the app's own edits are skipped).
 *   Deleting AI words just deletes them.
 * - **Decorations, never DOM hacks:** the current bullet (follow-along) is a node decoration; the time chip (click =
 *   play), ✎ (edited: the bullet differs from the AI's original; hover shows it + "Restore original") and the 🃏 / 💬
 *   badges of notes made from the bullet are widgets.
 * - `/mochi`, `/note`: a tiny menu (filter as you type, ↑↓, Enter / Tab, Esc) that sends the bullet as a 💬 note.
 */
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import { editorViewCtx, editorViewOptionsCtx, parserCtx } from '@milkdown/kit/core'
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'
import { wrapInBulletListCommand } from '@milkdown/kit/preset/commonmark'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose, $remark, callCommand } from '@milkdown/kit/utils'
import { escapeBlockStart } from '../notesFile'
import { SLASH_COMMANDS } from '../noteTarget'
import { guideLines } from './docs/guideLines'
import { highlight, highlightSchema } from './docs/highlight'
import type { ImageOptions } from './docs/imageOptions'
import { createImageView } from './docs/imageView'
import { imageFile, insertPastedImage } from './docs/insertImage'
import { outlinerKeymap } from './docs/listCommands'
import { createOutlineFolding } from './docs/outlineFolding'

export interface Original { p: number; text: string }

export interface BulletInfo {
  /** The list item's position. */
  pos: number
  p: number | null
  slide: number | null
  t: number | null
  /** The bullet's own words (first block, plain text). */
  text: string
  /** Yasin's own bullet (no marker). */
  own: boolean
  /** The paragraph of the bullet, or of the nearest bullet above that has one. */
  anchorP: number | null
}

export interface PartEditorOptions {
  root: HTMLElement
  markdown: string
  orig: Original[]
  image: ImageOptions
  fmt: (t: number) => string
  foldKeys: () => ReadonlySet<string>
  onFoldKeys: (keys: readonly string[]) => void
  onChange: (markdown: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onSeek: (t: number) => void
  /** A 🃏 / 💬 badge was clicked. */
  onNoteBadge: (id: string) => void
  /** The badge's category (null: the note is not in the transcript any more). */
  noteCategory: (id: string) => 'mochi' | 'general' | null
  /** `/mochi` / `/note` picked (the command's text is already gone from the bullet). */
  onSlash: (category: 'mochi' | 'general', info: BulletInfo) => void
}

export interface PartEditor {
  crepe: CrepeBuilder
  view: () => EditorView
  markdown: () => string
  focus: () => void
  destroy: () => Promise<void>
  setReadonly: (ro: boolean) => void
  /** Bullets with a time (AI bullets, slides), document order. */
  timed: () => { t: number; pos: number }[]
  /** The follow-along bullet (null: none). */
  setCurrent: (pos: number | null) => void
  itemDom: (pos: number) => HTMLElement | null
  /** The bullet at a DOM node / point. */
  bulletAtDom: (node: Node) => BulletInfo | null
  bulletAtCoords: (x: number, y: number) => BulletInfo | null
  /** The selected text when the selection is inside one bullet's first block. */
  selectionIn: (pos: number) => string | null
  /** Replaces the bullet's text (the item holding `dom`) with the AI's original (no highlight). */
  restore: (dom: Node) => boolean
  /** The original behind an ✎ (null: none kept). */
  originalAt: (dom: Node) => string | null
  addNoteMarker: (pos: number, id: string) => void
  /** Re-renders the badges (a note's category changed / it was deleted). */
  refreshBadges: () => void
}

/** Edits the app makes itself (restore, slash removal, markers): never Yasin's words. */
export const NO_MARK = 'nv-no-yasin-mark'

// ---------- list item markers ----------

const MARK_RE = /<!--\s*(p|slide-title|slide|note):([\w.-]+)((?:\s+[a-z]+:[\w.]*)*)\s*-->/g
interface Md { type: string; value?: string; children?: Md[]; [k: string]: unknown }
/** nvSlide = a slide image bullet; nvSlideRef = slide-only text `(slide)`; nvSlideTitle = a heading from a slide title. */
interface Markers { nvP: number | null; nvSlide: number | null; nvSlideRef: number | null; nvSlideTitle: number | null; nvT: number | null; nvO: number | null; nvNotes: string | null }
const NO_MARKERS: Markers = { nvP: null, nvSlide: null, nvSlideRef: null, nvSlideTitle: null, nvT: null, nvO: null, nvNotes: null }

/** Reads the marker comments of an html value (null when it holds anything else). */
function readMarkers(value: string, into: Markers): boolean {
  if (value.replace(MARK_RE, '').trim()) return false
  for (const m of value.matchAll(MARK_RE)) {
    const fields = Object.fromEntries(m[3].trim().split(/\s+/).filter(Boolean).map((f) => f.split(':') as [string, string]))
    if (m[1] === 'p') into.nvP = Number(m[2])
    if (m[1] === 'slide') into.nvSlide = Number(m[2])
    if (m[1] === 'slide-title') into.nvSlideTitle = Number(m[2])
    if (m[1] === 'note') into.nvNotes = into.nvNotes ? `${into.nvNotes},${m[2]}` : m[2]
    if (fields.t !== undefined && Number.isFinite(Number(fields.t))) into.nvT = Number(fields.t)
    if (fields.o !== undefined && Number.isFinite(Number(fields.o))) into.nvO = Number(fields.o)
  }
  return true
}

/** Takes the trailing marker comments out of a listItem's first paragraph (mdast, in place). */
function takeMarkers(item: Md): Markers {
  const out: Markers = { ...NO_MARKERS }
  const first = item.children?.[0]
  if (!first) return out
  if (first.type === 'html' && typeof first.value === 'string' && readMarkers(first.value, out)) {
    item.children![0] = { type: 'paragraph', children: [] }   // `* <!-- p:41 -->` is an HTML block: an empty bullet
    return out
  }
  if (first.type !== 'paragraph' || !first.children) return out
  const kids = first.children
  const found: string[] = []
  while (kids.length) {
    const last = kids[kids.length - 1]
    if (last.type === 'html' && typeof last.value === 'string' && readMarkers(last.value, { ...NO_MARKERS })) { found.unshift(last.value); kids.pop(); continue }
    if (last.type === 'text' && typeof last.value === 'string' && !last.value.trim() && kids.length > 1) { kids.pop(); continue }
    break
  }
  for (const v of found) readMarkers(v, out)
  if (out.nvP !== null && out.nvSlide !== null) { out.nvSlideRef = out.nvSlide; out.nvSlide = null }   // text from a slide, not the slide
  const tail = kids[kids.length - 1]
  if (found.length && tail?.type === 'text' && typeof tail.value === 'string') tail.value = tail.value.replace(/[ \t]+$/, '')
  return out
}

const numAttr = (v: string | undefined): number | null => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

const listItemMarkers = extendListItemSchemaForTask.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    content: 'block+',   // as createCrepe does: image bullets and `* - nested` round-trip
    attrs: {
      ...base.attrs,
      nvP: { default: null }, nvSlide: { default: null }, nvSlideRef: { default: null }, nvSlideTitle: { default: null }, nvT: { default: null }, nvO: { default: null }, nvNotes: { default: null },
    },
    parseDOM: (base.parseDOM ?? []).map((rule) => ({
      ...rule,
      getAttrs: (dom: HTMLElement | string) => {
        const a = typeof rule.getAttrs === 'function' ? (rule.getAttrs as (d: unknown) => Record<string, unknown> | false | null)(dom) : {}
        if (a === false) return false
        const d = typeof dom === 'string' ? {} as DOMStringMap : dom.dataset
        return { ...(a ?? {}), nvP: numAttr(d.nvP), nvSlide: numAttr(d.nvSlide), nvSlideRef: numAttr(d.nvSlideRef), nvSlideTitle: numAttr(d.nvSlideTitle), nvT: numAttr(d.nvT), nvO: numAttr(d.nvO), nvNotes: d.nvNotes || null }
      },
    })),
    toDOM: (node) => {
      const spec = base.toDOM!(node) as unknown as [string, Record<string, unknown>, 0]
      const a = node.attrs
      return [spec[0], { ...spec[1], 'data-nv-p': a.nvP ?? undefined, 'data-nv-slide': a.nvSlide ?? undefined, 'data-nv-slide-ref': a.nvSlideRef ?? undefined, 'data-nv-slide-title': a.nvSlideTitle ?? undefined, 'data-nv-t': a.nvT ?? undefined, 'data-nv-o': a.nvO ?? undefined, 'data-nv-notes': a.nvNotes ?? undefined }, 0]
    },
    parseMarkdown: {
      match: ({ type }) => type === 'listItem',
      runner: (state, node, type) => {
        const markers = takeMarkers(node as unknown as Md)
        const label = node.label != null ? `${node.label}.` : '•'
        const listType = node.label != null ? 'ordered' : 'bullet'
        const spread = (node.spread as boolean | undefined) ?? true
        const checked = node.checked != null ? Boolean(node.checked) : null
        state.openNode(type, { label, listType, spread, checked, ...markers })
        state.next(node.children)
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'list_item',
      runner: (state, node) => {
        const a = node.attrs
        state.openNode('listItem', undefined, a.checked == null ? { spread: a.spread } : { label: a.label, listType: a.listType, spread: a.spread, checked: a.checked })
        const markers = [
          a.nvSlide != null ? `<!-- slide:${a.nvSlide} -->` : a.nvP != null ? `<!-- p:${a.nvP} -->` : '',
          a.nvSlideTitle != null ? `<!-- slide-title:${a.nvSlideTitle} -->` : '',
          a.nvSlideRef != null ? `<!-- slide:${a.nvSlideRef} -->` : '',
          ...(a.nvNotes ? String(a.nvNotes).split(',').map((id: string) => `<!-- note:${id} -->`) : []),
        ].filter(Boolean)
        node.content.forEach((child, _o, i) => {
          state.next(child)
          if (i !== 0 || !markers.length) return
          const li = (state as unknown as { top: () => { children?: Md[] } | undefined }).top()
          const para = li?.children?.[li.children.length - 1]
          if (!para || para.type !== 'paragraph') return
          para.children ??= []
          for (const m of markers) { if (para.children.length) para.children.push({ type: 'text', value: ' ' }); para.children.push({ type: 'html', value: m }) }
        })
        state.closeNode()
      },
    },
  }
})

/** Enter at the end of a bullet copies its markers into the new empty one: an empty bullet sharing a marker drops it. */
const dropCopiedMarkers = $prose(() => new Plugin({
  key: new PluginKey('nv-drop-copied-markers'),
  appendTransaction(trs, _old, state) {
    if (!trs.some((t) => t.docChanged)) return null
    const count = new Map<string, number>()
    const items: { node: ProseNode; pos: number; key: string }[] = []
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'list_item') return true
      const key = node.attrs.nvSlide != null ? `s${node.attrs.nvSlide}` : node.attrs.nvP != null ? `p${node.attrs.nvP}` : node.attrs.nvNotes ? `n${node.attrs.nvNotes}` : null
      if (key) { count.set(key, (count.get(key) ?? 0) + 1); items.push({ node, pos, key }) }
      return true
    })
    const tr = state.tr
    for (const it of items) {
      const first = it.node.firstChild
      if ((count.get(it.key) ?? 0) > 1 && first && first.isTextblock && !first.textContent.trim() && first.childCount === 0) {
        tr.setNodeMarkup(it.pos, undefined, { ...it.node.attrs, ...NO_MARKERS })
        count.set(it.key, count.get(it.key)! - 1)
      }
    }
    return tr.docChanged ? tr.setMeta(NO_MARK, true).setMeta('addToHistory', true) : null
  },
}))

/**
 * mdast gives an image without a title `title: null`, and the commonmark image schema validates `title` as a string:
 * the image was dropped on load (slides, pasted screenshots). A missing title becomes the schema's default ''.
 */
const imageTitles = $remark('nv-image-titles', () => () => (tree: unknown) => {
  const walk = (n: Md) => { if (n.type === 'image' && n.title == null) delete n.title; n.children?.forEach(walk) }
  walk(tree as Md)
})

// ---------- Yasin's words: the highlight mark on everything typed / pasted ----------

const yasinMarks = $prose((ctx) => new Plugin({
  key: new PluginKey('nv-yasin-marks'),
  appendTransaction(trs, _old, state) {
    let ranges: { from: number; to: number }[] = []
    for (const tr of trs) {
      ranges = ranges.map((r) => ({ from: tr.mapping.map(r.from, 1), to: tr.mapping.map(r.to, -1) })).filter((r) => r.to > r.from)
      if (!tr.docChanged || tr.getMeta(NO_MARK) || tr.getMeta('history$') || tr.getMeta('addToHistory') === false) continue
      const deleted: string[] = []
      const fresh: { from: number; to: number }[] = []
      tr.steps.forEach((step, i) => {
        const before = tr.docs[i]
        const rest = tr.mapping.slice(i + 1)
        step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
          if (oldEnd > oldStart) deleted.push(before.textBetween(oldStart, oldEnd, '\n', ''))
          if (newEnd > newStart) { const f = rest.map(newStart, 1), t = rest.map(newEnd, -1); if (t > f) fresh.push({ from: f, to: t }) }
        })
      })
      for (const r of fresh) {
        const text = tr.doc.textBetween(r.from, r.to, '\n', '')
        if (!text.trim() || deleted.includes(text)) continue   // structure only, or a move: words keep their own marks
        ranges.push(r)
      }
    }
    if (!ranges.length) return null
    const type = highlightSchema.type(ctx)
    const mark = type.create({ color: null })
    const out = state.tr
    for (const r of ranges) {
      state.doc.nodesBetween(r.from, r.to, (node, pos, parent) => {
        if (!node.isText) return true
        if (!parent?.type.allowsMarkType(type) || type.isInSet(node.marks)) return false
        out.addMark(Math.max(pos, r.from), Math.min(pos + node.nodeSize, r.to), mark)
        return false
      })
    }
    return out.docChanged ? out : null
  },
}))

/** Paste / drop of image bytes (the docs app's clipboardPaste.ts image branch, without its text paste modes). */
const imagePaste = (image: ImageOptions) =>
  $prose((ctx) => {
    ctx.update(editorViewOptionsCtx, (prev) => ({
      ...prev,
      handlePaste: (view, event, slice) => {
        if (!view.editable) return true
        const file = view.state.selection.$from.parent.type.spec.code ? null : imageFile(event.clipboardData)
        if (file !== null) { void insertPastedImage(image, view, file); return true }
        return prev.handlePaste?.(view, event, slice) ?? false
      },
      handleDrop: (view, event, slice, moved) => {
        const file = !moved && view.editable ? imageFile(event.dataTransfer) : null
        if (file === null) return prev.handleDrop?.(view, event, slice, moved) ?? false
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (at === null || view.state.doc.resolve(at.pos).parent.type.spec.code) return true
        view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at.pos))))
        void insertPastedImage(image, view, file)
        return true
      },
    }))
    return new Plugin({})
  })

// ---------- decorations: current bullet, time chips, ✎, note badges ----------

const decoKey = new PluginKey<{ cur: number | null; deco: DecorationSet }>('nv-decorations')

/** The list item containing `$pos`'s depth chain, innermost (or null). */
function itemAt(doc: ProseNode, pos: number): { node: ProseNode; pos: number } | null {
  const $p = doc.resolve(Math.max(0, Math.min(doc.content.size, pos)))
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'list_item') return { node: $p.node(d), pos: $p.before(d) }
  const after = $p.nodeAfter
  return after?.type.name === 'list_item' ? { node: after, pos: $p.pos } : null
}

export async function createPartEditor(o: PartEditorOptions): Promise<PartEditor> {
  const crepe = new CrepeBuilder({ root: o.root, defaultValue: o.markdown })
    .addFeature(cursor, { virtual: false })
    .addFeature(listItem)
    .addFeature(linkTooltip)
    .addFeature(placeholder, { text: 'Type your notes for this part…', mode: 'block' })
    .addFeature(toolbar)

  // the AI's originals as editor content (parsed once, on first use): ✎ = the bullet's first block differs
  const origFrag = new Map<number, Fragment>()
  const original = (k: number): Fragment | null => {
    if (k < 0 || k >= o.orig.length) return null
    if (!origFrag.has(k)) {
      const doc = crepe.editor.ctx.get(parserCtx)(escapeBlockStart(o.orig[k].text))   // `1) …` is text, as in the editor
      const first = doc.firstChild
      origFrag.set(k, first && first.type.name === 'paragraph' ? first.content : Fragment.from(doc.type.schema.text(o.orig[k].text)))
    }
    return origFrag.get(k)!
  }
  const edited = (node: ProseNode): boolean => {
    const a = node.attrs
    if (a.nvP == null) return false
    if (a.nvO == null) return true
    const f = original(a.nvO), first = node.firstChild
    return !f || !first || !first.content.eq(f)
  }

  const chip = (t: number) => () => {
    const s = document.createElement('span')
    s.className = 'nv-pm'
    s.dataset.t = String(t)
    s.textContent = o.fmt(t)
    s.title = `${o.fmt(t)} — click to play`
    s.setAttribute('contenteditable', 'false')
    s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
    s.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); o.onSeek(t) })
    return s
  }
  const pencil = (k: number | null) => () => {
    const s = document.createElement('span')
    s.className = 'nv-edited'
    s.textContent = '✎'
    s.title = 'You edited this note'
    if (k !== null) s.dataset.o = String(k)
    s.setAttribute('contenteditable', 'false')
    s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
    return s
  }
  const badge = (id: string) => () => {
    const cat = o.noteCategory(id)
    const s = document.createElement('span')
    s.className = `nv-nb${cat ? '' : ' nv-nb-gone'}`
    s.dataset.id = id
    s.textContent = cat === 'mochi' ? '🃏' : '💬'
    s.title = cat ? `Sent as a ${cat === 'mochi' ? '🃏 Mochi' : '💬'} note — click to play it` : 'Sent as a 💬 note (not in the transcript now: edited, deleted, or Labs did not save it)'
    s.setAttribute('contenteditable', 'false')
    s.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
    s.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); o.onNoteBadge(id) })
    return s
  }
  const slideIcon = (n: number) => () => {
    const s = document.createElement('span')
    s.className = 'nv-si'
    s.textContent = '🖼'
    s.title = `From slide ${n}'s title`
    s.setAttribute('contenteditable', 'false')
    return s
  }
  let badgeGen = 0
  const build = (doc: ProseNode, cur: number | null): DecorationSet => {
    const decos: Decoration[] = []
    doc.descendants((node, pos) => {
      if (node.type.name !== 'list_item') return true
      const a = node.attrs, first = node.firstChild
      if (first && first.isTextblock) {
        const end = pos + first.nodeSize   // the end of the first block's content
        if (a.nvSlideTitle != null) decos.push(Decoration.widget(pos + 2, slideIcon(a.nvSlideTitle), { side: -1, key: `s${a.nvSlideTitle}`, ignoreSelection: true, stopEvent: () => true }))
        if (edited(node)) decos.push(Decoration.widget(end, pencil(a.nvO), { side: 1, key: `e${a.nvO ?? 'x'}`, ignoreSelection: true, stopEvent: () => true }))
        if (a.nvNotes) for (const id of String(a.nvNotes).split(',')) decos.push(Decoration.widget(end, badge(id), { side: 2, key: `n${id}:${badgeGen}`, ignoreSelection: true, stopEvent: () => true }))
        if ((a.nvP != null || a.nvSlide != null) && a.nvT != null) decos.push(Decoration.widget(end, chip(a.nvT), { side: 3, key: `t${a.nvT}`, ignoreSelection: true, stopEvent: () => true }))
      }
      if (pos === cur) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'nv-cur-b' }))
      return true
    })
    return DecorationSet.create(doc, decos)
  }
  const decorations = $prose(() => new Plugin({
    key: decoKey,
    state: {
      init: (_c, state): { cur: number | null; deco: DecorationSet } => ({ cur: null, deco: build(state.doc, null) }),
      apply: (tr: Transaction, val, _old, state: EditorState) => {
        const meta = tr.getMeta(decoKey) as { cur?: number | null; refresh?: boolean } | undefined
        let cur = val.cur
        if (meta && 'cur' in meta) cur = meta.cur ?? null
        else if (tr.docChanged && cur !== null) {
          const m = tr.mapping.mapResult(cur)
          cur = m.deleted || state.doc.nodeAt(m.pos)?.type.name !== 'list_item' ? null : m.pos
        }
        if (!tr.docChanged && !meta) return val
        return { cur, deco: build(state.doc, cur) }
      },
    },
    props: { decorations: (state) => decoKey.getState(state)?.deco },
  }))

  // ---------- the slash menu: /mochi, /note ----------
  let menu: HTMLElement | null = null
  let menuState: { from: number; to: number; items: typeof SLASH_COMMANDS; index: number } | null = null
  let dismissedAt: number | null = null
  const hideMenu = () => { menu?.remove(); menu = null; menuState = null }
  const pick = (view: EditorView, k: number) => {
    const st = menuState
    if (!st) return
    const cmd = st.items[k]
    hideMenu()
    const tr = view.state.tr.delete(st.from, st.to).setMeta(NO_MARK, true)
    view.dispatch(tr)
    const info = infoAt(view.state.doc, tr.mapping.map(st.from))
    if (info) o.onSlash(cmd.category, info)
  }
  const renderMenu = (view: EditorView) => {
    if (!menuState) return
    const at = view.coordsAtPos(menuState.to)
    if (!menu) { menu = document.createElement('div'); menu.className = 'nv-slash'; document.body.append(menu) }
    menu.replaceChildren(...menuState.items.map((it, k) => {
      const b = document.createElement('div')
      b.className = `nv-slash-item${k === menuState!.index ? ' on' : ''}`
      b.textContent = it.label
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(view, k) })
      return b
    }))
    menu.style.left = `${Math.min(at.left, window.innerWidth - 280)}px`
    menu.style.top = `${at.bottom + 4}px`
  }
  const slash = $prose(() => new Plugin({
    key: new PluginKey('nv-slash'),
    view: () => ({
      update: (view) => {
        const { selection } = view.state
        const $f = selection.$from
        if (!selection.empty || !view.hasFocus() || !$f.parent.isTextblock) { hideMenu(); return }
        const before = $f.parent.textBetween(0, $f.parentOffset, '\n', '￼')
        const m = /(?:^|\s)\/([a-z]*)$/i.exec(before)
        const items = m ? SLASH_COMMANDS.filter((c) => c.key.startsWith(m[1].toLowerCase())) : []
        const from = m ? $f.pos - m[1].length - 1 : -1
        if (!m || !items.length || dismissedAt === from) { hideMenu(); if (!m) dismissedAt = null; return }
        const index = menuState && menuState.from === from ? Math.min(menuState.index, items.length - 1) : 0
        menuState = { from, to: $f.pos, items, index }
        renderMenu(view)
      },
      destroy: hideMenu,
    }),
  }))

  crepe.editor
    .use(imageTitles)
    .use(listItemMarkers)
    .use(highlight)
    .use(createOutlineFolding({ seedCollapsedKeys: o.foldKeys, onCollapsedKeysChange: o.onFoldKeys }))
    .use(guideLines)
    .use(outlinerKeymap)
    .use(createImageView(o.image))
    .use(imagePaste(o.image))
    .use(dropCopiedMarkers)
    .use(yasinMarks)
    .use(decorations)
    .use(slash)
  // Crepe adds an empty paragraph after a document that ends in a list: not an edit
  const norm = (md: string) => md.replace(/(\s*(<br\s*\/?>)?\s*)+$/, '')
  let last = norm(o.markdown)
  let ready = false
  crepe.on((l) => {
    l.markdownUpdated((_ctx, md) => { if (ready && norm(md) !== last) { last = norm(md); o.onChange(md) } })
    if (o.onFocus) l.focus(() => o.onFocus?.())
    l.blur(() => { hideMenu(); o.onBlur?.() })
  })
  await crepe.create()
  const view = () => crepe.editor.ctx.get(editorViewCtx)
  // the first serialization differs from the loaded text (t: / o: fields): that is not an edit
  last = norm(crepe.getMarkdown())
  ready = true
  if (!o.markdown.trim()) crepe.editor.action(callCommand(wrapInBulletListCommand.key))   // an empty part starts as a bullet list
  last = norm(crepe.getMarkdown())

  // the slash menu's keys come first (capture: before ProseMirror and the outliner keymap)
  view().dom.addEventListener('keydown', (e) => {
    if (!menuState) return
    const v = view()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { menuState.index = (menuState.index + (e.key === 'ArrowDown' ? 1 : -1) + menuState.items.length) % menuState.items.length; renderMenu(v) }
    else if (e.key === 'Enter' || e.key === 'Tab') pick(v, menuState.index)
    else if (e.key === 'Escape') { dismissedAt = menuState.from; hideMenu() }
    else return
    e.preventDefault(); e.stopPropagation()
  }, true)

  const infoAt = (doc: ProseNode, pos: number): BulletInfo | null => {
    const it = itemAt(doc, pos)
    if (!it) return null
    const a = it.node.attrs
    let anchorP: number | null = a.nvP ?? null
    if (anchorP === null) doc.descendants((n, p) => { if (p >= it.pos) return false; if (n.type.name === 'list_item' && n.attrs.nvP != null) anchorP = n.attrs.nvP; return true })
    return { pos: it.pos, p: a.nvP ?? null, slide: a.nvSlide ?? null, t: a.nvT ?? null, text: it.node.firstChild?.textContent ?? '', own: a.nvP == null && a.nvSlide == null, anchorP }
  }

  const timedCache: { doc: ProseNode | null; list: { t: number; pos: number }[] } = { doc: null, list: [] }
  const ed: PartEditor = {
    crepe,
    view,
    markdown: () => crepe.getMarkdown(),
    focus: () => { const v = view(); v.focus(); if (!o.markdown.trim()) v.dispatch(v.state.tr.setSelection(Selection.atStart(v.state.doc))) },
    destroy: async () => { hideMenu(); await crepe.destroy() },
    setReadonly: (ro) => { crepe.setReadonly(ro) },
    timed: () => {
      const doc = view().state.doc
      if (timedCache.doc === doc) return timedCache.list
      const out: { t: number; pos: number }[] = []
      timedCache.doc = doc
      timedCache.list = out
      doc.descendants((n, pos) => {
        if (n.type.name === 'list_item' && n.attrs.nvT != null && (n.attrs.nvP != null || n.attrs.nvSlide != null)) out.push({ t: n.attrs.nvT, pos })
        return true
      })
      return out
    },
    setCurrent: (pos) => {
      const v = view()
      if ((decoKey.getState(v.state)?.cur ?? null) === pos) return
      v.dispatch(v.state.tr.setMeta(decoKey, { cur: pos }).setMeta('addToHistory', false))
    },
    itemDom: (pos) => { const d = view().nodeDOM(pos); return d instanceof HTMLElement ? d : null },
    bulletAtDom: (node) => {
      const v = view()
      let pos: number
      try { pos = v.posAtDOM(node, 0) } catch { return null }
      return infoAt(v.state.doc, pos)
    },
    bulletAtCoords: (x, y) => {
      const v = view()
      const at = v.posAtCoords({ left: x, top: y })
      return at ? infoAt(v.state.doc, at.inside >= 0 ? at.inside + 1 : at.pos) : null
    },
    selectionIn: (pos) => {
      const v = view(), { from, to, empty } = v.state.selection
      if (empty) return null
      const it = itemAt(v.state.doc, from), it2 = itemAt(v.state.doc, to)
      if (!it || !it2 || it.pos !== pos || it2.pos !== pos) return null
      return v.state.doc.textBetween(from, to, ' ', ' ').trim() || null
    },
    originalAt: (dom) => {
      const k = Number((dom as HTMLElement).dataset?.o)
      return Number.isFinite(k) && o.orig[k] ? o.orig[k].text : null
    },
    restore: (dom) => {
      const v = view()
      const k = Number((dom as HTMLElement).dataset?.o)
      const f = Number.isFinite(k) ? original(k) : null
      if (!f) return false
      let pos: number
      try { pos = v.posAtDOM(dom, 0) } catch { return false }
      const it = itemAt(v.state.doc, pos)
      const first = it?.node.firstChild
      if (!it || !first) return false
      const from = it.pos + 2, to = it.pos + 1 + first.nodeSize - 1
      const tr = v.state.tr.replaceWith(from, to, f).setMeta(NO_MARK, true)
      tr.setSelection(TextSelection.create(tr.doc, Math.min(tr.doc.content.size, from + f.size)))
      v.dispatch(tr)
      return true
    },
    addNoteMarker: (pos, id) => {
      const v = view()
      const node = v.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'list_item') return
      const ids = node.attrs.nvNotes ? String(node.attrs.nvNotes).split(',') : []
      if (ids.includes(id)) return
      v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, nvNotes: [...ids, id].join(',') }).setMeta(NO_MARK, true))
    },
    refreshBadges: () => { badgeGen++; const v = view(); v.dispatch(v.state.tr.setMeta(decoKey, { cur: decoKey.getState(v.state)?.cur ?? null }).setMeta('addToHistory', false)) },
  }
  return ed
}
