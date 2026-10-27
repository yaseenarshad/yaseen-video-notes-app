import { describe, expect, it } from 'vitest'
import type { Words } from '../../analysis/words'
import { buildNotesPrompt, InvalidNotes, validateNotes } from './aiNotes'
import {
  aiOf, ensureSections, formatProblems, normalizeYasinMarkdown, parseNotes, serializeNotes, setAiNotes, setSlides, setYasin, yasinOf,
} from './notesFile'
import { anchorWord, computeSections, timeBullets, type ViewSection } from './sections'

const FILE = `# Notes — How always-on agents work

* [0:00](https://www.youtube.com/watch?v=L1OBRtfPS34&t=0s) Introduction to always-on agents
   * Always-on agents = agents that keep running without you <!-- p:0 -->
* [12:14](https://www.youtube.com/watch?v=L1OBRtfPS34&t=734s) Firecracker VMs
   * Agent runs on its own computer = a Linux box (Firecracker VM) <!-- p:41 -->
      * Easy to snapshot the machine → shut it down → start it back up <!-- p:42 -->
   * ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 -->
   * Yasin:
      * this is why always-on agents are cheap to pause
         * nested thought
      * ![paste-1|400](notes-images/paste-1.png)
`

const paraTime = (p: number) => [0, 10, 20][p] ?? p * 18   // P41 → 738, P42 → 756

describe('notes file', () => {
  it('parses sections, AI bullets with paragraph ids, slides and the Yasin subtree', () => {
    const d = parseNotes(FILE)
    expect(d.h1).toBe('Notes — How always-on agents work')
    expect(d.sections.map((s) => [s.t, s.title])).toEqual([[0, 'Introduction to always-on agents'], [734, 'Firecracker VMs']])
    const s = d.sections[1]
    expect(aiOf(s)).toEqual([{ text: 'Agent runs on its own computer = a Linux box (Firecracker VM)', p: 41, children: [
      { text: 'Easy to snapshot the machine → shut it down → start it back up', p: 42, children: [] }] }])
    expect(s.items[1]).toMatchObject({ kind: 'slide', n: 12, src: 'slides/slide-012.jpg', t: 740, alt: 'Slide 12 · 12:20' })
    expect(yasinOf(s)).toBe('* this is why always-on agents are cheap to pause\n   * nested thought\n* ![paste-1|400](notes-images/paste-1.png)')
  })

  it('round-trips byte for byte', () => {
    expect(serializeNotes(parseNotes(FILE))).toBe(FILE)
    const d = parseNotes(FILE)
    expect(parseNotes(serializeNotes(d))).toEqual(d)
  })

  it('reads other indentation and keeps hand-written bullets verbatim', () => {
    const odd = '* [1:00](https://www.youtube.com/watch?v=x&t=60s) A\n  - my own line\n    - its child\n  * Yasin:\n    * hi\n'
    const d = parseNotes(odd)
    expect(d.sections[0].items[0]).toEqual({ kind: 'other', lines: ['- my own line', '   - its child'] })
    expect(yasinOf(d.sections[0])).toBe('* hi')
    const out = serializeNotes(d)
    expect(out).toBe('* [1:00](https://www.youtube.com/watch?v=x&t=60s) A\n   - my own line\n      - its child\n   * Yasin:\n      * hi\n')
    expect(serializeNotes(parseNotes(out))).toBe(out)
  })

  it('regenerating AI notes keeps the Yasin notes and slides untouched', () => {
    const d = parseNotes(FILE)
    const yasinBefore = yasinOf(d.sections[1])
    setAiNotes(d, 734, [{ text: 'New first bullet', p: 41, children: [] }, { text: 'Later bullet', p: 43, children: [] }], paraTime)
    const s = d.sections[1]
    expect(yasinOf(s)).toBe(yasinBefore)
    expect(s.items.map((i) => i.kind)).toEqual(['ai', 'slide', 'ai', 'yasin'])   // the slide (12:20) sits by time
    expect(serializeNotes(d)).toContain('   * Yasin:\n      * this is why always-on agents are cheap to pause\n         * nested thought')
    // other sections untouched
    expect(aiOf(d.sections[0])[0].text).toBe('Always-on agents = agents that keep running without you')
  })

  it('refreshing slides moves them by time and never touches Yasin', () => {
    const d = parseNotes(FILE)
    setSlides(d, [{ n: 1, t: 5, src: 'slides/slide-001.jpg' }, { n: 12, t: 740, src: 'slides/slide-012.jpg' }], paraTime)
    expect(d.sections[0].items.map((i) => i.kind)).toEqual(['ai', 'slide'])
    expect(serializeNotes(d)).toContain('* ![Slide 1 · 0:05](slides/slide-001.jpg) <!-- slide:1 -->')
    expect(yasinOf(d.sections[1])).toContain('cheap to pause')
  })

  it('stores the editor markdown as canonical bullets', () => {
    expect(normalizeYasinMarkdown('* a\n\n  * b\n* <br />\nplain line\n# head\n')).toBe('* a\n   * b\n* plain line\n* head')
    const d = parseNotes(FILE)
    setYasin(d, 734, '- one\n  - two\n')
    expect(serializeNotes(d)).toContain('   * Yasin:\n      * one\n         * two\n')
    setYasin(d, 734, '* <br />')
    expect(serializeNotes(d)).not.toContain('Yasin:')
  })

  it('ensureSections adds missing sections and keeps orphan ones', () => {
    const d = parseNotes(FILE)
    ensureSections(d, [{ t: 0, title: 'Intro', url: 'u0' }, { t: 300, title: 'Middle', url: 'u300' }])
    expect(d.sections.map((s) => s.t)).toEqual([0, 300, 734])
    expect(d.sections[0].title).toBe('Intro')
  })

  it('flags bold, headers and mochi tags in AI bullets', () => {
    const d = parseNotes('* [0:00](https://www.youtube.com/watch?v=x&t=0s) A\n   * **Bold** idea <!-- p:0 -->\n   * ## Header <!-- p:0 -->\n   * fine = ok <!-- p:0 -->\n')
    expect(formatProblems(d)).toEqual(['0:00: bold in "**Bold** idea"', '0:00: header in "## Header"'])
    expect(formatProblems(parseNotes(FILE))).toEqual([])
  })
})

