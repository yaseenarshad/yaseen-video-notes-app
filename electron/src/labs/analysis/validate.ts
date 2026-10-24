import type { Chunk } from './prompt'
import { groups } from './prompt'
import {
  ANALYSIS_VERSION, CLAIM_TYPES, MOCHI_TYPES, WHY, WINDOW_SECONDS,
  type Claim, type ClaimType, type Highlight, type LabsAnalysis, type MochiCandidate, type MochiType, type PullQuote, type Question,
  type RawOutput, type Span, type TimedSpan, type Why,
} from './schema'
import { endTimeAt, flatOf, norm, normWords, posOf, timeAt, timed, transcriptHash, wordAt, type Words } from './words'

/**
 * Validates and repairs a model answer against the transcript the app has. Nothing the model writes is shown
 * except `label` (≤ 6 words): spans are word numbers into the sidecar, checked against the "first" / "last"
 * anchor words (a span whose numbers are off is moved to where its anchor words really are, within ±40 words),
 * clamped or dropped when out of range; overlaps, lengths, counts and enums are enforced. Every repair is noted.
 */

/** The answer is unusable (not JSON / wrong shape): the caller retries once with this message. */
export class InvalidAnswer extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidAnswer' }
}

/** Finds the JSON object in a model answer (tolerates a code fence or text around it). */
export function parseAnswer(text: string): unknown {
  let t = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t)
  if (fence) t = fence[1].trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new InvalidAnswer('the answer has no JSON object')
  try { return JSON.parse(t.slice(a, b + 1)) } catch (e) {
    throw new InvalidAnswer(`the JSON does not parse: ${e instanceof Error ? e.message : String(e)}`)
  }
}

const isObj = (o: unknown): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o)

/** Checks the top-level shape; missing lists other than highlights become empty (noted). */
export function checkShape(o: unknown, repairs: string[]): RawOutput {
  if (!isObj(o)) throw new InvalidAnswer('the answer is not a JSON object')
  if (!Array.isArray(o.highlights)) throw new InvalidAnswer('"highlights" must be an array')
  const list = (k: string): unknown[] => {
    if (Array.isArray(o[k])) return o[k] as unknown[]
    repairs.push(`"${k}" missing or not a list: treated as empty`)
    return []
  }
  return {
    highlights: o.highlights as RawOutput['highlights'],
    paragraphScores: (typeof o.paragraphScores === 'string' || Array.isArray(o.paragraphScores) ? o.paragraphScores : '') as string,
    pullQuotes: list('pullQuotes') as RawOutput['pullQuotes'],
    questions: list('questions') as RawOutput['questions'],
    claims: list('claims') as RawOutput['claims'],
    mochiCandidates: list('mochiCandidates') as RawOutput['mochiCandidates'],
  }
}

// ---------- spans ----------

const ANCHOR_WINDOW = 40

/**
 * When the transcript words starting at flat `at` read `anchor` (normalized; words that are only punctuation, like
 * a lone "—", are skipped): the flat position of the last matched word, else -1.
 */
function matchAt(w: Words, at: number, anchor: string[]): number {
  if (at < 0) return -1
  let f = at
  for (let k = 0; k < anchor.length; k++) {
    while (f < w.total && norm(wordAt(w, f)) === '') f++
    if (f >= w.total || norm(wordAt(w, f)) !== anchor[k]) return -1
    f++
  }
  return f - 1
}

/** The match of `anchor` whose start (side "start") or end (side "end") is nearest `guess`, within ±ANCHOR_WINDOW words. */
function locate(w: Words, guess: number, anchor: string[], side: 'start' | 'end'): { start: number; end: number } | null {
  if (!anchor.length) return null
  // a match starts at a real word (not a lone "—")
  const at = (s: number) => { if (s < 0 || s >= w.total || norm(wordAt(w, s)) === '') return null; const e = matchAt(w, s, anchor); return e < 0 ? null : { start: s, end: e } }
  // for an end anchor, try starts so that the match ends near `guess`
  const base = side === 'start' ? guess : guess - anchor.length + 1
  for (let d = 0; d <= ANCHOR_WINDOW; d++) {
    const m = at(base - d) ?? (d ? at(base + d) : null)
    if (m) return m
  }
  return null
}

