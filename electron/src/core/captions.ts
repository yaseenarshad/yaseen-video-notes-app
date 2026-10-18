import { splitWS, swiftDouble, trimWS } from './text'

/** One spoken word from the captions, with the time it starts. */
export interface CaptionWord {
  text: string
  time: number
  /** True when a `>>` speaker-change marker came right before this word. */
  newTurn: boolean
}

export const word = (text: string, time: number, newTurn = false): CaptionWord => ({ text, time, newTurn })

interface Cue {
  start: number
  end: number
  lines: string[]
}

const timingTagG = /<(\d{1,2}:\d\d:\d\d\.\d+)>/g
const timingTag = /<(\d{1,2}:\d\d:\d\d\.\d+)>/
const anyTagG = /<[^>]*>/g

/**
 * Parses WebVTT captions as YouTube writes them.
 *
 * Auto-captions ("rolling" format) have word-level timing tags: `Last<00:00:00.880><c> night</c>...`.
 * Every cue repeats the previous line on top, and a 10 ms "settle" cue repeats the line once more.
 * Only the new text of each cue is kept, so every word appears exactly once.
 *
 * Manual captions have no word tags; the cue's time is spread across its words.
 */
export function parseVTT(vtt: string): CaptionWord[] {
  const cues = parseCues(vtt)
  const rolling = vtt.includes('<c>') || timingTag.test(vtt)
  const out: CaptionWord[] = []
  let pendingTurn = false
  let lastLine = ''

  const emit = (token: string, time: number) => {
    let tok = token
    while (tok.startsWith('>>')) {
      pendingTurn = true
      tok = tok.slice(2)
    }
    if (tok.length === 0) return
    out.push({ text: tok, time, newTurn: pendingTurn })
    pendingTurn = false
  }

  for (const cue of cues) {
    let lines = cue.lines.filter((l) => plain(l).length > 0)
    if (lines.length === 0) continue
    if (rolling) {
      const tagged = lines.some(hasTimingTags)
      // 10 ms settle cue: repeats text already emitted.
      if (!tagged && cue.end - cue.start < 0.05) continue
      // The first line of a rolling cue carries over the previous line.
      if (lines.length >= 2 && !hasTimingTags(lines[0]) && plain(lines[0]) === lastLine) lines = lines.slice(1)
      for (const line of lines) {
        if (hasTimingTags(line)) {
          for (const [w, t] of taggedWords(line, cue.start)) emit(w, t)
        } else {
          const words = plain(line).split(' ').filter((x) => x.length > 0)
          for (const [w, t] of spread(words, cue)) emit(w, t)
        }
        lastLine = plain(line)
      }
    } else {
      const words = lines.flatMap((l) => plain(l).split(' ').filter((x) => x.length > 0))
      for (const [w, t] of spread(words, cue)) emit(w, t)
    }
  }
  return out
}

/** Spreads a cue's time evenly across its words. */
export function spread(words: string[], cue: Cue): [string, number][] {
  // Count real words only, so ">>" markers do not take a time slot.
  const n = Math.max(1, words.filter((w) => w !== '>>').length)
  const step = Math.max(0, cue.end - cue.start) / n
  let i = 0
  return words.map((w) => {
    const t = cue.start + i * step
    if (w !== '>>') i += 1
    return [w, t] as [string, number]
  })
}

export function parseCues(vtt: string): Cue[] {
  const text = vtt.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const cues: Cue[] = []
  let current: Cue | null = null
  for (const line of text.split('\n')) {
    if (line.includes('-->')) {
      if (current) cues.push(current)
      const parts = line.split('-->')
      const start = parseTime(parts[0]) ?? 0
      const endField = parts.length > 1 ? (trimWS(parts[1]).split(' ').filter((x) => x)[0] ?? '') : ''
      current = { start, end: parseTime(endField) ?? start, lines: [] }
    } else if (line.length === 0) {
      if (current) cues.push(current)
      current = null
    } else if (current) {
      current.lines.push(line)
    }
  }
  if (current) cues.push(current)
  return cues
}

/** "00:01:02.500", "01:02.500" or "1:02:03,250" → seconds. */
export function parseTime(s: string): number | null {
  const t = trimWS(s).replaceAll(',', '.')
  const parts = t.split(':').filter((p) => p.length > 0)
  if (parts.length < 2 || parts.length > 3) return null
  let total = 0
  for (const p of parts) {
    const v = swiftDouble(p)
    if (v === null) return null
    total = total * 60 + v
  }
  return total
}

export function hasTimingTags(line: string): boolean {
  return line.includes('<c>') || timingTag.test(line)
}

/** Words of a line with `<hh:mm:ss.mmm>` tags. The first word starts at the cue start. */
export function taggedWords(line: string, start: number): [string, number][] {
  const out: [string, number][] = []
  let t = start
  let pos = 0
  const addText = (s: string) => {
    for (const w of splitWS(decode(strip(s)))) out.push([w, t])
  }
  for (const m of line.matchAll(timingTagG)) {
    addText(line.slice(pos, m.index))
    t = parseTime(m[1]) ?? t
    pos = m.index! + m[0].length
  }
  addText(line.slice(pos))
  return out
}

export const strip = (s: string): string => s.replace(anyTagG, '')

/** Text of a caption line without tags or entities, with single spaces. */
export const plain = (line: string): string => splitWS(decode(strip(line))).join(' ')

export function decode(s: string): string {
  if (!s.includes('&')) return s
  let r = s
  for (const [k, v] of [['&gt;', '>'], ['&lt;', '<'], ['&quot;', '"'], ['&#39;', "'"], ['&apos;', "'"],
    ['&nbsp;', ' '], ['&lrm;', ''], ['&rlm;', '']] as const) {
    r = r.split(k).join(v)
  }
  r = r.replace(/&#(x?)([0-9a-fA-F]+);/g, (all, x: string, digits: string) => {
    const hex = x === 'x'
    if (!hex && !/^\d+$/.test(digits)) return all
    const code = parseInt(digits, hex ? 16 : 10)
    if (!Number.isFinite(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return all
    return String.fromCodePoint(code)
  })
  return r.split('&amp;').join('&')
}
