// The triage digest (triage-cards / triage-queue / feed-triage): verbatim quotes, signal %, chapter openings.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeSidecar, type Sidecar } from '../../../core/transcript'
import { analyze } from '../../analysis/analyze'
import { spanText, wordsOf } from '../../analysis/words'
import { digestOf, digestOfSidecar, firstSentence, openings, rankQuotes } from './digest'

const FIX = join(__dirname, '../../fixtures')
const SIDECAR = join(FIX, 'AQnwQHMnCrE.follow-along.json')

function small(chapters: Sidecar['chapters'] = []) {
  const paras = ['So the thing is that nobody saw it coming. And then it happened.', 'Really how fast was it in numbers', 'About forty percent a year. That is the story.']
    .map((s) => s.split(' '))
  let t = 0
  const s: Sidecar = { version: 1, id: 'SMALLVIDEO1', title: 'Small', channel: 'C', duration: 1300, paras: paras.map((w, i) => ({ turn: i > 0, w })),
    t: paras.map((w, i) => w.map(() => (t += i === 2 ? 700 : 1.5))), chapters }
  return wordsOf(s)
}

describe('triage digest', () => {
  it('first sentence: verbatim words up to the sentence end, across paragraphs, capped', () => {
    const w = small()
    expect(firstSentence(w, 0)).toEqual({ text: 'So the thing is that nobody saw it coming.', truncated: false })
    expect(firstSentence(w, 1)).toEqual({ text: 'Really how fast was it in numbers About forty percent a year.', truncated: false })
    expect(firstSentence(w, 1, 0, 5)).toEqual({ text: 'Really how fast was it', truncated: true })
    // a short first sentence runs on to at least 8 words; a start word inside a paragraph
    expect(firstSentence(w, 2, 0)).toEqual({ text: 'About forty percent a year. That is the story.', truncated: false })
    expect(firstSentence(w, 0, 9)).toEqual({ text: 'And then it happened. Really how fast was it in numbers About forty percent a year.', truncated: false })
  })

  it('openings: one per chapter, else ~10-minute windows', () => {
    const w = small([{ start: 0, end: 10, title: 'Intro', para: 0 }, { start: 12, end: 99, title: 'Numbers', para: 1 }])
    expect(openings(w).map((o) => [o.title, o.text])).toEqual([['Intro', 'So the thing is that nobody saw it coming.'], ['Numbers', 'Really how fast was it in numbers About forty percent a year.']])
    // a chapter mark in mid-sentence starts at that sentence's first word
    const mid = small([{ start: 16.5, end: 99, title: 'Speed', para: 0 }])
    expect(openings(mid)[0]).toMatchObject({ t: 16.5, text: 'And then it happened. Really how fast was it in numbers About forty percent a year.' })
    const plain = small()
    expect(openings(plain).map((o) => o.title)).toEqual(['0:00–10:00', '10:00–20:00'])
  })

  it('digests a real analysis: verbatim quotes, highlight minutes, signal %', async () => {
    const ud = mkdtempSync(join(tmpdir(), 'vn-triage-'))
    try {
      const { analysis } = await analyze(SIDECAR, { userData: ud, responses: [join(FIX, 'AQnwQHMnCrE.response.json')] })
      const w = wordsOf(decodeSidecar(readFileSync(SIDECAR, 'utf8')))
      const d = digestOf(w, analysis)
      expect(d.analyzed).toBe(true)
      expect(d.highlights).toBe(analysis.highlights.length)
      expect(d.highlightSeconds).toBeGreaterThan(60)
      const dense = analysis.paragraphScores.filter((s) => s.score >= 2).length
      expect(d.signalPct).toBe(Math.round((100 * dense) / analysis.paragraphScores.length))
      // every quote is exactly the transcript's words for a pull quote span
      const ranked = rankQuotes(analysis)
      expect(d.quotes.map((q) => q.text)).toEqual(ranked.map((q) => spanText(w, q)))
      expect(d.quotes.length).toBe(analysis.pullQuotes.length)
      // the cached file reader gives the same
      expect(digestOfSidecar(ud, SIDECAR)?.quotes[0].text).toBe(d.quotes[0].text)
      // another transcript version → not analyzed (falls back to openings)
      const other = small()
      expect(digestOf(other, analysis).analyzed).toBe(false)
      expect(digestOf(other, analysis).openings.length).toBeGreaterThan(0)
    } finally {
      rmSync(ud, { recursive: true, force: true })
    }
  })
})
