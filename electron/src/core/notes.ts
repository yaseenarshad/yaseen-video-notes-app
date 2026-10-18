import { readFileSync } from 'node:fs'
import { atomicWrite } from './atomic'
import { FollowAlongError } from './errors'
import { commentMask, ensureGuide } from './guide'
import { clock } from './transcript'
import { splitWS, swiftInt, trimWS, trimWSNL } from './text'

/**
 * A note under a transcript paragraph. In the markdown a note is a block quote that starts with "💬":
 *
 *     > 💬 [29:41](https://www.youtube.com/watch?v=ID&t=1781s) my note
 *
 * A note on a highlighted range has a start–end time and a last line with the highlighted words in
 * curly quotes (all of them up to 15 words; else the first 6, " … ", the last 6):
 *
 *     > 💬 [29:41–29:58](https://www.youtube.com/watch?v=ID&t=1781s) my note
 *     > “exact highlighted words here”
 *
 * Notes typed by hand (`> 💬 text`, no time) belong to the paragraph above.
 *
 * Tags: right after the time link (or right after `> 💬 ` for a note without a time), space-separated, any
 * order and case: `#mochi` = make a Mochi flashcard from this note (no tag = general); `#resolved` = done
 * (no tag = open). Written lowercase, `#mochi` before `#resolved`. An agent that resolves a note may add
 * `> ↳ resolved: what was done` line(s) after the note text and before the quote line.
 *
 *     > 💬 [19:51](https://www.youtube.com/watch?v=ID&t=1191s) #mochi #resolved note text
 *     > ↳ resolved: made the Mochi card
 */
export type NoteCategory = 'general' | 'mochi'

export interface Note {
  /** Index of the paragraph the note is under. */
  para: number
  /** Start time in seconds, if the note has a time link. */
  time: number | null
  /** End time in seconds, for a note on a highlighted range. */
  end: number | null
  text: string
  /** The highlighted words, without the curly quotes. */
  quote: string | null
  /** `mochi` when the text starts with the `#mochi` tag (not part of `text`), else `general`. */
  category: NoteCategory
  /** True with the `#resolved` tag (not part of `text`). */
  resolved: boolean
  /** The `> ↳ resolved: …` line(s), without the marker (not part of `text`). */
  resolution: string | null
}

export const note = (para: number, time: number | null, text: string, end: number | null = null, quote: string | null = null,
  category: NoteCategory = 'general', resolved = false, resolution: string | null = null): Note =>
  ({ para, time, end, text, quote, category, resolved, resolution })

export interface NoteTags { mochi: boolean; resolved: boolean }

/** One tag at the start of a note's text (any case), with the spaces after it. */
const reTag = /^#(mochi|resolved)(?:[ \t]+|$)/i
/** A resolution line's text (after "> "): `↳ resolved: …`. */
const reResolution = /^↳\s*resolved:\s?(.*)$/i
/** A raw resolution line of the file. */
const reResolutionLine = /^>\s*↳\s*resolved:/i

/** Splits the tags off the start of a note's first-line text. */
export function splitTags(text: string): NoteTags & { text: string } {
  const out = { mochi: false, resolved: false, text }
  for (let m = reTag.exec(out.text); m; m = reTag.exec(out.text)) {
    if (m[1].toLowerCase() === 'mochi') out.mochi = true
    else out.resolved = true
    out.text = out.text.slice(m[0].length)
  }
  return out
}

/** The first-line text with exactly these tags in front, lowercase, `#mochi` first (tags already in `text` are replaced). */
function withTags(tags: NoteTags, text: string): string {
  const body = splitTags(text).text
  const head = [tags.mochi ? '#mochi' : '', tags.resolved ? '#resolved' : ''].filter(Boolean).join(' ')
  return head === '' ? body : body === '' ? head : head + ' ' + body
}

const tagsOf = (n: Note): NoteTags => ({ mochi: n.category === 'mochi', resolved: n.resolved })

/** The note as JSON for the player (Swift's Codable leaves out nil values). */
export function noteJSON(n: Note): Record<string, unknown> {
  const o: Record<string, unknown> = { para: n.para }
  if (n.time !== null) o.time = n.time
  if (n.end !== null) o.end = n.end
  o.text = n.text
  if (n.quote !== null) o.quote = n.quote
  o.category = n.category
  o.resolved = n.resolved
  if (n.resolution !== null) o.resolution = n.resolution
  return o
}

