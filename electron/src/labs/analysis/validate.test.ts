// The analysis validator: model spans → real transcript words (repair / drop), never model text.
// Fixture: a real model answer (src/labs/fixtures/AQnwQHMnCrE.response.json) to the real prompt of a real video.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeSidecar, type Sidecar } from '../../core/transcript'
import { readAnalysis } from '../store'
import { analyze } from './analyze'
import { buildPrompt, chunks, groups, paragraphLine } from './prompt'
import { finalize, fixSpan, InvalidAnswer, matchesTranscript, parseAnswer, validateChunk } from './validate'
import { spanText, wordsOf, type Words } from './words'

const FIX = join(__dirname, '../fixtures')
const realSidecar = join(FIX, 'AQnwQHMnCrE.follow-along.json')
const real = (): Words => wordsOf(decodeSidecar(readFileSync(realSidecar, 'utf8')))

/** A small transcript: 3 paragraphs, one word per second. */
function small(): Words {
  const paras = [
    'So the thing is that nobody saw it coming. And then it happened very fast.',
    '— Really? How fast was it, in numbers?',
    'About forty percent a year, compounding. That is the whole story of the decade.',
  ].map((s) => s.split(' '))
  let t = 0
  const s: Sidecar = { version: 1, id: 'SMALLVIDEO1', title: 'Small', channel: 'C', duration: 100, paras: paras.map((w, i) => ({ turn: i > 0, w })),
    t: paras.map((w) => w.map(() => (t += 1.5))), chapters: [] }
  return wordsOf(s)
}

