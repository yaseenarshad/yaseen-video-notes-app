/**
 * notes-view: the Notes view (bundled for the player page, loaded lazily by player.js the first time Notes is shown;
 * served as /labs/x/notes-view/view.js + view.css). `window.__notesView.mount(LABS, host)` builds it inside the
 * transcript column and returns { show, hide, visible, timeAtView }.
 *
 * One editor per part (partEditor.ts) holds the AI bullets, the slides and Yasin's words; it is created when the part
 * comes near the screen. Until then the part is a static copy in the same Crepe list DOM (`.editor-instance .milkdown
 * … .milkdown-list-item-block > li.list-item > .label-wrapper + .children > .content-dom`), so the vendored bullets /
 * fold / guide line / image CSS draws both alike. The 💬 transcript notes of the part follow (read-only mirror).
 */
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/cursor.css'
import '@milkdown/crepe/theme/common/link-tooltip.css'
import '@milkdown/crepe/theme/common/list-item.css'
import '@milkdown/crepe/theme/common/placeholder.css'
import '@milkdown/crepe/theme/common/toolbar.css'
import frameLight from '@milkdown/crepe/theme/frame.css?inline'
import frameDark from '@milkdown/crepe/theme/frame-dark.css?inline'
import './docs/editor.css'
import './docs/bullets.css'
import './docs/outlineFolding.css'
import './docs/guideLines.css'
import './docs/imageView.css'
import './view.css'
import { parseTree, wasSpans, type TreeNode } from '../notesFile'
import { noteTarget, noteText } from '../noteTarget'
import { openImageModal } from './docs/imageModal'
import type { ImageOptions } from './docs/imageOptions'
import { foldAllOutline, unfoldAllOutline } from './docs/outlineFolding'
import { getOutlineFoldKey } from './docs/outlineFoldKeys'
import { createPartEditor, type BulletInfo, type Original, type PartEditor } from './partEditor'

// ---------- the LABS API (src/labs/page/api.js), as much as this view uses ----------
interface LabsNote { id: string; para: number; t: number; time: number | null; text: string; quote: string | null; category: string; resolved: boolean }
interface Labs {
  video: { time(): number; seek(t: number, o?: { play?: boolean; follow?: boolean }): void; onTick(fn: () => void, ms: number): () => void }
  transcript: {
    id: string; title: string; current(): { follow: boolean }; setFollow?(on: boolean): void
    paragraphs: { words: string[]; times: number[] }[]; at(t: number): { para: number; word: number }
  }
  notes(): LabsNote[]
  composeNote?(o: {
    host: HTMLElement; para: number; time: number; end?: number | null; quote?: string | null; words?: [number, number][]
    category: 'general' | 'mochi'; text?: string; onSaved?: (notes: LabsNote[]) => void; onClose?: () => void
  }): boolean
  ui: { toast(m: string, ms?: number): void; fmt(s: number): string }
  store(id: string): { get(key?: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
  log(...a: unknown[]): void
}

// ---------- the data (main.ts `data` route) ----------
interface DChecks { uncovered: { p: number; t: number }[]; missing: string[]; format: string[]; reworded: { text: string; share: number; p: number }[]; corrected?: { name: string; was: string }[]; contentParas: number }
interface DSection {
  t: number; end: number; title: string; md: string; orig: Original[]; sig: string; touched: boolean; aiCount: number; slideCount: number
  /** "Nothing lost" checks of the AI notes (null: no AI notes). */
  checks: DChecks | null
  /** The previous notes of this part (`<slug>.notes.v1.md`); null when there is no previous file. */
  v1: string | null
}
interface Job { state: 'idle' | 'running' | 'done' | 'failed'; current: number | null; done: number; total: number; error: string | null; loginNeeded: boolean; lines: string[]; pending: number[] }
interface Data { file: string; exists: boolean; sections: DSection[]; claude: boolean; job: Job; slides: number }

const BASE = '/labs/x/notes-view/'
const getJSON = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(BASE + path, { cache: 'no-store', ...init })
  const j = await r.json()
  if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { status: r.status, body: j })
  return j as T
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
const FOLD_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>'

// ---------- the static copy of a part (before its editor exists) ----------

const MARK_RE = /[ \t]*<!--\s*(p|slide-title|slide|note):([\w.-]+)((?:\s+[a-z]+:[\w.]*)*)\s*-->/g
interface SNode { text: string; p: number | null; slide: number | null; slideTitle: number | null; t: number | null; notes: string[]; yaseen: boolean; children: SNode[] }
function staticNode(n: TreeNode): SNode {
  const out: SNode = { text: '', p: null, slide: null, slideTitle: null, t: null, notes: [], yaseen: false, children: n.children.map(staticNode) }
  out.text = n.text.replace(MARK_RE, (_m, kind: string, v: string, fields: string) => {
    if (kind === 'p') out.p = Number(v)
    if (kind === 'slide') out.slide = Number(v)
    if (kind === 'slide-title') out.slideTitle = Number(v)
    if (kind === 'note') out.notes.push(v)
    const t = /\bt:([\d.]+)/.exec(fields)
    if (t) out.t = Number(t[1])
    return ''
  }).trim()
  if (out.p !== null) out.slide = null   // with a paragraph it is text from a slide, not the slide image
  out.text = out.text.replace(/^#yaseen(?=\s|$)[ \t]*/i, () => { out.yaseen = true; return '' })
  return out
}
const imageSrc = (src: string) => (/^[a-z][a-z0-9+.-]*:/i.test(src) ? src : BASE + 'file/' + src.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/'))
/** Plain text of a bullet's markdown (images → their alt): the fold key label, as the editor's itemLabelText reads it. */
const labelOf = (md: string): string =>
  md.replace(/!\[([^\]|]*)(?:\|\d+)?\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(?<!\\)==|`|\*\*|__/g, '').replace(/\\(.)/g, '$1').trim() || 'Untitled item'

/** Inline markdown of a bullet: name corrections (`Name <!-- was: … -->`), Yasin's `==…==`, code, links, images. */
function inline(md: string, into: HTMLElement): void {
  const ws = wasSpans(md)
  if (ws.length) {
    let last = 0
    for (const w of ws) {
      if (w.nameStart > last) inlineText(md.slice(last, w.nameStart), into)
      const span = el('span', 'nv-was')
      span.dataset.was = w.was
      span.title = `Captions said: ${w.was}`
      inlineText(w.name, span)
      into.append(span)
      last = w.end
    }
    if (last < md.length) inlineText(md.slice(last), into)
    return
  }
  inlineText(md, into)
}

function inlineText(md: string, into: HTMLElement): void {
  const re = /(?<![\\=])==(?![=\s])((?:\\.|[^=\\]|=(?!=))*?)(?<![\s\\=])==(?!=)|(`[^`]+`)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(md); m; m = re.exec(md)) {
    if (m.index > last) into.append(md.slice(last, m.index).replace(/\\(.)/g, '$1'))
    if (m[1] !== undefined) { const mk = el('mark'); inline(m[1], mk); into.append(mk) }
    else if (m[2]) into.append(el('code', '', m[2].slice(1, -1)))
    else if (m[4] !== undefined) into.append(imageView(imageSrc(m[4]), m[3]))
    else { const a = el('a', '', m[5]); a.href = m[6]; a.target = '_blank'; into.append(a) }
    last = m.index + m[0].length
  }
  if (last < md.length) into.append(md.slice(last).replace(/\\(.)/g, '$1'))
}

/** The docs app's image node view DOM (imageView.ts), read-only: image + corner fold button. */
function imageView(src: string, alt: string): HTMLElement {
  const wrap = el('span', 'image-view image-view--loading')
  wrap.setAttribute('contenteditable', 'false')
  const img = el('img')
  img.draggable = false
  img.decoding = 'async'
  img.alt = alt.replace(/\|\d+$/, '')
  const w = /\|(\d+)$/.exec(alt)
  if (w) img.style.setProperty('--image-width', `${w[1]}px`)
  img.addEventListener('load', () => { wrap.classList.remove('image-view--loading'); wrap.classList.add('image-view--ready') })
  img.addEventListener('error', () => { wrap.className = 'image-view image-view--broken'; wrap.replaceChildren(el('span', 'image-view__broken', `Broken image: ${src}`)) })
  img.src = src
  const fold = el('button', 'image-view__fold')
  fold.type = 'button'; fold.tabIndex = -1; fold.setAttribute('aria-label', 'Collapse image'); fold.innerHTML = FOLD_UP
  wrap.append(img, fold)
  return wrap
}

/** One bullet in Crepe's list DOM. `content` fills its first paragraph; children go in a nested list. */
function bullet(content: (p: HTMLParagraphElement) => void, cls = ''): { block: HTMLElement; li: HTMLLIElement; contentDom: HTMLElement; p: HTMLParagraphElement } {
  const block = el('div', `milkdown-list-item-block ${cls}`.trim())
  const li = el('li', 'list-item')
  const lw = el('div', 'label-wrapper')
  lw.setAttribute('contenteditable', 'false')
  lw.append(el('span', 'label bullet'))
  const children = el('div', 'children')
  const contentDom = el('div', 'content-dom')
  const p = el('p')
  content(p)
  contentDom.append(p)
  children.append(contentDom)
  li.append(lw, children)
  block.append(li)
  return { block, li, contentDom, p }
}

/** A fold chevron (outlineFolding.ts's widget, same class / aria) at the start of a bullet's content. */
function foldToggle(contentDom: HTMLElement, label: string, collapsed: boolean, onToggle: (collapsed: boolean) => void): HTMLButtonElement {
  const b = el('button', 'outline-toggle')
  b.type = 'button'
  b.tabIndex = -1
  b.innerHTML = CHEVRON
  const set = (c: boolean) => { b.setAttribute('aria-expanded', String(!c)); b.setAttribute('aria-label', `${c ? 'Expand' : 'Collapse'} ${label}`) }
  set(collapsed)
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const c = b.getAttribute('aria-expanded') === 'true'; set(c); onToggle(c) })
  contentDom.prepend(b)
  return b
}

