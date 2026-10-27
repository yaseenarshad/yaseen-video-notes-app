/**
 * notes-view: the per-video notes file `<slug>.notes.md` — pure parse / serialize / merge (no fs, no Electron).
 *
 * Bullet-only, like Yasin's notes format (one optional H1 title, everything else bullets):
 *
 *   # Notes — <video title>
 *
 *   * [12:14](https://www.youtube.com/watch?v=ID&t=734s) Firecracker VMs          ← a section (time link + title)
 *      * Agent runs on its own computer = a Linux box (Firecracker VM) <!-- p:41 -->   ← AI bullet (source paragraph)
 *         * Easy to snapshot the machine → shut it down → start it back up <!-- p:42 -->
 *      * ![Slide 12 · 12:14](slides/slide-012.jpg) <!-- slide:12 -->              ← a slide (from slides.json)
 *      * Yasin:                                                                   ← the user's own notes
 *         * this is why always-on agents are cheap to pause
 *         * ![paste-20261027-140501|400](notes-images/paste-20261027-140501.png)
 *
 * - Indent: 3 spaces per level (any indentation is read; the file is written back in this canonical form).
 * - AI bullets carry `<!-- p:N -->` (an HTML comment: invisible in the docs app / Obsidian). A child without one
 *   inherits its parent's paragraph.
 * - Slide bullets carry `<!-- slide:N -->`; the src is relative to the notes file.
 * - Everything else under a section that is not AI / slide / Yasin is kept verbatim ("other"), so a hand edit in
 *   another app is never lost. Regenerating AI notes or slides replaces only AI / slide bullets; the `Yasin:` subtree
 *   and "other" bullets are never touched.
 */

export const INDENT = '   '
/** The section line: `* [m:ss](url&t=Ns) Title`. */
const SECTION_RE = /^[*+-] \[(\d{1,2}(?::\d{2}){1,2})\]\((\S+?)\)(?:[ \t]+(.*))?$/
const BULLET_RE = /^([*+-]|\d{1,3}[.)])[ \t]+(.*)$|^([*+-])$/
const P_MARK_RE = /\s*<!--\s*p:\s*(\d+)\s*-->\s*$/
const SLIDE_MARK_RE = /\s*<!--\s*slide:\s*(\d+)\s*-->\s*$/
const YASIN_RE = /^(?:🧑\s*)?Yasin:\s*$/i
const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/

export interface AiBullet { text: string; p: number; children: AiBullet[] }
export interface AiItem { kind: 'ai'; bullet: AiBullet }
export interface SlideItem {
  kind: 'slide'
  n: number
  alt: string
  src: string
  /** From the alt's `· m:ss` (null when it has none). */
  t: number | null
  /** Lines someone wrote under the slide bullet (dedented, verbatim) — carried over when slides are refreshed. */
  extra: string[]
}
/** The user's own notes: the `Yasin:` bullet's children, dedented, as a markdown bullet list (3-space indents). */
export interface YasinItem { kind: 'yasin'; md: string }
/** Anything else under a section (hand edits): lines verbatim, dedented to the section's child level. */
export interface OtherItem { kind: 'other'; lines: string[] }
export type SectionItem = AiItem | SlideItem | YasinItem | OtherItem

export interface NotesSection {
  /** Start, whole seconds (the key: it is the `t=` of the link). */
  t: number
  title: string
  url: string
  items: SectionItem[]
  /** Top-level lines after the section that are not sections (hand edits), verbatim. */
  after: string[]
}

export interface NotesDoc {
  /** The H1's text (without `# `), or null. */
  h1: string | null
  /** Lines between the H1 and the first section, verbatim (blank edges trimmed). */
  head: string[]
  sections: NotesSection[]
}

// ---------- small helpers ----------

export const fmtTime = (s: number): string => {
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}

export const parseTime = (s: string): number | null => {
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(s)) return null
  return s.split(':').reduce((a, b) => a * 60 + Number(b), 0)
}

export const videoUrl = (videoId: string, t: number): string => `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(t)}s`

export const sectionKey = (t: number): number => Math.floor(t)

