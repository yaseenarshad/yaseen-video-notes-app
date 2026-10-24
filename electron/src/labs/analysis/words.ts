import { createHash } from 'node:crypto'
import type { Sidecar } from '../../core/transcript'
import type { Span, TimedSpan } from './schema'

/**
 * The transcript as the analysis sees it: the sidecar's words (`paras[p].w`) and times (`t[p][w]`), with flat
 * word numbers across paragraphs. Every quote the app shows is derived here (`spanText`), never taken from a model.
 */
export interface Words {
  id: string
  title: string
  channel: string
  duration: number
  paras: string[][]
  times: number[][]
  turns: boolean[]
  chapters: { start: number; end: number; title: string; para: number }[]
  /** flat index of word 0 of each paragraph */
  offsets: number[]
  total: number
}

export function wordsOf(s: Sidecar): Words {
  const paras = s.paras.map((p) => p.w)
  const offsets: number[] = []
  let n = 0
  for (const p of paras) { offsets.push(n); n += p.length }
  return {
    id: s.id, title: s.title, channel: s.channel, duration: s.duration,
    paras, times: s.t, turns: s.paras.map((p) => p.turn), chapters: (s.chapters ?? []).map((c) => ({ ...c })), offsets, total: n,
  }
}

/** A short hash of the words (stale-analysis check). */
export function transcriptHash(w: Words): string {
  const h = createHash('sha1')
  for (const p of w.paras) h.update(p.join(' ') + '\n')
  return h.digest('hex').slice(0, 16)
}

export const flatOf = (w: Words, para: number, word: number): number => w.offsets[para] + word

/** [para, word] of a flat word number (clamped). */
export function posOf(w: Words, flat: number): [number, number] {
  const f = Math.max(0, Math.min(w.total - 1, flat))
  let lo = 0, hi = w.offsets.length - 1, p = 0
  while (lo <= hi) { const m = (lo + hi) >> 1; if (w.offsets[m] <= f) { p = m; lo = m + 1 } else hi = m - 1 }
  // skip empty paragraphs (offset ties)
  while (p + 1 < w.offsets.length && w.offsets[p + 1] <= f) p++
  return [p, f - w.offsets[p]]
}

export const wordAt = (w: Words, flat: number): string => { const [p, j] = posOf(w, flat); return w.paras[p][j] ?? '' }

/** When a word starts. */
export const timeAt = (w: Words, flat: number): number => { const [p, j] = posOf(w, flat); return w.times[p]?.[j] ?? 0 }

/** When a word ends: the next word's start (capped at +3 s), or +0.6 s for the last word. */
export function endTimeAt(w: Words, flat: number): number {
  const t = timeAt(w, flat)
  if (flat + 1 >= w.total) return Math.min(w.duration || t + 0.6, t + 0.6)
  return Math.min(timeAt(w, flat + 1), t + 3)
}

export function timed(w: Words, s: Span): TimedSpan {
  return { ...s, t0: round2(timeAt(w, flatOf(w, s.startPara, s.startWord))), t1: round2(endTimeAt(w, flatOf(w, s.endPara, s.endWord))) }
}

const round2 = (x: number): number => Math.round(x * 100) / 100

/** The exact transcript words of a span (the only text the app shows for a span). */
export function spanText(w: Words, s: Span): string {
  const a = flatOf(w, s.startPara, s.startWord), b = flatOf(w, s.endPara, s.endWord)
  const out: string[] = []
  for (let f = a; f <= b && f < w.total; f++) out.push(wordAt(w, f))
  return out.join(' ')
}

/** Words lowercased with punctuation removed (anchor matching). */
export const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}']+/gu, '').replace(/^'+|'+$/g, '')
export const normWords = (s: string): string[] => s.split(/\s+/).map(norm).filter((x) => x !== '')

/** "1:02:03" / "2:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds))
  const h = Math.trunc(s / 3600), m = Math.trunc((s % 3600) / 60), x = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}
