// Resolved notes: `#resolved` right after the time link = done (no tag = open), plus optional
// `> ↳ resolved: …` line(s) written by the agent that handled the note.
import { describe, expect, it } from 'vitest'
import { deleteNote, editNote, insert, note, noteJSON, parse, setCategory, setResolved } from './notes'
import { sampleMD } from './fixtures'

const L = 'https://www.youtube.com/watch?v=ID'
const md = `# T

[0:00](${L}&t=0s) First paragraph.

> 💬 [0:01](${L}&t=1s) #mochi #resolved point card
> ↳ resolved: made the Mochi card

> 💬 [0:02–0:05](${L}&t=2s) #RESOLVED #Mochi range card
> second line
> ↳ resolved: card "range" in deck X
> ↳ resolved: also linked it
> “First paragraph.”

> 💬 #resolved typed by hand

> 💬 [0:06](${L}&t=6s) open note
> “First”

[0:11](${L}&t=11s) — Second.

> 💬 [0:12](${L}&t=12s) old untouched note
`

describe('resolved notes', () => {
  it('parses both tags in either order and any case, and the resolution lines with or without a quote', () => {
    expect(parse(md)).toEqual([
      note(0, 1, 'point card', null, null, 'mochi', true, 'made the Mochi card'),
      note(0, 2, 'range card\nsecond line', 5, 'First paragraph.', 'mochi', true, 'card "range" in deck X\nalso linked it'),
      note(0, null, 'typed by hand', null, null, 'general', true),
      note(0, 6, 'open note', null, 'First'),
      note(1, 12, 'old untouched note'),
    ])
  })

  it('old notes are open; the JSON has resolved and the resolution', () => {
    const n = parse(md)
    expect(n[4].resolved).toBe(false)
    expect(n[4].resolution).toBeNull()
    expect(noteJSON(n[0])).toEqual({ para: 0, time: 1, text: 'point card', category: 'mochi', resolved: true, resolution: 'made the Mochi card' })
  })

  it('toggling resolved changes only the tags, byte for byte (resolution lines stay)', () => {
    const reopened = setResolved(md, 0, 0, 'point card', 1, false)
    expect(reopened).toBe(md.replace('&t=1s) #mochi #resolved point card', '&t=1s) #mochi point card'))
    expect(setResolved(reopened, 0, 0, 'point card', 1, true)).toBe(md)
    // open → resolved: written lowercase after #mochi
    expect(setResolved(md, 0, 3, 'open note', 6, true)).toBe(md.replace('&t=6s) open note', '&t=6s) #resolved open note'))
    expect(setResolved(md, 1, 0, 'old untouched note', 12, true)).toBe(md.replace('&t=12s) old untouched', '&t=12s) #resolved old untouched'))
    // the tag group is written canonically: #mochi first, lowercase
    expect(setResolved(md, 0, 1, 'range card\nsecond line', 2, false)).toBe(md.replace('#RESOLVED #Mochi range card', '#mochi range card'))
    expect(setResolved(md, 0, 2, 'typed by hand', null, false)).toBe(md.replace('> 💬 #resolved typed by hand', '> 💬 typed by hand'))
    // category toggle keeps #resolved
    expect(setCategory(md, 0, 0, 'point card', 1, 'general')).toBe(md.replace('#mochi #resolved point card', '#resolved point card'))
    // already in that state: unchanged
    expect(setResolved(md, 0, 0, 'point card', 1, true)).toBe(md)
  })

  it('edit keeps the tags, the resolution lines and the quote', () => {
    const out = editNote(md, 0, 1, 'range card\nsecond line', 2, 'new text')
    expect(out).toContain(`> 💬 [0:02–0:05](${L}&t=2s) #mochi #resolved new text
> ↳ resolved: card "range" in deck X
> ↳ resolved: also linked it
> “First paragraph.”`)
    expect(parse(out)[1]).toEqual(note(0, 2, 'new text', 5, 'First paragraph.', 'mochi', true, 'card "range" in deck X\nalso linked it'))
  })

  it('delete and safe matching work with tags and resolution lines', () => {
    const [out] = deleteNote(md, 0, 1, 'range card\nsecond line', 2)
    expect(out).not.toContain('range card')
    expect(out).not.toContain('deck X')
    expect(parse(out).length).toBe(4)
    expect(() => deleteNote(md, 0, 0, 'point card\n↳ resolved: made the Mochi card', 1)).toThrow()
    expect(() => setResolved(md, 0, 3, 'open note!', 6, true)).toThrow()
  })

  it('insert writes typed tags canonically', () => {
    expect(insert(sampleMD, 1, 13, '#Resolved #MOCHI done already')).toContain(`&t=13s) #mochi #resolved done already\n`)
    expect(insert(sampleMD, 1, 13, 'x', null, null, 'mochi')).toContain(`&t=13s) #mochi x\n`)
  })
})
