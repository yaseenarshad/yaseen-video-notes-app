import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { atomicWrite } from './atomic'
import { FollowAlongError } from './errors'
import { withFileLock } from './fileLock'
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
 * order and case: `#mochi` = make a Mochi flashcard from this note (no tag = general);
 * `#claimed:<agent>@<ISO UTC minute>` = an agent is working on it (expires after the lease, 30 min by
 * default); `#resolved` = done (no tag = open). Written lowercase, in the order `#mochi #claimed:… #resolved`;
 * a note is never both claimed and resolved (resolving drops the claim). An agent that resolves a note adds
 * `> ↳ resolved by <agent>: what was done` line(s) after the note text and before the quote line (older
 * files have `> ↳ resolved: …`, still read).
 *
 *     > 💬 [19:51](https://www.youtube.com/watch?v=ID&t=1191s) #mochi #claimed:a1@2026-10-23T14:30Z note text
 *     > 💬 [19:51](https://www.youtube.com/watch?v=ID&t=1191s) #mochi #resolved note text
 *     > ↳ resolved by a1: made the Mochi card
 *
 * Every note has an `id`: a short hash of its paragraph index, start time and text (without tags,
 * resolution lines and quote). Tags do not change it (claim → resolve keeps the id); editing the note's
 * text (or moving it) does.
 */
export type NoteCategory = 'general' | 'mochi'

/** `#claimed:<agent>@<at>`: `at` is an ISO UTC time to the minute, e.g. `2026-10-23T14:30Z`. */
export interface Claim { agent: string; at: string }

export interface Note {
  /** Stable short id (see above). */
  id: string
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
  /** The `> ↳ resolved: …` / `> ↳ resolved by a1: …` line(s), without the marker (not part of `text`). */
  resolution: string | null
  /** The `#claimed:…` tag (never on a resolved note). */
  claim: Claim | null
  /** The agent named in the last `> ↳ resolved by <agent>:` line. */
  resolvedBy: string | null
  /** Per resolution line, the agent it names (null for an old `> ↳ resolved:` line); null when no line names one. */
  resolutionBy: (string | null)[] | null
}

/** The note's id: 7 base36 chars of a hash of paragraph + start time + text (+ the duplicate number). */
export function noteId(para: number, time: number | null, text: string, dup = 0): string {
  const h = createHash('sha1').update(`${para}|${time ?? ''}|${text}${dup ? `|${dup}` : ''}`).digest()
  // 36 bits → at most 7 base36 digits
  const n = (BigInt(h.readUInt32BE(0)) << 4n) | BigInt(h[4] >> 4)
  return n.toString(36).padStart(7, '0')
}

export const note = (para: number, time: number | null, text: string, end: number | null = null, quote: string | null = null,
  category: NoteCategory = 'general', resolved = false, resolution: string | null = null, claim: Claim | null = null,
  resolvedBy: string | null = null): Note =>
  ({ id: noteId(para, time, text), para, time, end, text, quote, category, resolved, resolution, claim, resolvedBy, resolutionBy: null })

export interface NoteTags { mochi: boolean; resolved: boolean; claim: Claim | null }

/** Agent names: lowercase letters, digits and dashes, 1–24 chars. */
export const AGENT_RE = /^[a-z0-9-]{1,24}$/
/** One tag at the start of a note's text (any case), with the spaces after it. */
const reTag = /^#(mochi|resolved|claimed:([a-z0-9-]{1,24})@(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z))(?:[ \t]+|$)/i
/** A resolution line's text (after "> "): `↳ resolved: …` or `↳ resolved by a1: …`. */
const reResolution = /^↳\s*resolved(?:\s+by\s+([a-z0-9-]{1,24}))?\s*:\s?(.*)$/i
/** A raw resolution line of the file. */
const reResolutionLine = /^>\s*↳\s*resolved(?:\s+by\s+[a-z0-9-]{1,24})?\s*:/i

/** Splits the tags off the start of a note's first-line text. A claim on a resolved note is ignored. */
export function splitTags(text: string): NoteTags & { text: string } {
  const out: NoteTags & { text: string } = { mochi: false, resolved: false, claim: null, text }
  for (let m = reTag.exec(out.text); m; m = reTag.exec(out.text)) {
    const t = m[1].toLowerCase()
    if (t === 'mochi') out.mochi = true
    else if (t === 'resolved') out.resolved = true
    else out.claim = { agent: m[2].toLowerCase(), at: m[3].toUpperCase() }
    out.text = out.text.slice(m[0].length)
  }
  if (out.resolved) out.claim = null
  return out
}

export const claimTag = (c: Claim): string => `#claimed:${c.agent}@${c.at}`

/** The first-line text with exactly these tags in front, lowercase, `#mochi #claimed:… #resolved` (tags already in `text` are replaced). */
function withTags(tags: NoteTags, text: string): string {
  const body = splitTags(text).text
  const head = [tags.mochi ? '#mochi' : '', tags.claim && !tags.resolved ? claimTag(tags.claim) : '', tags.resolved ? '#resolved' : '']
    .filter(Boolean).join(' ')
  return head === '' ? body : body === '' ? head : head + ' ' + body
}

const tagsOf = (n: Note): NoteTags => ({ mochi: n.category === 'mochi', resolved: n.resolved, claim: n.claim })
const sameTags = (a: NoteTags, b: NoteTags): boolean =>
  a.mochi === b.mochi && a.resolved === b.resolved && (a.claim?.agent ?? '') === (b.claim?.agent ?? '') && (a.claim?.at ?? '') === (b.claim?.at ?? '')

/** The claim time to the minute, as written in the tag: `2026-10-23T14:30Z`. */
export const claimStamp = (now: number = Date.now()): string => new Date(now).toISOString().slice(0, 16) + 'Z'

/** Default claim lease (minutes): an older claim is expired and can be claimed again. */
export const DEFAULT_LEASE_MIN = 30

/** True when the claim is older than the lease (an unreadable time counts as expired). */
export function claimExpired(c: Claim, now: number = Date.now(), leaseMin: number = DEFAULT_LEASE_MIN): boolean {
  const t = Date.parse(c.at)
  return !Number.isFinite(t) || now - t > leaseMin * 60_000
}

/** The note as JSON for the player (Swift's Codable leaves out nil values). */
export function noteJSON(n: Note, now: number = Date.now(), leaseMin: number = DEFAULT_LEASE_MIN): Record<string, unknown> {
  const o: Record<string, unknown> = { id: n.id, para: n.para }
  if (n.time !== null) o.time = n.time
  if (n.end !== null) o.end = n.end
  o.text = n.text
  if (n.quote !== null) o.quote = n.quote
  o.category = n.category
  o.resolved = n.resolved
  if (n.resolution !== null) o.resolution = n.resolution
  if (n.resolvedBy !== null) { o.resolvedBy = n.resolvedBy; o.resolutionBy = n.resolutionBy }
  if (n.claim !== null) o.claim = { agent: n.claim.agent, at: n.claim.at, expired: claimExpired(n.claim, now, leaseMin) }
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

/** A note and its lines [start, end) in the file. */
export interface NoteBlock { start: number; end: number; note: Note }

/** All notes of the file's lines with their line ranges, in file order. */
export function noteBlocks(ls: string[]): NoteBlock[] {
  const out: NoteBlock[] = []
  let p = -1
  let current: NoteBlock | null = null // the note being continued
  const mask = commentMask(ls)
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
      current = { start: i, end: i + 1, note: note(p, time, tg.text, end, null, tg.mochi ? 'mochi' : 'general', tg.resolved, null, tg.claim) }
      out.push(current)
      continue
    }
    if (current !== null && line.startsWith('>')) {
      current.note.text += '\n' + trimWS(line.slice(1))
      current.end = i + 1
      continue
    }
    current = null
  }
  const seen = new Map<string, number>()
  for (const { note: n } of out) {
    let parts = n.text.split('\n')
    // `↳ resolved: …` / `↳ resolved by a1: …` lines (after the first line) are the resolution, not note text.
    const res: string[] = [], by: (string | null)[] = []
    parts = parts.filter((l, i) => {
      const r = i > 0 ? reResolution.exec(l) : null
      if (r) { res.push(r[2] ?? ''); by.push(r[1] ? r[1].toLowerCase() : null); if (r[1]) n.resolvedBy = r[1].toLowerCase() }
      return !r
    })
    if (res.length) { n.resolution = res.join('\n'); n.text = parts.join('\n') }
    if (n.resolvedBy !== null) n.resolutionBy = by
    // The last line of a range note is the highlighted words in curly quotes.
    const q = parts.length >= 2 ? reQuoteLine.exec(parts[parts.length - 1]) : null
    if (q) {
      n.quote = q[1] ?? ''
      parts.pop()
      n.text = parts.join('\n')
    }
    // the id, from the final text; the same note twice (same paragraph, time and text) gets a different one
    const key = `${n.para}|${n.time ?? ''}|${n.text}`
    const dup = seen.get(key) ?? 0
    seen.set(key, dup + 1)
    n.id = noteId(n.para, n.time, n.text, dup)
  }
  return out
}

/** All notes in the markdown, in file order. */
export const parse = (md: string): Note[] => noteBlocks(lines(md)).map((b) => b.note)

/** The note's markdown lines. */
export function block(base: string, time: number, end: number | null, text: string, quote: string | null, category: NoteCategory = 'general'): string[] {
  // tags typed at the start of the text are kept (they would read back that way anyway)
  const body = trimWSNL(text).replaceAll('\r\n', '\n').split('\n')
  let stamp = clock(time)
  // a range within one second (a single word) is written as a single time
  if (end !== null && clock(end) !== stamp) stamp += '–' + clock(end)
  const typed = splitTags(body[0])
  const first = withTags({ mochi: category === 'mochi' || typed.mochi, resolved: typed.resolved, claim: null }, body[0])
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

/**
 * Changes the transcript .md under its lock (`fileLock.ts`): reads it fresh, applies `change`, and when that
 * changed anything writes it atomically (with the current agent guide: the file is written anyway). Every
 * write to a transcript .md goes through here or takes the same lock. Returns the text now in the file.
 */
export function changeFile(path: string, change: (md: string) => string): { before: string; after: string } {
  return withFileLock(path, () => {
    const before = readFileSync(path, 'utf8')
    let after = change(before)
    if (after !== before) {
      after = ensureGuide(after)
      atomicWrite(path, after)
    }
    return { before, after }
  })
}

/** Adds a note to the file (locked, atomic write, so Obsidian never sees a half-written file). */
export function addNote(path: string, para: number, time: number, text: string, end: number | null = null, quote: string | null = null,
  category: NoteCategory = 'general'): Note[] {
  return parse(changeFile(path, (md) => insert(md, para, time, text, end, quote, category)).after)
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
export function find(ls: string[], para: number, index: number): NoteBlock | null {
  return noteBlocks(ls).filter((b) => b.note.para === para)[index] ?? null
}

/** The note with this id, with its line range. */
export function findById(ls: string[], id: string): NoteBlock | null {
  return noteBlocks(ls).find((b) => b.note.id === id) ?? null
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
  const resolved = f.note.resolved || typed.resolved
  const tags = { mochi: category ? category === 'mochi' : f.note.category === 'mochi' || typed.mochi, resolved, claim: resolved ? null : f.note.claim }
  const out = [prefix + withTags(tags, newLines[0]), ...newLines.slice(1).map((l) => (l === '' ? '>' : `> ${l}`))]
  out.push(...ls.slice(f.start + 1, f.end).filter((l) => reResolutionLine.test(l)))
  if (f.note.quote !== null) out.push(`> “${f.note.quote}”`)
  ls.splice(f.start, f.end - f.start, ...out)
  return ls.join('\n')
}

/** The block with only its first line's tags changed (every other byte stays); null when nothing changes. */
function retag(ls: string[], f: NoteBlock, change: Partial<NoteTags>): string[] | null {
  const now = tagsOf(f.note), next = { ...now, ...change }
  if (next.resolved) next.claim = null   // never both claimed and resolved
  if (sameTags(now, next)) return null
  const { prefix, rest } = firstLineParts(ls[f.start])
  const out = ls.slice()
  out[f.start] = prefix + withTags(next, rest)
  return out
}

/** Changes only the tags at the start of a note's first line; every other byte stays. */
function setTags(md: string, para: number, index: number, text: string, time: number | null, change: Partial<NoteTags>): string {
  const ls = lines(md)
  const f = find(ls, para, index)
  if (!f) throw new NoteChanged()
  check(f.note, text, time)
  const out = retag(ls, f, change)
  return out ? out.join('\n') : md
}

/** Sets a note's category (`#mochi` or no tag). */
export const setCategory = (md: string, para: number, index: number, text: string, time: number | null, category: NoteCategory): string =>
  setTags(md, para, index, text, time, { mochi: category === 'mochi' })

/** Marks a note resolved (`#resolved`, which drops a claim) or open again; its resolution lines stay. */
export const setResolved = (md: string, para: number, index: number, text: string, time: number | null, resolved: boolean): string =>
  setTags(md, para, index, text, time, { resolved })

/** Drops the note's `#claimed:…` tag (the app's "Release claim"). */
export const releaseClaimAt = (md: string, para: number, index: number, text: string, time: number | null): string =>
  setTags(md, para, index, text, time, { claim: null })

// ---------- by id (the agent CLI) ----------

/** Sets / drops the claim of the note with this id; null when there is no such note. */
export function setClaimById(md: string, id: string, claim: Claim | null): string | null {
  const ls = lines(md)
  const f = findById(ls, id)
  if (!f) return null
  const out = retag(ls, f, { claim })
  return out ? out.join('\n') : md
}

/**
 * Resolves the note with this id: drops its claim, adds `#resolved` and a line `> ↳ resolved by <agent>: <done>`
 * after its text and resolution lines, before its quote line. Null when there is no such note.
 */
export function resolveById(md: string, id: string, agent: string, done: string): string | null {
  const ls = lines(md)
  const f = findById(ls, id)
  if (!f) return null
  const out = retag(ls, f, { resolved: true, claim: null }) ?? ls.slice()
  const line = `> ↳ resolved by ${agent}: ${trimWS(done.replace(/\s*\r?\n\s*/g, ' '))}`
  const quoteLast = f.note.quote !== null && /^>\s*“.*”\s*$/.test(ls[f.end - 1])
  out.splice(quoteLast ? f.end - 1 : f.end, 0, line)
  return out.join('\n')
}
