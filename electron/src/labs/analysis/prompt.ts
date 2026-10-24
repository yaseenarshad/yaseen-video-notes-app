import { WINDOW_SECONDS } from './schema'
import { clock, type Words } from './words'

/**
 * The prompt for `claude -p`. The transcript goes in with stable ids: paragraphs `P<n>` with their start time, and
 * a word-number marker `{n}` before every 10th word of a paragraph (paragraph-local, 0-based), so the model can
 * point at words without a number on every word (half the tokens). It answers with spans of word numbers plus a
 * few anchor words that the validator uses to check and repair the numbers.
 *
 * One call for a whole video when it fits (a 2 h podcast is ~25k words ≈ 35k tokens); longer transcripts are
 * split at chapter boundaries (else at paragraph boundaries) into chunks of ≤ CHUNK_WORDS, merged afterwards.
 */
export const CHUNK_WORDS = 45_000
export const MARK_EVERY = 10

export const SYSTEM_PROMPT = `You are an extractive analyst of spoken transcripts. You never summarize, paraphrase or invent text: you only point at exact places in the transcript by paragraph and word numbers. You answer with exactly one JSON object and nothing else.`

export interface Chunk {
  /** Paragraph range [first, last] (inclusive). */
  first: number
  last: number
  words: number
  /** Highlights to ask for in this chunk (10–20 over the whole video). */
  highlights: number
}

/** Splits the transcript into model calls (usually one). */
export function chunks(w: Words, maxWords = CHUNK_WORDS): Chunk[] {
  const n = w.paras.length
  if (n === 0) return []
  const size = (a: number, b: number) => (b + 1 < n ? w.offsets[b + 1] : w.total) - w.offsets[a]
  const out: Chunk[] = []
  if (w.total <= maxWords) out.push({ first: 0, last: n - 1, words: w.total, highlights: 0 })
  else {
    // cut before a chapter start (any paragraph when there are no chapters) once the chunk would pass maxWords;
    // a chapter longer than that is cut anyway at 1.25 × maxWords
    const cuts = new Set<number>(w.chapters.map((c) => c.para).filter((p) => p > 0 && p < n))
    let a = 0
    for (let p = 1; p < n; p++) {
      const grown = size(a, p)
      if (((cuts.size === 0 || cuts.has(p)) && grown > maxWords) || grown > maxWords * 1.25) {
        out.push({ first: a, last: p - 1, words: size(a, p - 1), highlights: 0 })
        a = p
      }
    }
    out.push({ first: a, last: n - 1, words: size(a, n - 1), highlights: 0 })
  }
  const total = out.reduce((s, c) => s + c.words, 0) || 1
  for (const c of out) c.highlights = Math.max(3, Math.round((out.length === 1 ? 15 : 18) * c.words / total))
  return out
}

/** Pull-quote groups of a chunk: the chapters that start in it, or ~10-minute windows. */
export function groups(w: Words, c: Chunk): { kind: 'chapter' | 'window'; items: { index: number; start: number; para: number; title: string }[] } {
  if (w.chapters.length) {
    const items = w.chapters.map((ch, index) => ({ index, start: ch.start, para: ch.para, title: ch.title }))
      .filter((g, i, all) => {
        const nextPara = i + 1 < all.length ? all[i + 1].para : Infinity
        return g.para <= c.last && nextPara > c.first // overlaps the chunk
      })
    return { kind: 'chapter', items }
  }
  const t0 = w.times[c.first]?.[0] ?? 0, t1 = w.times[c.last]?.[w.times[c.last].length - 1] ?? t0
  const items = []
  for (let k = Math.floor(t0 / WINDOW_SECONDS); k * WINDOW_SECONDS <= t1; k++) {
    let para = c.first
    while (para < c.last && (w.times[para + 1]?.[0] ?? Infinity) <= k * WINDOW_SECONDS) para++
    items.push({ index: k, start: k * WINDOW_SECONDS, para, title: `${clock(k * WINDOW_SECONDS)}–${clock((k + 1) * WINDOW_SECONDS)}` })
  }
  return { kind: 'window', items }
}

/** One paragraph line: `P12 [3:45] (new speaker) {0} So the … {10} next …`. */
export function paragraphLine(w: Words, p: number): string {
  const parts: string[] = [`P${p} [${clock(w.times[p]?.[0] ?? 0)}]${w.turns[p] ? ' (new speaker)' : ''}`]
  w.paras[p].forEach((word, j) => {
    if (j % MARK_EVERY === 0) parts.push(`{${j}}`)
    parts.push(word)
  })
  return parts.join(' ')
}