/** Finds anchor words near `guess`: all given words (≤ 4), else the first / last 2 of them. */
function anchorMatch(w: Words, text: unknown, guess: number, side: 'start' | 'end'): { given: boolean; m: { start: number; end: number } | null } {
  const all = typeof text === 'string' ? normWords(text) : []
  if (!all.length) return { given: false, m: null }
  const full = side === 'start' ? all.slice(0, 4) : all.slice(-4)
  const short = side === 'start' ? full.slice(0, 2) : full.slice(-2)
  return { given: true, m: locate(w, guess, full, side) ?? (full.length > 2 ? locate(w, guess, short, side) : null) }
}

export interface SpanCheck { span: Span; verified: boolean }

/**
 * A model span → a span of real transcript words, or null (dropped, with the reason in `repairs`).
 * `first` / `last`: the model's anchor words (only used to check / repair the numbers).
 */
export function fixSpan(w: Words, raw: unknown, first: unknown, last: unknown, what: string, repairs: string[]): SpanCheck | null {
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    repairs.push(`${what}: dropped (span is not [p, w, p, w])`)
    return null
  }
  const [sp, sw, ep, ew] = raw.map((x) => Math.trunc(x as number))
  const n = w.paras.length
  if (sp < 0 || ep < 0 || sp >= n || ep >= n) { repairs.push(`${what}: dropped (paragraph P${sp >= n || sp < 0 ? sp : ep} does not exist)`); return null }
  const clampW = (p: number, j: number, side: string): number => {
    const len = w.paras[p].length
    if (j < 0 || j >= len) { repairs.push(`${what}: ${side} word ${j} of P${p} clamped (P${p} has ${len} words)`); return Math.max(0, Math.min(len - 1, j)) }
    return j
  }
  let a = flatOf(w, sp, clampW(sp, sw, 'start')), b = flatOf(w, ep, clampW(ep, ew, 'end'))
  let verified = true
  const fa = anchorMatch(w, first, a, 'start')
  if (fa.given) {
    if (!fa.m) { verified = false; repairs.push(`${what}: start anchor "${first}" not found near P${sp}:${sw}`) }
    else if (fa.m.start !== a) { repairs.push(`${what}: start moved ${fa.m.start - a > 0 ? '+' : ''}${fa.m.start - a} words to its anchor`); a = fa.m.start }
  }
  const la = anchorMatch(w, last, b, 'end')
  if (la.given) {
    if (!la.m) { verified = false; repairs.push(`${what}: end anchor "${last}" not found near P${ep}:${ew}`) }
    else if (la.m.end !== b) { repairs.push(`${what}: end moved ${la.m.end - b > 0 ? '+' : ''}${la.m.end - b} words to its anchor`); b = la.m.end }
  }
  if (!fa.given && !la.given) verified = false
  if (b < a) { repairs.push(`${what}: dropped (ends before it starts)`); return null }
  const [p0, w0] = posOf(w, a), [p1, w1] = posOf(w, b)
  return { span: { startPara: p0, startWord: w0, endPara: p1, endWord: w1 }, verified }
}

const flatStart = (w: Words, s: Span) => flatOf(w, s.startPara, s.startWord)
const flatEnd = (w: Words, s: Span) => flatOf(w, s.endPara, s.endWord)
const spanWords = (w: Words, s: Span) => flatEnd(w, s) - flatStart(w, s) + 1
const overlaps = (w: Words, x: Span, y: Span) => flatStart(w, x) <= flatEnd(w, y) && flatStart(w, y) <= flatEnd(w, x)
const SENTENCE_END = /[.?!…]["'”’)\]]*$/

/** A label: one line, no quotes, at most 6 words / 60 characters. */
export function cleanLabel(s: unknown, what: string, repairs: string[]): string {
  let t = typeof s === 'string' ? s.replace(/[\r\n\t]+/g, ' ').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim() : ''
  const words = t.split(' ').filter(Boolean)
  if (words.length > 6) { repairs.push(`${what}: label cut to 6 words`); t = words.slice(0, 6).join(' ') }
  if (t.length > 60) t = t.slice(0, 60).trim()
  return t
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], synonyms: Record<string, T>, fallback: T, what: string, repairs: string[]): T {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if ((allowed as readonly string[]).includes(s)) return s as T
  if (synonyms[s]) return synonyms[s]
  repairs.push(`${what}: type "${String(v)}" → ${fallback}`)
  return fallback
}

