import { createHash } from 'node:crypto'
import { MARK_EVERY, paragraphLine, type Chunk } from '../../analysis/prompt'
import type { TimedSpan } from '../../analysis/schema'
import { fixSpan, InvalidAnswer } from '../../analysis/validate'
import { clock, flatOf, posOf, timed, transcriptHash, type Words } from '../../analysis/words'

/**
 * "Ask the video" — the AI engine (main process). The question + the indexed transcript go to `claude -p`; the
 * answer may only be paragraph / word spans (+ anchor words), validated like the analysis (src/labs/analysis/
 * validate.ts `fixSpan`: numbers moved to their anchor words, out-of-range dropped). The page shows only the
 * transcript's own words for those spans, never model text.
 */
export const ASK_SYSTEM = 'You are an extractive search engine over a spoken transcript. You never summarize, paraphrase or invent text: you only point at exact places in the transcript by paragraph and word numbers. You answer with exactly one JSON object and nothing else.'

export const MAX_PASSAGES = 8
export const MAX_PASSAGE_WORDS = 150
export const MIN_PASSAGE_WORDS = 3

export interface AskPassage extends TimedSpan {
  /** 1–5: how directly it answers (from the model; used only for order). */
  score: number
}

/** The prompt for one chunk of the transcript (usually the whole transcript). */
export function askPrompt(w: Words, question: string, c: Chunk, nChunks = 1, index = 0): string {
  const part = nChunks > 1 ? ` This is part ${index + 1} of ${nChunks} of the transcript (paragraphs P${c.first}–P${c.last}); answer for this part only.` : ''
  const lines: string[] = []
  for (let p = c.first; p <= c.last; p++) lines.push(paragraphLine(w, p))
  return `A listener of a long podcast asks where in it something is talked about. Find the places in the transcript that answer it best. Your job is EXTRACTIVE: point at passages; never paraphrase, summarize or invent text.${part}

QUESTION: ${question.replace(/\s+/g, ' ').trim()}

HOW TO POINT AT WORDS
- Paragraphs have ids P0, P1, …; each starts with its time [m:ss]. Words inside a paragraph are numbered from 0; a marker {n} stands right before word n (every ${MARK_EVERY}th word). Count the words after a marker by whitespace; punctuation is part of its word; markers are not words.
- A span is [startPara, startWord, endPara, endWord], inclusive, and may cross paragraphs.
- With every span give "first": its first 3 words and "last": its last 3 words, copied exactly from the transcript (they are only used to check your numbers).

RETURN exactly one JSON object (no prose, no code fence):
{"passages": [{"span": [p, w, p, w], "first": "…", "last": "…", "score": 5}]}

RULES
- Up to ${MAX_PASSAGES} passages, best first. Each is 1–4 whole sentences (about 15–120 words) where a speaker actually talks about the question's topic — the passage itself must be about it, not just mention a word. Start at the start of a sentence, end at the end of one.
- "score": 5 = answers it directly, 3 = clearly related, 1 = only touches it.
- No two passages overlap. If nothing in the transcript is about it, return {"passages": []}.
- Only use paragraph and word numbers that exist. Never put words in "first" / "last" that are not in the transcript.

VIDEO: ${w.title}${w.channel ? ` — ${w.channel}` : ''} (${clock(w.duration)})

TRANSCRIPT:
${lines.join('\n')}
`
}

const isObj = (o: unknown): o is Record<string, unknown> => !!o && typeof o === 'object' && !Array.isArray(o)

/**
 * A parsed model answer → passages of real transcript words (sorted best first, at most MAX_PASSAGES).
 * Throws InvalidAnswer when the shape is wrong (the caller asks once more). Item problems are dropped / repaired
 * and noted in `repairs`: a span whose anchor words are not found is dropped (search results must be exact),
 * spans outside the chunk are dropped, too-long ones are cut to MAX_PASSAGE_WORDS, overlaps keep the better one.
 */
export function validatePassages(w: Words, answer: unknown, repairs: string[], chunk?: Chunk): AskPassage[] {
  const list = Array.isArray(answer) ? answer : isObj(answer) ? answer.passages : undefined
  if (!Array.isArray(list)) throw new InvalidAnswer('the answer has no "passages" list')
  const out: AskPassage[] = []
  list.forEach((raw, i) => {
    const what = `passage ${i}`
    if (!isObj(raw)) { repairs.push(`${what}: dropped (not an object)`); return }
    const fixed = fixSpan(w, raw.span, raw.first, raw.last, what, repairs)
    if (!fixed) return
    if (!fixed.verified) { repairs.push(`${what}: dropped (its anchor words were not found)`); return }
    let s = fixed.span
    if (chunk && (s.startPara < chunk.first || s.endPara > chunk.last)) { repairs.push(`${what}: dropped (outside P${chunk.first}–P${chunk.last})`); return }
    const a = flatOf(w, s.startPara, s.startWord), b = flatOf(w, s.endPara, s.endWord)
    if (b - a + 1 < MIN_PASSAGE_WORDS) { repairs.push(`${what}: dropped (shorter than ${MIN_PASSAGE_WORDS} words)`); return }
    if (b - a + 1 > MAX_PASSAGE_WORDS) {
      const [p, j] = posOf(w, a + MAX_PASSAGE_WORDS - 1)
      s = { ...s, endPara: p, endWord: j }
      repairs.push(`${what}: cut to ${MAX_PASSAGE_WORDS} words`)
    }
    const sc = typeof raw.score === 'number' && Number.isFinite(raw.score) ? Math.max(1, Math.min(5, Math.round(raw.score))) : 3
    out.push({ ...timed(w, s), score: sc })
  })
  // overlaps: the better score (then the earlier in the answer) wins
  const ranked = out.map((p, i) => ({ p, i })).sort((x, y) => y.p.score - x.p.score || x.i - y.i)
  const kept: AskPassage[] = []
  for (const { p, i } of ranked) {
    const a = flatOf(w, p.startPara, p.startWord), b = flatOf(w, p.endPara, p.endWord)
    if (kept.some((k) => a <= flatOf(w, k.endPara, k.endWord) && flatOf(w, k.startPara, k.startWord) <= b)) { repairs.push(`passage ${i}: dropped (overlaps a better one)`); continue }
    kept.push(p)
  }
  return kept.slice(0, MAX_PASSAGES)
}

/** Merges the passages of several chunks: best score first, then by time; at most MAX_PASSAGES. */
export function mergePassages(parts: AskPassage[][]): AskPassage[] {
  return parts.flat().sort((x, y) => y.score - x.score || x.t0 - y.t0).slice(0, MAX_PASSAGES)
}

/** The cache file name of a question (per transcript version; case and spacing of the question ignored). */
export function askCacheName(w: Words, question: string): string {
  const k = createHash('sha1').update(transcriptHash(w) + '\n' + question.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16)
  return `ask-${k}.json`
}

/** True for errors that mean "claude can't be used until someone logs in / installs it". */
export const isLoginError = (msg: string): boolean => /log ?in|logged out|auth|oauth|credential|api key|not found|could not run/i.test(msg)
