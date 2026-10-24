/**
 * The triage digest of one video (main process, plain Node): what a card / the Triage queue / the Feed preview shows
 * to decide in seconds whether a video is worth the time. Everything shown is EXTRACTIVE: quote text is always
 * re-derived from the transcript words (`spanText`), never taken from a model; only highlight labels are AI-written
 * and the UI marks them as such.
 *
 * Used by triage-cards (board cards), triage-queue (New Tab "Triage") and feed-triage (📺 Feed preview). Keep this
 * folder if you keep any of them.
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SIDECAR_FILE } from '../../../core/transcript'
import { loadWords } from '../../analysis/analyze'
import type { LabsAnalysis, PullQuote } from '../../analysis/schema'
import { matchesTranscript } from '../../analysis/validate'
import { spanText, type Words } from '../../analysis/words'
import { analysisPath, readAnalysis } from '../../store'

export interface DigestQuote { text: string; t0: number; t1: number }
export interface Opening { title: string; t: number; text: string; truncated: boolean }

export interface Digest {
  videoId: string
  title: string
  duration: number
  /** A Labs analysis of THIS transcript exists. */
  analyzed: boolean
  highlights: number
  /** Total length of the highlights (seconds). */
  highlightSeconds: number
  /** Share of paragraphs the analysis scored 2–3 (0–100), or null. */
  signalPct: number | null
  /** The best pull quotes, verbatim, best first (all of them; the UI shows the top few). */
  quotes: DigestQuote[]
  /** AI labels of the best highlights (≤ 6 words each — shown marked as AI labels). */
  labels: { label: string; t0: number; score: number }[]
  /** Non-AI fallback: each chapter's (or 10-minute window's) title + its first sentence, verbatim. */
  openings: Opening[]
}

/**
 * The words from (para, word) up to the end of the first sentence, verbatim. A very short first sentence ("All right.")
 * runs on to the next sentence end until at least `minWords`; at most `maxWords` (then `truncated`).
 */
