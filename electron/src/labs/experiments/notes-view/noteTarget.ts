/**
 * notes-view: a bullet of the Notes view → a 💬 transcript note (pure; bundled into the view and unit-tested).
 *
 * - Where: the transcript paragraph of the bullet's `p:N` (for Yasin's own bullet, the nearest bullet above that has
 *   one — the caller finds it). Time = that paragraph's start.
 * - With a text selection inside the bullet whose words are found in that paragraph (in order, punctuation and case
 *   ignored; a cut-off first / last word may be left out): the note covers those words — start / end time and the
 *   paragraph's exact words as the quote, like the transcript's own composer. Not found → no quote, paragraph start.
 * - Text: the bullet's text without a `/mochi` / `/note` command, the `==` marks, markers and markdown syntax.
 */

export interface ParaWords { words: string[]; times: number[] }

export interface NoteTarget {
  para: number
  /** Start (seconds). */
  time: number
  /** End of the quoted words (null: no quote). */
  end: number | null
  quote: string | null
  /** The quoted words as [para, word] (the transcript composer tints them while it is open). */
  words: [number, number][]
}

/** Same as analysis/words.ts `norm` (copied: this file is bundled into the page). */
export const normWord = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}']+/gu, '').replace(/^'+|'+$/g, '')
const tokens = (s: string): string[] => s.split(/\s+/).map(normWord).filter((x) => x !== '')

/** Where `want` occurs as consecutive words in `words` (normalized), or -1. */
function findRun(words: string[], want: string[]): number {
  if (!want.length) return -1
  const ws = words.map(normWord)
  outer: for (let i = 0; i + want.length <= ws.length; i++) {
    for (let k = 0; k < want.length; k++) if (ws[i + k] !== want[k]) continue outer
    return i
  }
  return -1
}

export function noteTarget(paras: ParaWords[], p: number, selection?: string | null): NoteTarget {
  const para = Math.max(0, Math.min(paras.length - 1, Math.floor(p)))
  const P = paras[para] ?? { words: [], times: [0] }
  const start = P.times[0] ?? 0
  const none: NoteTarget = { para, time: start, end: null, quote: null, words: [] }
  const want = tokens(selection ?? '')
  if (!want.length) return none
  // the whole selection, else without a cut-off first and / or last word
  const tries: [number, number][] = [[0, want.length]]
  if (want.length >= 3) tries.push([1, want.length], [0, want.length - 1], [1, want.length - 1])
  for (const [a, b] of tries) {
    const w = want.slice(a, b)
    const i = findRun(P.words, w)
    if (i < 0) continue
    const j = i + w.length - 1
    return {
      para, time: P.times[i] ?? start, end: P.times[j] ?? start,
      quote: P.words.slice(i, j + 1).join(' '),
      words: Array.from({ length: w.length }, (_x, k): [number, number] => [para, i + k]),
    }
  }
  return none
}

/** The slash commands that send a bullet as a note. */
export const SLASH_COMMANDS = [
  { key: 'mochi', category: 'mochi' as const, label: '🃏 Mochi note: send this bullet' },
  { key: 'note', category: 'general' as const, label: '💬 Note: send this bullet' },
]

/** A bullet's text (markdown or plain) → a note's text. */
export function noteText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|\s)\/(?:mochi|note)\b/gi, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(?<!\\)==/g, '')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