// ---------- one chunk ----------

export interface ChunkResult {
  highlights: Highlight[]
  scores: Map<number, number>
  pullQuotes: PullQuote[]
  questions: Question[]
  claims: Claim[]
  mochiCandidates: MochiCandidate[]
  unverified: number
}

/** Validates one chunk's answer. Throws InvalidAnswer when it is not usable at all (the caller retries). */
export function validateChunk(w: Words, answer: unknown, chunk: Chunk, repairs: string[]): ChunkResult {
  const raw = checkShape(answer, repairs)
  let unverified = 0
  const span = (s: unknown, f: unknown, l: unknown, what: string): Span | null => {
    const r = fixSpan(w, s, f, l, what, repairs)
    if (r && !r.verified) unverified++
    return r ? r.span : null
  }

  // highlights
  const hs: Highlight[] = []
  raw.highlights.forEach((h, i) => {
    const what = `highlight ${i + 1}`
    if (!isObj(h)) { repairs.push(`${what}: dropped (not an object)`); return }
    const s = span(h.span, h.first, h.last, what)
    if (!s) return
    let t = timed(w, s)
    let d = t.t1 - t.t0
    if (d < 10) { repairs.push(`${what}: dropped (${d.toFixed(0)} s, shorter than 10 s)`); return }
    if (d > 120) {
      // trim to ≤ 120 s, at a sentence end when there is one in the last 40 s
      const a = flatStart(w, s)
      let f = flatEnd(w, s), best = -1
      while (f > a && endTimeAt(w, f) - t.t0 > 120) f--
      for (let g = f; g > a && endTimeAt(w, g) - t.t0 >= 80; g--) if (SENTENCE_END.test(wordAt(w, g))) { best = g; break }
      const end = best >= 0 ? best : f
      const [p1, w1] = posOf(w, end)
      t = timed(w, { ...s, endPara: p1, endWord: w1 })
      repairs.push(`${what}: trimmed from ${d.toFixed(0)} s to ${(t.t1 - t.t0).toFixed(0)} s`)
      d = t.t1 - t.t0
    } else if (d < 20) repairs.push(`${what}: short (${d.toFixed(0)} s), kept`)
    const label = cleanLabel(h.label, what, repairs)
    const why = pickEnum<Why>(h.why, WHY, { stat: 'number', statistic: 'number', story: 'story', anecdote: 'story', quote: 'quote', argument: 'claim' }, 'insight', what, repairs)
    const sc = typeof h.score === 'number' && Number.isFinite(h.score) ? Math.max(1, Math.min(5, Math.round(h.score))) : 3
    hs.push({ ...t, label: label || why, why, score: sc })
  })

  // paragraph scores: a digit string (also accepted: [score, …] or [[para, score], …])
  const scores = new Map<number, number>()
  const count = chunk.last - chunk.first + 1
  const ps = raw.paragraphScores as unknown
  let digits: number[] = []
  if (typeof ps === 'string') digits = [...ps.replace(/[^0-9]/g, '')].map(Number)
  else if (Array.isArray(ps)) {
    if (ps.every((x) => Array.isArray(x) && x.length === 2)) for (const [p, v] of ps as number[][]) { if (p >= chunk.first && p <= chunk.last) scores.set(p, v) }
    else digits = ps.map((x) => Number(x))
  }
  if (digits.length) {
    if (digits.length !== count) repairs.push(`paragraphScores: ${digits.length} digits for ${count} paragraphs (P${chunk.first}–P${chunk.last}); ${digits.length < count ? 'the rest are 1' : 'extra ones ignored'}`)
    digits.slice(0, count).forEach((v, k) => scores.set(chunk.first + k, v))
  }
  for (const [p, v] of scores) scores.set(p, Number.isFinite(v) ? Math.max(0, Math.min(3, Math.round(v))) : 1)

  // pull quotes: grouped by chapter (or ~10-minute window); at most 2 per group
  const g = groups(w, chunk)
  const known = new Set(g.items.map((x) => x.index))
  const groupOfTime = (t: number): number => {
    if (g.kind === 'window') return Math.floor(t / WINDOW_SECONDS)
    let k = -1
    w.chapters.forEach((c, i) => { if (c.start <= t + 0.5) k = i })
    return Math.max(0, k)
  }
  const pq: PullQuote[] = []
  raw.pullQuotes.forEach((q, i) => {
    const what = `pull quote ${i + 1}`
    if (!isObj(q)) return
    const s = span(q.span, q.first, q.last, what)
    if (!s) return
    const n = spanWords(w, s)
    if (n > 90) { repairs.push(`${what}: dropped (${n} words, not a quote)`); return }
    const t = timed(w, s)
    let group = typeof q.chapter === 'number' ? Math.trunc(q.chapter) : -1
    const byTime = groupOfTime(t.t0)
    if (!known.has(group) || (g.kind === 'chapter' && group !== byTime)) { if (group !== byTime) repairs.push(`${what}: group ${group} → ${byTime} (by its time)`); group = byTime }
    if (pq.filter((x) => x.group === group).length >= 2) { repairs.push(`${what}: dropped (already 2 in ${g.kind} ${group})`); return }
    pq.push({ ...t, group, groupKind: g.kind })
  })

  // questions
  const qs: Question[] = []
  raw.questions.forEach((q, i) => {
    const what = `question ${i + 1}`
    if (!isObj(q)) return
    const s = span(q.q, q.qFirst, q.qLast, what)
    if (!s) return
    if (spanWords(w, s) > 120) { repairs.push(`${what}: dropped (longer than 120 words)`); return }
    let answer: TimedSpan | null = null
    if (q.a != null) {
      const a = span(q.a, q.aFirst, q.aLast, `${what} answer`)
      if (a && flatStart(w, a) >= flatStart(w, s)) answer = timed(w, a)
      else if (a) repairs.push(`${what}: answer before the question dropped`)
    }
    qs.push({ question: timed(w, s), answer })
  })

  // claims
  const cs: Claim[] = []
  raw.claims.forEach((c, i) => {
    const what = `claim ${i + 1}`
    if (!isObj(c)) return
    const s = span(c.span, c.first, c.last, what)
    if (!s) return
    if (spanWords(w, s) > 70) { repairs.push(`${what}: dropped (longer than 70 words)`); return }
    const type = pickEnum<ClaimType>(c.type, CLAIM_TYPES, { number: 'stat', statistic: 'stat', stats: 'stat', people: 'person', name: 'person', product: 'company', organization: 'company', org: 'company', bold: 'claim', bold_claim: 'claim' }, 'claim', what, repairs)
    cs.push({ ...timed(w, s), type })
  })

  // flashcard candidates
  const ms: MochiCandidate[] = []
  raw.mochiCandidates.forEach((m, i) => {
    const what = `mochi ${i + 1}`
    if (!isObj(m)) return
    const s = span(m.span, m.first, m.last, what)
    if (!s) return
    if (spanWords(w, s) > 90) { repairs.push(`${what}: dropped (longer than 90 words)`); return }
    const type = pickEnum<MochiType>(m.type, MOCHI_TYPES, { term: 'vocab', word: 'vocab', idea: 'concept', number: 'stat', statistic: 'stat', people: 'person' }, 'concept', what, repairs)
    ms.push({ ...timed(w, s), type, label: cleanLabel(m.label, what, repairs) || type })
  })

  if (raw.highlights.length > 0 && hs.length === 0) throw new InvalidAnswer('none of the highlights point at real transcript words (check the paragraph and word numbers)')
  if (raw.highlights.length >= 4 && hs.length < raw.highlights.length / 2) throw new InvalidAnswer(`only ${hs.length} of ${raw.highlights.length} highlights point at real transcript words`)
  return { highlights: hs, scores, pullQuotes: pq, questions: qs, claims: cs, mochiCandidates: ms, unverified }
}