const reParagraph = /^\[(\d+(?::\d\d)+)\]\(([^)]*?)&t=(\d+)s\)/
export const reNote = /^>\s*💬\s?(.*)$/u
const reNoteTime = /^\[(\d+(?::\d\d)+)(?:\s*[–-]\s*(\d+(?::\d\d)+))?\]\([^)]*?&t=(\d+)s\)\s*(.*)$/
const reQuoteLine = /^“(.*)”$/
const reHeading = /^#{1,6}\s/

/** "1:02:03" or "2:03" → seconds. */
export function seconds(c: string): number {
  return c.split(':').filter((x) => x.length > 0).reduce((n, p) => n * 60 + (swiftInt(p) ?? 0), 0)
}

export const lines = (md: string): string[] => md.replaceAll('\r\n', '\n').split('\n')

/** True for a markdown heading (a chapter heading like "## 3:36 Title"). */
export const isHeading = (line: string): boolean => reHeading.test(line)

/** True for a paragraph line: `[m:ss](...&t=Ns) ...`. */
export const isParagraph = (line: string): boolean => reParagraph.test(line)

/** Paragraph lines of the file, outside HTML comment blocks (the agent guide has example lines). */
export function paragraphCount(md: string): number {
  const ls = lines(md), mask = commentMask(ls)
  return ls.filter((l, i) => !mask[i] && isParagraph(l)).length
}

/** All notes in the markdown, in file order. */
export function parse(md: string): Note[] {
  const notes: Note[] = []
  let p = -1
  let current: number | null = null // index into notes of the note being continued
  const ls = lines(md), mask = commentMask(ls)
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]
    if (mask[i]) { current = null; continue }   // HTML comments (the agent guide) are never paragraphs or notes
    if (isParagraph(line)) {
      p += 1
      current = null
      continue
    }
    const m = p >= 0 ? reNote.exec(line) : null
    if (m) {
      let text = m[1] ?? ''
      let time: number | null = null, end: number | null = null
      const t = reNoteTime.exec(text)
      if (t) {
        time = swiftInt(t[3])
        if (t[2] !== undefined) end = seconds(t[2])
        text = t[4] ?? ''
      }
      const tg = splitTags(text)
      notes.push(note(p, time, tg.text, end, null, tg.mochi ? 'mochi' : 'general', tg.resolved))
      current = notes.length - 1
      continue
    }
    if (current !== null && line.startsWith('>')) {
      notes[current].text += '\n' + trimWS(line.slice(1))
      continue
    }
    current = null
  }
  for (const n of notes) {
    let parts = n.text.split('\n')
    // `↳ resolved: …` lines (after the first line) are the resolution, not note text.
    const res: string[] = []
    parts = parts.filter((l, i) => {
      const r = i > 0 ? reResolution.exec(l) : null
      if (r) res.push(r[1] ?? '')
      return !r
    })
    if (res.length) { n.resolution = res.join('\n'); n.text = parts.join('\n') }
    // The last line of a range note is the highlighted words in curly quotes.
    const q = parts.length >= 2 ? reQuoteLine.exec(parts[parts.length - 1]) : null
    if (q) {
      n.quote = q[1] ?? ''
      parts.pop()
      n.text = parts.join('\n')
    }
  }
  return notes
}

/** The note's markdown lines. */
export function block(base: string, time: number, end: number | null, text: string, quote: string | null, category: NoteCategory = 'general'): string[] {
  // tags typed at the start of the text are kept (they would read back that way anyway)
  const body = trimWSNL(text).replaceAll('\r\n', '\n').split('\n')
  let stamp = clock(time)
  // a range within one second (a single word) is written as a single time
  if (end !== null && clock(end) !== stamp) stamp += '–' + clock(end)
  const typed = splitTags(body[0])
  const first = withTags({ mochi: category === 'mochi' || typed.mochi, resolved: typed.resolved }, body[0])
  const out = [`> 💬 [${stamp}](${base}&t=${Math.trunc(Math.max(0, time))}s) ${first}`]
  for (const l of body.slice(1)) out.push(l === '' ? '>' : `> ${l}`)
  if (quote !== null) {
    const q = shortQuote(quote)
    if (q !== '') out.push(`> “${q}”`)
  }
  return out
}

