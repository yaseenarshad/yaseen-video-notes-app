/**
 * notes-view: the per-video notes file `<slug>.notes.md` — pure parse / serialize / merge (no fs, no Electron).
 *
 * Bullet-only, like Yasin's notes format (one optional H1 title, everything else bullets):
 *
 *   # Notes — <video title>
 *
 *   * [12:14](https://www.youtube.com/watch?v=ID&t=734s) Firecracker VMs                  ← a part (time link + title)
 *      * Agent runs on its own computer ==my words== = a Linux box <!-- p:41 -->          ← AI bullet (+ Yasin's words)
 *         * ==a child Yasin typed==                                                        ← Yasin's own bullet (no marker)
 *         * Easy to snapshot the machine <!-- p:42 --> <!-- note:k3j9a0b -->               ← sent as a 💬 transcript note
 *      * ![Slide 12 · 12:14](slides/slide-012.jpg) <!-- slide:12 -->                      ← a slide (from slides.json)
 *      * ==my own bullet==
 *         * ![notes-20261027-144035|400](notes-images/notes-20261027-144035.png)
 *
 * - Indent: 3 spaces per level (any indentation is read; the file is written back in this canonical form).
 * - `<!-- p:N -->` = the transcript paragraph a bullet follows (sync: click to play, highlighted while playing). It
 *   rides on the bullet, not its text: Yasin may reword, merge or split AI bullets; the marker stays. A bullet without
 *   one is Yasin's own (or a hand edit).
 * - `==…==` = Yasin's own words (typed or pasted in the Notes view), inside AI bullets or as whole bullets.
 * - `<!-- note:<id> -->` = this bullet was sent as a 💬 transcript note (core/notes.ts id).
 * - Slide bullets carry `<!-- slide:N -->`; the src is relative to the notes file.
 * - Legacy: a `* Yasin:` bullet's children (the first version's separate editor) are still read; they are shown inline
 *   at the end of their part and written back as `==…==` bullets on the next save of that part.
 * - The AI's original text of each bullet lives in the `.notes-ai.json` sidecar (`Originals`), never in this file.
 */

export const INDENT = '   '
/** The part line: `* [m:ss](url&t=Ns) Title`. */
const SECTION_RE = /^[*+-] \[(\d{1,2}(?::\d{2}){1,2})\]\((\S+?)\)(?:[ \t]+(.*))?$/
const BULLET_RE = /^([*+-]|\d{1,3}[.)])[ \t]+(.*)$|^([*+-])$/
/**
 * A paragraph marker anywhere in a bullet's text (typing after it in the editor leaves words behind it). Extra
 * `key:value` fields (`t:`, `o:`) are the editor's transport only and are never written to the file.
 */
const P_MARK_RE = /[ \t]*<!--\s*p:\s*(\d+)((?:\s+[a-z]+:[\w.]*)*)\s*-->[ \t]*/
const NOTE_MARK_RE = /[ \t]*<!--\s*note:\s*([A-Za-z0-9_-]{1,40})\s*-->[ \t]*/g
const SLIDE_TITLE_RE = /[ \t]*<!--\s*slide-title:\s*(\d+)(?:\s+[a-z]+:[\w.]*)*\s*-->[ \t]*/
const SLIDE_REF_RE = /[ \t]*<!--\s*slide:\s*(\d+)(?:\s+[a-z]+:[\w.]*)*\s*-->[ \t]*/
const SLIDE_MARK_RE = /\s*<!--\s*slide:\s*(\d+)(?:\s+[a-z]+:[\w.]*)*\s*-->\s*$/
const YASIN_RE = /^(?:🧑\s*)?Yasin:\s*$/i
const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/
const IMG_ANY_RE = /!\[[^\]]*\]\([^)\s]*(?:\s+"[^"]*")?\)/g

/**
 * One bullet. `p` = the source paragraph (null: Yasin's own bullet, or a hand edit). `text` is markdown and may hold
 * `==…==` (Yasin's words) and several lines (a hard break). `notes` = ids of 💬 transcript notes made from it.
 */
