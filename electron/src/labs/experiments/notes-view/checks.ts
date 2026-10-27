/**
 * notes-view: the "nothing lost" checks of a part's notes (code, not AI; pure). Shown as a small ⚠ list per part; they
 * never block saving. From notes-format.md "Video notes: outline, cleanup, punch":
 *
 * - coverage: every transcript paragraph with real content (not filler-only like "Yeah." / "[applause]") is cited by
 *   some bullet's `p:N`.
 * - numbers and names: every number (`84%`, `2.36`, `$5`, `1,000`) and every capitalised multi-word name or proper
 *   noun of the part's paragraphs appears in the part's notes (case-insensitive). A spelling fix is fine when the
 *   notes use a spelling from the sources (slides, video title, chapter titles, YouTube description) close to it.
 * - format: no bold, no headers, no mochi tags (in the AI's text; Yasin's words are his).
 * - "cut, don't rewrite" (soft): the share of a bullet's content words found in its source paragraph (± the
 *   neighbours: one sentence can span a paragraph break) or its slide's text. Under 70 % → "may be reworded".
 */
import { flatBullets, stripUser, textProblems, type Bullet } from './notesFile'
import { normWord } from './noteTarget'

export interface CheckPara { words: string[]; times: number[] }
export interface CheckInput {
  paras: CheckPara[]
  startPara: number
  endPara: number
  /** The part's bullets (as in the file). */
  bullets: Bullet[]
  /** Slide texts by slide number (OCR), for "cut, don't rewrite" of slide bullets and spelling sources. */
  slideText?: Record<number, string>
  /** Other spelling sources: video title, chapter titles, description. */
  sources?: string[]
}

export interface PartChecks {
  /** Paragraphs with real content that no bullet cites. */
  uncovered: { p: number; t: number }[]
  /** Numbers / names of the paragraphs missing from the notes. */
  missing: string[]
  format: string[]
  reworded: { text: string; share: number; p: number }[]
  /** Paragraphs with real content in the part (the coverage denominator). */
  contentParas: number
}

const FILLER = new Set(('yeah yes yep yup no nope okay ok um uh uhm hmm mhm mm oh ah wow right so well cool sure great nice totally exactly ' +
  'absolutely true interesting thanks thank you got it and but like i mean know laughter applause music laughs crosstalk inaudible').split(' '))

/** A paragraph that is only filler ("Yeah.", "[applause]", "Okay, so.") — under 4 words with at most one real one. */
export function isFillerOnly(words: string[]): boolean {
  const ws = words.filter((w) => !/^\[.*\]$/.test(w)).map(normWord).filter(Boolean)
  const real = ws.filter((w) => !FILLER.has(w))
  return real.length === 0 || (ws.length < 4 && real.length <= 1)
}

// ---------- numbers and names ----------

const NUM_RE = /(?<![\w.])\$?\d[\d,]*(?:\.\d+)?%?(?![\w])/g
/** A number as the notes may write it: digits only, thousands commas dropped ("1,000" = "1000"); `$` / `%` optional. */
const numCore = (n: string): string => n.replace(/[$%,]/g, '').replace(/\.$/, '')

const NOT_NAMES = new Set(('I I\'m I\'ve I\'ll I\'d OK Okay Yeah Yes No So And But Or If When Then Now Well Oh Um Uh Like The A An This That These Those ' +
  'It It\'s We We\'re You You\'re They They\'re He She My Our Your Their What Why How Where Who Which There Here Just Also Right Sure Thanks ' +
  'Monday Tuesday Wednesday Thursday Friday Saturday Sunday').split(' '))
