import { readFileSync } from 'node:fs'
import { atomicWrite } from './atomic'
import { FollowAlongError } from './errors'
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
 */
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
}

export const note = (para: number, time: number | null, text: string, end: number | null = null, quote: string | null = null): Note =>
  ({ para, time, end, text, quote })

/** The note as JSON for the player (Swift's Codable leaves out nil values). */
export function noteJSON(n: Note): Record<string, unknown> {
  const o: Record<string, unknown> = { para: n.para }
  if (n.time !== null) o.time = n.time
  if (n.end !== null) o.end = n.end
  o.text = n.text
  if (n.quote !== null) o.quote = n.quote
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

export const paragraphCount = (md: string): number => lines(md).filter(isParagraph).length

/** All notes in the markdown, in file order. */
export function parse(md: string): Note[] {
  const notes: Note[] = []
  let p = -1
  let current: number | null = null // index into notes of the note being continued
  for (const line of lines(md)) {
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
      notes.push(note(p, time, text, end))
      current = notes.length - 1
      continue
    }
    if (current !== null && line.startsWith('>')) {
      notes[current].text += '\n' + trimWS(line.slice(1))
      continue
    }
    current = null
  }
  // The last line of a range note is the highlighted words in curly quotes.
  for (const n of notes) {
    const parts = n.text.split('\n')
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
export function block(base: string, time: number, end: number | null, text: string, quote: string | null): string[] {
  const body = trimWSNL(text).replaceAll('\r\n', '\n').split('\n')
  let stamp = clock(time)
  // a range within one second (a single word) is written as a single time
  if (end !== null && clock(end) !== stamp) stamp += '–' + clock(end)
  const out = [`> 💬 [${stamp}](${base}&t=${Math.trunc(Math.max(0, time))}s) ${body[0]}`]
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
export function insert(md: string, paraIndex: number, time: number, text: string, end: number | null = null, quote: string | null = null): string {
  const ls = lines(md)
  let p = -1
  let insertAt: number | null = null
  let base: string | null = null
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i]
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
  ls.splice(insertAt, 0, '', ...block(base, time, end, text, quote))
  return ls.join('\n')
}

/** Adds a note to the file with an atomic write, so Obsidian never sees a half-written file. */
export function addNote(path: string, para: number, time: number, text: string, end: number | null = null, quote: string | null = null): Note[] {
  const md = readFileSync(path, 'utf8')
  const updated = insert(md, para, time, text, end, quote)
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
  while (i < ls.length) {
    const line = ls[i]
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

/** Replaces the note's text; its time / range link and its quote line stay. */
export function editNote(md: string, para: number, index: number, text: string, time: number | null, newText: string): string {
  const ls = lines(md)
  const f = find(ls, para, index)
  if (!f) throw new NoteChanged()
  check(f.note, text, time)
  const first = ls[f.start]
  // The part of the first line before the note text: "> 💬 " plus the [time](link) if any.
  const m = reNote.exec(first)
  if (!m || m[1] === undefined) throw new NoteChanged()
  const bodyText = m[1]
  let prefix = first.slice(0, first.length - bodyText.length)
  const t = reNoteTime.exec(bodyText)
  if (t && t[4] !== undefined) prefix += bodyText.slice(0, bodyText.length - t[4].length)
  const newLines = trimWSNL(newText).replaceAll('\r\n', '\n').split('\n')
  const out = [prefix + newLines[0], ...newLines.slice(1).map((l) => (l === '' ? '>' : `> ${l}`))]
  if (f.note.quote !== null) out.push(`> “${f.note.quote}”`)
  ls.splice(f.start, f.end - f.start, ...out)
  return ls.join('\n')
}