/** Leading whitespace width (a tab counts as one indent step). */
const indentOf = (line: string): number => {
  let n = 0
  for (const c of line) { if (c === ' ') n++; else if (c === '\t') n += INDENT.length; else break }
  return n
}
const dedent = (line: string, n: number): string => {
  let i = 0, w = 0
  while (i < line.length && w < n && (line[i] === ' ' || line[i] === '\t')) { w += line[i] === '\t' ? INDENT.length : 1; i++ }
  return line.slice(i)
}
const isBlank = (l: string): boolean => l.trim() === ''

// ---------- a generic bullet tree (indentation-based) ----------

export interface TreeNode { marker: string; text: string; children: TreeNode[] }

/**
 * Lines of a markdown bullet list → a tree, by indentation. A non-bullet line deeper than the current bullet is a
 * continuation of its text (joined with "\n"); a non-bullet line at the top becomes a bullet of its own (notes are
 * bullets only). Blank lines are dropped. Ordered markers (`1.`) are kept; `-` / `+` become `*`.
 */
export function parseTree(lines: string[]): TreeNode[] {
  const roots: TreeNode[] = []
  const stack: { indent: number; node: TreeNode }[] = []
  for (const raw of lines) {
    if (isBlank(raw)) continue
    const ind = indentOf(raw)
    const body = raw.trim()
    const m = BULLET_RE.exec(body)
    if (!m) {
      // continuation of the deepest bullet it is inside of
      while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop()
      const top = stack[stack.length - 1]
      if (top) { top.node.text = top.node.text ? top.node.text + '\n' + body : body; continue }
      const node: TreeNode = { marker: '*', text: body.replace(/^#{1,6}\s+/, ''), children: [] }
      roots.push(node); stack.push({ indent: ind, node })
      continue
    }
    const marker = m[1] ? (/^\d/.test(m[1]) ? m[1] : '*') : '*'
    const node: TreeNode = { marker, text: (m[2] ?? '').trimEnd(), children: [] }
    while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.node.children.push(node); else roots.push(node)
    stack.push({ indent: ind, node })
  }
  return roots
}

/** Tree → lines with 3-space indents; continuation lines sit at the bullet's content column. */
export function serializeTree(nodes: TreeNode[], depth = 0): string[] {
  const out: string[] = []
  for (const n of nodes) {
    const pad = INDENT.repeat(depth)
    const [first, ...rest] = n.text.split('\n')
    out.push(first ? `${pad}${n.marker} ${first}` : `${pad}${n.marker}`)
    const cont = pad + ' '.repeat(n.marker.length + 1)
    for (const r of rest) out.push(cont + r)
    out.push(...serializeTree(n.children, depth + 1))
  }
  return out
}

/** Empty bullets (no text, no children) are dropped — an editor's trailing empty item is not a note. */
function dropEmpty(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => ({ ...n, children: dropEmpty(n.children) })).filter((n) => n.text.trim() !== '' || n.children.length > 0)
}

/**
 * Markdown from the Yasin editor (Milkdown) → the canonical bullet list stored in the file: bullets only, 3-space
 * indents, empty bullets dropped. Lines that are not bullets become bullets; `# ` heading marks are dropped.
 */
export function normalizeYasinMarkdown(md: string): string {
  const lines = md.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''))
  // Milkdown writes an empty item as `* <br />` sometimes; that is an empty bullet
  const cleaned = lines.map((l) => l.replace(/^(\s*[*+-])\s+<br\s*\/?>$/, '$1'))
  return serializeTree(dropEmpty(parseTree(cleaned))).join('\n')
}

// ---------- parse ----------

function aiFromTree(nodes: TreeNode[], inherit: number | null): AiBullet[] {
  const out: AiBullet[] = []
  for (const n of nodes) {
    const text = n.text.replace(/\n/g, ' ')
    const m = P_MARK_RE.exec(text)
    const p = m ? Number(m[1]) : inherit ?? 0
    out.push({ text: (m ? text.slice(0, m.index) : text).trim(), p, children: aiFromTree(n.children, p) })
  }
  return out
}