const capital = (w: string): boolean => /^[A-Z][\p{L}\p{N}'’.&-]*$/u.test(w.replace(/[,.;:!?)"”]+$/, '').replace(/^["“(]+/, ''))
const clean = (w: string): string => w.replace(/[,.;:!?)"”]+$/, '').replace(/^["“(]+/, '').replace(/['’]s$/, '')

/**
 * Names in a paragraph's words: runs of 2+ capitalised words ("Jeff Holden", "Atomic Machines"), and single
 * capitalised words that do not start a sentence (proper nouns: "Tesla", "Firecracker"); common sentence words and
 * "I" are not names.
 */
export function namesIn(words: string[]): string[] {
  const out: string[] = []
  let run: string[] = []
  const flush = () => {
    const r = run.filter((w) => !NOT_NAMES.has(w))
    if (r.length >= 2) out.push(r.join(' '))
    else if (r.length === 1 && run.length === 1 && !runStartsSentence) out.push(r[0])
    run = []
  }
  let runStartsSentence = false
  words.forEach((raw, i) => {
    const w = clean(raw)
    if (capital(raw) && w.length > 1) {
      if (!run.length) runStartsSentence = i === 0 || /[.!?]["”)]?$/.test(words[i - 1])
      run.push(w)
      if (/[,.;:!?]$/.test(raw)) flush()
    } else flush()
  })
  flush()
  return out
}

export function numbersIn(words: string[]): string[] {
  return [...words.join(' ').matchAll(NUM_RE)].map((m) => m[0].replace(/[.,]$/, ''))
}

const lev = (a: string, b: string): number => {
  if (Math.abs(a.length - b.length) > 4) return 99
  const d = Array.from({ length: a.length + 1 }, (_x, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

const letters = (x: string): string => x.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * Whether `name` is in the notes, or a source spelling close to it is (a fixed spelling): a run of 1 to n+1 source
 * words whose letters are within ~40 % edits of the name's letters ("Grokbot" ~ "Grok Bot", "X-P Prize" ~ "XPRIZE",
 * "Anushia" ~ "Anousheh"), and the notes use that spelling. Letters only, so spaces / hyphens never matter.
 */
function nameFound(name: string, notesLow: string, notesLetters: string, sources: string[]): boolean {
  const low = name.toLowerCase(), want = letters(name)
  if (notesLow.includes(low) || (want.length >= 4 && notesLetters.includes(want))) return true
  const n = low.split(' ').length
  const tol = Math.max(2, Math.ceil(want.length * 0.4))
  for (const src of sources) {
    const ws = src.split(/\s+/).map(clean).filter(Boolean)
    for (let k = 1; k <= n + 1; k++) {
      for (let i = 0; i + k <= ws.length; i++) {
        const cand = letters(ws.slice(i, i + k).join(''))
        if (cand.length < 3 || cand === want) continue
        if (lev(cand, want) <= tol && notesLetters.includes(cand)) return true
      }
    }
  }
  return false
}

// ---------- "cut, don't rewrite" ----------

const STOP = new Set('the a an and or but of to in on at for is are was were be been it its this that these those so we you they i he she them our your their with as by from not do does did just like um uh yeah okay oh really very can will would could should have has had there here what which who how when where why then than if about into out up down over more most some any all also because get got going go one'.split(' '))
const contentWords = (text: string): string[] =>
  text.replace(/<!--.*?-->/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\(slide\)/gi, ' ').replace(/[=→←+:()[\]{}*_`"“”]/g, ' ')
    .split(/\s+/).map(normWord).filter((w) => w.length > 2 && !STOP.has(w))

/** Share of the bullet's content words found in `source` (1 when it has fewer than 3 content words). */
export function sourceShare(text: string, source: string[]): number {
  const want = contentWords(text)
  if (want.length < 3) return 1
  const have = new Set(source.map(normWord))
  const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '')
  const stems = new Set([...have].map(stem))
  return want.filter((w) => have.has(w) || stems.has(stem(w))).length / want.length
}

// ---------- all four ----------

export function checkPart(o: CheckInput): PartChecks {
  const all = flatBullets(o.bullets)
  const marked = all.filter((b) => b.p !== null)
  const cited = new Set(marked.map((b) => b.p!))
  const uncovered: { p: number; t: number }[] = []
  let contentParas = 0
  for (let p = o.startPara; p <= o.endPara; p++) {
    const words = o.paras[p]?.words ?? []
    if (isFillerOnly(words)) continue
    contentParas++
    if (!cited.has(p)) uncovered.push({ p, t: o.paras[p]?.times[0] ?? 0 })
  }

  const notesLow = all.map((b) => b.text).join('\n').toLowerCase()
  const notesLetters = letters(notesLow)
  const notesNums = new Set([...notesLow.matchAll(NUM_RE)].map((m) => numCore(m[0])))
  const sources = [...(o.sources ?? []), ...Object.values(o.slideText ?? {})]
  const missing: string[] = []
  const seen = new Set<string>()
  for (let p = o.startPara; p <= o.endPara; p++) {
    const words = o.paras[p]?.words ?? []
    for (const n of numbersIn(words)) {
      const k = numCore(n)
      if (seen.has(k)) continue
      seen.add(k)
      if (!notesNums.has(k)) missing.push(n)
    }
    for (const name of namesIn(words)) {
      const k = name.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      if (!nameFound(name, notesLow, notesLetters, sources)) missing.push(name)
    }
  }

  const format: string[] = []
  for (const b of marked) for (const prob of textProblems(stripUser(b.text))) format.push(`${prob}: "${b.text.slice(0, 60)}"`)

  const reworded: { text: string; share: number; p: number }[] = []
  for (const b of marked) {
    const src = [...(o.paras[b.p! - 1]?.words ?? []), ...(o.paras[b.p!]?.words ?? []), ...(o.paras[b.p! + 1]?.words ?? [])]
    const slide = b.slide ?? b.slideTitle
    if (slide !== undefined && o.slideText?.[slide]) src.push(...o.slideText[slide].split(/\s+/))
    const share = sourceShare(stripUser(b.text), src)
    if (share < 0.7) reworded.push({ text: b.text, share: Math.round(share * 100) / 100, p: b.p! })
  }
  return { uncovered, missing, format, reworded, contentParas }
}