export interface Bullet {
  text: string
  p: number | null
  children: Bullet[]
  marker?: string
  /** 💬 notes made from it (`<!-- note:<id> -->`). */
  notes?: string[]
  /** A heading bullet made from slide N's title (`<!-- slide-title:N -->`: the UI shows a slide icon). */
  slideTitle?: number
  /** Text from slide N the speaker never said, marked `(slide)` (`<!-- slide:N -->` after its `<!-- p:N -->`). */
  slide?: number
}
/** @deprecated the old name; every bullet is a `Bullet` now. */
export type AiBullet = Bullet
export interface BulletItem { kind: 'bullet'; bullet: Bullet }
export interface SlideItem {
  kind: 'slide'
  n: number
  alt: string
  src: string
  /** From the alt's `· m:ss` (null when it has none). */
  t: number | null
  /** Lines under the slide bullet (dedented, verbatim) — carried over when slides are refreshed. */
  extra: string[]
}
/** Legacy: the `Yasin:` bullet's children, dedented, as a markdown bullet list (3-space indents). */
export interface YasinItem { kind: 'yasin'; md: string }
export type SectionItem = BulletItem | SlideItem | YasinItem

export interface NotesSection {
  /** Start, whole seconds (the key: it is the `t=` of the link). */
  t: number
  title: string
  url: string
  items: SectionItem[]
  /** Top-level lines after the part that are not parts (hand edits), verbatim. */
  after: string[]
}

