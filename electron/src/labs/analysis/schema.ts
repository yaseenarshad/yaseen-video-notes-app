/**
 * The Labs analysis (`labs-analysis.json`, one per video, in Labs' userData — never in the vault).
 *
 * EXTRACTIVE ONLY. Every item points at words of the transcript the app already has (the `.follow-along.json`
 * sidecar: `paras[p].w[w]`). The model never supplies text that is shown: the app derives every quote from the
 * transcript (`spanText` in transcript.ts here). The only model-written text is `label` (≤ 6 words), which the UI
 * must show visibly marked as a label.
 *
 * A span is inclusive: from word `startWord` of paragraph `startPara` to word `endWord` of paragraph `endPara`
 * (paragraph-local word indices, 0-based). `t0` / `t1` are the seconds the first word starts and the last word
 * ends (derived from the sidecar times, not from the model).
 */
export const ANALYSIS_VERSION = 1

export interface Span {
  startPara: number
  startWord: number
  endPara: number
  endWord: number
}

/** A span with its times (seconds, from the transcript). */
export interface TimedSpan extends Span {
  t0: number
  t1: number
}

export const WHY = ['claim', 'story', 'number', 'framing', 'disagreement', 'insight', 'quote'] as const
export type Why = (typeof WHY)[number]

export const CLAIM_TYPES = ['stat', 'person', 'company', 'book', 'claim'] as const
export type ClaimType = (typeof CLAIM_TYPES)[number]

export const MOCHI_TYPES = ['vocab', 'concept', 'quote', 'person', 'book', 'stat'] as const
export type MochiType = (typeof MOCHI_TYPES)[number]

export interface Highlight extends TimedSpan {
  /** AI-written, ≤ 6 words: show it marked as a label, never as a quote. */
  label: string
  why: Why
  /** 1–5 (5 = do not miss). */
  score: number
}

export interface ParagraphScore {
  para: number
  /** 0 filler · 1 ordinary · 2 substantive · 3 dense. */
  score: number
}

export interface PullQuote extends TimedSpan {
  /** The chapter index (sidecar `chapters`), or the ~10-minute window index when the video has no chapters. */
  group: number
  groupKind: 'chapter' | 'window'
}

export interface Question {
  /** The question as asked (verbatim span). */
  question: TimedSpan
  /** Where the answer starts (its first sentence), or null. */
  answer: TimedSpan | null
}

export interface Claim extends TimedSpan {
  type: ClaimType
}

export interface MochiCandidate extends TimedSpan {
  type: MochiType
  /** AI-written, ≤ 6 words (a label, not a quote). */
  label: string
}

export interface LabsAnalysis {
  version: number
  videoId: string
  title: string
  /** ISO time the analysis was made. */
  createdAt: string
  /** "claude -p" (default model) / "claude -p --model X" / "response file". */
  source: string
  /** Wall time of the model call(s), ms. */
  elapsedMs: number
  /** Model calls (chunks) the transcript was split into. */
  chunks: number
  /** What the spans index into; a mismatch with the sidecar means the analysis is stale (ignore it). */
  transcript: { paras: number; words: number; hash: string }
  highlights: Highlight[]
  paragraphScores: ParagraphScore[]
  pullQuotes: PullQuote[]
  questions: Question[]
  claims: Claim[]
  mochiCandidates: MochiCandidate[]
  /** What the validator repaired or dropped (for the inspector / debugging). */
  repairs: string[]
}

/** Windows used for pull quotes when a video has no chapters. */
export const WINDOW_SECONDS = 600

// ---------- the model's raw output (before validation) ----------
// Compact on purpose (output tokens = time): spans as [startPara, startWord, endPara, endWord] plus "first" /
// "last" anchor words, used ONLY to check and repair the numbers (never shown).

export type RawSpan = [number, number, number, number]
export interface RawAnchored { span: RawSpan; first?: string; last?: string }
export interface RawOutput {
  highlights: (RawAnchored & { label: string; why: string; score: number })[]
  /** One digit 0–3 per paragraph of this chunk, in order. */
  paragraphScores: string
  pullQuotes: (RawAnchored & { chapter: number })[]
  questions: { q: RawSpan; qFirst?: string; qLast?: string; a?: RawSpan | null; aFirst?: string; aLast?: string }[]
  claims: (RawAnchored & { type: string })[]
  mochiCandidates: (RawAnchored & { type: string; label: string })[]
}
