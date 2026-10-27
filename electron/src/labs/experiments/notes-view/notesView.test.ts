import { describe, expect, it } from 'vitest'
import type { Words } from '../../analysis/words'
import { buildNotesPrompt, InvalidNotes, validateNotes } from './aiNotes'
import {
  assignOriginals, bulletsOf, editorPart, ensureOriginals, ensureSections, formatProblems, isEdited, markedOf, originalsFromSection, parseNotes,
  partTouched, restoreOriginal, serializeNotes, setAiNotes, setPart, setSlides, stripUser, unmarkUser, userSpans, wrapUser,
  type Bullet, type NotesDoc, type Originals,
} from './notesFile'
import { anchorWord, computeSections, timeBullets, type ViewSection } from './sections'
import { noteTarget, noteText } from './noteTarget'
import { checkPart, isFillerOnly, namesIn, numbersIn, sourceShare } from './checks'

/** The first version's file: AI bullets, a slide, and a separate `Yasin:` subtree. */
const LEGACY = `# Notes — How always-on agents work

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

/** The inline format: Yasin's words inside AI bullets, his own bullets, a bullet sent as a 💬 note. */
const FILE = `# Notes — How always-on agents work

* [0:00](https://www.youtube.com/watch?v=L1OBRtfPS34&t=0s) Introduction to always-on agents
   * Always-on agents = agents that keep running without you <!-- p:0 -->
* [12:14](https://www.youtube.com/watch?v=L1OBRtfPS34&t=734s) Firecracker VMs
   * Agent runs on its own computer ==my own words== = a Linux box (Firecracker VM) <!-- p:41 -->
      * ==a child I typed==
      * Easy to snapshot the machine → shut it down → start it back up <!-- p:42 --> <!-- note:k3j9a0b -->
   * ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 -->
   * ==this is why always-on agents are cheap to pause==
      * ![paste-1|400](notes-images/paste-1.png)
`

const paraTime = (p: number) => [0, 10, 20][p] ?? p * 18   // P41 → 738, P42 → 756, P43 → 774
const B = (text: string, p: number | null, children: Bullet[] = []): Bullet => ({ text, p, children })
/** Every `==…==` text of a doc, sorted (to check "each exactly once"). */
const spansOf = (d: NotesDoc) => d.sections.flatMap((s) => serializeNotes({ h1: null, head: [], sections: [s] })).flatMap(userSpans).sort()

describe('notes file: the inline format', () => {
  it('parses AI bullets with Yasin\'s words, his own bullets, note markers and slides', () => {
    const d = parseNotes(FILE)
    expect(d.h1).toBe('Notes — How always-on agents work')
    const s = d.sections[1]
    expect(s.items.map((i) => i.kind)).toEqual(['bullet', 'slide', 'bullet'])
    const [ai, mine] = bulletsOf(s)
    expect(ai).toMatchObject({ text: 'Agent runs on its own computer ==my own words== = a Linux box (Firecracker VM)', p: 41 })
    expect(ai.children[0]).toEqual({ text: '==a child I typed==', p: null, children: [] })
    expect(ai.children[1]).toEqual({ text: 'Easy to snapshot the machine → shut it down → start it back up', p: 42, children: [], notes: ['k3j9a0b'] })
    expect(mine).toMatchObject({ text: '==this is why always-on agents are cheap to pause==', p: null, children: [{ text: '![paste-1|400](notes-images/paste-1.png)', p: null }] })
    expect(s.items[1]).toMatchObject({ kind: 'slide', n: 12, src: 'slides/slide-012.jpg', t: 740 })
    expect(userSpans(ai.text)).toEqual(['my own words'])
    expect(stripUser(ai.text)).toBe('Agent runs on its own computer = a Linux box (Firecracker VM)')
    expect(unmarkUser(ai.text)).toBe('Agent runs on its own computer my own words = a Linux box (Firecracker VM)')
  })

  it('round-trips byte for byte (new format and legacy)', () => {
    expect(serializeNotes(parseNotes(FILE))).toBe(FILE)
    expect(serializeNotes(parseNotes(LEGACY))).toBe(LEGACY)
    expect(parseNotes(serializeNotes(parseNotes(FILE)))).toEqual(parseNotes(FILE))
  })

  it('reads `==` like the docs app: exactly two, no space inside the ends, escapes respected', () => {
    expect(userSpans('a ==b c== d ==e==')).toEqual(['b c', 'e'])
    expect(userSpans('x == y, a ==b ==')).toEqual([])
    expect(userSpans('\\==no== ===three===')).toEqual([])
    expect(userSpans('==a = b==')).toEqual(['a = b'])
    expect(wrapUser('plain words ![i|400](notes-images/i.png) more')).toBe('==plain words== ![i|400](notes-images/i.png) ==more==')
    expect(wrapUser('a == b')).toBe('==a \\=\\= b==')
    expect(userSpans(wrapUser('a == b'))).toEqual(['a \\=\\= b'])
  })

  it('reads other indentation and markers, written back canonically', () => {
    const odd = '* [1:00](https://www.youtube.com/watch?v=x&t=60s) A\n  - my own line\n    - its child\n'
    const out = serializeNotes(parseNotes(odd))
    expect(out).toBe('* [1:00](https://www.youtube.com/watch?v=x&t=60s) A\n   * my own line\n      * its child\n')
    expect(serializeNotes(parseNotes(out))).toBe(out)
  })

  it('the editor\'s markdown: transport fields dropped, a marker anywhere goes to the end, split / merge keep markers', () => {
    const d = parseNotes(FILE)
    // typed after the marker, split (both halves keep p:42), merged (the first marker stays, the second is gone)
    setPart(d, 734, [
      '* Agent runs on its own computer <!-- p:41 t:738.5 o:0 --> ==typed after==',
      '  * Easy to snapshot the machine <!-- p:42 t:756 o:1 -->',
      '  * → shut it down → start it back up <!-- p:42 t:756 o:1 -->',
      '* Merged first half and second half <!-- p:43 t:774 o:2 -->',
      '* <br />',
      '* ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 t:740 -->',
      '',
    ].join('\n'))
    expect(serializeNotes(d).split('\n').slice(5).join('\n')).toBe([
      '   * Agent runs on its own computer ==typed after== <!-- p:41 -->',
      '      * Easy to snapshot the machine <!-- p:42 -->',
      '      * → shut it down → start it back up <!-- p:42 -->',
      '   * Merged first half and second half <!-- p:43 -->',
      '   * ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 -->',
      '',
    ].join('\n'))
    // a split bullet: the first half keeps the original's slot, the second half has none (edited)
    const s = d.sections[1]
    const a = assignOriginals(bulletsOf(s), { 42: ['Easy to snapshot the machine → shut it down → start it back up'] })
    const [h1, h2] = bulletsOf(s)[0].children
    expect(a.get(h1)?.index).toBe(0)
    expect(a.get(h2)).toBeNull()
    expect(isEdited(h1, a.get(h1)) && isEdited(h2, a.get(h2))).toBe(true)
  })

  it('the editor\'s markdown keeps the AI\'s bytes: block-like starts escaped there, taken out again on save', () => {
    const d = parseNotes('* [0:00](u&t=0s) A\n   * 1) Copy-pasting code <!-- p:4 -->\n   * = loading up Q&A <!-- p:4 -->\n   * - a dash, # hash <!-- p:4 -->\n')
    const ed = editorPart(d.sections[0], originalsFromSection(d.sections[0]), () => null)
    expect(ed.md).toBe('* 1\\) Copy-pasting code <!-- p:4 o:0 -->\n* = loading up Q&A <!-- p:4 o:1 -->\n* \\- a dash, # hash <!-- p:4 o:2 -->')
    const before = serializeNotes(d)
    // what the editor writes back (it escapes & and a leading =)
    setPart(d, 0, '* 1\\) Copy-pasting code <!-- p:4 -->\n* \\= loading up Q\\&A <!-- p:4 -->\n* \\- a dash, # hash <!-- p:4 -->\n\n<br />\n')
    expect(serializeNotes(d)).toBe(before)
  })

  it('the editor\'s view of a part: t / o fields, originals list, legacy Yasin notes inline', () => {
    const d = parseNotes(LEGACY)
    const s = d.sections[1]
    const ed = editorPart(s, originalsFromSection(s), (b) => (b.p === 41 ? 738 : null))
    expect(ed.md).toBe([
      '* Agent runs on its own computer = a Linux box (Firecracker VM) <!-- p:41 t:738 o:0 -->',
      '   * Easy to snapshot the machine → shut it down → start it back up <!-- p:42 o:1 -->',
      '* ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 t:740 -->',
      '* ==this is why always-on agents are cheap to pause==',
      '   * ==nested thought==',
      '* ![paste-1|400](notes-images/paste-1.png)',
    ].join('\n'))
    expect(ed.orig).toEqual([{ p: 41, text: 'Agent runs on its own computer = a Linux box (Firecracker VM)' }, { p: 42, text: 'Easy to snapshot the machine → shut it down → start it back up' }])
    expect(s.items.some((i) => i.kind === 'yasin')).toBe(true)   // editorPart never changes the doc
  })

  it('old Yasin: subtree → written inline on the next save, never lost', () => {
    const d = parseNotes(LEGACY)
    const s = d.sections[1]
    setPart(d, 734, editorPart(s, originalsFromSection(s), () => null).md)
    const out = serializeNotes(d)
    expect(out).not.toContain('Yasin:')
    expect(out).toContain('   * ==this is why always-on agents are cheap to pause==\n      * ==nested thought==\n   * ![paste-1|400](notes-images/paste-1.png)\n')
    expect(out).toContain('   * Agent runs on its own computer = a Linux box (Firecracker VM) <!-- p:41 -->\n')
  })

  it('touched parts: Yasin\'s bullets, his words, edited AI bullets, notes sent, legacy, lines under a slide', () => {
    const d = parseNotes(FILE)
    expect(partTouched(d.sections[0])).toBe(false)
    expect(partTouched(d.sections[1])).toBe(true)
    const legacy = parseNotes(LEGACY)
    expect(partTouched(legacy.sections[1])).toBe(true)
    const plain = parseNotes('* [0:00](u&t=0s) A\n   * one <!-- p:0 -->\n')
    expect(partTouched(plain.sections[0], { 0: ['one'] })).toBe(false)
    expect(partTouched(plain.sections[0], { 0: ['the AI wrote this'] })).toBe(true)   // reworded
    expect(partTouched(parseNotes('* [0:00](u&t=0s) A\n   * one <!-- p:0 --> <!-- note:abc1234 -->\n').sections[0], { 0: ['one'] })).toBe(true)
    expect(partTouched(parseNotes('* [0:00](u&t=0s) A\n   * ![s](slides/s.jpg) <!-- slide:1 -->\n      * my line\n').sections[0])).toBe(true)
    expect(partTouched(parseNotes('* [0:00](u&t=0s) A\n   * escaped snake\\_case <!-- p:0 -->\n').sections[0], { 0: ['escaped snake_case'] })).toBe(false)
  })

  it('old files with no sidecar: the current AI bullets without == are the originals', () => {
    const d = parseNotes(FILE)
    const o: Originals = { version: 1, parts: {} }
    expect(ensureOriginals(d, o)).toBe(true)
    expect(o.parts['0']).toEqual({ 0: ['Always-on agents = agents that keep running without you'] })
    expect(o.parts['734']).toEqual({ 42: ['Easy to snapshot the machine → shut it down → start it back up'] })   // p:41 has == → none
    expect(ensureOriginals(d, o)).toBe(false)
  })

  it('restore original: the AI text again, Yasin\'s words in it gone', () => {
    const d = parseNotes('* [0:00](u&t=0s) A\n   * my reworded ==and typed== text <!-- p:0 -->\n')
    const b = bulletsOf(d.sections[0])[0]
    const a = assignOriginals([b], { 0: ['the AI text'] }).get(b)!
    expect(isEdited(b, a)).toBe(true)
    restoreOriginal(b, a)
    expect(isEdited(b, a)).toBe(false)
    expect(serializeNotes(d)).toBe('* [0:00](u&t=0s) A\n   * the AI text <!-- p:0 -->\n')
  })
})

describe('regenerating AI notes', () => {
  const fresh = (): Bullet[] => [
    B('NEW forty-one', 41, [B('NEW forty-two', 42)]),
    B('NEW forty-three', 43),
  ]

  it('an untouched part is simply replaced; the originals are the new texts', () => {
    const d = parseNotes('* [12:14](u&t=734s) P\n   * old 41 <!-- p:41 -->\n   * old 43 <!-- p:43 -->\n')
    const o = setAiNotes(d, 734, fresh(), paraTime, { 41: ['old 41'], 43: ['old 43'] })
    expect(serializeNotes(d)).toBe('* [12:14](u&t=734s) P\n   * NEW forty-one <!-- p:41 -->\n      * NEW forty-two <!-- p:42 -->\n   * NEW forty-three <!-- p:43 -->\n')
    expect(o).toEqual({ 41: ['NEW forty-one'], 42: ['NEW forty-two'], 43: ['NEW forty-three'] })
  })

  it('keeps edited bullets byte-identically, re-attaches Yasin\'s bullets by p:N, keeps every == once', () => {
    const before = [
      '* [12:14](u&t=734s) P',
      '   * old 41 <!-- p:41 -->',
      '      * ==first child of 41==',                       // child of an untouched AI bullet → child of the new p:41
      '      * old 42 <!-- p:42 -->',
      '   * ==top-level after 41==',                         // after the new p:41 (its previous sibling's paragraph)
      '   * Yasin REWORDED this ==and typed== <!-- p:43 -->',   // edited → kept as is; p:43 pinned (no NEW forty-three)
      '      * ==under the edited one==',
      '   * old 44 <!-- p:44 -->',
      '   * ==after 44, which is gone==',                    // p:44 has no new bullet → nearest earlier (43)
      '',
    ].join('\n')
    const d = parseNotes(before)
    const spans = spansOf(d)
    const o = setAiNotes(d, 734, fresh(), paraTime, { 41: ['old 41'], 42: ['old 42'], 43: ['the AI 43'], 44: ['old 44'] })
    const out = serializeNotes(d)
    expect(out).toBe([
      '* [12:14](u&t=734s) P',
      '   * NEW forty-one <!-- p:41 -->',
      '      * ==first child of 41==',
      '      * NEW forty-two <!-- p:42 -->',
      '   * ==top-level after 41==',
      '   * Yasin REWORDED this ==and typed== <!-- p:43 -->',
      '      * ==under the edited one==',
      '   * ==after 44, which is gone==',
      '',
    ].join('\n'))
    expect(out).toContain('   * Yasin REWORDED this ==and typed== <!-- p:43 -->\n')
    expect(spansOf(d)).toEqual(spans)
    expect(o).toEqual({ 41: ['NEW forty-one'], 42: ['NEW forty-two'], 43: ['the AI 43'] })
    // regenerating again changes nothing of Yasin's
    setAiNotes(d, 734, fresh(), paraTime, o)
    expect(serializeNotes(d)).toBe(out)
  })

  it('a legacy Yasin: subtree is kept at the end, as == bullets', () => {
    const d = parseNotes(LEGACY)
    setAiNotes(d, 734, fresh(), paraTime)
    const out = serializeNotes(d)
    expect(out).not.toContain('Yasin:')
    expect(out.split('\n').slice(5).join('\n')).toBe([
      '   * NEW forty-one <!-- p:41 -->',
      '      * NEW forty-two <!-- p:42 -->',
      '   * ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 -->',
      '   * NEW forty-three <!-- p:43 -->',
      '   * ==this is why always-on agents are cheap to pause==',
      '      * ==nested thought==',
      '   * ![paste-1|400](notes-images/paste-1.png)',
      '',
    ].join('\n'))
  })

  it('a bullet sent as a 💬 note is kept (its marker with it)', () => {
    const d = parseNotes('* [12:14](u&t=734s) P\n   * old 41 <!-- p:41 --> <!-- note:abc1234 -->\n')
    setAiNotes(d, 734, fresh(), paraTime, { 41: ['old 41'] })
    // p:41 is pinned: its new bullet is not added (its child p:42 moves up)
    expect(serializeNotes(d)).toBe('* [12:14](u&t=734s) P\n   * old 41 <!-- p:41 --> <!-- note:abc1234 -->\n   * NEW forty-two <!-- p:42 -->\n   * NEW forty-three <!-- p:43 -->\n')
  })

  it('refreshing slides moves them by time and never touches Yasin\'s bullets', () => {
    const d = parseNotes(FILE)
    setSlides(d, [{ n: 1, t: 5, src: 'slides/slide-001.jpg' }, { n: 12, t: 740, src: 'slides/slide-012.jpg' }], paraTime)
    expect(d.sections[0].items.map((i) => i.kind)).toEqual(['bullet', 'slide'])
    expect(serializeNotes(d)).toContain('* ![Slide 1 · 0:05](slides/slide-001.jpg) <!-- slide:1 -->')
    expect(serializeNotes(d)).toContain('   * ==this is why always-on agents are cheap to pause==\n')
    expect(spansOf(d)).toEqual(spansOf(parseNotes(FILE)))
  })

  it('ensureSections adds missing parts and keeps orphan ones', () => {
    const d = parseNotes(FILE)
    ensureSections(d, [{ t: 0, title: 'Intro', url: 'u0' }, { t: 300, title: 'Middle', url: 'u300' }])
    expect(d.sections.map((s) => s.t)).toEqual([0, 300, 734])
    expect(d.sections[0].title).toBe('Intro')
    expect(markedOf(d.sections[2]).map((b) => b.p)).toEqual([41, 42])
  })

  it('flags bold, headers and mochi tags in AI bullets (not in Yasin\'s words)', () => {
    const d = parseNotes('* [0:00](https://www.youtube.com/watch?v=x&t=0s) A\n   * **Bold** idea <!-- p:0 -->\n   * ## Header <!-- p:0 -->\n   * fine = ok ==**mine**== <!-- p:0 -->\n   * ==**mine too**==\n')
    expect(formatProblems(d)).toEqual(['0:00: bold in "**Bold** idea"', '0:00: header in "## Header"'])
    expect(formatProblems(parseNotes(FILE))).toEqual([])
  })
})

describe('a bullet → a 💬 transcript note', () => {
  const paras = [
    { words: ['Hello', 'and', 'welcome.'], times: [0, 1, 2] },
    { words: ['An', 'agent', 'runs', 'on', 'its', 'own', 'computer,', 'a', 'Linux', 'box.'], times: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109] },
  ]

  it('goes under the bullet\'s paragraph, at its start', () => {
    expect(noteTarget(paras, 1)).toEqual({ para: 1, time: 100, end: null, quote: null, words: [] })
    expect(noteTarget(paras, 7).para).toBe(1)   // clamped
  })

  it('a selection whose words are in the paragraph → range + the transcript\'s exact words as the quote', () => {
    expect(noteTarget(paras, 1, 'its own computer')).toEqual({ para: 1, time: 104, end: 106, quote: 'its own computer,', words: [[1, 4], [1, 5], [1, 6]] })
    expect(noteTarget(paras, 1, 'gent runs on its own compu')).toMatchObject({ time: 102, end: 105, quote: 'runs on its own' })   // cut-off ends
    expect(noteTarget(paras, 1, 'Linux box (Firecracker VM)')).toMatchObject({ quote: null, time: 100 })   // not in the paragraph
  })

  it('the note text: no /command, no == marks, no markers', () => {
    expect(noteText('Agent runs ==my words== on a box <!-- p:41 --> /mochi')).toBe('Agent runs my words on a box')
    expect(noteText('==whole bullet of mine== /note')).toBe('whole bullet of mine')
    expect(noteText('see [the docs](https://x.y) and snake\\_case')).toBe('see the docs and snake_case')
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

  it('an AI text never holds `==` (it would read as Yasin\'s words)', () => {
    const v = validateNotes('* if a == b then <!-- p:0 -->', sec)
    expect(v.bullets[0].text).toBe('if a \\=\\= b then')
    expect(userSpans(v.bullets[0].text)).toEqual([])
  })

  it('rejects an answer with no bullets', () => {
    expect(() => validateNotes('   \n', sec)).toThrow(InvalidNotes)
  })
})

// ---------- generation: outline markers, prompt inputs, "nothing lost" checks ----------

describe('outline markers', () => {
  it('a heading from a slide title and slide-only text round-trip (and survive the editor transport)', () => {
    const f = '* [0:00](u&t=0s) A\n   * Durable workflows vs. job queues <!-- p:3 --> <!-- slide-title:12 -->\n      * Keep each tool\'s description under 4,000 characters (slide) <!-- p:3 --> <!-- slide:12 -->\n   * ![Slide 12 · 0:40](slides/slide-012.jpg) <!-- slide:12 -->\n'
    const d = parseNotes(f)
    const [h] = bulletsOf(d.sections[0])
    expect(h).toMatchObject({ text: 'Durable workflows vs. job queues', p: 3, slideTitle: 12 })
    expect(h.children[0]).toMatchObject({ text: 'Keep each tool\'s description under 4,000 characters (slide)', p: 3, slide: 12 })
    expect(d.sections[0].items[1]).toMatchObject({ kind: 'slide', n: 12 })
    expect(serializeNotes(d)).toBe(f)
    const ed = editorPart(d.sections[0], originalsFromSection(d.sections[0]), () => 40)
    expect(ed.md.split('\n')[0]).toBe('* Durable workflows vs. job queues <!-- p:3 t:40 o:0 --> <!-- slide-title:12 -->')
    setPart(d, 0, ed.md)
    expect(serializeNotes(d)).toBe(f)
  })
})

describe('slides next to their title heading', () => {
  it('a slide goes right before the bullet made from its title', () => {
    const d = parseNotes('* [0:00](u&t=0s) A\n   * Intro <!-- p:0 -->\n   * ![Slide 7 · 0:05](slides/s7.jpg) <!-- slide:7 -->\n')
    setAiNotes(d, 0, [{ text: 'Intro', p: 0, children: [] }, { text: 'How developers work with AI', p: 0, slideTitle: 7, children: [{ text: 'Four eras', p: 0, children: [] }] }], () => 0)
    expect(serializeNotes(d)).toBe('* [0:00](u&t=0s) A\n   * Intro <!-- p:0 -->\n   * ![Slide 7 · 0:05](slides/s7.jpg) <!-- slide:7 -->\n   * How developers work with AI <!-- p:0 --> <!-- slide-title:7 -->\n      * Four eras <!-- p:0 -->\n')
  })
})

describe('the prompt', () => {
  const sec: ViewSection = { t: 0, end: 320, title: 'Agents', kind: 'chapter', startPara: 0, endPara: 1 }
  it('with slides: titles, OCR text, times, the slide markers', () => {
    const p = buildNotesPrompt({ format: 'FORMAT', principles: 'Use direct verbs.', slides: [{ n: 4, t0: 49, t1: 126, title: 'Your agent vs. an always-on agent', text: 'Your agent vs. an always-on agent\nRuns on a server' }], description: 'About Grok Bot' }, W, sec)
    expect(p).toContain('Use direct verbs.')
    expect(p).toContain('S4 [0:49–2:06] title: Your agent vs. an always-on agent')
    expect(p).toContain('   | Runs on a server')
    expect(p).toContain('<!-- slide-title:S -->')
    expect(p).toContain('- YouTube description:\n  About Grok Bot')
    expect(p).not.toContain('host\'s questions')
  })
  it('no slides: the chapter, the host\'s questions (or: find them), topic shifts', () => {
    const withQ = buildNotesPrompt({ format: 'F', slides: [], questions: [{ p: 1, t: 100, text: 'where does the agent run?' }] }, W, sec)
    expect(withQ).toContain('the YouTube chapter "Agents"')
    expect(withQ).toContain('- P1 [1:40] where does the agent run?')
    expect(withQ).toContain('topic clearly shifts')
    expect(buildNotesPrompt({ format: 'F', slides: [], questions: null }, W, sec)).toContain('find them in the transcript')
  })
  it('the validator keeps slide markers of this part, adds "(slide)", gives a slide bullet its slide\'s paragraph', () => {
    const v = validateNotes('* Durable workflows <!-- p:1 --> <!-- slide-title:4 -->\n   * Under 4,000 characters <!-- slide:4 -->\n* Other <!-- p:1 --> <!-- slide:99 -->', sec,
      { slides: [{ n: 4, t0: 100, t1: 120, title: 'Durable workflows', text: '' }], paraAt: (t) => (t >= 100 ? 1 : 0) })
    expect(v.bullets[0]).toMatchObject({ text: 'Durable workflows', p: 1, slideTitle: 4 })
    expect(v.bullets[0].children[0]).toMatchObject({ text: 'Under 4,000 characters (slide)', p: 1, slide: 4 })
    expect(v.bullets[1].slide).toBeUndefined()
    expect(v.repairs.some((r) => r.includes('slide:99'))).toBe(true)
  })
})

describe('"nothing lost" checks', () => {
  const paras = [
    { words: ['Yeah.'], times: [0] },
    { words: ['Robotics', 'costs', 'dropped', '84%', 'in', 'two', 'months,', 'Jeff', 'Holden', 'said', 'at', 'Atomic', 'Machines.'], times: [10] },
    { words: ['[applause]'], times: [20] },
    { words: ['The', 'price', 'is', '$2.36', 'per', 'hour', 'with', 'Firecracker', 'snapshots.'], times: [30] },
    { words: ['We', 'think', 'Optimus', 'will', 'ship', 'in', '2027', 'for', 'sure.'], times: [40] },
  ]
  const B2 = (text: string, p: number | null, children: Bullet[] = []): Bullet => ({ text, p, children })

  it('coverage: real paragraphs only (filler-only ones skipped)', () => {
    const r = checkPart({ paras, startPara: 0, endPara: 4, bullets: [B2('Robotics costs dropped 84% in two months = Jeff Holden, Atomic Machines', 1)] })
    expect(r.contentParas).toBe(3)
    expect(r.uncovered).toEqual([{ p: 3, t: 30 }, { p: 4, t: 40 }])
    expect(isFillerOnly(['Okay,', 'so.'])).toBe(true)
    expect(isFillerOnly(['That', 'is', 'the', 'point.'])).toBe(false)
  })

  it('numbers and names: missing ones listed; a spelling fixed from the sources is fine', () => {
    expect(numbersIn(paras[3].words)).toEqual(['$2.36'])
    expect(namesIn(paras[1].words)).toEqual(['Jeff Holden', 'Atomic Machines'])
    expect(namesIn(['We', 'think', 'Optimus', 'will', 'ship.', 'Then', 'Tesla', 'wins.'])).toEqual(['Optimus'])
    const r = checkPart({
      paras, startPara: 0, endPara: 4,
      bullets: [B2('Costs dropped 84% in 2 months — Jeff Holden of Atomic Machines', 1), B2('Price = 2.36 per hour with FireCracker snapshots', 3), B2('Optimous ships in 2027', 4)],
      sources: ['Optimous: the robot (description)'],
    })
    expect(r.missing).toEqual([])
    // spaces / hyphens and a garbled caption spelling, fixed to the description's
    const garbled = [{ words: ['We', 'built', 'Grokbot', 'with', 'Anushia', 'for', 'the', 'X-P', 'Prize.'], times: [0] }]
    expect(checkPart({ paras: garbled, startPara: 0, endPara: 0, bullets: [B2('Built Grok Bot with Anousheh for the XPRIZE', 0)], sources: ['Grok Bot', 'Anousheh Ansari XPRIZE'] }).missing).toEqual([])
    expect(checkPart({ paras: garbled, startPara: 0, endPara: 0, bullets: [B2('Built a bot', 0)], sources: ['Grok Bot', 'Anousheh Ansari XPRIZE'] }).missing).toEqual(['Grokbot', 'Anushia', 'X-P Prize'])
    const r2 = checkPart({ paras, startPara: 0, endPara: 4, bullets: [B2('Costs dropped in two months', 1), B2('Price per hour', 3)] })
    expect(r2.missing).toEqual(['84%', 'Jeff Holden', 'Atomic Machines', '$2.36', 'Firecracker', '2027', 'Optimus'])
  })

  it('format: bold, headers, mochi tags in AI text', () => {
    const r = checkPart({ paras, startPara: 1, endPara: 1, bullets: [B2('**Costs** dropped 84% — Jeff Holden, Atomic Machines', 1), B2('#mochi card', 1)] })
    expect(r.format).toEqual(['bold: "**Costs** dropped 84% — Jeff Holden, Atomic Machines"', 'mochi tag: "#mochi card"'])
  })

  it('"cut, don\'t rewrite": bullets whose words are mostly not the speaker\'s are flagged', () => {
    const r = checkPart({
      paras, startPara: 1, endPara: 3, slideText: { 7: 'Firecracker snapshot pricing table hourly' },
      bullets: [
        B2('Robotics costs dropped 84% in two months', 1),
        B2('Automation expenditure plummeted dramatically recently', 1),
        { text: 'Firecracker snapshot pricing table (slide)', p: 3, children: [], slide: 7 },
      ],
    })
    expect(r.reworded.map((x) => x.text)).toEqual(['Automation expenditure plummeted dramatically recently'])
    expect(sourceShare('Robotics costs dropped', paras[1].words)).toBe(1)
  })
})