// ---------- the whole video ----------

export const MAX_HIGHLIGHTS = 20

/** Merges the chunk results: global non-overlap and count for highlights, a score for every paragraph. */
export function finalize(w: Words, parts: ChunkResult[], meta: { createdAt: string; source: string; elapsedMs: number; repairs: string[] }): LabsAnalysis {
  const repairs = [...meta.repairs]
  // highlights: best first, no overlaps, at most 20; then in time order
  const all = parts.flatMap((p) => p.highlights).sort((x, y) => y.score - x.score || x.t0 - y.t0)
  const kept: Highlight[] = []
  for (const h of all) {
    if (kept.some((k) => overlaps(w, k, h))) { repairs.push(`highlight at ${h.t0.toFixed(0)} s dropped (overlaps a better one)`); continue }
    if (kept.length >= MAX_HIGHLIGHTS) { repairs.push(`highlight at ${h.t0.toFixed(0)} s dropped (more than ${MAX_HIGHLIGHTS})`); continue }
    kept.push(h)
  }
  kept.sort((x, y) => x.t0 - y.t0)
  if (kept.length < 10) repairs.push(`only ${kept.length} highlights (10–20 wanted)`)
  const paragraphScores = w.paras.map((_, para) => {
    for (const p of parts) if (p.scores.has(para)) return { para, score: p.scores.get(para)! }
    return { para, score: 1 }
  })
  const missing = w.paras.length - parts.reduce((n, p) => n + p.scores.size, 0)
  if (missing > 0) repairs.push(`${missing} paragraph score(s) missing: set to 1`)
  const dedupe = <T extends Span>(xs: T[]): T[] => {
    const seen = new Set<string>()
    return xs.filter((x) => { const k = `${x.startPara}:${x.startWord}:${x.endPara}:${x.endWord}`; return !seen.has(k) && (seen.add(k), true) })
  }
  const unverified = parts.reduce((n, p) => n + p.unverified, 0)
  if (unverified) repairs.push(`${unverified} span(s) without matching anchor words (kept as numbered)`)
  return {
    version: ANALYSIS_VERSION,
    videoId: w.id,
    title: w.title,
    createdAt: meta.createdAt,
    source: meta.source,
    elapsedMs: meta.elapsedMs,
    chunks: parts.length,
    transcript: { paras: w.paras.length, words: w.total, hash: transcriptHash(w) },
    highlights: kept,
    paragraphScores,
    pullQuotes: parts.flatMap((p) => p.pullQuotes).sort((x, y) => x.t0 - y.t0),
    questions: parts.flatMap((p) => p.questions).sort((x, y) => x.question.t0 - y.question.t0)
      .filter((q, i, a) => i === 0 || flatStart(w, q.question) !== flatStart(w, a[i - 1].question)),
    claims: dedupe(parts.flatMap((p) => p.claims)).sort((x, y) => x.t0 - y.t0),
    mochiCandidates: dedupe(parts.flatMap((p) => p.mochiCandidates)).sort((x, y) => x.t0 - y.t0),
    repairs,
  }
}

/** True when a stored analysis indexes this transcript (same paragraphs, word count and words). */
export const matchesTranscript = (a: LabsAnalysis, w: Words): boolean =>
  a.transcript.paras === w.paras.length && a.transcript.words === w.total && a.transcript.hash === transcriptHash(w)

/** Seconds of a span's first word (for callers that only have a Span). */
export const startTime = (w: Words, s: Span): number => timeAt(w, flatStart(w, s))