// ---------- sections, anchors, AI answers ----------

const W: Words = {
  id: 'vid12345678', title: 'Talk', channel: 'Chan', duration: 700,
  paras: [
    ['Hello', 'and', 'welcome.', 'Today', 'we', 'talk', 'about', 'agents.'],
    ['An', 'agent', 'runs', 'on', 'its', 'own', 'computer,', 'a', 'Linux', 'box.', 'It', 'is', 'easy', 'to', 'snapshot', 'the', 'machine.'],
    ['Memory', 'is', 'the', 'hard', 'part.'],
    ['Thanks', 'for', 'listening.'],
  ],
  times: [[0, 1, 2, 3, 4, 5, 6, 7], [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116], [320, 321, 322, 323, 324], [650, 651, 652]],
  turns: [true, false, false, true],
  chapters: [], offsets: [0, 8, 25, 30], total: 33,
}

describe('sections', () => {
  it('makes ~5-minute windows on paragraph boundaries without chapters', () => {
    const s = computeSections(W)
    expect(s.map((x) => [x.t, x.startPara, x.endPara, x.end])).toEqual([[0, 0, 1, 320], [320, 2, 2, 650], [650, 3, 3, 700]])
    expect(s[0].title).toBe('0:00–5:20')
  })

  it('uses chapters, with a Start section before the first one', () => {
    const s = computeSections({ ...W, chapters: [{ start: 100, end: 320, title: 'Agents', para: 1 }, { start: 320, end: 700, title: 'Memory', para: 2 }] })
    expect(s.map((x) => [x.t, x.title, x.startPara, x.endPara])).toEqual([[0, 'Start', 0, 0], [100, 'Agents', 1, 1], [320, 'Memory', 2, 3]])
  })

  it('times bullets at their words, moving forward within a paragraph', () => {
    expect(anchorWord('Agent runs on its own computer = a Linux box', W.paras[1])).toBe(1)
    const tb = timeBullets([{ text: 'Agent runs on its own computer = Linux box', p: 1, children: [{ text: 'Easy to snapshot the machine', p: 1, children: [] }] }], W)
    expect(tb.map((b) => [b.t, b.depth])).toEqual([[101, 0], [112, 1]])
  })
})

describe('AI answer validation', () => {
  const sec: ViewSection = { t: 0, end: 320, title: 'Agents', kind: 'window', startPara: 0, endPara: 1 }

  it('builds a prompt with the format and paragraph ids', () => {
    const p = buildNotesPrompt('FORMAT RULES', W, sec)
    expect(p).toContain('FORMAT RULES')
    expect(p).toContain('P1 [1:40] An agent runs on its own computer,')
    expect(p).toContain('Use only P0 to P1')
  })

  it('accepts a clean answer and reports coverage', () => {
    const v = validateNotes('* Today we talk about agents <!-- p:0 -->\n* Agent runs on its own computer = a Linux box <!-- p:1 -->\n   * Easy to snapshot the machine <!-- p:1 -->', sec)
    expect(v.violations).toEqual([])
    expect(v.repairs).toEqual([])
    expect(v.uncovered).toEqual([])
    expect(v.bullets[1].children[0]).toEqual({ text: 'Easy to snapshot the machine', p: 1, children: [] })
  })

  it('flags and strips bold / headers, repairs ids', () => {
    const v = validateNotes('```\n## Agents\n* **Agent** runs on its own computer (P1)\n   * child without id\n* bad id <!-- p:7 -->\n```', sec)
    expect(v.violations.some((x) => x.startsWith('header'))).toBe(true)
    expect(v.violations.some((x) => x.startsWith('bold'))).toBe(true)
    expect(v.bullets.map((b) => b.text)).toEqual(['Agents', 'Agent runs on its own computer', 'bad id'])
    expect(v.bullets[1]).toMatchObject({ p: 1, children: [{ text: 'child without id', p: 1 }] })
    expect(v.bullets[2].p).toBe(1)
    expect(v.repairs.length).toBeGreaterThanOrEqual(3)
    expect(v.bullets.flatMap((b) => [b.text, ...b.children.map((c) => c.text)]).join(' ')).not.toMatch(/\*\*|#/)
  })

  it('rejects an answer with no bullets', () => {
    expect(() => validateNotes('   \n', sec)).toThrow(InvalidNotes)
  })
})
