// "Ask the video": the local engine (player.js, run without a page) and the AI engine's prompt / validator (ai.ts).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { loadWords } from '../../analysis/analyze'
import { chunks } from '../../analysis/prompt'
import { InvalidAnswer, parseAnswer } from '../../analysis/validate'
import { spanText } from '../../analysis/words'
import { askCacheName, askPrompt, isLoginError, MAX_PASSAGE_WORDS, mergePassages, validatePassages } from './ai'

const FIXTURE = join(__dirname, '../../fixtures/AQnwQHMnCrE.follow-along.json')
const w = loadWords(FIXTURE)

// the engine exports itself as globalThis.__askTheVideoEngine when there is no window.LABS
interface Result { para: number; score: number; matched: number; total: number; hits: number[]; w0: number; w1: number }
interface Engine {
  stem(w: string): string
  buildIndex(paras: string[][]): unknown
  search(index: unknown, q: string, o?: { limit?: number }): { terms: { term: { label: string }; vars: { stems: string[]; kind: string }[] }[]; results: Result[]; matched: number }
  wordMatches(terms: unknown, word: string): boolean
}
const sandbox: Record<string, unknown> = {}
runInNewContext(readFileSync(join(__dirname, 'player.js'), 'utf8'), sandbox)
const E = sandbox.__askTheVideoEngine as Engine
const index = E.buildIndex(w.paras)
const top = (q: string) => E.search(index, q).results.map((r) => r.para)

describe('ask-the-video: local engine', () => {
  it('stems word forms together, without merging unrelated words', () => {
    expect(E.stem('running')).toBe(E.stem('run'))
    expect(E.stem('companies')).toBe(E.stem('company'))
    expect(E.stem('making')).toBe(E.stem('make'))
    expect(E.stem('simulated')).toBe(E.stem('simulation'))
    expect(E.stem('caring')).toBe(E.stem('care'))
    expect(E.stem('care')).not.toBe(E.stem('car'))
    expect(E.stem('career')).not.toBe(E.stem('car'))
    expect(E.stem('speed')).toBe('speed')
  })

  it('finds the paragraph that has every query word first, ignoring "where do they talk about"', () => {
    const r = E.search(index, 'where do they talk about simulation theory')
    expect(r.terms.map((t) => t.term.label)).toEqual(['simulation', 'theory'])
    expect(r.results[0].para).toBe(19)
    expect(r.results[0].matched).toBe(2)
    expect(w.paras[19].join(' ')).toMatch(/simulation theory/)
  })

  it('expands synonyms (jobs → work) and longer forms (worker → work)', () => {
    const jobs = E.search(index, 'jobs')
    expect(jobs.terms[0].vars.some((v) => v.kind === 'synonym' && v.stems[0] === E.stem('work'))).toBe(true)
    expect(jobs.results.length).toBeGreaterThan(0)
    expect(top('workers').length).toBeGreaterThan(0)
  })

  it('tolerates typos only for words not in the video', () => {
    const r = E.search(index, 'simulaton')
    expect(r.results.length).toBeGreaterThan(0)
    expect(w.paras[r.results[0].para].join(' ').toLowerCase()).toContain('simulation')
    expect(E.search(index, 'trillionare').results.map((x) => x.para)).toContain(3)
    // "alignment" is in the video's vocabulary as align*: no fuzzy "alien"
    expect(E.search(index, 'alignment').terms[0].vars.some((v) => v.kind === 'fuzzy')).toBe(false)
  })

  it('matches "quoted phrases" as consecutive words', () => {
    const r = E.search(index, '"making spaceships"')
    expect(r.results[0].para).toBe(22)
    expect(r.matched).toBe(1)
  })

  it('returns at most 8 results, not two from the same stretch of talk, each a window with its hits inside', () => {
    const r = E.search(index, 'money wealth')
    expect(r.results.length).toBeLessThanOrEqual(8)
    const ps = r.results.map((x) => x.para)
    for (const a of ps) for (const b of ps) if (a !== b) expect(Math.abs(a - b)).toBeGreaterThan(1)
    for (const x of r.results) {
      expect(x.w0).toBeGreaterThanOrEqual(0)
      expect(x.w1).toBeLessThan(w.paras[x.para].length)
      expect(x.hits.some((h) => h >= x.w0 && h <= x.w1)).toBe(true)
    }
  })

  it('has nothing for filler-only or absent words, and marks matching words of other passages', () => {
    expect(E.search(index, 'where do they talk about').results).toEqual([])
    expect(E.search(index, 'xylophone').results).toEqual([])
    const r = E.search(index, 'robots')
    expect(E.wordMatches(r.terms, 'robot,')).toBe(true)
    expect(E.wordMatches(r.terms, 'Optimus')).toBe(true)
    expect(E.wordMatches(r.terms, 'money')).toBe(false)
  })

  it('is fast on a long transcript (index + search well under 100 ms)', () => {
    const t0 = performance.now()
    const big = E.buildIndex([...w.paras, ...w.paras, ...w.paras])
    E.search(big, 'why will money become irrelevant')
    expect(performance.now() - t0).toBeLessThan(400)
  })
})

