/**
 * Where a note card is shown in the player transcript (display only; the .md is not involved).
 *
 * The player puts each timed note card right after the word it is about, inside its paragraph:
 * - a range note (`[a–b]` + quote line) after the last covered word, and its words get an underline;
 * - a point note (`[m:ss]` only) after the word spoken at that time, which gets a small marker;
 * - a note with no time stays at the bottom of the paragraph (`anchor` -1).
 *
 * IMPORTANT: `noteAnchor` must stay self-contained (no imports, no module-level helpers): the app
 * serves its source to the player page as `/note-anchor.js` via `Function.prototype.toString`.
 */

export interface AnchorNote {
  /** The paragraph the note is under. */
  para: number
  /** Start time in whole seconds (the time link), if any. */
  time?: number | null
  /** End time in whole seconds, for a note on a highlighted range. */
  end?: number | null
  /** The quote line (exact words, or first 6 + " … " + last 6). */
  quote?: string | null
}

export interface NoteAnchorResult {
  /** Index of the word in `para` the card goes after; -1 = at the bottom of the paragraph. */
  anchor: number
  /** The words a range note covers, as [paragraph, word], in order (may start in an earlier paragraph). */
  cover: [number, number][]
  /** A point note's word in `para` (shown with a small marker); -1 for other notes. */
  mark: number
}

/**
 * @param words the words of every paragraph (`DATA.paras[i].w`)
 * @param times the start time of every word (`DATA.t[i]`)
 */
export function noteAnchor(words: string[][], times: number[][], n: AnchorNote): NoteAnchorResult {
  const para = n.para
  if (n.time == null || !(para >= 0 && para < words.length) || !words[para].length) return { anchor: -1, cover: [], mark: -1 }
  // index of the last value <= x (0 when x is before the first)
  const lastLE = (arr: number[], x: number): number => {
    let lo = 0, hi = arr.length - 1, r = 0
    while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) { r = m; lo = m + 1 } else hi = m - 1 }
    return r
  }
  const tp = times[para]
  const wordAt = (x: number): number => (x < tp[0] ? 0 : lastLE(tp, x))   // clamped to the paragraph
  const time = n.time
  const quote = n.quote ? n.quote.trim() : ''
  if (n.end == null && !quote) { const j = wordAt(time); return { anchor: j, cover: [], mark: j } }

  // ----- a range note: find the covered words -----
  const end = n.end ?? time
  // the words to search: from (a paragraph before) the start time up to the note's paragraph
  const starts = times.map((t) => (t.length ? t[0] : Infinity))
  const lo = Math.max(0, Math.min(para, lastLE(starts, time - 1.01) - 1))
  const fp: number[] = [], fj: number[] = [], ft: number[] = [], fw: string[] = []
  const norm = (w: string): string => String(w).toLowerCase().replace(/[^a-z0-9]/g, '')
  for (let p = lo; p <= para; p++) words[p].forEach((w, j) => { fp.push(p); fj.push(j); ft.push(times[p][j]); fw.push(norm(w)) })
  const span = (a: number, b: number): [number, number][] => { const out: [number, number][] = []; for (let i = a; i <= b; i++) out.push([fp[i], fj[i]]); return out }

  let cover: [number, number][] = []
  if (quote) {
    // "first words … last words" (a long highlight) or the whole highlight. A highlight may start or
    // end inside a word, so the first quote word may be the end of a word and the last one its start.
    const parts = quote.split(/\s+…\s+/)
    const toks = (s: string): string[] => s.split(/\s+/).filter(Boolean).map(norm)
    const head = toks(parts[0])
    const tail = parts.length > 1 ? toks(parts[parts.length - 1]) : null
    const matches = (i: number, q: string[], partialFirst: boolean, partialLast: boolean): boolean =>
      q.length > 0 && i + q.length <= fw.length && q.every((w, k) => {
        const f = fw[i + k]
        if (f === w) return true
        if (k === 0 && partialFirst && w && f.endsWith(w)) return true
        if (k === q.length - 1 && partialLast && w && f.startsWith(w)) return true
        return false
      })
    const first = Math.max(0, lastLE(ft, time - 1.01) - 1)
    search: for (let i = first; i < fw.length && ft[i] < time + 2; i++) {
      if (!matches(i, head, true, !tail)) continue
      if (!tail) { cover = span(i, i + head.length - 1); break }
      const last = n.end != null ? n.end + 2 : time + 600
      for (let j = i + head.length; j < fw.length && ft[j] < last; j++) {
        if (matches(j, tail, false, true)) { cover = span(i, j + tail.length - 1); break search }
      }
    }
  }
  if (!cover.length) {
    // by times: the words from the start second up to the end second
    const out: [number, number][] = []
    for (let i = Math.max(0, lastLE(ft, time - 0.01)); i < ft.length && ft[i] < end + 1; i++) if (ft[i] >= time) out.push([fp[i], fj[i]])
    cover = out
  }
  const inPara = cover.filter(([p]) => p === para)
  const anchor = inPara.length ? inPara[inPara.length - 1][1] : wordAt(end + 0.999)
  return { anchor, cover, mark: -1 }
}