function slideFrom(rest: string, sub: string[]): SlideItem | null {
  const m = SLIDE_MARK_RE.exec(rest)
  if (!m) return null
  const body = rest.slice(0, m.index).trim()
  const img = IMG_RE.exec(body)
  const alt = img ? img[1] : body
  const src = img ? img[2] : ''
  const tm = /·\s*(\d{1,2}(?::\d{2}){1,2})\s*$/.exec(alt)
  return { kind: 'slide', n: Number(m[1]), alt, src, t: tm ? parseTime(tm[1]) : null, extra: sub }
}

/** Splits a block of lines at its base indentation: one group per line at (or left of) the base. */
function groups(lines: string[]): { first: string; sub: string[] }[] {
  const nonBlank = lines.filter((l) => !isBlank(l))
  if (!nonBlank.length) return []
  const base = indentOf(nonBlank[0])
  const out: { first: string; sub: string[] }[] = []
  for (const l of lines) {
    if (isBlank(l)) continue
    if (indentOf(l) <= base || !out.length) out.push({ first: dedent(l, indentOf(l)), sub: [] })
    else out[out.length - 1].sub.push(l)
  }
  return out
}

function dedentAll(lines: string[]): string[] {
  const nb = lines.filter((l) => !isBlank(l))
  if (!nb.length) return []
  const min = Math.min(...nb.map(indentOf))
  return nb.map((l) => dedent(l, min))
}

function itemsOf(lines: string[]): SectionItem[] {
  const items: SectionItem[] = []
  for (const g of groups(lines)) {
    const bm = BULLET_RE.exec(g.first)
    const rest = bm ? (bm[2] ?? '').trimEnd() : ''
    if (bm && YASIN_RE.test(rest)) {
      const md = dedentAll(g.sub).join('\n')
      const prev = items.find((i): i is YasinItem => i.kind === 'yasin')
      if (prev) prev.md = prev.md ? prev.md + '\n' + md : md   // two Yasin: bullets → one (never lose either)
      else items.push({ kind: 'yasin', md })
      continue
    }
    if (bm) {
      const slide = slideFrom(rest, dedentAll(g.sub))
      if (slide) { items.push(slide); continue }
      if (P_MARK_RE.test(rest)) {
        // the item's own line + its subtree, parsed as one tree
        const tree = parseTree([g.first, ...g.sub.map((l) => l)])
        for (const b of aiFromTree(tree, null)) items.push({ kind: 'ai', bullet: b })
        continue
      }
    }
    // other: verbatim, dedented to the child level (sub lines keep their indent relative to the first)
    const subBase = g.sub.length ? Math.min(...g.sub.filter((l) => !isBlank(l)).map(indentOf)) : 0
    items.push({ kind: 'other', lines: [g.first, ...g.sub.map((l) => INDENT + dedent(l, subBase))] })
  }
  return items
}