interface TimedEl { t: number; el: HTMLElement }
interface SecView {
  d: DSection
  root: HTMLElement
  head: HTMLElement
  noAi: HTMLElement
  checksBox: HTMLElement
  v1Box: HTMLElement
  edBox: HTMLElement
  mirrorBox: HTMLElement
  saveEl: HTMLElement
  staticTimed: TimedEl[]
  editor: PartEditor | null
  mounting: Promise<PartEditor> | null
  pending: string | null
  timer: number | undefined
  saving: Promise<void> | null
}

interface Folds { s: number[]; b: string[]; e: Record<string, string[]> }

export function mount(L: Labs, host: HTMLElement) {
  const vid = L.transcript.id
  const store = L.store('notes-view')
  const pane = el('div', 'nv-pane')
  const inner = el('div', 'nv-inner editor-instance')
  pane.append(inner)
  host.append(pane)
  const bar = el('div', 'nv-bar')
  const list = el('div', 'nv-list')
  inner.append(bar, list)

  let data: Data | null = null
  let secs: SecView[] = []
  let visible = false
  let editing = 0
  let curSec: SecView | null = null
  let curEl: HTMLElement | null = null
  let curEd: SecView | null = null
  let lastFollow = true
  let folds: Folds = { s: [], b: [], e: {} }
  const ready = store.get(`folds:${vid}`).then((f) => { if (f && typeof f === 'object') folds = Object.assign({ s: [], b: [], e: {} }, f as Folds) }).catch(() => {})
  let foldTimer: number | undefined
  const saveFolds = () => { clearTimeout(foldTimer); foldTimer = window.setTimeout(() => void store.set(`folds:${vid}`, folds), 300) }

  // ---------- theme: Crepe's frame / frame-dark, following the player's light / dark ----------
  const themeStyle = el('style')
  themeStyle.dataset.labs = 'notes-view-theme'
  document.head.append(themeStyle)
  const applyTheme = () => {
    const dark = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#1c1c1f'
    const css = dark ? frameDark : frameLight
    if (themeStyle.textContent !== css) themeStyle.textContent = css
    pane.classList.toggle('nv-dark', dark)
    document.body.classList.toggle('nv-dark-body', dark)
  }
  applyTheme()
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

  // ---------- keys: typing in an editor never reaches the player's hotkeys ----------
  pane.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement
    if (!t.closest?.('.ProseMirror')) return
    if (e.key === 'Escape') { (t.closest('.ProseMirror') as HTMLElement).blur(); window.getSelection()?.removeAllRanges() }
    e.stopPropagation()
  })

  // ---------- user scroll turns Follow off (like the transcript) ----------
  const followOff = () => { if (L.transcript.current().follow) L.transcript.setFollow?.(false) }
  pane.addEventListener('wheel', followOff, { passive: true })
  pane.addEventListener('touchmove', followOff, { passive: true })

  // ---------- the page-wide lightbox (every image in the Notes view, in page order) ----------
  function openGallery(img: HTMLImageElement): void {
    const imgs = [...pane.querySelectorAll<HTMLImageElement>('.image-view img')]
    const index = Math.max(0, imgs.indexOf(img))
    openImageModal({
      images: imgs.map((i) => ({ src: i.currentSrc || i.src, alt: i.alt, caption: i.closest('[data-caption]')?.getAttribute('data-caption') ?? i.alt })),
      index,
    })
  }
  pane.addEventListener('dblclick', (e) => {
    const img = (e.target as HTMLElement).closest?.('.nv-static .image-view img') as HTMLImageElement | null
    if (img) { e.preventDefault(); openGallery(img) }
  })

  const imageOptions: ImageOptions = {
    root: '/', notePath: '/notes.md',
    onOpenImage: ({ el: img }) => { if (img) openGallery(img) },
    onNotice: (m) => L.ui.toast(m, 5000),
  }

  // ---------- render ----------
  function renderBar(): void {
    if (!data) return
    const withAi = data.sections.filter((s) => s.aiCount > 0).length
    const job = data.job
    bar.replaceChildren()
    const tag = el('span', 'nv-tag nv-tag-ai', '🤖 AI notes')
    tag.title = 'Notes written by Claude from the transcript, in your notes format (notes-format.md). Your own words are highlighted.'
    bar.append(tag, el('span', 'nv-muted', ` ${withAi} of ${data.sections.length} parts`))
    if (job.state === 'running') bar.append(el('span', 'nv-run', ` · writing ${job.done + 1} of ${job.total}…`))
    else if (withAi < data.sections.length) {
      const b = el('button', 'nv-btn', 'Write missing')
      b.title = 'Write AI notes (claude -p) for every part that has none and that you have not written in.'
      b.onclick = () => generate({ all: true })
      bar.append(b)
    }
    if (job.state === 'failed' && job.error) bar.append(el('div', 'nv-err', job.loginNeeded ? 'AI notes need `claude` login — run `claude` in a terminal and /login, then try again.' : `AI notes failed: ${job.error}`))
    if (data.sections.some((s) => s.v1 !== null)) {
      const cmp = el('button', `nv-btn${comparing ? ' nv-on' : ''}`, comparing ? '🕘 Showing previous notes · back to new' : '🕘 Compare with previous notes')
      cmp.title = 'Switch every part between the current notes and the previous version (<slug>.notes.v1.md)'
      cmp.onclick = () => setCompare(!comparing)
      bar.append(cmp)
    }
    const right = el('span', 'nv-right')
    const fa = el('button', 'nv-btn nv-plain', 'Fold all'); fa.onclick = () => foldAll(true)
    const ua = el('button', 'nv-btn nv-plain', 'Unfold all'); ua.onclick = () => foldAll(false)
    const status = el('span', 'nv-muted nv-global-save')
    status.id = 'nvGlobalSave'
    right.append(status, fa, ua)
    bar.append(right)
    const file = el('div', 'nv-file', data.exists ? data.file.replace(/^.*\/labs-cache\//, 'labs-cache/') : 'notes file: written on your first note')
    file.title = data.file
    bar.append(file)
  }

  const isPending = (t: number) => !!data?.job.pending?.includes(t)

  function renderNoAi(sv: SecView): void {
    sv.noAi.replaceChildren()
    const d = sv.d
    if (isPending(d.t)) { sv.noAi.append(el('span', 'nv-run', d.aiCount ? '🤖 rewriting the AI notes… (your notes stay)' : '🤖 writing AI notes…')); return }
    if (d.aiCount) return
    sv.noAi.append(el('span', 'nv-muted', '🤖 No AI notes for this part yet · '))
    const b = el('button', 'nv-btn', 'Write them')
    b.onclick = () => generate({ t: d.t })
    sv.noAi.append(b)
  }

  function renderCounts(sv: SecView): void {
    const counts = sv.head.querySelector('.nv-counts')
    if (counts) counts.textContent = [sv.d.aiCount ? `🤖 ${sv.d.aiCount}` : '', sv.d.slideCount ? `🖼 ${sv.d.slideCount}` : '', sv.d.touched ? '✎ yours' : ''].filter(Boolean).join(' · ')
  }

  /** The static copy of a part (same DOM as the editor's list); a click opens the editor there. */
  function renderStatic(sv: SecView): void {
    const { md, timed, empty } = buildStatic(sv.d.md, new Set(folds.e[String(sv.d.t)] ?? []))
    sv.staticTimed = timed
    if (empty) sv.edBox.replaceChildren(el('div', 'nv-ed-empty', 'Type your notes for this part…'))
    else sv.edBox.replaceChildren(md)
  }

  /** A part's markdown → the Crepe list DOM (read-only), with its timed bullets. */
  function buildStatic(source: string, keys: Set<string>): { md: HTMLElement; timed: TimedEl[]; empty: boolean } {
    const timed: TimedEl[] = []
    const md = el('div', 'milkdown nv-static')
    const pm = el('div', 'ProseMirror')
    const ul = el('ul')
    pm.append(ul); md.append(pm)
    const occ = new Map<string, number>()
    const walk = (n: SNode, into: HTMLElement) => {
      const isSlide = n.slide !== null
      let wrap: HTMLElement | null = null
      const b = bullet((p) => {
        if (n.yaseen) { const y = el('span', 'nv-yaseen', 'Yaseen'); y.title = 'You wrote or changed this bullet (#yaseen)'; p.append(y) }
        if (n.slideTitle !== null) { const ic = el('span', 'nv-si', '🖼'); ic.title = `From slide ${n.slideTitle}'s title`; p.append(ic) }
        inline(n.text, p)
        wrap = p.querySelector('.image-view')
        if (isSlide && wrap) wrap.dataset.caption = (wrap.querySelector('img')?.alt ?? '')
        if (n.notes.length) for (const id of n.notes) { const s = el('span', 'nv-nb', '💬'); s.dataset.id = id; p.append(s) }
        if (n.t !== null) { const c = el('span', 'nv-pm', L.ui.fmt(n.t)); c.dataset.t = String(n.t); p.append(c) }
      }, isSlide ? 'nv-slide' : n.p !== null ? 'nv-b' : 'nv-own')
      if (n.t !== null) { b.block.dataset.t = String(n.t); timed.push({ t: n.t, el: b.block }) }
      const foldable = n.children.length > 0 || !!wrap
      if (foldable) {
        const label = labelOf(n.text)
        const o = occ.get(label) ?? 0
        occ.set(label, o + 1)
        const collapsed = keys.has(getOutlineFoldKey(label, o))
        let sub: HTMLElement | null = null
        if (n.children.length) { sub = el('ul'); n.children.forEach((c) => walk(c, sub!)); b.contentDom.append(sub) }
        const set = (c: boolean) => {
          if (sub) { if (c) sub.setAttribute('data-outline-folded', 'true'); else sub.removeAttribute('data-outline-folded') }
          const w = wrap as HTMLElement | null
          if (w) { w.setAttribute('data-outline-foldable-image', 'true'); if (c) w.setAttribute('data-outline-folded-image', 'true'); else w.removeAttribute('data-outline-folded-image') }
        }
        set(collapsed)
        foldToggle(b.contentDom, label.slice(0, 40), collapsed, set)
      }
      into.append(b.block)
    }
    for (const n of parseTree(source.split('\n'))) walk(staticNode(n), ul)
    timed.sort((a, b) => a.t - b.t)
    return { md, timed, empty: !ul.children.length }
  }

  /** The ⚠ list of a part: "nothing lost" checks of its AI notes (never blocks anything). */
  function renderChecks(sv: SecView): void {
    sv.checksBox.replaceChildren()
    const c = sv.d.checks
    if (!c) return
    const fixed = c.corrected ?? []
    if (fixed.length) {
      // info, not a warning: names the notes corrected from general knowledge (`<!-- was: … -->`)
      const info = el('details', 'nv-checks nv-checks-info')
      info.append(el('summary', '', `ℹ ${fixed.length} corrected name${fixed.length > 1 ? 's' : ''}`))
      info.append(el('div', 'nv-ck-row', fixed.map((f) => `${f.name} ← captions: ${f.was}`).join(' · ')))
      sv.checksBox.append(info)
    }
    const n = c.uncovered.length + c.missing.length + c.format.length + c.reworded.length
    if (!n) return
    const det = el('details', 'nv-checks')
    const cov = c.contentParas ? Math.round(((c.contentParas - c.uncovered.length) / c.contentParas) * 100) : 100
    det.append(el('summary', '', `⚠ ${[c.uncovered.length ? `${c.uncovered.length} paragraph${c.uncovered.length > 1 ? 's' : ''} not in the notes (${cov}% covered)` : '', c.missing.length ? `${c.missing.length} number${c.missing.length > 1 ? 's' : ''} / name${c.missing.length > 1 ? 's' : ''} missing` : '', c.format.length ? `${c.format.length} format` : '', c.reworded.length ? `${c.reworded.length} may be reworded` : ''].filter(Boolean).join(' · ')}`))
    if (c.uncovered.length) {
      const row = el('div', 'nv-ck-row', 'Not covered: ')
      for (const u of c.uncovered) { const b = el('button', 'nv-tchip', L.ui.fmt(u.t)); b.title = `Paragraph ${u.p} — play it`; b.onclick = () => L.video.seek(u.t); row.append(b, ' ') }
      det.append(row)
    }
    if (c.missing.length) det.append(el('div', 'nv-ck-row', `Missing: ${c.missing.join(' · ')}`))
    for (const f of c.format) det.append(el('div', 'nv-ck-row', `Format: ${f}`))
    for (const r of c.reworded) det.append(el('div', 'nv-ck-row nv-ck-rw', `May be reworded (${Math.round(r.share * 100)}% of its words in P${r.p}): ${r.text.slice(0, 120)}`))
    sv.checksBox.prepend(det)   // the ⚠ line first, the ℹ corrected names after it
  }

  // ---------- "Compare with previous notes" (`<slug>.notes.v1.md`) ----------
  let comparing = false
  function setCompare(on: boolean): void {
    comparing = on
    pane.classList.toggle('nv-comparing', on)
    for (const s of secs) {
      if (on && !s.v1Box.childElementCount) {
        const label = el('div', 'nv-tag nv-tag-v1', '🕘 Previous notes (v1) — read-only')
        if (s.d.v1) s.v1Box.append(label, buildStatic(s.d.v1, new Set()).md)
        else s.v1Box.append(label, el('div', 'nv-muted', 'No notes for this part in the previous version.'))
      }
    }
    renderBar()
  }

  function setSave(sv: SecView, state: 'edited' | 'saving' | 'saved' | 'error', msg = ''): void {
    sv.saveEl.className = `nv-save nv-save-${state}`
    sv.saveEl.textContent = state === 'edited' ? '● edited' : state === 'saving' ? 'saving…' : state === 'saved' ? `saved ${new Date().toTimeString().slice(0, 5)}` : `not saved: ${msg}`
    const g = document.getElementById('nvGlobalSave')
    const dirty = secs.some((s) => s.pending !== null)
    if (g) g.textContent = dirty ? '● edited' : state === 'error' ? 'not saved' : 'all saved'
  }

  async function save(sv: SecView, keepalive = false): Promise<void> {
    clearTimeout(sv.timer)
    if (sv.saving) await sv.saving
    const md = sv.pending
    if (md === null) return
    setSave(sv, 'saving')
    const run = (async () => {
      try {
        const r = await getJSON<{ ok: boolean; sig: string; touched: boolean; aiCount: number }>(`part?t=${sv.d.t}&sig=${encodeURIComponent(sv.d.sig)}`, { method: 'POST', body: md, keepalive })
        if (sv.pending === md) sv.pending = null
        sv.d.sig = r.sig
        sv.d.touched = r.touched
        sv.d.aiCount = r.aiCount
        renderCounts(sv)
        if (data) data.exists = true
        setSave(sv, sv.pending === null ? 'saved' : 'edited')
      } catch (e) {
        const err = e as Error & { status?: number; body?: { kept?: string } }
        if (err.status === 409) {
          sv.pending = null
          L.ui.toast(`This part changed (AI notes were rewritten) — your version is kept in labs-cache as ${err.body?.kept ?? 'a conflict file'}; reloading the part`, 9000)
          await reloadPart(sv)
          setSave(sv, 'error', 'the part changed — reloaded')
        } else setSave(sv, 'error', err.message)
      }
    })()
    sv.saving = run
    await run
    sv.saving = null
  }

  async function mountEditor(sv: SecView, focus: boolean): Promise<PartEditor> {
    if (sv.editor) { if (focus) sv.editor.focus(); return sv.editor }
    if (!sv.mounting) {
      const box = el('div', 'nv-ed-live')
      box.style.display = 'none'
      sv.edBox.append(box)
      sv.mounting = createPartEditor({
        root: box,
        markdown: sv.d.md,
        orig: sv.d.orig,
        image: imageOptions,
        fmt: (t) => L.ui.fmt(t),
        foldKeys: () => new Set(folds.e[String(sv.d.t)] ?? []),
        onFoldKeys: (keys) => { folds.e[String(sv.d.t)] = [...keys]; saveFolds() },
        onChange: (md) => {
          sv.pending = md
          setSave(sv, 'edited')
          clearTimeout(sv.timer)
          sv.timer = window.setTimeout(() => void save(sv), 700)
        },
        onFocus: () => { editing++; pane.classList.add('nv-editing') },
        onBlur: () => { editing = Math.max(0, editing - 1); if (!editing) pane.classList.remove('nv-editing'); void save(sv) },
        onSeek: (t) => L.video.seek(t),
        onNoteBadge: (id) => seekNote(id),
        noteCategory: (id) => { const n = L.notes().find((x) => x.id === id); return n ? (n.category === 'mochi' ? 'mochi' : 'general') : null },
        onSlash: (category, info) => openNote(sv, info, null, category, noteText(info.text)),
      }).then((ed) => {
        sv.edBox.querySelectorAll(':scope > :not(.nv-ed-live)').forEach((n) => n.remove())
        box.style.display = ''
        sv.editor = ed
        if (isPending(sv.d.t)) ed.setReadonly(true)
        if (curSec === sv) curEl = null   // the static copy is gone: the next tick marks the bullet in the editor
        return ed
      })
    }
    const ed = await sv.mounting
    if (focus) ed.focus()
    return ed
  }

  /** New data for one part (after AI notes landed, a conflict): the editor is rebuilt from the file. */
  async function reloadPart(sv: SecView, next?: DSection): Promise<void> {
    if (!next) {
      const all = await getJSON<Data>('data')
      data = all
      next = all.sections.find((s) => s.t === sv.d.t)
      if (!next) return
    }
    const had = !!sv.editor || !!sv.mounting
    const ed = sv.editor ?? (sv.mounting ? await sv.mounting.catch(() => null) : null)
    sv.editor = null; sv.mounting = null
    if (curEd === sv) curEd = null
    if (ed) await ed.destroy()
    sv.d = next
    sv.pending = null
    sv.v1Box.replaceChildren()
    renderStatic(sv)
    renderNoAi(sv)
    renderChecks(sv)
    if (comparing) setCompare(true)
    renderCounts(sv)
    curEl = null
    if (had) void mountEditor(sv, false)
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const sv = secs.find((s) => s.edBox === e.target)
      if (sv) void mountEditor(sv, false)
    }
  }, { root: pane, rootMargin: '600px 0px' })

  function renderSection(d: DSection): SecView {
    const root = el('section', 'nv-sec')
    root.dataset.t = String(d.t)
    const head = el('div', 'nv-sh')
    head.dataset.t = String(d.t)
    const fold = el('button', 'nv-sfold')
    fold.innerHTML = CHEVRON
    fold.title = 'Fold this part'
    const time = el('span', 'nv-st', L.ui.fmt(d.t))
    const title = el('span', 'nv-title', d.title)
    const counts = el('span', 'nv-counts')
    const saveEl = el('span', 'nv-save')
    const regen = el('button', 'nv-regen', '⟳ 🤖')
    regen.title = 'Write the AI notes of this part again (what you wrote or edited stays)'
    head.append(fold, time, title, counts, saveEl, regen)
    const body = el('div', 'nv-body')
    const noAi = el('div', 'nv-noai')
    const checksBox = el('div', 'nv-checks-box')
    const v1Box = el('div', 'nv-v1')
    const edBox = el('div', 'nv-ed milkdown-host')
    const mirrorBox = el('div', 'nv-mirror')
    body.append(noAi, checksBox, v1Box, edBox, mirrorBox)
    root.append(head, body)
    const sv: SecView = { d, root, head, noAi, checksBox, v1Box, edBox, mirrorBox, saveEl, staticTimed: [], editor: null, mounting: null, pending: null, timer: undefined, saving: null }
    const setFold = (c: boolean) => {
      root.classList.toggle('nv-folded', c)
      fold.setAttribute('aria-expanded', String(!c))
      folds.s = folds.s.filter((x) => x !== d.t); if (c) folds.s.push(d.t)
    }
    setFold(folds.s.includes(d.t))
    fold.onclick = (e) => { e.stopPropagation(); setFold(!root.classList.contains('nv-folded')); saveFolds() }
    head.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) return; L.video.seek(sv.d.t) })
    regen.onclick = (e) => { e.stopPropagation(); void regenerate(sv) }
    edBox.addEventListener('mousedown', (e) => {
      if (sv.editor || e.button !== 0 || (e.target as HTMLElement).closest('.outline-toggle, .nv-pm, .nv-nb, .image-view')) return
      e.preventDefault()
      void mountEditor(sv, true)
    })
    edBox.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest('.nv-static .nv-pm') as HTMLElement | null
      if (c) { e.stopPropagation(); L.video.seek(Number(c.dataset.t)) }
      const nb = (e.target as HTMLElement).closest('.nv-static .nv-nb') as HTMLElement | null
      if (nb) { e.stopPropagation(); seekNote(nb.dataset.id ?? '') }
    })
    renderStatic(sv)
    renderNoAi(sv)
    renderChecks(sv)
    renderCounts(sv)
    renderMirror(sv)
    return sv
  }

  function renderMirror(sv: SecView): void {
    const notes = L.notes().filter((n) => n.t >= sv.d.t && n.t < sv.d.end)
    sv.mirrorBox.replaceChildren()
    if (!notes.length) return
    const tag = el('div', 'nv-tag nv-tag-mirror', '💬 Your transcript notes')
    tag.title = 'Your 💬 notes in the transcript (read-only here — edit them in the Transcript)'
    const md = el('div', 'milkdown nv-static nv-mirror-list')
    const pm = el('div', 'ProseMirror')
    const ul = el('ul')
    for (const n of notes) {
      const b = bullet((p) => {
        p.append(el('span', 'nv-mt', L.ui.fmt(n.t)), ' ')
        if (n.category === 'mochi') p.append(el('span', 'nv-mcat', '🃏'), ' ')
        p.append(n.text)
        if (n.quote) p.append(' ', el('span', 'nv-mq', `“${n.quote}”`))
      }, `nv-mirror-b${n.resolved ? ' nv-resolved' : ''}`)
      b.p.title = 'Click to play'
      b.p.onclick = () => L.video.seek(n.t)
      ul.append(b.block)
    }
    pm.append(ul); md.append(pm)
    sv.mirrorBox.append(tag, md)
  }

  let notesSig = ''
  function refreshMirrors(force = false): void {
    const sig = L.notes().map((n) => `${n.id}:${n.category}:${n.resolved}`).join('|')
    if (!force && sig === notesSig) return
    notesSig = sig
    for (const s of secs) { renderMirror(s); s.editor?.refreshBadges() }
  }

  function seekNote(id: string): void {
    const n = L.notes().find((x) => x.id === id)
    if (n) L.video.seek(n.time ?? n.t)
    else L.ui.toast('That note is not in the transcript now (edited, deleted, or not saved in Labs)', 4000)
  }

  function render(): void {
    if (!data) return
    renderBar()
    for (const s of secs) io.unobserve(s.edBox)
    list.replaceChildren()
    secs = data.sections.map(renderSection)
    for (const s of secs) { list.append(s.root); io.observe(s.edBox) }
    curSec = null; curEl = null; curEd = null
  }

  /** New data from main (polling while AI notes are written): parts that changed underneath are reloaded. */
  function refresh(next: Data): void {
    data = next
    renderBar()
    for (const sv of secs) {
      const d = next.sections.find((s) => s.t === sv.d.t)
      if (!d) continue
      sv.editor?.setReadonly(isPending(d.t))
      if (d.sig !== sv.d.sig && sv.pending === null && !sv.saving && !isPending(d.t)) void reloadPart(sv, d)
      else renderNoAi(sv)
    }
  }

  async function load(): Promise<void> {
    await ready
    data = await getJSON<Data>('data')
    render()
    if (data.job.state === 'running') poll()
  }

  // ---------- AI notes ----------
  let polling: number | undefined
  function poll(): void {
    clearInterval(polling)
    polling = window.setInterval(async () => {
      try {
        const next = await getJSON<Data>('data')
        refresh(next)
        if (next.job.state !== 'running') {
          clearInterval(polling)
          if (next.job.state === 'failed') L.ui.toast(next.job.loginNeeded ? 'AI notes need `claude` login — run `claude` in a terminal and /login' : `AI notes failed: ${next.job.error}`, 7000)
          else if (next.job.state === 'done') L.ui.toast('🤖 AI notes written', 2500)
        }
      } catch { /* try again next time */ }
    }, 1500)
  }

  /** A small in-page confirm (two buttons). */
  function ask(text: string, yes: string): Promise<boolean> {
    return new Promise((resolve) => {
      const back = el('div', 'nv-confirm')
      const box = el('div', 'nv-confirm-box')
      const p = el('p', '', text)
      const b1 = el('button', 'nv-btn', 'Cancel'), b2 = el('button', 'nv-btn nv-btn-primary', yes)
      const done = (v: boolean) => { back.remove(); resolve(v) }
      b1.onclick = () => done(false); b2.onclick = () => done(true)
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(false) })
      back.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true) })
      const row = el('div', 'nv-confirm-row'); row.append(b1, b2)
      box.append(p, row); back.append(box); host.append(back)   // over the notes column
      b2.focus()
    })
  }

  async function regenerate(sv: SecView): Promise<void> {
    if (sv.pending !== null) await save(sv)
    if (sv.d.touched && !(await ask('This part has your notes. Rewrite the AI notes and keep yours attached?', 'Rewrite AI notes'))) return
    sv.editor?.setReadonly(true)
    await generate({ t: sv.d.t })
  }

  async function generate(o: { t?: number; all?: boolean }): Promise<void> {
    const q = o.all ? 'all=1' : `t=${o.t}`
    try {
      const job = await getJSON<Job>(`generate?${q}`, { method: 'POST' })
      if (data) { data.job = job; renderBar(); secs.forEach((s) => { s.editor?.setReadonly(isPending(s.d.t)); renderNoAi(s) }) }
      poll()
    } catch (e) {
      secs.forEach((s) => s.editor?.setReadonly(false))
      L.ui.toast(`AI notes: ${e instanceof Error ? e.message : e}`, 6000)
    }
  }

  function foldAll(c: boolean): void {
    for (const s of secs) {
      if (s.editor) { const v = s.editor.view(); (c ? foldAllOutline : unfoldAllOutline)(v.state, v.dispatch) }
      else s.edBox.querySelectorAll<HTMLButtonElement>('.nv-static .outline-toggle').forEach((b) => { if ((b.getAttribute('aria-expanded') === 'true') === c) b.click() })
    }
  }

  // ---------- 💬 notes from the Notes view: right-click a bullet, or /mochi /note ----------
  const secOf = (n: Node): SecView | undefined => secs.find((s) => s.edBox.contains(n))

  /** Opens the transcript's own composer under the bullet, for the bullet's paragraph (a selection → a quote). */
  function openNote(sv: SecView, info: BulletInfo, selection: string | null, category: 'general' | 'mochi', text = ''): void {
    if (!L.composeNote) { L.ui.toast('This player cannot add notes here', 4000); return }
    const paras = L.transcript.paragraphs
    let target
    if (info.slide !== null && info.t !== null) target = { para: L.transcript.at(info.t).para, time: info.t, end: null, quote: null, words: [] as [number, number][] }
    else {
      const p = info.p ?? info.anchorP ?? L.transcript.at(sv.d.t).para
      target = noteTarget(paras, p, info.p !== null ? selection : null)
    }
    const hostEl = el('div', 'nv-compose')
    const item = sv.editor?.itemDom(info.pos)
    const ir = inner.getBoundingClientRect()
    const r = item?.querySelector('p')?.getBoundingClientRect() ?? item?.getBoundingClientRect()
    hostEl.style.top = `${(r ? r.bottom : ir.top) - ir.top + 4}px`
    inner.append(hostEl)
    const before = new Set(L.notes().map((n) => n.id))
    const pos = info.pos
    const ok = L.composeNote({
      host: hostEl, para: target.para, time: target.time, end: target.end, quote: target.quote, words: target.words, category, text,
      onSaved: (notes) => {
        const made = notes.find((n) => !before.has(n.id) && n.para === target.para)
        if (made && sv.editor) sv.editor.addNoteMarker(pos, made.id)
        refreshMirrors(true)
      },
      onClose: () => hostEl.remove(),
    })
    if (!ok) hostEl.remove()
  }

  const menu = el('div', 'nv-menu')
  let menuFor: { sv: SecView; info: BulletInfo; selection: string | null } | null = null
  const closeMenu = () => { menu.remove(); menuFor = null }
  document.addEventListener('mousedown', (e) => { if (!menu.contains(e.target as Node)) closeMenu() }, true)
  pane.addEventListener('scroll', closeMenu, { passive: true })
  // the selection as it was BEFORE the right-click (macOS selects the word under the pointer on a right-click)
  let preSel: { pos: number; text: string } | null = null
  pane.addEventListener('mousedown', (e) => {
    if (e.button !== 2 && !e.ctrlKey) return
    const sv = secOf(e.target as Node)
    const info = sv?.editor?.bulletAtCoords(e.clientX, e.clientY)
    const text = info && sv?.editor ? sv.editor.selectionIn(info.pos) : null
    preSel = info && text ? { pos: info.pos, text } : null
  }, true)
  pane.addEventListener('contextmenu', async (e) => {
    const target = e.target as HTMLElement
    if (!target.closest('.nv-ed') || target.closest('.nv-compose')) return
    const sv = secOf(target)
    if (!sv) return
    e.preventDefault()
    const { clientX: x, clientY: y } = e
    const ed = sv.editor ?? await mountEditor(sv, false)
    const info = ed.bulletAtCoords(x, y)
    if (!info) return
    const selection = preSel && preSel.pos === info.pos ? preSel.text : null
    menuFor = { sv, info, selection }
    const items: [string, () => void][] = [
      ['💬 Add note…', () => openNote(sv, info, selection, 'general')],
      ['🃏 Add Mochi note…', () => openNote(sv, info, selection, 'mochi')],
    ]
    if (info.own) items.push(['🃏 Make Mochi note', () => openNote(sv, info, null, 'mochi', noteText(info.text))])
    menu.replaceChildren(...items.map(([label, fn]) => {
      const b = el('button', '', label)
      b.onclick = () => { closeMenu(); fn() }
      return b
    }))
    const hint = el('div', 'nv-menu-hint', selection ? `on “${selection.length > 40 ? selection.slice(0, 38) + '…' : selection}”` : info.p !== null ? `under paragraph ${info.p}` : info.slide !== null ? 'at this slide' : info.anchorP !== null ? `your bullet · under paragraph ${info.anchorP}` : 'your bullet')
    menu.prepend(hint)
    document.body.append(menu)
    const w = menu.offsetWidth, h = menu.offsetHeight
    menu.style.left = `${Math.min(x, window.innerWidth - w - 6)}px`
    menu.style.top = `${Math.min(y, window.innerHeight - h - 6)}px`
  })

  // ---------- ✎: the AI's original on hover, "Restore original" ----------
  const pop = el('div', 'nv-orig-pop')
  let popFor: HTMLElement | null = null
  let popTimer: number | undefined
  const hidePop = () => { pop.remove(); popFor = null }
  pane.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest?.('.nv-edited') as HTMLElement | null
    if (t) {
      clearTimeout(popTimer)
      if (popFor === t) return
      const sv = secOf(t)
      if (!sv?.editor) return
      popFor = t
      const original = sv.editor.originalAt(t)
      pop.replaceChildren(el('div', 'nv-orig-h', 'You edited this note'))
      if (original) {
        const body = el('div', 'nv-orig-text'); inline(original, body)
        const b = el('button', 'nv-btn', 'Restore original')
        b.onclick = () => { if (sv.editor?.restore(t)) L.ui.toast('AI text restored', 2000); hidePop() }
        pop.append(el('div', 'nv-orig-l', 'The AI wrote:'), body, b)
      } else pop.append(el('div', 'nv-orig-l', 'No AI original kept for this bullet (split from or added to an AI note).'))
      const ir = inner.getBoundingClientRect(), r = t.getBoundingClientRect()
      pop.style.top = `${r.bottom - ir.top + 4}px`
      pop.style.left = `${Math.max(0, Math.min(r.left - ir.left - 20, ir.width - 360))}px`
      inner.append(pop)
      return
    }
    if (popFor && !(e.target as HTMLElement).closest?.('.nv-orig-pop')) { clearTimeout(popTimer); popTimer = window.setTimeout(hidePop, 350) }
  })
  pop.addEventListener('mouseenter', () => clearTimeout(popTimer))

  // ---------- follow-along ----------
  const visibleEl = (e: HTMLElement, sv: SecView): HTMLElement => {
    if (sv.root.classList.contains('nv-folded')) return sv.head
    let x: HTMLElement | null = e
    while (x && x.offsetParent === null) x = x.parentElement?.closest('.milkdown-list-item-block') ?? null
    return x ?? sv.head
  }
  function keepInView(target: HTMLElement, force: boolean): void {
    const r = target.getBoundingClientRect(), s = pane.getBoundingClientRect(), y = r.top - s.top
    if (!force && !(y < s.height * 0.2 || y > s.height * 0.6)) return
    const top = Math.max(0, pane.scrollTop + y - s.height * 0.35)
    pane.scrollTo({ top, behavior: force ? 'instant' : 'smooth' })
  }
  function locate(t: number): { sv: SecView | null; target: HTMLElement | null; pos: number | null } {
    let sv: SecView | null = null
    for (const s of secs) if (s.d.t <= t + 0.05) sv = s
    sv = sv ?? secs[0] ?? null
    if (!sv) return { sv: null, target: null, pos: null }
    if (sv.editor) {
      let b: { t: number; pos: number } | null = null
      for (const x of sv.editor.timed()) if (x.t <= t + 0.05 && (!b || x.t >= b.t)) b = x
      return { sv, target: b ? sv.editor.itemDom(b.pos) : null, pos: b ? b.pos : null }
    }
    let b: TimedEl | null = null
    for (const x of sv.staticTimed) if (x.t <= t + 0.05) b = x
    return { sv, target: b ? b.el : null, pos: null }
  }
  function tick(force = false): void {
    if (!visible || !secs.length) return
    const t = L.video.time()
    const { sv, target, pos } = locate(t)
    if (sv !== curSec) { curSec?.root.classList.remove('nv-cur'); sv?.root.classList.add('nv-cur'); curSec = sv }
    if (sv?.editor) {
      if (curEd && curEd !== sv) curEd.editor?.setCurrent(null)
      sv.editor.setCurrent(pos)
      curEd = sv
      if (curEl) { curEl.classList.remove('nv-cur-b'); curEl = null }
    } else {
      if (curEd) { curEd.editor?.setCurrent(null); curEd = null }
      if (target !== curEl) { curEl?.classList.remove('nv-cur-b'); target?.classList.add('nv-cur-b'); curEl = target }
    }
    const follow = L.transcript.current().follow
    const turnedOn = follow && !lastFollow
    lastFollow = follow
    if (follow && sv && (force || turnedOn || !editing)) keepInView(visibleEl(target ?? sv.head, sv), force || turnedOn)
  }
  L.video.onTick(() => tick(false), 200)
  window.setInterval(() => { if (visible && secs.length) refreshMirrors() }, 1500)

  /** The time at the reading line (35 % down) of the Notes view — where a switch to the transcript lands. */
  function timeAtView(): number | null {
    const s = pane.getBoundingClientRect(), line = s.top + s.height * 0.35
    let best: number | null = null
    for (const e of pane.querySelectorAll<HTMLElement>('.nv-sh[data-t], .nv-static .milkdown-list-item-block[data-t], .nv-ed-live .nv-pm[data-t]')) {
      if (e.offsetParent === null) continue
      const top = (e.classList.contains('nv-pm') ? e.closest('li') ?? e : e).getBoundingClientRect().top
      if (top <= line) best = Number(e.dataset.t)
      else break
    }
    return best
  }

  // flush unsaved typing when the page goes away (⌘R, close)
  window.addEventListener('pagehide', () => { for (const s of secs) if (s.pending !== null) void save(s, true) })

  let loaded: Promise<void> | null = null
  // view buttons are never Tab stops (Tab = indent in the editors; a focused button would take Space / Enter)
  new MutationObserver(() => pane.querySelectorAll<HTMLButtonElement>('button:not([tabindex])').forEach((b) => { if (!b.closest('.nv-confirm')) b.tabIndex = -1 })).observe(pane, { childList: true, subtree: true })

  const api = {
    /** Shows the Notes view landing on `t` (null: the current time; Follow decides like the transcript). */
    async show(t: number | null): Promise<void> {
      pane.classList.add('nv-show')
      visible = true
      loaded = loaded ?? load().catch((e) => { list.replaceChildren(el('div', 'nv-err', `Could not load the notes: ${e instanceof Error ? e.message : e}`)) })
      await loaded
      refreshMirrors(true)
      if (t === null) tick(true)
      else {
        tick(false)
        const { sv, target } = locate(t)
        if (sv) keepInView(visibleEl(target ?? sv.head, sv), true)
      }
    },
    hide(): number | null {
      const t = timeAtView()
      pane.classList.remove('nv-show')
      visible = false
      for (const s of secs) if (s.pending !== null) void save(s)
      return t
    },
    visible: () => visible,
    timeAtView,
    /** For tests (CDP): the parts' editors. */
    editors: () => secs.map((s) => ({ t: s.d.t, editor: s.editor, mount: () => mountEditor(s, false), pending: s.pending, sig: s.d.sig, touched: s.d.touched })),
  }
  ;(window as unknown as { __nvView?: typeof api }).__nvView = api   // for tests (CDP)
  return api
}

declare global { interface Window { __notesView?: { mount: typeof mount } } }
window.__notesView = { mount }