/**
 * The quote line's text: the highlighted words in full when there are at most 15, else the first
 * 6 + " … " + the last 6. With the start–end times this still pins the exact span.
 */
export function shortQuote(quote: string): string {
  const words = splitWS(quote)
  if (words.length <= 15) return words.join(' ')
  return words.slice(0, 6).join(' ') + ' … ' + words.slice(-6).join(' ')
}

/** Inserts a note under paragraph `paraIndex`, after its text and any notes it has. */
export function insert(md: string, paraIndex: number, time: number, text: string, end: number | null = null, quote: string | null = null,
  category: NoteCategory = 'general'): string {
  const ls = lines(md), mask = commentMask(ls)
  let p = -1
  let insertAt: number | null = null
  let base: string | null = null
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]
    if (mask[i]) continue
    const m = reParagraph.exec(line)
    if (m) {
      if (p === paraIndex) break // reached the next paragraph
      p += 1
      if (p === paraIndex) {
        base = m[2]
        insertAt = i + 1
      }
    } else if (p === paraIndex && isHeading(line)) {
      break // a chapter heading belongs to the next paragraph
    } else if (p === paraIndex && trimWS(line) !== '') {
      insertAt = i + 1 // after the paragraph text and existing notes
    }
  }
  if (insertAt === null || base === null) throw new FollowAlongError(`Paragraph ${paraIndex} is not in the file.`)
  ls.splice(insertAt, 0, '', ...block(base, time, end, text, quote, category))
  return ls.join('\n')
}

/** Adds a note to the file with an atomic write, so Obsidian never sees a half-written file. */
export function addNote(path: string, para: number, time: number, text: string, end: number | null = null, quote: string | null = null,
  category: NoteCategory = 'general'): Note[] {
  const md = readFileSync(path, 'utf8')
  // the file is written anyway: it gets the current agent guide too (idempotent)
  const updated = ensureGuide(insert(md, para, time, text, end, quote, category))
  atomicWrite(path, updated)
  return parse(updated)
}

// ---------- edit / delete / undo of one note ----------

/** The file no longer has the note the player showed. */
export class NoteChanged extends Error {
  constructor() {
    super('Note changed in the file — try again')
    this.name = 'NoteChanged'
  }
  toString(): string {
    return this.message
  }
}

/** What a delete removed, to put it back. */
export interface Removed {
  /** The removed lines: the blank line before the note (if any), then the note's lines. */
  block: string[]
  /** Line index where the block started. */
  at: number
  /** The line just above the block, to find the spot again if the file moved. */
  anchor: string | null
  para: number
}

/** Line range [start, end) of the `index`-th note under paragraph `para`, and the parsed note. */
export function find(ls: string[], para: number, index: number): { start: number; end: number; note: Note } | null {
  let p = -1, k = -1
  let i = 0
  const mask = commentMask(ls)
  while (i < ls.length) {
    const line = ls[i]
    if (mask[i]) { i += 1; continue }
    if (isParagraph(line)) { p += 1; k = -1; i += 1; continue }
    if (p === para && reNote.test(line)) {
      k += 1
      let j = i + 1
      while (j < ls.length && ls[j].startsWith('>') && !reNote.test(ls[j])) j += 1
      if (k === index) {
        // Parse the block on its own, under a dummy paragraph line.
        const n = parse('[0:00](x&t=0s) p\n' + ls.slice(i, j).join('\n'))[0]
        if (!n) return null
        n.para = para
        return { start: i, end: j, note: n }
      }
      i = j
      continue
    }
    if (p > para) break
    i += 1
  }
  return null
}

function check(n: Note, text: string, time: number | null): void {
  if (n.text !== text || (time !== null && n.time !== time)) throw new NoteChanged()
}