describe('fixSpan', () => {
  it('keeps a correct span and derives the text from the transcript', () => {
    const w = small(), r: string[] = []
    const s = fixSpan(w, [0, 0, 0, 8], 'So the thing', 'it coming.', 'x', r)!
    expect(s.verified).toBe(true)
    expect(spanText(w, s.span)).toBe('So the thing is that nobody saw it coming.')
    expect(r).toEqual([])
  })

  it('moves numbers that are off to where the anchor words are', () => {
    const w = small(), r: string[] = []
    const s = fixSpan(w, [0, 2, 0, 6], 'So the thing', 'saw it coming.', 'x', r)!
    expect(spanText(w, s.span)).toBe('So the thing is that nobody saw it coming.')
    expect(r).toEqual(['x: start moved -2 words to its anchor', 'x: end moved +2 words to its anchor'])
  })

  it('finds anchors across paragraphs and ignores case / punctuation', () => {
    const w = small(), r: string[] = []
    const s = fixSpan(w, [1, 0, 2, 3], 'really how fast', 'a year compounding', 'x', r)!
    expect(spanText(w, s.span)).toBe('Really? How fast was it, in numbers? About forty percent a year, compounding.')
    expect(s.span).toMatchObject({ startPara: 1, startWord: 1, endPara: 2, endWord: 5 })
  })

  it('clamps word numbers past the paragraph end, drops paragraphs that do not exist and reversed spans', () => {
    const w = small(), r: string[] = []
    expect(fixSpan(w, [2, 0, 2, 99], null, null, 'a', r)!.span.endWord).toBe(w.paras[2].length - 1)
    expect(fixSpan(w, [7, 0, 7, 3], null, null, 'b', r)).toBeNull()
    expect(fixSpan(w, [2, 5, 0, 1], null, null, 'c', r)).toBeNull()
    expect(fixSpan(w, 'P2', null, null, 'd', r)).toBeNull()
    expect(r.join('\n')).toMatch(/a: end word 99 of P2 clamped/)
    expect(r.join('\n')).toMatch(/b: dropped \(paragraph P7 does not exist\)/)
    expect(r.join('\n')).toMatch(/c: dropped \(ends before it starts\)/)
    expect(r.join('\n')).toMatch(/d: dropped \(span is not/)
  })

  it('an anchor that is nowhere near keeps the numbers but is unverified', () => {
    const w = small(), r: string[] = []
    const s = fixSpan(w, [0, 0, 0, 3], 'purple elephants dancing', null, 'x', r)!
    expect(s.verified).toBe(false)
    expect(spanText(w, s.span)).toBe('So the thing is')
  })
})

describe('validateChunk / finalize', () => {
  const base = { paragraphScores: '123', pullQuotes: [], questions: [], claims: [], mochiCandidates: [] }

  it('drops too-short highlights, cuts labels, maps unknown enums, clamps scores, de-overlaps', () => {
    const w = small(), r: string[] = []
    const res = validateChunk(w, {
      ...base,
      highlights: [
        { span: [0, 0, 2, 13], first: 'So the thing', last: 'of the decade.', label: 'one two three four five six seven eight', why: 'statistic', score: 9 },
        { span: [1, 0, 2, 13], first: '— Really? How', label: 'overlapping one', why: 'claim', score: 2 },
        { span: [0, 0, 0, 2], label: 'tiny', why: 'claim', score: 3 },
      ],
    }, chunks(w)[0], r)
    expect(res.highlights.length).toBe(2) // the 3-word one is < 10 s
    expect(res.highlights[0]).toMatchObject({ label: 'one two three four five six', why: 'number', score: 5 })
    const a = finalize(w, [res], { createdAt: 'now', source: 'test', elapsedMs: 0, repairs: r })
    expect(a.highlights.length).toBe(1) // the overlapping, lower-scored one is dropped
    expect(a.paragraphScores).toEqual([{ para: 0, score: 1 }, { para: 1, score: 2 }, { para: 2, score: 3 }])
    expect(a.repairs.join('\n')).toMatch(/label cut to 6 words/)
    expect(a.repairs.join('\n')).toMatch(/overlaps a better one/)
    expect(a.repairs.join('\n')).toMatch(/only 1 highlights/)
  })

  it('paragraph scores of the wrong length are padded / cut (noted)', () => {
    const w = small(), r: string[] = []
    const res = validateChunk(w, { ...base, paragraphScores: '3', highlights: [] }, chunks(w)[0], r)
    const a = finalize(w, [res], { createdAt: 'now', source: 'test', elapsedMs: 0, repairs: r })
    expect(a.paragraphScores.map((p) => p.score)).toEqual([3, 1, 1])
    expect(a.repairs.join('\n')).toMatch(/1 digits for 3 paragraphs/)
  })

  it('an unusable answer is an InvalidAnswer (the engine retries once)', () => {
    const w = small()
    expect(() => parseAnswer('Sure! Here is the analysis.')).toThrow(InvalidAnswer)
    expect(() => parseAnswer('{"highlights": [}')).toThrow(InvalidAnswer)
    expect(parseAnswer('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(() => validateChunk(w, { highlights: 'none' }, chunks(w)[0], [])).toThrow(/"highlights" must be an array/)
    expect(() => validateChunk(w, { ...base, highlights: [{ span: [9, 0, 9, 1] }] }, chunks(w)[0], [])).toThrow(/none of the highlights/)
  })

  it('a real answer: every span is real transcript, highlights 20–120 s and non-overlapping', () => {
    const w = real(), r: string[] = []
    const answer = parseAnswer(readFileSync(join(FIX, 'AQnwQHMnCrE.response.json'), 'utf8'))
    const a = finalize(w, [validateChunk(w, answer, chunks(w)[0], r)], { createdAt: 'now', source: 'fixture', elapsedMs: 0, repairs: r })
    expect(a.highlights.length).toBeGreaterThanOrEqual(10)
    expect(a.highlights.length).toBeLessThanOrEqual(20)
    expect(a.paragraphScores.length).toBe(w.paras.length)
    for (const h of a.highlights) {
      expect(h.t1 - h.t0).toBeGreaterThanOrEqual(10)
      expect(h.t1 - h.t0).toBeLessThanOrEqual(121)
      expect(h.label.split(' ').length).toBeLessThanOrEqual(6)
    }
    for (let i = 1; i < a.highlights.length; i++) expect(a.highlights[i].t0).toBeGreaterThanOrEqual(a.highlights[i - 1].t1 - 3.01)
    const all = [...a.highlights, ...a.pullQuotes, ...a.claims, ...a.mochiCandidates, ...a.questions.map((q) => q.question)]
    for (const s of all) {
      expect(s.startPara).toBeLessThan(w.paras.length)
      expect(s.startWord).toBeLessThan(w.paras[s.startPara].length)
      expect(s.endWord).toBeLessThan(w.paras[s.endPara].length)
      expect(spanText(w, s).length).toBeGreaterThan(0)
    }
    expect(matchesTranscript(a, w)).toBe(true)
    // the stored analysis holds no model text except labels: no "first" / "last" / quote fields
    expect(JSON.stringify(a)).not.toMatch(/"first"|"last"|"quote"|"text"/)
  })
})

describe('prompt', () => {
  it('marks every 10th word and numbers paragraphs', () => {
    const w = small()
    expect(paragraphLine(w, 1)).toBe('P1 [0:24] (new speaker) {0} — Really? How fast was it, in numbers?')
    const p = buildPrompt(w, chunks(w)[0])
    expect(p).toContain('exactly 3 digits')
    expect(p).toContain('WINDOWS (the video has no chapters)')
    expect(p).toContain('W0 0:00 (starts at P0)')
  })

  it('one call for a 2 h podcast; longer transcripts split at chapter starts', () => {
    const w = real()
    expect(chunks(w).length).toBe(1)
    const parts = chunks(w, 2000)
    expect(parts.length).toBeGreaterThan(2)
    expect(parts[0].first).toBe(0)
    expect(parts[parts.length - 1].last).toBe(w.paras.length - 1)
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].first).toBe(parts[i - 1].last + 1)
      const cut = w.chapters.some((c) => c.para === parts[i].first)
      expect(cut || parts[i - 1].words > 2000).toBe(true)
    }
    expect(groups(w, parts[0]).kind).toBe('chapter')
  })
})

describe('analyze (engine)', () => {
  it('retries once with the error, then stores the analysis in Labs userData', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'vn-labs-analyze-'))
    try {
      const answers = ['I cannot do that', readFileSync(join(FIX, 'AQnwQHMnCrE.response.json'), 'utf8')]
      const prompts: string[] = []
      const r = await analyze(realSidecar, { userData: ud, ask: async (p) => { prompts.push(p); return { text: answers.shift()!, ms: 5 } } })
      expect(prompts.length).toBe(2)
      expect(prompts[1]).toContain('YOUR PREVIOUS ANSWER WAS REJECTED: the answer has no JSON object')
      expect(r.analysis.highlights.length).toBeGreaterThanOrEqual(10)
      expect(readAnalysis(ud, 'AQnwQHMnCrE')?.videoId).toBe('AQnwQHMnCrE')
      // a second run reuses it
      const again = await analyze(realSidecar, { userData: ud, ask: async () => { throw new Error('should not be called') } })
      expect(again.reused).toBe(true)
      // two bad answers: the error
      await expect(analyze(realSidecar, { userData: ud, force: true, ask: async () => ({ text: '{"nope": 1}', ms: 1 }) })).rejects.toThrow(/"highlights" must be an array/)
    } finally { rmSync(ud, { recursive: true, force: true }) }
  })
})