/** The user prompt for one chunk (sent on stdin). */
export function buildPrompt(w: Words, c: Chunk, nChunks = 1, index = 0): string {
  const g = groups(w, c)
  const count = c.last - c.first + 1
  const part = nChunks > 1 ? ` This is part ${index + 1} of ${nChunks} of the transcript (paragraphs P${c.first}–P${c.last}); answer for this part only.` : ''
  const groupLines = g.items.map((x) => `${g.kind === 'chapter' ? 'C' : 'W'}${x.index} ${clock(x.start)} (starts at P${x.para}) ${x.title}`).join('\n')
  return `Mark up this transcript for a listener who watches long podcasts at 2–3× speed and decides for themselves what matters. They value the speakers' exact words and framing and dislike summaries, so your job is EXTRACTIVE: point at places in the transcript. Never paraphrase or rewrite what was said, never invent a quote.${part}

HOW TO POINT AT WORDS
- Paragraphs have ids P0, P1, …; each starts with its time [m:ss]. Words inside a paragraph are numbered from 0; a marker {n} stands right before word n (every ${MARK_EVERY}th word). Count the words after a marker by whitespace; punctuation is part of its word; markers are not words.
- A span is [startPara, startWord, endPara, endWord], inclusive, and may cross paragraphs.
- With every span give "first": its first 3 words and "last": its last 3 words, copied exactly from the transcript (they are only used to check your numbers).

RETURN exactly one JSON object (no prose, no code fence) of this shape:
{
  "highlights": [{"span": [p, w, p, w], "first": "…", "last": "…", "label": "…", "why": "…", "score": 1}],
  "paragraphScores": "…",
  "pullQuotes": [{"chapter": 0, "span": [p, w, p, w], "first": "…", "last": "…"}],
  "questions": [{"q": [p, w, p, w], "qFirst": "…", "qLast": "…", "a": [p, w, p, w], "aFirst": "…", "aLast": "…"}],
  "claims": [{"type": "…", "span": [p, w, p, w], "first": "…", "last": "…"}],
  "mochiCandidates": [{"type": "…", "label": "…", "span": [p, w, p, w], "first": "…", "last": "…"}]
}

RULES
- highlights: about ${c.highlights} of the moments most worth hearing at 1× speed${nChunks > 1 ? ' in this part' : ' (10–20 for the whole video)'}. Each one 20–120 seconds long (judge by the paragraph times), no two overlapping, starting at the start of a sentence and ending at the end of one. "label": at most 6 words, a neutral pointer to the topic — not a summary of the argument. "why": one of claim | story | number | framing | disagreement | insight | quote. "score": 1–5, 5 = do not miss.
- paragraphScores: a string of exactly ${count} digits, one per paragraph from P${c.first} to P${c.last} in order: how dense with signal it is. 0 = filler, ads, banter, housekeeping · 1 = ordinary · 2 = substantive · 3 = dense / important.
- pullQuotes: for each ${g.kind === 'chapter' ? 'chapter' : '~10-minute window'} listed below, the 1–2 most quotable verbatim sentences (8–60 words each). "chapter" is its number (the n of ${g.kind === 'chapter' ? 'Cn' : 'Wn'}).
- questions: every question the host or interviewer asks (not rhetorical questions inside an answer). "q" = the question as asked; "a" = the first sentence of the answer (omit "a" when there is none).
- claims: specific numbers and statistics (type "stat"), named people ("person"), companies or products ("company"), books ("book"), and bold claims ("claim") — each as the shortest verbatim span that holds it (a name: 1–4 words; a stat or claim: a clause or a sentence). Up to ~${Math.max(15, Math.round(60 * c.words / Math.max(w.total, 1)))}.
- mochiCandidates: up to ~${Math.max(8, Math.round(25 * c.words / Math.max(w.total, 1)))} spans worth a flashcard. "type": vocab (an unusual word or term) | concept | quote | person | book | stat. "label": at most 6 words naming what the card would test.
- Only use paragraph and word numbers that exist. Never put words in "first" / "last" that are not in the transcript.

VIDEO: ${w.title}${w.channel ? ` — ${w.channel}` : ''} (${clock(w.duration)})

${g.kind === 'chapter' ? 'CHAPTERS' : 'WINDOWS (the video has no chapters)'}:
${groupLines || '(none in this part)'}

TRANSCRIPT:
${range(c.first, c.last).map((p) => paragraphLine(w, p)).join('\n')}
`
}

/** The follow-up prompt when an answer was not valid JSON of the right shape. */
export function retryPrompt(original: string, error: string): string {
  return `${original}

YOUR PREVIOUS ANSWER WAS REJECTED: ${error}
Answer again with exactly one JSON object of the shape above and nothing else.`
}

const range = (a: number, b: number): number[] => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)