export function firstSentence(w: Words, para: number, word = 0, maxWords = 40, minWords = 8): { text: string; truncated: boolean } {
  const out: string[] = []
  for (let p = para; p < w.paras.length && out.length < maxWords; p++) {
    for (let i = p === para ? word : 0; i < w.paras[p].length; i++) {
      out.push(w.paras[p][i])
      if (out.length >= minWords && /[.?!]["”’)]*$/.test(w.paras[p][i])) return { text: out.join(' '), truncated: false }
      if (out.length >= maxWords) break
    }
  }
  return { text: out.join(' '), truncated: out.length >= maxWords }
}

/** The first word at or after `t` (from paragraph `para`, looking one paragraph further); else word 0 of `para`. */
function wordAtTime(w: Words, para: number, t: number): [number, number] {
  for (let p = para; p < Math.min(w.paras.length, para + 2); p++) {
    const i = (w.times[p] ?? []).findIndex((x) => x >= t - 0.5)
    if (i >= 0) return [p, sentenceStart(w, p, i)]
  }
  return [para, 0]
}

/** A chapter mark often lands mid-sentence: step back (≤ 12 words, same paragraph) to the start of that sentence. */
function sentenceStart(w: Words, p: number, i: number): number {
  for (let k = i; k > 0 && i - k < 12; k--) if (/[.?!]["”’)]*$/.test(w.paras[p][k - 1])) return k
  return i <= 12 ? 0 : i
}

/** Chapter titles + first sentences; without chapters, ~10-minute windows ("10:00–20:00"). */
export function openings(w: Words, windowSeconds = 600): Opening[] {
  const clock = (s: number) => { const x = Math.max(0, Math.trunc(s)); const h = Math.trunc(x / 3600), m = Math.trunc((x % 3600) / 60), r = x % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}` }
  if (!w.paras.length) return []
  const starts = w.paras.map((_, p) => w.times[p]?.[0] ?? 0)
  if (w.chapters.length) {
    return w.chapters.map((c) => {
      const [p, i] = wordAtTime(w, c.para, c.start)
      return { title: c.title, t: c.start, ...firstSentence(w, p, i) }
    })
  }
  const out: Opening[] = []
  const end = w.duration || starts[starts.length - 1]
  for (let k = 0; k * windowSeconds <= end; k++) {
    const p = starts.findIndex((s) => s >= k * windowSeconds)
    if (p < 0) break
    if (out.length && out[out.length - 1].t === starts[p]) continue
    out.push({ title: `${clock(k * windowSeconds)}–${clock((k + 1) * windowSeconds)}`, t: starts[p], ...firstSentence(w, p) })
  }
  return out
}

/** Pull quotes ranked: inside a high-scored highlight first, then by how dense their paragraphs are; ties: earlier. */
export function rankQuotes(a: LabsAnalysis): PullQuote[] {
  const para = new Map(a.paragraphScores.map((s) => [s.para, s.score]))
  const score = (q: PullQuote) => {
    const h = Math.max(0, ...a.highlights.filter((x) => x.t0 < q.t1 && q.t0 < x.t1).map((x) => x.score))
    let sum = 0, n = 0
    for (let p = q.startPara; p <= q.endPara; p++) { sum += para.get(p) ?? 1; n++ }
    return h * 10 + (n ? sum / n : 0)
  }
  return a.pullQuotes.map((q) => ({ q, s: score(q) })).sort((x, y) => y.s - x.s || x.q.t0 - y.q.t0).map((x) => x.q)
}

export function digestOf(w: Words, a: LabsAnalysis | null): Digest {
  const ok = !!a && matchesTranscript(a, w)
  const base = { videoId: w.id, title: w.title, duration: w.duration, openings: openings(w) }
  if (!ok || !a) return { ...base, analyzed: false, highlights: 0, highlightSeconds: 0, signalPct: null, quotes: [], labels: [] }
  const scored = a.paragraphScores.length
  return {
    ...base,
    analyzed: true,
    highlights: a.highlights.length,
    highlightSeconds: Math.round(a.highlights.reduce((s, h) => s + Math.max(0, h.t1 - h.t0), 0)),
    signalPct: scored ? Math.round((100 * a.paragraphScores.filter((s) => s.score >= 2).length) / scored) : null,
    quotes: rankQuotes(a).map((q) => ({ text: spanText(w, q), t0: q.t0, t1: q.t1 })),
    labels: [...a.highlights].sort((x, y) => y.score - x.score || x.t0 - y.t0).slice(0, 5).map((h) => ({ label: h.label, t0: h.t0, score: h.score })),
  }
}

// ---------- cached, by file mtimes (a board asks for many cards at once) ----------

const mtime = (p: string): number => { try { return statSync(p).mtimeMs } catch { return 0 } }
const cache = new Map<string, { key: string; d: Digest }>()

/** The digest of a sidecar file (a video folder's `.follow-along.json`, or a Labs-cache copy). */
export function digestOfSidecar(userData: string, sidecar: string, videoId?: string | null): Digest | null {
  if (!existsSync(sidecar)) return null
  let aKey = 0
  try { aKey = videoId ? mtime(analysisPath(userData, videoId)) : 0 } catch { /* not a video id */ }
  const key = `${mtime(sidecar)}:${aKey}`
  const hit = cache.get(sidecar)
  if (hit && hit.key === key) return hit.d
  const w = loadWords(sidecar)
  let a: LabsAnalysis | null = null
  try { a = readAnalysis(userData, w.id) } catch { /* not a video id */ }
  const d = digestOf(w, a)
  cache.set(sidecar, { key, d })
  return d
}

/** The digest of a video folder (read-only: only its `.follow-along.json` is read). */
export function digestOfFolder(userData: string, folder: string, videoId?: string | null): Digest | null {
  return digestOfSidecar(userData, join(folder, SIDECAR_FILE), videoId)
}