export interface NotesDoc {
  /** The H1's text (without `# `), or null. */
  h1: string | null
  /** Lines between the H1 and the first part, verbatim (blank edges trimmed). */
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

// ---------- Yasin's words: `==…==` ----------

/**
 * `==…==` spans, read like the docs app's highlight tokenizer (Obsidian syntax): exactly two `=`, not escaped, no
 * space just inside either end. The `g` regex: use through `userSpans` / `stripUser`.
 */
const USER_SPAN_RE = /(?<![\\=])==(?![=\s])((?:\\.|[^=\\]|=(?!=))*?)(?<![\s\\=])==(?!=)/g

/** The inner texts of every `==…==` span, in order. */
export const userSpans = (text: string): string[] => [...text.matchAll(USER_SPAN_RE)].map((m) => m[1])
export const hasUserWords = (text: string): boolean => userSpans(text).length > 0
/** The text without Yasin's spans (spaces collapsed). */
export const stripUser = (text: string): string => text.replace(USER_SPAN_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim()
/** The text with the `==` marks removed (the words stay). */
export const unmarkUser = (text: string): string => text.replace(USER_SPAN_RE, '$1')

// ---------- name corrections: `Palmer Luckey <!-- was: Palmer Lucky -->` ----------

/**
 * A name the model corrected from its own knowledge, marked right after the name with the captions' spelling
 * (notes-format.md). Fixes taken from slides / title / chapters / description carry no mark.
 */
export interface WasSpan {
  /** Where the corrected name starts. */
  nameStart: number
  /** Where the marker comment ends (name + marker = text.slice(nameStart, end)). */
  end: number
  name: string
  /** The captions' spelling. */
  was: string
}

const WAS_MARK_RE = /[ \t]*<!--\s*was:\s*([^>]*?)\s*-->/g

const NAME_STOP = new Set('The Then And But So A An In On At Of To With From By For My Our Your His Her Their This That These Those I We You He She They It Its As Is Was Like'.split(' '))

/**
 * How many characters before the marker the corrected name takes: the run of capitalised words right before it
 * ("Palmer Luckey", "Le Bourget", "St. Louis", "Global Learning XPRIZE"; a sentence word like "Then" / "The", or a word
 * ending a clause like "Live:", is never part of it), else — a lowercase term — as many words as the captions' spelling has. Shared with the editor.
 */
export function nameBefore(before: string, was: string): string | null {
  const b = before.replace(/\s+$/, '')
  const words = b.split(/(?<=\S)(?=\s)/)   // keeps the spaces with the following word
  const toks: string[] = []
  for (let i = words.length - 1; i >= 0 && toks.length < 6; i--) {
    const t = words[i].trim()
    if (!/^[("'“‘]*(\p{Lu}|\p{N}+\p{L})/u.test(t) || NAME_STOP.has(t.replace(/^[("'“‘]+/, ''))) break
    // a word ending a clause ("Live:", "said,") is not part of the name after it; "St." / "Dr." / "F." are
    if (toks.length && /[,:;!?.)]$/.test(t) && !/^(St|Dr|Mr|Mrs|Ms|Jr|Sr|Mt|\p{Lu})\.$/u.test(t)) break
    toks.unshift(words[i])
  }
  if (!toks.length) {
    const n = Math.max(1, was.split(/\s+/).filter(Boolean).length)
    const m = new RegExp(`(?:\\S+\\s+){0,${n - 1}}\\S+$`).exec(b)
    return m ? m[0] : null
  }
  return toks.join('').trim()
}

/** Every `was:` marker of a bullet text with the name it belongs to (`nameBefore`). */
export function wasSpans(text: string): WasSpan[] {
  const out: WasSpan[] = []
  for (const m of text.matchAll(WAS_MARK_RE)) {
    const was = m[1].trim()
    const before = text.slice(0, m.index).replace(/\s+$/, '')
    const name = nameBefore(before, was)
    if (!name) continue
    out.push({ nameStart: before.length - name.length, end: m.index! + m[0].length, name, was })
  }
  return out
}

/** The text with each corrected name put back to the captions' spelling (markers gone) — for comparing with the transcript. */
export function captionsText(text: string): string {
  let out = '', last = 0
  for (const w of wasSpans(text)) { out += text.slice(last, w.nameStart) + w.was; last = w.end }
  return out + text.slice(last)
}

/** Comparable form of a bullet text: markdown escapes undone, whitespace collapsed (the editor may re-escape). */
export const canon = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, '$1').replace(/\s+/g, ' ').trim()

/** `a = b` stays; any `=` touching another `=` is escaped, so it can never open or close a span. */
const escapeEquals = (s: string): string => s.replace(/=(?==)|(?<==)=/g, '\\=')

/**
 * Plain text → Yasin's words: every run of text between images becomes `==…==` (spaces just inside moved out, images
 * left alone — they are not words). Used for the legacy `Yasin:` notes.
 */
export function wrapUser(text: string): string {
  if (hasUserWords(text) && !stripUser(text.replace(IMG_ANY_RE, ' ')).trim()) return text   // already all Yasin's
  const parts: string[] = []
  let last = 0
  const wrap = (seg: string) => {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(seg)!
    parts.push(m[2] ? `${m[1]}==${escapeEquals(m[2])}==${m[3]}` : seg)
  }
  for (const m of text.matchAll(IMG_ANY_RE)) {
    if (m.index! > last) wrap(text.slice(last, m.index))
    parts.push(m[0])
    last = m.index! + m[0].length
  }
  if (last < text.length) wrap(text.slice(last))
  return parts.join('')
}

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

/** Removes `re` matches (each joined by one space) and trims what is left on each side. */
function cut(text: string, start: number, len: number): string {
  const a = text.slice(0, start).replace(/[ \t]+$/, ''), b = text.slice(start + len).replace(/^[ \t]+/, '')
  return a && b && !a.endsWith('\n') && !b.startsWith('\n') ? `${a} ${b}` : a + b
}

/** Tree node → bullet: the paragraph marker and note markers come out of the text (wherever they are). */
function bulletOf(n: TreeNode): Bullet {
  let text = n.text
  let p: number | null = null
  const m = P_MARK_RE.exec(text)
  if (m) { p = Number(m[1]); text = cut(text, m.index, m[0].length) }
  const notes: string[] = []
  for (let k = NOTE_MARK_RE.exec(text); k; k = NOTE_MARK_RE.exec(text)) { notes.push(k[1]); text = cut(text, k.index, k[0].length); NOTE_MARK_RE.lastIndex = 0 }
  let slideTitle: number | undefined, slide: number | undefined
  const st = SLIDE_TITLE_RE.exec(text)
  if (st) { slideTitle = Number(st[1]); text = cut(text, st.index, st[0].length) }
  const sr = p !== null ? SLIDE_REF_RE.exec(text) : null   // a slide marker with no paragraph is the slide image itself
  if (sr) { slide = Number(sr[1]); text = cut(text, sr.index, sr[0].length) }
  const b: Bullet = { text: text.trim(), p, children: n.children.map(bulletOf) }
  if (slideTitle !== undefined) b.slideTitle = slideTitle
  if (slide !== undefined) b.slide = slide
  if (n.marker !== '*') b.marker = n.marker
  if (notes.length) b.notes = notes
  return b
}

/** Markers written after a bullet's text: file form (`<!-- p:N -->`) or the editor's transport (+ t:, o:). */
export type MarkOf = (b: Bullet) => string
/** Extra markers after the paragraph marker, in the file's order: slide-title, slide, notes. */
export const refMarks = (b: Bullet): string[] => [
  b.slideTitle !== undefined ? `<!-- slide-title:${b.slideTitle} -->` : '',
  b.slide !== undefined ? `<!-- slide:${b.slide} -->` : '',
  ...(b.notes ?? []).map((id) => `<!-- note:${id} -->`),
].filter(Boolean)
export const fileMark: MarkOf = (b) => [b.p !== null ? `<!-- p:${b.p} -->` : '', ...refMarks(b)].filter(Boolean).join(' ')

export function bulletLines(b: Bullet, depth: number, mark: MarkOf = fileMark, textOf: (text: string) => string = (t) => t): string[] {
  const pad = INDENT.repeat(depth), m = b.marker ?? '*'
  const lines = textOf(b.text).split('\n')
  const tail = mark(b)
  if (tail) lines[lines.length - 1] = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${tail}` : tail
  const out = [lines[0] ? `${pad}${m} ${lines[0]}` : `${pad}${m}`]
  const cont = pad + ' '.repeat(m.length + 1)
  for (const r of lines.slice(1)) out.push(cont + r)
  for (const c of b.children) out.push(...bulletLines(c, depth + 1, mark, textOf))
  return out
}

/** Empty bullets (no text, no children) are dropped — an editor's trailing empty item is not a note. */
function dropEmpty(bs: Bullet[]): Bullet[] {
  return bs.map((b) => ({ ...b, children: dropEmpty(b.children) })).filter((b) => b.text.trim() !== '' || b.children.length > 0)
}

// ---------- parse ----------

function slideFrom(rest: string, sub: string[]): SlideItem | null {
  const m = SLIDE_MARK_RE.exec(rest)
  if (!m) return null
  const body = rest.slice(0, m.index).trim()
  const img = IMG_RE.exec(body)
  if (!img) return null
  const alt = img[1]
  const tm = /·\s*(\d{1,2}(?::\d{2}){1,2})\s*(?:\|\d+)?$/.exec(alt)   // `|400`: resized in the editor
  return { kind: 'slide', n: Number(m[1]), alt, src: img[2], t: tm ? parseTime(tm[1]) : null, extra: sub }
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

/** A part's block of lines (any base indentation) → its items. */
export function itemsOf(lines: string[]): SectionItem[] {
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
    }
    for (const n of parseTree([g.first, ...g.sub])) items.push({ kind: 'bullet', bullet: bulletOf(n) })
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
      // a top-level line that is not a part: kept verbatim after this part, with its sub-lines
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
  while (doc.head.length && isBlank(doc.head[0])) doc.head.shift()
  while (doc.head.length && isBlank(doc.head[doc.head.length - 1])) doc.head.pop()
  return doc
}

// ---------- serialize ----------

export interface ItemMarks { bullet?: MarkOf; slide?: (it: SlideItem) => string; text?: (text: string) => string }

function itemLines(it: SectionItem, depth: number, marks: ItemMarks): string[] {
  const pad = INDENT.repeat(depth)
  switch (it.kind) {
    case 'bullet': return bulletLines(it.bullet, depth, marks.bullet, marks.text)
    case 'slide': return [`${pad}* ![${it.alt}](${it.src}) ${marks.slide ? marks.slide(it) : `<!-- slide:${it.n} -->`}`, ...it.extra.map((l) => pad + INDENT + l)]
    case 'yasin': {
      const md = it.md.split('\n').filter((l) => !isBlank(l))
      return [`${pad}* Yasin:`, ...md.map((l) => pad + INDENT + l)]
    }
  }
}

/** A part's items as lines at `depth` (1 in the file, 0 for the editor). */
export const partLines = (s: NotesSection, depth = 1, marks: ItemMarks = {}): string[] => s.items.flatMap((it) => itemLines(it, depth, marks))

export function serializeNotes(doc: NotesDoc): string {
  const out: string[] = []
  if (doc.h1 !== null) out.push(`# ${doc.h1}`, '')
  if (doc.head.length) out.push(...doc.head, '')
  for (const s of doc.sections) {
    out.push(`* [${fmtTime(s.t)}](${s.url})${s.title ? ' ' + s.title : ''}`)
    out.push(...partLines(s))
    out.push(...s.after)
  }
  return out.join('\n').replace(/\n+$/, '') + '\n'
}

/** A short signature of a part as stored (the editor sends it back: a save over a part that changed is refused). */
export function partSig(s: NotesSection): string {
  let h = 2166136261
  for (const c of partLines(s).join('\n')) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}

// ---------- queries ----------

export const bulletsOf = (s: NotesSection): Bullet[] => s.items.filter((i): i is BulletItem => i.kind === 'bullet').map((i) => i.bullet)
/** Every bullet of a part, depth first in document order. */
export function flatBullets(bs: Bullet[]): Bullet[] {
  const out: Bullet[] = []
  const walk = (b: Bullet) => { out.push(b); b.children.forEach(walk) }
  bs.forEach(walk)
  return out
}
/** The bullets that carry a paragraph marker (the AI's, reworded or not), document order. */
export const markedOf = (s: NotesSection): Bullet[] => flatBullets(bulletsOf(s)).filter((b) => b.p !== null)
/** @deprecated use bulletsOf */
export const aiOf = bulletsOf

// ---------- the AI's originals (the `.notes-ai.json` sidecar) ----------

/** One part's originals: paragraph → the AI's texts of the bullets with that marker, in document order. */
export type PartOriginals = Record<string, string[]>
export interface Originals { version: 1; parts: Record<string, PartOriginals> }
export const emptyOriginals = (): Originals => ({ version: 1, parts: {} })

/** For a part with no sidecar entry (files made before it): the current marked bullets without `==` are the originals. */
export function originalsFromSection(s: NotesSection): PartOriginals {
  const out: PartOriginals = {}
  for (const b of markedOf(s)) if (!hasUserWords(b.text)) (out[b.p!] ??= []).push(b.text)
  return out
}

/** Adds a sidecar entry for every part that has marked bullets and none yet. → whether anything was added. */
export function ensureOriginals(doc: NotesDoc, orig: Originals): boolean {
  let changed = false
  for (const s of doc.sections) {
    if (orig.parts[String(s.t)] || !markedOf(s).length) continue
    orig.parts[String(s.t)] = originalsFromSection(s)
    changed = true
  }
  return changed
}

export interface Assigned { text: string; p: number; index: number }

/**
 * Each marked bullet → its original (or null). Per paragraph: exact matches first (each original used once), then the
 * remaining bullets take the remaining originals in order (an edited bullet keeps its slot). A split bullet's second
 * half has none left.
 */
export function assignOriginals(bullets: Bullet[], orig: PartOriginals): Map<Bullet, Assigned | null> {
  const out = new Map<Bullet, Assigned | null>()
  const byP = new Map<number, Bullet[]>()
  for (const b of flatBullets(bullets)) if (b.p !== null) { const g = byP.get(b.p) ?? []; g.push(b); byP.set(b.p, g) }
  for (const [p, group] of byP) {
    const pool = orig[String(p)] ?? []
    const used = new Set<number>()
    for (const b of group) {
      const i = pool.findIndex((t, k) => !used.has(k) && canon(t) === canon(b.text))
      if (i >= 0) { used.add(i); out.set(b, { text: pool[i], p, index: i }) }
    }
    for (const b of group) {
      if (out.has(b)) continue
      const i = pool.findIndex((_t, k) => !used.has(k))
      if (i >= 0) { used.add(i); out.set(b, { text: pool[i], p, index: i }) } else out.set(b, null)
    }
  }
  return out
}

/** A marked bullet that is not the AI's as written: reworded, with Yasin's words, with no original, or sent as a note. */
export const isEdited = (b: Bullet, a: Assigned | null | undefined): boolean =>
  b.p !== null && (hasUserWords(b.text) || !a || canon(a.text) !== canon(b.text) || !!b.notes?.length)

/**
 * A part Yasin touched: any bullet of his (no marker), any edited AI bullet, Yasin's words anywhere, a legacy `Yasin:`
 * subtree, or lines under a slide. "Write missing" skips these; "⟳ 🤖" asks first.
 */
export function partTouched(s: NotesSection, orig?: PartOriginals): boolean {
  if (s.items.some((i) => i.kind === 'yasin' || (i.kind === 'slide' && i.extra.length))) return true
  const all = flatBullets(bulletsOf(s))
  if (all.some((b) => b.p === null)) return true
  const assigned = assignOriginals(bulletsOf(s), orig ?? originalsFromSection(s))
  return all.some((b) => isEdited(b, assigned.get(b)))
}

/** Restore original: the bullet's text becomes the AI's again (Yasin's words in it go; children stay). */
export function restoreOriginal(b: Bullet, a: Assigned): void { b.text = a.text }

// ---------- merge (regenerate / refresh / editor saves) ----------

export interface SectionSpec { t: number; title: string; url: string }

export function emptyDoc(h1: string | null): NotesDoc { return { h1, head: [], sections: [] } }

/** Makes sure every computed part exists (title / url refreshed); parts that no longer match are KEPT. */
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

/** The part a time falls in: the last one starting at or before it (else the first). */
export function sectionAt(doc: NotesDoc, t: number): NotesSection | undefined {
  let best: NotesSection | undefined
  for (const s of doc.sections) if (s.t <= t + 0.001) best = s
  return best ?? doc.sections[0]
}

/** Legacy `Yasin:` markdown → Yasin's bullets (`==…==`, no marker). */
export function yasinBullets(md: string): Bullet[] {
  const conv = (n: TreeNode): Bullet => ({ text: wrapUser(n.text), p: null, children: n.children.map(conv) })
  return dropEmpty(parseTree(md.split('\n')).map(conv))
}

/** The legacy `Yasin:` subtree of a part → Yasin's bullets at the end of the part (in place). → the new bullets. */
export function migrateYasin(s: NotesSection): Bullet[] {
  const ys = s.items.filter((i): i is YasinItem => i.kind === 'yasin')
  if (!ys.length) return []
  const bs = ys.flatMap((y) => yasinBullets(y.md))
  s.items = [...s.items.filter((i) => i.kind !== 'yasin'), ...bs.map((b): BulletItem => ({ kind: 'bullet', bullet: b }))]
  return bs
}

/**
 * Item order inside a part: bullets keep their order; a top-level bullet without a marker stays glued to the one
 * before it; a slide goes right before the top-level bullet made from its title, other slides between the top-level
 * bullets by time (before the first that starts after the slide);
 * a legacy `Yasin:` subtree stays last.
 */
export function arrange(s: NotesSection, paraTime: (p: number) => number): void {
  const slides = s.items.filter((i): i is SlideItem => i.kind === 'slide').sort((a, b) => (a.t ?? 0) - (b.t ?? 0) || a.n - b.n)
  const yasin = s.items.filter((i) => i.kind === 'yasin')
  const units: { t: number; items: SectionItem[] }[] = []
  for (const it of s.items) {
    if (it.kind !== 'bullet') continue
    const p = it.bullet.p
    if (p === null && units.length) units[units.length - 1].items.push(it)
    else units.push({ t: p === null ? -Infinity : paraTime(p), items: [it] })
  }
  // a slide whose title heads a top-level bullet goes right before that bullet (picture, then its title + notes)
  const titled = new Map<number, SlideItem>()
  for (const u of units) {
    const st = (u.items[0] as BulletItem).bullet.slideTitle
    const sl = st !== undefined ? slides.find((x) => x.n === st) : undefined
    if (sl && !titled.has(sl.n)) titled.set(sl.n, sl)
  }
  const free = slides.filter((x) => !titled.has(x.n))
  const merged: SectionItem[] = []
  let k = 0
  for (const u of units) {
    while (k < free.length && (free[k].t ?? 0) < u.t) merged.push(free[k++])
    const st = (u.items[0] as BulletItem).bullet.slideTitle
    if (st !== undefined && titled.has(st)) { merged.push(titled.get(st)!); titled.delete(st) }
    merged.push(...u.items)
  }
  while (k < free.length) merged.push(free[k++])
  s.items = [...merged, ...yasin]
}

interface Flat { depth: number; node: Bullet; key: number }

function flatten(bs: Bullet[], depth: number, key: (b: Bullet) => number, out: Flat[] = []): Flat[] {
  for (const b of bs) { out.push({ depth, node: { ...b, children: [] }, key: key(b) }); flatten(b.children, depth + 1, key, out) }
  return out
}

function unflatten(entries: Flat[]): Bullet[] {
  const roots: Bullet[] = []
  const stack: Flat[] = []
  for (const e of entries) {
    while (stack.length && stack[stack.length - 1].depth >= e.depth) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.node.children.push(e.node); else roots.push(e.node)
    stack.push({ ...e, depth: parent ? parent.depth + 1 : 0 })
  }
  return roots
}

/**
 * Writes the AI notes of one part, keeping everything Yasin touched (→ the part's new originals for the sidecar).
 *
 * - A legacy `Yasin:` subtree becomes Yasin's bullets at the end first.
 * - Kept as they are: Yasin's bullets (no marker), and every AI bullet of a paragraph where Yasin edited any bullet
 *   (reworded, `==…==`, no original, sent as a note) — the paragraph is "pinned": the new AI bullets of a pinned
 *   paragraph are not added, so his version is never doubled.
 * - Replaced: the other AI bullets. Kept bullets are re-attached by `p:N`: after the last new bullet with the same
 *   paragraph or the nearest earlier one (Yasin's own bullets: the paragraph of the AI bullet above them — the
 *   previous sibling, else the parent), at their old depth where the tree allows; none earlier → the top of the part.
 * - An untouched part is simply replaced.
 */
export function setAiNotes(doc: NotesDoc, t: number, fresh: Bullet[], paraTime: (p: number) => number, orig?: PartOriginals): PartOriginals {
  const s = findSection(doc, t)
  if (!s) throw new Error(`no part at ${fmtTime(t)}`)
  const old = orig ?? originalsFromSection(s)
  const legacy = new Set(migrateYasin(s))
  const roots = bulletsOf(s)
  const assigned = assignOriginals(roots, old)
  const pinned = new Set<number>()
  for (const b of flatBullets(roots)) if (b.p !== null && isEdited(b, assigned.get(b))) pinned.add(b.p)
  const kept = (b: Bullet) => b.p === null || pinned.has(b.p)

  // what stays: whole subtrees, minus the AI bullets that get replaced (their kept children move up into their place)
  const origOf = new Map<Bullet, Bullet>()
  const keepTree = (b: Bullet): Bullet => {
    const copy: Bullet = { ...b, children: b.children.flatMap((c) => (kept(c) ? [keepTree(c)] : keptInside(c))) }
    origOf.set(copy, b)
    return copy
  }
  const keptInside = (b: Bullet): Bullet[] => b.children.flatMap((c) => (kept(c) ? [keepTree(c)] : keptInside(c)))
  const pieces: { node: Bullet; depth: number; key: number }[] = []
  const walk = (list: Bullet[], depth: number, parentP: number | null) => {
    let prev: number | null = null
    for (const b of list) {
      if (kept(b)) pieces.push({ node: keepTree(b), depth, key: legacy.has(b) ? Infinity : b.p ?? prev ?? parentP ?? -1 })
      else walk(b.children, depth + 1, b.p)
      if (b.p !== null) prev = b.p
    }
  }
  walk(roots, 0, null)

  // the new AI bullets, minus pinned paragraphs (their children move up)
  const freshSet = new Set<Bullet>()
  const prune = (list: Bullet[]): Bullet[] => list.flatMap((b) => {
    if (b.p !== null && pinned.has(b.p)) return prune(b.children)
    const c: Bullet = { ...b, children: prune(b.children) }
    freshSet.add(c)
    return [c]
  })
  const entries = flatten(prune(fresh), 0, (b) => b.p ?? -1)
  for (const e of entries) freshSet.add(e.node)

  for (const pc of pieces) {
    let i = -1
    for (let k = entries.length - 1; k >= 0; k--) if (entries[k].key <= pc.key) { i = k; break }
    // after the target's whole subtree when the piece sits at (or above) the target's level
    while (i >= 0 && i + 1 < entries.length && entries[i + 1].depth > pc.depth) i++
    const prevDepth = i >= 0 ? entries[i].depth : -1
    const nextDepth = entries[i + 1]?.depth ?? 0
    const depth = Math.max(nextDepth, Math.min(pc.depth, prevDepth + 1))
    const sub = flatten([pc.node], depth, () => pc.key)
    // flatten copies nodes: keep the identity map for the originals
    const subOrig = flatBullets([pc.node])
    sub.forEach((e, k) => origOf.set(e.node, origOf.get(subOrig[k]) ?? subOrig[k]))
    entries.splice(i + 1, 0, ...sub)
  }
  const result = unflatten(entries)
  s.items = [...result.map((b): BulletItem => ({ kind: 'bullet', bullet: b })), ...s.items.filter((i) => i.kind === 'slide')]
  arrange(s, paraTime)

  // the part's originals: new bullets → their text; kept ones → the original they had
  const next: PartOriginals = {}
  for (const b of flatBullets(result)) {
    if (b.p === null) continue
    if (freshSet.has(b)) { (next[b.p] ??= []).push(b.text); continue }
    const a = assigned.get(origOf.get(b) ?? b)
    if (a) (next[b.p] ??= []).push(a.text)
  }
  return next
}

/**
 * The editor's markdown of one part → the part (everything in the editor IS the part: AI bullets as Yasin left them,
 * his bullets, slides). Transport fields in the markers (`t:`, `o:`) are dropped; empty bullets are dropped; a legacy
 * `Yasin:` subtree is gone (the editor showed it inline, so it is in the markdown as `==…==` bullets).
 */
export function setPart(doc: NotesDoc, t: number, md: string): NotesSection {
  const s = findSection(doc, t)
  if (!s) throw new Error(`no part at ${fmtTime(t)}`)
  // Milkdown writes an empty item as `* <br />` sometimes; that is an empty bullet
  const lines = md.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '').replace(/^(\s*[*+-])\s+<br\s*\/?>$/, '$1').replace(/^\s*<br\s*\/?>$/, ''))
  const items = itemsOf(lines).filter((i) => i.kind !== 'yasin')
  s.items = items.flatMap((i): SectionItem[] => {
    if (i.kind !== 'bullet') return [i]
    const un = (x: Bullet): Bullet => ({ ...x, text: tidyEscapes(unescapeBlockStart(x.text)), children: x.children.map(un) })
    const [b] = dropEmpty([un(i.bullet)])
    return b ? [{ kind: 'bullet', bullet: b }] : []
  })
  return s
}

export interface SlideSpec { n: number; t: number; src: string; alt?: string }

export const slideAlt = (n: number, t: number): string => `Slide ${n} · ${fmtTime(t)}`

/** Replaces every slide bullet with `slides` (each in the part its time falls in); a slide's extra lines are kept. */
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

// ---------- the editor's markdown of a part ----------

/**
 * A bullet text that starts like a block — `1) ` / `2. ` (the AI numbers its steps), `- `, `+ `, `# `, `> ` — is read
 * by the editor as a nested list / heading / quote. In the editor's markdown it is escaped (`1\) `); `setPart` takes
 * exactly these escapes out again, so the file keeps the AI's text.
 */
export const escapeBlockStart = (text: string): string => text.replace(/^(\d{1,9})([.)])(?=\s)/, '$1\\$2').replace(/^([-+*#>])(?=\s)/, '\\$1')
export const unescapeBlockStart = (text: string): string => text.replace(/^(\d{1,9})\\([.)])(?=\s)/, '$1$2').replace(/^\\([-+*#>])(?=\s)/, '$1')
/**
 * Escapes the editor's serializer adds that the text never needed (measured on the Stanford notes: `Q\&A`, a
 * bullet starting `\= …`): taken out so an edited part keeps the AI's bytes. Every other escape stays.
 */
export const tidyEscapes = (text: string): string => text.replace(/\\&(?![a-zA-Z0-9#]+;)/g, '&').replace(/^\\=(?=\s)/, '=')

export interface EditorPart {
  /** The part as the editor loads it: markers carry `t:` (seconds, for follow-along) and `o:` (index into `orig`). */
  md: string
  /** The originals the `o:` fields point at. */
  orig: { p: number; text: string }[]
}

/**
 * A part → the editor's markdown (depth 0). `timeOf` gives each marked bullet's time; legacy `Yasin:` notes come
 * inline at the end as `==…==` bullets (saved in that form on the next save).
 */
export function editorPart(s0: NotesSection, orig: PartOriginals, timeOf: (b: Bullet) => number | null): EditorPart {
  const s: NotesSection = { ...s0, items: [...s0.items] }
  migrateYasin(s)
  const assigned = assignOriginals(bulletsOf(s), orig)
  const list: { p: number; text: string }[] = []
  const index = new Map<string, number>()
  const oOf = (a: Assigned): number => {
    const key = `${a.p}:${a.index}`
    if (!index.has(key)) { index.set(key, list.length); list.push({ p: a.p, text: a.text }) }
    return index.get(key)!
  }
  const fmtT = (x: number) => String(Math.round(x * 100) / 100)
  const md = partLines(s, 0, {
    text: escapeBlockStart,
    bullet: (b) => {
      if (b.p === null) return fileMark(b)
      const t = timeOf(b), a = assigned.get(b)
      const fields = [`p:${b.p}`, t !== null ? `t:${fmtT(t)}` : '', a ? `o:${oOf(a)}` : ''].filter(Boolean).join(' ')
      return [`<!-- ${fields} -->`, ...refMarks(b)].join(' ')
    },
    slide: (it) => `<!-- slide:${it.n}${it.t !== null ? ` t:${it.t}` : ''} -->`,
  }).join('\n')
  return { md, orig: list }
}

// ---------- format rules (AI bullets) ----------

/** Problems with a bullet text against the notes format: bold, headers, mochi tags. */
export function textProblems(text: string): string[] {
  const out: string[] = []
  if (/\*\*[^*]+\*\*|__[^_]+__/.test(text)) out.push('bold')
  if (/^#{1,6}\s/.test(text.trim())) out.push('header')
  if (/\[\[\s*mochi|#mochi\b/i.test(text)) out.push('mochi tag')
  return out
}

/** Every format problem of a whole notes file's AI bullets (`[]` = clean). Yasin's words are his business. */
export function formatProblems(doc: NotesDoc): string[] {
  const out: string[] = []
  for (const s of doc.sections) for (const b of markedOf(s)) {
    const text = stripUser(b.text)
    for (const p of textProblems(text)) out.push(`${fmtTime(s.t)}: ${p} in "${text.slice(0, 60)}"`)
  }
  return out
}
