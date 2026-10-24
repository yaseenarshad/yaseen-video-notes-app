// "Mochi candidates": the previewed / copied note line must be byte-identical to what the app writes for a
// #mochi range note (core/notes.ts block(), CLAUDE.md rule 3), and must parse back as a mochi note with that quote.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { block, parse } from '../../../core/notes'

interface Core { noteLines(id: string, start: number, end: number | null, label: string, quote: string): string[]; shortQuote(q: string): string }
const sandbox: Record<string, unknown> = {}
runInNewContext(readFileSync(join(__dirname, 'player.js'), 'utf8'), sandbox)
const C = sandbox.__mochiCandidates as Core
const ID = 'AQnwQHMnCrE', BASE = `https://www.youtube.com/watch?v=${ID}`

describe('mochi-candidates: note line', () => {
  const cases: [number, number | null, string, string][] = [
    [16.08, 19.36, 'Reality as an irony maximizer', 'reality is not just an interestingness max- maximizer, but also an irony maximizer.'],
    [1368.72, 1372.32, 'DDD: dull, dirty, dangerous', 'the three Ds dull, dirty and dangerous jobs that nobody wants to do anymore at all, says he, again and again'],
    [3725.4, 3725.9, 'One word', 'Optimus'],                       // inside one second → a single time
    [59.99, 61.2, '  spaced\n label ', 'a b c'],                   // label whitespace collapsed
  ]
  it('equals core/notes.ts block() for a #mochi range note', () => {
    for (const [t0, t1, label, quote] of cases) {
      const want = block(BASE, t0, t1, label.replace(/\s+/g, ' ').trim(), quote, 'mochi')
      expect(C.noteLines(ID, t0, t1, label, quote)).toEqual(want)
    }
  })

  it('looks like the documented format', () => {
    expect(C.noteLines(ID, 16.08, 19.36, 'Reality as an irony maximizer', 'one two three')).toEqual([
      `> 💬 [0:16–0:19](${BASE}&t=16s) #mochi Reality as an irony maximizer`,
      '> “one two three”',
    ])
    expect(C.noteLines(ID, 3725.4, 3725.9, 'x', 'y')[0]).toBe(`> 💬 [1:02:05](${BASE}&t=3725s) #mochi x`)
    expect(C.shortQuote('1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16')).toBe('1 2 3 4 5 6 … 11 12 13 14 15 16')
  })

  it('parses back as a mochi note with the label as text and the quote', () => {
    const md = `# T\n\n- url: ${BASE}\n\n---\n\n[0:00](${BASE}&t=0s) Some words here.\n` + C.noteLines(ID, 16.08, 19.36, 'Irony maximizer', 'an irony maximizer.').join('\n') + '\n'
    const [n] = parse(md)
    expect(n.category).toBe('mochi')
    expect(n.text).toBe('Irony maximizer')
    expect(n.quote).toBe('an irony maximizer.')
    expect(n.time).toBe(16)
    expect(n.end).toBe(19)
  })
})