describe('ask-the-video: AI engine (prompt + validation)', () => {
  const c = chunks(w)[0]

  it('sends the question and the numbered transcript', () => {
    const p = askPrompt(w, '  where does he   talk about money? ', c)
    expect(p).toContain('QUESTION: where does he talk about money?')
    expect(p).toContain('P0 [0:00] {0} I\'ve been sort of')
    expect(p).toContain(`P${w.paras.length - 1} [`)
    expect(p).toContain('{"passages": [{"span": [p, w, p, w]')
  })

  it('keeps verified spans, moves numbers to their anchors, drops what points nowhere', () => {
    const repairs: string[] = []
    // P19 is "And is simulation theory correct?"
    const ans = parseAnswer('```json\n' + JSON.stringify({ passages: [
      { span: [19, 0, 19, 4], first: 'And is simulation', last: 'simulation theory correct?', score: 5 },
      { span: [22, 3, 22, 12], first: 'Should I really', last: 'nothing like this', score: 4 },        // anchors not in the transcript
      { span: [999, 0, 999, 3], first: 'a b c', last: 'a b c' },                                       // no such paragraph
      { span: [20, 0, 20, 1], first: 'that we', last: 'that we' },                                      // too short
    ] }) + '\n```')
    const out = validatePassages(w, ans, repairs, c)
    expect(out).toHaveLength(1)
    expect(spanText(w, out[0])).toBe('And is simulation theory correct?')
    expect(out[0].score).toBe(5)
    expect(out[0].t0).toBeLessThan(out[0].t1)
    expect(repairs.join('\n')).toMatch(/anchor words were not found/)
    expect(repairs.join('\n')).toMatch(/P999 does not exist/)
    expect(repairs.join('\n')).toMatch(/shorter than/)
  })

  it('repairs off-by-a-few word numbers, cuts long passages, resolves overlaps', () => {
    const repairs: string[] = []
    const p3 = w.paras[3]
    const out = validatePassages(w, { passages: [
      { span: [3, 2, 3, 9], first: p3.slice(0, 3).join(' '), last: p3.slice(5, 8).join(' '), score: 3 },   // start off by 2
      { span: [3, 4, 3, 7], first: p3.slice(4, 7).join(' '), last: p3.slice(5, 8).join(' '), score: 2 },   // overlaps the first
      { span: [8, 0, 14, w.paras[14].length - 1], first: w.paras[8].slice(0, 3).join(' '), last: w.paras[14].slice(-3).join(' '), score: 4 },   // > 150 words
    ] }, repairs, c)
    expect(w.offsets[15] - w.offsets[8]).toBeGreaterThan(MAX_PASSAGE_WORDS)
    expect(out.map((p) => p.startPara)).toEqual([8, 3])   // best score first
    const cut = out[0]
    expect(spanText(w, cut).split(' ').length).toBe(MAX_PASSAGE_WORDS)
    expect(out[1].startWord).toBe(0)
    expect(repairs.join('\n')).toMatch(/start moved -2/)
    expect(repairs.join('\n')).toMatch(/overlaps a better one/)
    expect(repairs.join('\n')).toMatch(/cut to 150 words/)
  })

  it('rejects an answer without a passages list (so it is asked once more)', () => {
    expect(() => validatePassages(w, { results: [] }, [])).toThrow(InvalidAnswer)
    expect(validatePassages(w, { passages: [] }, [])).toEqual([])
  })

  it('merges chunks best first, caches per question, recognizes login errors', () => {
    const a = { startPara: 1, startWord: 0, endPara: 1, endWord: 3, t0: 10, t1: 12, score: 2 }
    const b = { ...a, t0: 5, score: 5 }
    expect(mergePassages([[a], [b]])).toEqual([b, a])
    expect(askCacheName(w, 'Money?')).toBe(askCacheName(w, '  money? '))
    expect(askCacheName(w, 'money?')).not.toBe(askCacheName(w, 'robots?'))
    expect(isLoginError('claude: Failed to authenticate: OAuth session expired — run `claude`')).toBe(true)
    expect(isLoginError('claude: Not logged in · Please run /login')).toBe(true)
    expect(isLoginError('claude took longer than 5 min; stopped')).toBe(false)
  })
})
