/**
 * notes-view: the Notes view (bundled for the player page, loaded lazily by player.js the first time Notes is shown;
 * served as /labs/x/notes-view/view.js + view.css). `window.__notesView.mount(LABS, host)` builds it inside the
 * transcript column and returns { show, hide, visible, timeAtView }.
 *
 * The page looks like a docs-app page: every list is the Crepe list DOM (`.milkdown-list-item-block > li.list-item >
 * .label-wrapper + .children > .content-dom`) under `.editor-instance .milkdown`, so the vendored bullets / fold / guide
 * line / image CSS styles the read-only AI notes and slides exactly like the 🧑 Yasin editors (real Crepe).
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
import { openImageModal } from './docs/imageModal'
import type { ImageOptions } from './docs/imageOptions'
import type { YasinEditor } from './yasinEditor'
import { createYasinEditor } from './yasinEditor'

// ---------- the LABS API (src/labs/page/api.js), as much as this view uses ----------
interface LabsNote { para: number; t: number; time: number | null; text: string; quote: string | null; category: string; resolved: boolean }
interface Labs {
  video: { time(): number; seek(t: number, o?: { play?: boolean; follow?: boolean }): void; onTick(fn: () => void, ms: number): () => void }
  transcript: { id: string; title: string; current(): { follow: boolean }; setFollow?(on: boolean): void }
  notes(): LabsNote[]
  ui: { toast(m: string, ms?: number): void; fmt(s: number): string }
  store(id: string): { get(key?: string): Promise<unknown>; set(key: string, value: unknown): Promise<unknown> }
  log(...a: unknown[]): void
}

// ---------- the data (main.ts `data` route) ----------
interface DNode { text: string; p: number; t: number; children: DNode[] }
type DItem = { kind: 'ai'; node: DNode } | { kind: 'slide'; n: number; alt: string; src: string; t: number | null } | { kind: 'other'; lines: string[] }
interface DSection { t: number; end: number; title: string; aiCount: number; items: DItem[]; yasin: string }
interface Job { state: 'idle' | 'running' | 'done' | 'failed'; current: number | null; done: number; total: number; error: string | null; loginNeeded: boolean; lines: string[] }
interface Data { file: string; exists: boolean; sections: DSection[]; claude: boolean; job: Job; slides: number }

const BASE = '/labs/x/notes-view/'
const getJSON = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(BASE + path, { cache: 'no-store', ...init })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
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

/** Inline markdown of a bullet (AI text, other lines): code, links, images — everything else is plain text. */
function inline(md: string, into: HTMLElement): void {
  const re = /(`[^`]+`)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(md); m; m = re.exec(md)) {
    if (m.index > last) into.append(md.slice(last, m.index))
    if (m[1]) into.append(el('code', '', m[1].slice(1, -1)))
    else if (m[3] !== undefined) into.append(imageView(m[3].includes(':') ? m[3] : BASE + 'file/' + m[3], m[2]))
    else { const a = el('a', '', m[4]); a.href = m[5]; a.target = '_blank'; into.append(a) }
    last = m.index + m[0].length
  }
  if (last < md.length) into.append(md.slice(last))
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
  b.tabIndex = -1   // never a Tab stop: Tab belongs to the editors (indent)
  b.innerHTML = CHEVRON
  const set = (c: boolean) => { b.setAttribute('aria-expanded', String(!c)); b.setAttribute('aria-label', `${c ? 'Expand' : 'Collapse'} ${label}`) }
  set(collapsed)
  b.addEventListener('mousedown', (e) => e.preventDefault())
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const c = b.getAttribute('aria-expanded') === 'true'; set(c); onToggle(c) })
  contentDom.prepend(b)
  return b
}

interface TimedEl { t: number; el: HTMLElement; sec: SecView }
interface SecView {
  d: DSection
  root: HTMLElement
  head: HTMLElement
  aiBox: HTMLElement
  mirrorBox: HTMLElement
  edBox: HTMLElement
  saveEl: HTMLElement
  bullets: TimedEl[]
  editor: YasinEditor | null
  mounting: Promise<YasinEditor> | null
  savedMd: string
  pending: string | null
  timer: number | undefined
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
  let lastFollow = true
  let folds: Folds = { s: [], b: [], e: {} }
  const ready = store.get(`folds:${vid}`).then((f) => { if (f && typeof f === 'object') folds = Object.assign({ s: [], b: [], e: {} }, f as Folds) }).catch(() => {})
  const saveFolds = () => { void store.set(`folds:${vid}`, folds) }

  // ---------- theme: Crepe's frame / frame-dark, following the player's light / dark ----------
  const themeStyle = el('style')
  themeStyle.dataset.labs = 'notes-view-theme'
  document.head.append(themeStyle)
  const applyTheme = () => {
    const dark = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#1c1c1f'
    const css = dark ? frameDark : frameLight
    if (themeStyle.textContent !== css) themeStyle.textContent = css
    pane.classList.toggle('nv-dark', dark)
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

  // ---------- render ----------
  function renderBar(): void {
    if (!data) return
    const withAi = data.sections.filter((s) => s.aiCount > 0).length
    const job = data.job
    bar.replaceChildren()
    const tag = el('span', 'nv-tag nv-tag-ai', '🤖 AI notes')
    tag.title = 'Notes written by Claude from the transcript, in your notes format (notes-format.md). Marked 🤖.'
    bar.append(tag, el('span', 'nv-muted', ` ${withAi} of ${data.sections.length} parts`))
    if (job.state === 'running') bar.append(el('span', 'nv-run', ` · writing ${job.done + 1} of ${job.total}…`))
    else if (withAi < data.sections.length) {
      const b = el('button', 'nv-btn', 'Write missing')
      b.title = 'Write AI notes (claude -p) for every part that has none. Your own notes are never touched.'
      b.onclick = () => generate({ all: true })
      bar.append(b)
    }
    if (job.state === 'failed' && job.error) bar.append(el('div', 'nv-err', job.loginNeeded ? 'AI notes need `claude` login — run `claude` in a terminal and /login, then try again.' : `AI notes failed: ${job.error}`))
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

  function renderAi(sv: SecView): void {
    const d = sv.d
    sv.bullets = []
    sv.aiBox.replaceChildren()
    const items = d.items
    const hasAi = d.aiCount > 0
    if (hasAi || items.some((i) => i.kind === 'slide')) {
      const tag = el('div', 'nv-tag nv-tag-ai', hasAi ? '🤖 AI notes' : '🖼 Slides')
      tag.title = hasAi ? 'Written by Claude from the transcript, in your notes format — not your words. Click a bullet to play it.' : 'Slides from the video'
      sv.aiBox.append(tag)
    }
    if (!hasAi) {
      const row = el('div', 'nv-noai')
      const job = data?.job
      if (job?.state === 'running' && job.current === d.t) row.append(el('span', 'nv-run', '🤖 writing AI notes…'))
      else {
        row.append(el('span', 'nv-muted', '🤖 No AI notes for this part yet · '))
        const b = el('button', 'nv-btn', 'Write them')
        b.onclick = () => generate({ t: d.t })
        row.append(b)
      }
      sv.aiBox.append(row)
    }
    const md = el('div', 'milkdown nv-static')
    const pm = el('div', 'ProseMirror')
    const ul = el('ul')
    pm.append(ul); md.append(pm)
    const walk = (n: DNode, into: HTMLElement, path: string) => {
      const b = bullet((p) => inline(n.text, p), 'nv-b')
      b.block.dataset.t = String(n.t)
      b.p.title = `${L.ui.fmt(n.t)} · from paragraph ${n.p} — click to play`
      b.p.addEventListener('click', (e) => { if (!window.getSelection()?.toString() && !(e.target as HTMLElement).closest('a')) L.video.seek(n.t) })
      sv.bullets.push({ t: n.t, el: b.block, sec: sv })
      if (n.children.length) {
        const key = `${d.t}:${path}`
        const sub = el('ul')
        n.children.forEach((c, i) => walk(c, sub, `${path}.${i}`))
        b.contentDom.append(sub)
        const collapsed = folds.b.includes(key)
        if (collapsed) sub.setAttribute('data-outline-folded', 'true')
        foldToggle(b.contentDom, n.text.slice(0, 40), collapsed, (c) => {
          if (c) sub.setAttribute('data-outline-folded', 'true'); else sub.removeAttribute('data-outline-folded')
          folds.b = folds.b.filter((x) => x !== key); if (c) folds.b.push(key); saveFolds()
        })
      }
      into.append(b.block)
    }
    items.forEach((it, i) => {
      if (it.kind === 'ai') walk(it.node, ul, String(i))
      else if (it.kind === 'slide') {
        const key = `${d.t}:slide${it.n}`
        let wrap!: HTMLElement
        const b = bullet((p) => {
          const chip = el('button', 'nv-tchip', it.t !== null ? L.ui.fmt(it.t) : `#${it.n}`)
          chip.title = 'Play from this slide'
          chip.onclick = (e) => { e.stopPropagation(); if (it.t !== null) L.video.seek(it.t) }
          wrap = imageView(it.src, it.alt)
          wrap.querySelector('img')?.style.setProperty('--image-width', '400px')   // the docs app pastes images at 400 px
          wrap.dataset.caption = it.alt
          p.append(chip, ' ', wrap)
        }, 'nv-slide')
        if (it.t !== null) { b.block.dataset.t = String(it.t); sv.bullets.push({ t: it.t, el: b.block, sec: sv }) }
        const set = (c: boolean) => {
          wrap.setAttribute('data-outline-foldable-image', 'true')
          if (c) wrap.setAttribute('data-outline-folded-image', 'true'); else wrap.removeAttribute('data-outline-folded-image')
          folds.b = folds.b.filter((x) => x !== key); if (c) folds.b.push(key); saveFolds()
        }
        const tg = foldToggle(b.contentDom, it.alt, folds.b.includes(key), set)
        set(folds.b.includes(key))
        // the docs app's fold gestures: the corner button folds, a click on the folded chip unfolds
        wrap.querySelector('.image-view__fold')?.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); tg.click() })
        wrap.addEventListener('click', (e) => { if (wrap.hasAttribute('data-outline-folded-image') && (e.target as HTMLElement).tagName === 'IMG') { e.stopPropagation(); tg.click() } })
        ul.append(b.block)
      } else {
        const b = bullet((p) => inline(it.lines.join('\n').replace(/^[*+-]\s+/, ''), p), 'nv-other')
        ul.append(b.block)
      }
    })
    if (ul.children.length) sv.aiBox.append(md)
    sv.bullets.sort((a, b) => a.t - b.t)
    const counts = sv.head.querySelector('.nv-counts')
    if (counts) counts.textContent = [d.aiCount ? `🤖 ${d.aiCount}` : '', items.filter((i) => i.kind === 'slide').length ? `🖼 ${items.filter((i) => i.kind === 'slide').length}` : '', d.yasin.trim() ? '🧑' : ''].filter(Boolean).join(' · ')
  }

  function renderMirror(sv: SecView): void {
    const notes = L.notes().filter((n) => n.t >= sv.d.t && n.t < sv.d.end)
    sv.mirrorBox.replaceChildren()
    if (!notes.length) return
    const tag = el('div', 'nv-tag nv-tag-mirror', '💬 Your transcript notes')
    tag.title = 'Your 💬 notes in the transcript (read-only here — edit them in the Transcript)'
    const md = el('div', 'milkdown nv-static')
    const pm = el('div', 'ProseMirror')
    const ul = el('ul')
    for (const n of notes) {
      const b = bullet((p) => {
        p.append(el('span', 'nv-mt', L.ui.fmt(n.t)), ' ', n.text)
        if (n.quote) p.append(' ', el('span', 'nv-mq', `“${n.quote}”`))
      }, `nv-mirror-b${n.resolved ? ' nv-resolved' : ''}`)
      b.p.title = 'Click to play'
      b.p.onclick = () => L.video.seek(n.t)
      ul.append(b.block)
    }
    pm.append(ul); md.append(pm)
    sv.mirrorBox.append(tag, md)
  }

  const imageOptions: ImageOptions = {
    root: '/', notePath: '/notes.md',
    onOpenImage: ({ el: img }) => { if (img) openGallery(img) },
    onNotice: (m) => L.ui.toast(m, 5000),
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
    const md = sv.pending
    if (md === null) return
    setSave(sv, 'saving')
    try {
      const r = await getJSON<{ ok: boolean; md: string }>(`yasin?t=${sv.d.t}`, { method: 'POST', body: md, keepalive })
      if (sv.pending === md) sv.pending = null
      sv.savedMd = r.md
      sv.d.yasin = r.md
      if (data) data.exists = true
      setSave(sv, sv.pending === null ? 'saved' : 'edited')
    } catch (e) {
      setSave(sv, 'error', e instanceof Error ? e.message : String(e))
    }
  }

  async function mountEditor(sv: SecView, focus: boolean): Promise<YasinEditor> {
    if (sv.editor) { if (focus) sv.editor.focus(); return sv.editor }
    if (!sv.mounting) {
      sv.edBox.replaceChildren()
      sv.mounting = createYasinEditor({
        root: sv.edBox,
        markdown: sv.d.yasin,
        image: imageOptions,
        onChange: (md) => {
          sv.pending = md
          setSave(sv, 'edited')
          clearTimeout(sv.timer)
          sv.timer = window.setTimeout(() => void save(sv), 700)
        },
        onFocus: () => { editing++; pane.classList.add('nv-editing') },
        onBlur: () => { editing = Math.max(0, editing - 1); if (!editing) pane.classList.remove('nv-editing'); void save(sv) },
      }).then((ed) => { sv.editor = ed; return ed })
    }
    const ed = await sv.mounting
    if (focus) ed.focus()
    return ed
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const sv = secs.find((s) => s.edBox === e.target)
      if (sv && sv.d.yasin.trim()) void mountEditor(sv, false)
      io.unobserve(e.target)
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
    const regen = el('button', 'nv-regen', '⟳ 🤖')
    regen.title = 'Write the AI notes of this part again (your 🧑 notes are kept)'
    head.append(fold, time, title, counts, regen)
    const body = el('div', 'nv-body')
    const aiBox = el('div', 'nv-ai')
    const mirrorBox = el('div', 'nv-mirror')
    const yBox = el('div', 'nv-yasin')
    const ytag = el('div', 'nv-tag nv-tag-me', '🧑 Yasin')
    ytag.title = 'Your own notes for this part (saved in the notes file under "Yasin:")'
    const saveEl = el('span', 'nv-save')
    ytag.append(saveEl)
    const edBox = el('div', 'nv-ed milkdown-host')
    yBox.append(ytag, edBox)
    body.append(aiBox, mirrorBox, yBox)
    root.append(head, body)
    const sv: SecView = { d, root, head, aiBox, mirrorBox, edBox, saveEl, bullets: [], editor: null, mounting: null, savedMd: d.yasin, pending: null, timer: undefined }
    const setFold = (c: boolean) => {
      root.classList.toggle('nv-folded', c)
      fold.setAttribute('aria-expanded', String(!c))
      folds.s = folds.s.filter((x) => x !== d.t); if (c) folds.s.push(d.t)
    }
    setFold(folds.s.includes(d.t))
    fold.onclick = (e) => { e.stopPropagation(); setFold(!root.classList.contains('nv-folded')); saveFolds() }
    head.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) return; L.video.seek(d.t) })
    regen.onclick = (e) => { e.stopPropagation(); generate({ t: d.t, force: true }) }
    if (!d.yasin.trim()) {
      const add = el('div', 'nv-ed-empty', 'Type your notes for this part…')
      add.onclick = () => void mountEditor(sv, true)
      edBox.append(add)
    } else {
      edBox.append(el('div', 'nv-ed-loading', '…'))
    }
    renderAi(sv)
    renderMirror(sv)
    return sv
  }

  function render(): void {
    if (!data) return
    renderBar()
    for (const s of secs) io.unobserve(s.edBox)
    list.replaceChildren()
    secs = data.sections.map(renderSection)
    for (const s of secs) { list.append(s.root); io.observe(s.edBox) }
    curSec = null; curEl = null
  }

  /** New data from main: the AI / slide boxes are redrawn; the editors (and what is being typed) stay. */
  function refreshAi(next: Data): void {
    data = next
    renderBar()
    for (const sv of secs) {
      const d = next.sections.find((s) => s.t === sv.d.t)
      if (!d) continue
      const changed = JSON.stringify(d.items) !== JSON.stringify(sv.d.items) || d.aiCount !== sv.d.aiCount
      sv.d = { ...d, yasin: sv.d.yasin }
      if (changed || next.job.state === 'running') renderAi(sv)
    }
    curEl = null
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
        refreshAi(next)
        if (next.job.state !== 'running') {
          clearInterval(polling)
          if (next.job.state === 'failed') L.ui.toast(next.job.loginNeeded ? 'AI notes need `claude` login — run `claude` in a terminal and /login' : `AI notes failed: ${next.job.error}`, 7000)
          else if (next.job.state === 'done') L.ui.toast('🤖 AI notes written', 2500)
        }
      } catch { /* try again next time */ }
    }, 1500)
  }
  async function generate(o: { t?: number; all?: boolean; force?: boolean }): Promise<void> {
    const q = o.all ? 'all=1' : `t=${o.t}`
    try {
      const job = await getJSON<Job>(`generate?${q}${o.force ? '&force=1' : ''}`, { method: 'POST' })
      if (data) { data.job = job; renderBar(); secs.forEach((s) => { if (!s.d.aiCount || s.d.t === o.t) renderAi(s) }) }
      poll()
    } catch (e) {
      L.ui.toast(`AI notes: ${e instanceof Error ? e.message : e}`, 6000)
    }
  }

  function foldAll(c: boolean): void {
    pane.querySelectorAll<HTMLButtonElement>('.nv-static .outline-toggle').forEach((b) => { if ((b.getAttribute('aria-expanded') === 'true') === c) b.click() })
  }

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
  function locate(t: number): { sv: SecView | null; target: HTMLElement | null } {
    let sv: SecView | null = null
    for (const s of secs) if (s.d.t <= t + 0.05) sv = s
    sv = sv ?? secs[0] ?? null
    if (!sv) return { sv: null, target: null }
    let b: TimedEl | null = null
    for (const x of sv.bullets) if (x.t <= t + 0.05) b = x
    return { sv, target: b ? b.el : null }
  }
  function tick(force = false): void {
    if (!visible || !secs.length) return
    const t = L.video.time()
    const { sv, target } = locate(t)
    if (sv !== curSec) { curSec?.root.classList.remove('nv-cur'); sv?.root.classList.add('nv-cur'); curSec = sv }
    if (target !== curEl) { curEl?.classList.remove('nv-cur-b'); target?.classList.add('nv-cur-b'); curEl = target }
    const follow = L.transcript.current().follow
    const turnedOn = follow && !lastFollow
    lastFollow = follow
    if (follow && sv && (force || turnedOn || !editing)) keepInView(visibleEl(target ?? sv.head, sv), force || turnedOn)
  }
  L.video.onTick(() => tick(false), 200)

  /** The time at the reading line (35 % down) of the Notes view — where a switch to the transcript lands. */
  function timeAtView(): number | null {
    const s = pane.getBoundingClientRect(), line = s.top + s.height * 0.35
    let best: number | null = null
    for (const e of pane.querySelectorAll<HTMLElement>('.nv-sh[data-t], .milkdown-list-item-block[data-t]')) {
      if (e.offsetParent === null) continue
      const r = e.getBoundingClientRect()
      if (r.top <= line) best = Number(e.dataset.t)
      else break
    }
    return best
  }

  // flush unsaved typing when the page goes away (⌘R, close)
  window.addEventListener('pagehide', () => { for (const s of secs) if (s.pending !== null) void save(s, true) })

  let loaded: Promise<void> | null = null
  // view buttons are never Tab stops (Tab = indent in the editors; a focused button would take Space / Enter)
  new MutationObserver(() => pane.querySelectorAll<HTMLButtonElement>('button:not([tabindex])').forEach((b) => { b.tabIndex = -1 })).observe(pane, { childList: true, subtree: true })

  return {
    /** Shows the Notes view landing on `t` (null: the current time; Follow decides like the transcript). */
    async show(t: number | null): Promise<void> {
      pane.classList.add('nv-show')
      visible = true
      loaded = loaded ?? load().catch((e) => { list.replaceChildren(el('div', 'nv-err', `Could not load the notes: ${e instanceof Error ? e.message : e}`)) })
      await loaded
      for (const s of secs) renderMirror(s)
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
  }
}

declare global { interface Window { __notesView?: { mount: typeof mount } } }
window.__notesView = { mount }