export function parseNotes(text: string): NotesDoc {
  const lines = text.replace(/\r/g, '').split('\n')
  const doc: NotesDoc = { h1: null, head: [], sections: [] }
  let i = 0
  while (i < lines.length && isBlank(lines[i])) i++
  if (i < lines.length && /^# /.test(lines[i])) { doc.h1 = lines[i].slice(2).trim(); i++ }
  let cur: NotesSection | null = null
  let block: string[] = []
  const flush = () => { if (cur) { cur.items = itemsOf(block) } block = [] }
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (!isBlank(l) && indentOf(l) === 0) {
      const sm = SECTION_RE.exec(l)
      if (sm) {
        flush()
        const url = sm[2]
        const tq = /[?&#]t=(\d+)/.exec(url)
        const t = tq ? Number(tq[1]) : parseTime(sm[1]) ?? 0
        cur = { t, title: (sm[3] ?? '').trim(), url, items: [], after: [] }
        doc.sections.push(cur)
        continue
      }
      if (!cur) { doc.head.push(l); continue }
      // a top-level line that is not a section: kept verbatim after this section, with its sub-lines
      flush()
      cur.after.push(l)
      while (i + 1 < lines.length && (isBlank(lines[i + 1]) || indentOf(lines[i + 1]) > 0) && !SECTION_RE.test(lines[i + 1])) {
        i++
        if (!isBlank(lines[i])) cur.after.push(lines[i])
      }
      continue
    }
    if (!cur) { doc.head.push(l); continue }
    block.push(l)
  }
  flush()
  // trim blank edges of the head
  while (doc.head.length && isBlank(doc.head[0])) doc.head.shift()
  while (doc.head.length && isBlank(doc.head[doc.head.length - 1])) doc.head.pop()
  return doc
}

// ---------- serialize ----------

function aiLines(b: AiBullet, depth: number): string[] {
  const text = b.text.replace(/\s*\n\s*/g, ' ').trim()
  return [`${INDENT.repeat(depth)}* ${text} <!-- p:${b.p} -->`, ...b.children.flatMap((c) => aiLines(c, depth + 1))]
}

function itemLines(it: SectionItem): string[] {
  switch (it.kind) {
    case 'ai': return aiLines(it.bullet, 1)
    case 'slide': return [`${INDENT}* ![${it.alt}](${it.src}) <!-- slide:${it.n} -->`, ...it.extra.map((l) => INDENT.repeat(2) + l)]
    case 'yasin': {
      const md = it.md.split('\n').filter((l) => !isBlank(l))
      return [`${INDENT}* Yasin:`, ...md.map((l) => INDENT.repeat(2) + l)]
    }
    case 'other': return it.lines.map((l) => INDENT + l)
  }
}

export function serializeNotes(doc: NotesDoc): string {
  const out: string[] = []
  if (doc.h1 !== null) out.push(`# ${doc.h1}`, '')
  if (doc.head.length) out.push(...doc.head, '')
  for (const s of doc.sections) {
    out.push(`* [${fmtTime(s.t)}](${s.url})${s.title ? ' ' + s.title : ''}`)
    for (const it of s.items) out.push(...itemLines(it))
    out.push(...s.after)
  }
  return out.join('\n').replace(/\n+$/, '') + '\n'
}

// ---------- merge (regenerate / refresh / user edits) ----------

export interface SectionSpec { t: number; title: string; url: string }

export function emptyDoc(h1: string | null): NotesDoc { return { h1, head: [], sections: [] } }

/** Makes sure every computed section exists (title / url refreshed); sections that no longer match are KEPT. */
export function ensureSections(doc: NotesDoc, specs: SectionSpec[]): NotesDoc {
  for (const sp of specs) {
    const key = sectionKey(sp.t)
    const s = doc.sections.find((x) => sectionKey(x.t) === key)
    if (s) { s.title = sp.title; s.url = sp.url }
    else doc.sections.push({ t: key, title: sp.title, url: sp.url, items: [], after: [] })
  }
  doc.sections.sort((a, b) => a.t - b.t)
  return doc
}

export const findSection = (doc: NotesDoc, t: number): NotesSection | undefined => doc.sections.find((s) => sectionKey(s.t) === sectionKey(t))

/** The section a time falls in: the last one starting at or before it (else the first). */
export function sectionAt(doc: NotesDoc, t: number): NotesSection | undefined {
  let best: NotesSection | undefined
  for (const s of doc.sections) if (s.t <= t + 0.001) best = s
  return best ?? doc.sections[0]
}

/**
 * Item order inside a section: AI bullets and slides by time (a slide goes before the first AI bullet that starts
 * after it; AI bullets keep their own order), then "other" lines, then the Yasin notes last.
 */
export function arrange(s: NotesSection, paraTime: (p: number) => number): void {
  const ai = s.items.filter((i): i is AiItem => i.kind === 'ai')
  const slides = s.items.filter((i): i is SlideItem => i.kind === 'slide').sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || a.n - b.n)
  const other = s.items.filter((i) => i.kind === 'other')
  const yasin = s.items.filter((i) => i.kind === 'yasin')
  const merged: SectionItem[] = []
  let k = 0
  for (const a of ai) {
    const at = paraTime(a.bullet.p)
    while (k < slides.length && (slides[k].t ?? 0) < at) merged.push(slides[k++])
    merged.push(a)
  }
  while (k < slides.length) merged.push(slides[k++])
  s.items = [...merged, ...other, ...yasin]
}

