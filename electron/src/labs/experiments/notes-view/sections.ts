/**
 * notes-view: the Notes view's sections and the time of each AI bullet (pure; no fs).
 *
 * Sections = the video's chapters (a part before the first chapter becomes "Start"), else ~5-minute windows that
 * start on paragraph boundaries. A bullet's time = the time of the word in its source paragraph where its words
 * best match (the notes keep the speaker's words, so the match is usually exact); bullets of one paragraph never
 * go backwards in time.
 */
import { norm, type Words } from '../../analysis/words'
import { fmtTime, type AiBullet } from './notesFile'

export const WINDOW_SECONDS = 300

export interface ViewSection {
  /** Start (seconds) — the paragraph's start time, floored: the section's key in the notes file. */
  t: number
  /** Start of the next section (or the video's end). */
  end: number
  title: string
  kind: 'chapter' | 'window'
  startPara: number
  endPara: number
}

const paraStart = (w: Words, p: number): number => w.times[p]?.[0] ?? 0

export function computeSections(w: Words, windowSeconds = WINDOW_SECONDS): ViewSection[] {
  const n = w.paras.length
  if (!n) return []
  const dur = w.duration || (w.times[n - 1]?.[w.times[n - 1].length - 1] ?? 0) + 1
  const out: Omit<ViewSection, 'end' | 'endPara'>[] = []
  const chapters = (w.chapters ?? []).filter((c) => c.para >= 0 && c.para < n).sort((a, b) => a.para - b.para)
  if (chapters.length) {
    if (chapters[0].para > 0) out.push({ t: Math.floor(paraStart(w, 0)), title: 'Start', kind: 'chapter', startPara: 0 })
    for (const c of chapters) {
      if (out.length && out[out.length - 1].startPara === c.para) continue   // two chapters on one paragraph: the first wins
      out.push({ t: Math.floor(paraStart(w, c.para)), title: c.title, kind: 'chapter', startPara: c.para })
    }
  } else {
    let start = 0
    for (let p = 0; p < n; p++) {
      if (p === 0 || paraStart(w, p) - paraStart(w, start) >= windowSeconds) {
        start = p
        out.push({ t: Math.floor(paraStart(w, p)), title: '', kind: 'window', startPara: p })
      }
    }
  }
  return out.map((s, i) => {
    const next = out[i + 1]
    const end = next ? next.t : Math.ceil(dur)
    return { ...s, end, endPara: next ? next.startPara - 1 : n - 1, title: s.title || `${fmtTime(s.t)}–${fmtTime(end)}` }
  })
}

/** The section a paragraph belongs to. */
export function sectionOfPara(sections: ViewSection[], p: number): ViewSection | undefined {
  return sections.find((s) => p >= s.startPara && p <= s.endPara)
}

// ---------- bullet → time (anchor word) ----------

/** Words too common to place a bullet. */
const STOP = new Set('the a an and or but of to in on at for is are was were be been it its this that these those so we you they i he she them our your their with as by from not do does did just like um uh yeah okay oh really very'.split(' '))

const tokens = (text: string): string[] =>
  text
    .replace(/<!--.*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[=→←↑↓+:()[\]{}*_`"“”]/g, ' ')
    .split(/\s+/)
    .map(norm)
    .filter((t) => t.length > 1 && !STOP.has(t))

/**
 * The word in paragraph `words` where `text` best matches, at or after `from`: the start of the window (about the
 * bullet's length × 2) holding the most of the bullet's words, earliest on a tie. -1 when nothing matches.
 */
export function anchorWord(text: string, words: string[], from = 0): number {
  const want = tokens(text)
  if (!want.length || !words.length) return -1
  const set = new Set(want)
  const pw = words.map(norm)
  const span = Math.max(6, Math.min(60, want.length * 2))
  let best = -1, bestScore = 0
  for (let i = Math.max(0, from); i < pw.length; i++) {
    if (!set.has(pw[i])) continue
    const seen = new Set<string>()
    for (let j = i; j < Math.min(pw.length, i + span); j++) if (set.has(pw[j])) seen.add(pw[j])
    if (seen.size > bestScore) { bestScore = seen.size; best = i }
  }
  // one shared word out of many is noise
  return bestScore >= Math.min(2, set.size) ? best : -1
}

export interface TimedBullet { bullet: AiBullet; t: number; word: number; depth: number }

/**
 * Every AI bullet of a section (depth first, document order) with its time. Within a paragraph, bullets move
 * forward: each one is searched from the previous bullet's word on; one that does not match takes the previous
 * bullet's place (or the paragraph start).
 */
export function timeBullets(bullets: AiBullet[], w: Words): TimedBullet[] {
  const out: TimedBullet[] = []
  const lastWord = new Map<number, number>()
  const walk = (b: AiBullet, depth: number) => {
    const p = Math.max(0, Math.min(w.paras.length - 1, b.p))
    const from = lastWord.get(p) ?? 0
    const a = anchorWord(b.text, w.paras[p] ?? [], from)
    const word = a >= 0 ? a : from
    lastWord.set(p, word)
    out.push({ bullet: b, t: w.times[p]?.[word] ?? paraStart(w, p), word, depth })
    b.children.forEach((c) => walk(c, depth + 1))
  }
  bullets.forEach((b) => walk(b, 0))
  return out
}