/** Removes the note's block and the blank line before it. */
export function deleteNote(md: string, para: number, index: number, text: string, time: number | null): [string, Removed] {
  const ls = lines(md)
  const f = find(ls, para, index)
  if (!f) throw new NoteChanged()
  check(f.note, text, time)
  let start = f.start
  if (start > 0 && trimWS(ls[start - 1]) === '') start -= 1
  const removed: Removed = { block: ls.slice(start, f.end), at: start, anchor: start > 0 ? ls[start - 1] : null, para }
  ls.splice(start, f.end - start)
  return [ls.join('\n'), removed]
}

/** Puts a deleted block back: at the same line if the line above still matches, else after that anchor line, else under its paragraph. */
export function restoreNote(md: string, r: Removed): string {
  const ls = lines(md)
  let at: number | null = null
  if (r.at <= ls.length && (r.at === 0 || (r.at > 0 && ls[r.at - 1] === r.anchor))) {
    at = r.at
  } else if (r.anchor !== null) {
    const i = ls.indexOf(r.anchor)
    if (i >= 0) at = i + 1
  }
  if (at !== null) {
    ls.splice(at, 0, ...r.block)
    return ls.join('\n')
  }
  // Fallback: after the paragraph's text and notes.
  let k = 0
  while (k < r.block.length && trimWS(r.block[k]) === '') k++
  const noteLines = r.block.slice(k)
  const t = lines(insert(md, r.para, 0, '\u0001'))
  const i = t.findIndex((l) => l.endsWith('\u0001'))
  if (i < 0) throw new NoteChanged()
  t.splice(i, 1, ...noteLines)
  return t.join('\n')
}

/** The note's first line split into "> 💬 " + the [time](link) if any, and the text after it (tag included). */
function firstLineParts(first: string): { prefix: string; rest: string } {
  const m = reNote.exec(first)
  if (!m || m[1] === undefined) throw new NoteChanged()
  const bodyText = m[1]
  let prefix = first.slice(0, first.length - bodyText.length)
  let rest = bodyText
  const t = reNoteTime.exec(bodyText)
  if (t && t[4] !== undefined) { prefix += bodyText.slice(0, bodyText.length - t[4].length); rest = t[4] }
  return { prefix, rest }
}

/**
 * Replaces the note's text; its time / range link, tags, resolution lines and quote line stay. Its
 * category changes only when `category` is given.
 */
export function editNote(md: string, para: number, index: number, text: string, time: number | null, newText: string,
  category?: NoteCategory): string {
  const ls = lines(md)
  const f = find(ls, para, index)
  if (!f) throw new NoteChanged()
  check(f.note, text, time)
  const { prefix } = firstLineParts(ls[f.start])
  const newLines = trimWSNL(newText).replaceAll('\r\n', '\n').split('\n')
  const typed = splitTags(newLines[0])
  const tags = { mochi: category ? category === 'mochi' : f.note.category === 'mochi' || typed.mochi, resolved: f.note.resolved || typed.resolved }
  const out = [prefix + withTags(tags, newLines[0]), ...newLines.slice(1).map((l) => (l === '' ? '>' : `> ${l}`))]
  out.push(...ls.slice(f.start + 1, f.end).filter((l) => reResolutionLine.test(l)))
  if (f.note.quote !== null) out.push(`> “${f.note.quote}”`)
  ls.splice(f.start, f.end - f.start, ...out)
  return ls.join('\n')
}

/** Changes only the tags at the start of a note's first line; every other byte stays. */
function setTags(md: string, para: number, index: number, text: string, time: number | null, change: Partial<NoteTags>): string {
  const ls = lines(md)
  const f = find(ls, para, index)
  if (!f) throw new NoteChanged()
  check(f.note, text, time)
  const now = tagsOf(f.note), next = { ...now, ...change }
  if (now.mochi === next.mochi && now.resolved === next.resolved) return md
  const { prefix, rest } = firstLineParts(ls[f.start])
  ls[f.start] = prefix + withTags(next, rest)
  return ls.join('\n')
}

/** Sets a note's category (`#mochi` or no tag). */
export const setCategory = (md: string, para: number, index: number, text: string, time: number | null, category: NoteCategory): string =>
  setTags(md, para, index, text, time, { mochi: category === 'mochi' })

/** Marks a note resolved (`#resolved`) or open again; its resolution lines stay. */
export const setResolved = (md: string, para: number, index: number, text: string, time: number | null, resolved: boolean): string =>
  setTags(md, para, index, text, time, { resolved })