/** Replaces the AI bullets of one section (Yasin notes, slides and other lines untouched). */
export function setAiNotes(doc: NotesDoc, t: number, bullets: AiBullet[], paraTime: (p: number) => number): NotesDoc {
  const s = findSection(doc, t)
  if (!s) throw new Error(`no section at ${fmtTime(t)}`)
  s.items = [...s.items.filter((i) => i.kind !== 'ai'), ...bullets.map((b): AiItem => ({ kind: 'ai', bullet: b }))]
  arrange(s, paraTime)
  return doc
}

export interface SlideSpec { n: number; t: number; src: string; alt?: string }

export const slideAlt = (n: number, t: number): string => `Slide ${n} · ${fmtTime(t)}`

/** Replaces every slide bullet with `slides` (each in the section its time falls in); a slide's extra lines are kept. */
export function setSlides(doc: NotesDoc, slides: SlideSpec[], paraTime: (p: number) => number): NotesDoc {
  const extra = new Map<number, string[]>()
  for (const s of doc.sections) {
    for (const i of s.items) if (i.kind === 'slide' && i.extra.length) extra.set(i.n, i.extra)
    s.items = s.items.filter((i) => i.kind !== 'slide')
  }
  for (const sl of slides) {
    const s = sectionAt(doc, sl.t)
    if (!s) continue
    s.items.push({ kind: 'slide', n: sl.n, alt: sl.alt ?? slideAlt(sl.n, sl.t), src: sl.src, t: Math.floor(sl.t), extra: extra.get(sl.n) ?? [] })
  }
  for (const s of doc.sections) arrange(s, paraTime)
  return doc
}

/** The slides the file has now (to see whether slides.json changed). */
export const slideSignature = (doc: NotesDoc): string =>
  doc.sections.flatMap((s) => s.items.filter((i): i is SlideItem => i.kind === 'slide').map((i) => `${i.n}@${i.t}:${i.src}`)).sort().join('|')

export const specsSignature = (slides: SlideSpec[]): string => slides.map((s) => `${s.n}@${Math.floor(s.t)}:${s.src}`).sort().join('|')

/** The user's notes of one section (normalized markdown; empty → the `Yasin:` bullet is removed). */
export function setYasin(doc: NotesDoc, t: number, md: string): NotesDoc {
  const s = findSection(doc, t)
  if (!s) throw new Error(`no section at ${fmtTime(t)}`)
  const norm = normalizeYasinMarkdown(md)
  s.items = s.items.filter((i) => i.kind !== 'yasin')
  if (norm.trim()) s.items.push({ kind: 'yasin', md: norm })
  return doc
}

export const yasinOf = (s: NotesSection): string => s.items.find((i): i is YasinItem => i.kind === 'yasin')?.md ?? ''
export const aiOf = (s: NotesSection): AiBullet[] => s.items.filter((i): i is AiItem => i.kind === 'ai').map((i) => i.bullet)

// ---------- format rules (AI bullets) ----------

/** Problems with a bullet text against the notes format: bold, headers, mochi tags. */
export function textProblems(text: string): string[] {
  const out: string[] = []
  if (/\*\*[^*]+\*\*|__[^_]+__/.test(text)) out.push('bold')
  if (/^#{1,6}\s/.test(text.trim())) out.push('header')
  if (/\[\[\s*mochi|#mochi\b/i.test(text)) out.push('mochi tag')
  return out
}

/** Every format problem of a whole notes file's AI bullets (`[]` = clean). */
export function formatProblems(doc: NotesDoc): string[] {
  const out: string[] = []
  const walk = (b: AiBullet, where: string) => {
    for (const p of textProblems(b.text)) out.push(`${where}: ${p} in "${b.text.slice(0, 60)}"`)
    b.children.forEach((c) => walk(c, where))
  }
  for (const s of doc.sections) for (const b of aiOf(s)) walk(b, fmtTime(s.t))
  return out
}
