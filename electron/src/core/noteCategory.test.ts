// Note categories: `#mochi` right after the time link = make a Mochi flashcard; no tag = general.
import { describe, expect, it } from 'vitest'
import { sampleMD } from './fixtures'
import { deleteNote, editNote, insert, note, noteJSON, parse, setCategory } from './notes'

const L = 'https://www.youtube.com/watch?v=ID'
const md = `# T

[0:00](${L}&t=0s) First paragraph.

> 💬 [0:01](${L}&t=1s) #mochi point card

> 💬 [0:02–0:05](${L}&t=2s) #MOCHI range card
> second line
> “First paragraph.”

> 💬 #Mochi typed by hand

> 💬 [0:06](${L}&t=6s) plain old note

> 💬 [0:07](${L}&t=7s) #mochicards is not the tag

[0:11](${L}&t=11s) — Second.

> 💬 untagged by hand
`

describe('note categories', () => {
  it('parses #mochi (any case) after the time link or after "> 💬 ", and strips it from the text', () => {
    expect(parse(md)).toEqual([
      note(0, 1, 'point card', null, null, 'mochi'),
      note(0, 2, 'range card\nsecond line', 5, 'First paragraph.', 'mochi'),
      note(0, null, 'typed by hand', null, null, 'mochi'),
      note(0, 6, 'plain old note'),
      note(0, 7, '#mochicards is not the tag'),
      note(1, null, 'untagged by hand'),
    ])
  })

  it('old untagged notes are general, in the JSON too', () => {
    const notes = parse(md)
    expect(notes.slice(3).map((n) => n.category)).toEqual(['general', 'general', 'general'])
    expect(noteJSON(notes[3])).toEqual({ id: notes[3].id, para: 0, time: 6, text: 'plain old note', category: 'general', resolved: false })
    expect(noteJSON(notes[1])).toEqual({ id: notes[1].id, para: 0, time: 2, end: 5, text: 'range card\nsecond line', quote: 'First paragraph.', category: 'mochi', resolved: false })
  })

  it('a tag alone is a mochi note with empty text', () => {
    expect(parse(`[0:00](${L}&t=0s) p\n\n> 💬 [0:01](${L}&t=1s) #mochi`)[0]).toEqual(note(0, 1, '', null, null, 'mochi'))
  })

  it('insert writes the tag first on the first line; general writes no tag', () => {
    let out = insert(sampleMD, 1, 13.7, 'card text\nmore', null, null, 'mochi')
    expect(out).toContain(`> 💬 [0:13](${L}&t=13s) #mochi card text\n> more\n`)
    out = insert(out, 1, 14, 'range card', 15, 'Second paragraph.', 'mochi')
    expect(out).toContain(`> 💬 [0:14–0:15](${L}&t=14s) #mochi range card\n> “Second paragraph.”`)
    out = insert(out, 1, 16, 'plain')
    expect(out).toContain(`> 💬 [0:16](${L}&t=16s) plain\n`)
    expect(out).not.toContain('#general')
    expect(parse(out).map((n) => [n.text, n.category])).toEqual([
      ['card text\nmore', 'mochi'], ['range card', 'mochi'], ['plain', 'general'],
    ])
    // text typed with the tag already in front keeps a single tag
    expect(insert(sampleMD, 1, 13, '#mochi typed', null, null, 'mochi')).toContain(') #mochi typed\n')
  })

  it('edit keeps the category, or changes it when asked', () => {
    let out = editNote(md, 0, 1, 'range card\nsecond line', 2, 'new range text')
    expect(out).toContain(`> 💬 [0:02–0:05](${L}&t=2s) #mochi new range text\n> “First paragraph.”`)
    out = editNote(out, 0, 2, 'typed by hand', null, 'retyped')
    expect(out).toContain('> 💬 #mochi retyped\n')
    out = editNote(out, 0, 3, 'plain old note', 6, 'still plain')
    expect(out).toContain(`> 💬 [0:06](${L}&t=6s) still plain\n`)
    out = editNote(out, 0, 3, 'still plain', 6, 'now a card', 'mochi')
    out = editNote(out, 0, 0, 'point card', 1, 'now general', 'general')
    expect(parse(out).slice(0, 4).map((n) => [n.text, n.category])).toEqual([
      ['now general', 'general'], ['new range text', 'mochi'], ['retyped', 'mochi'], ['now a card', 'mochi'],
    ])
  })

  it('toggling the category changes only the tag', () => {
    let out = setCategory(md, 0, 3, 'plain old note', 6, 'mochi')
    expect(out).toBe(md.replace(`&t=6s) plain old note`, `&t=6s) #mochi plain old note`))
    out = setCategory(out, 0, 3, 'plain old note', 6, 'general')
    expect(out).toBe(md)
    // range note: the first line changes, the continuation and quote lines stay byte for byte
    out = setCategory(md, 0, 1, 'range card\nsecond line', 2, 'general')
    expect(out).toBe(md.replace('#MOCHI range card', 'range card'))
    // hand-typed note without a time
    expect(setCategory(md, 0, 2, 'typed by hand', null, 'general')).toBe(md.replace('> 💬 #Mochi typed by hand', '> 💬 typed by hand'))
    expect(setCategory(md, 1, 0, 'untagged by hand', null, 'mochi')).toBe(md.replace('> 💬 untagged by hand', '> 💬 #mochi untagged by hand'))
    // already that category: unchanged
    expect(setCategory(md, 0, 0, 'point card', 1, 'mochi')).toBe(md)
  })

  it('delete / edit / toggle still check the note against the file (tag not part of the text)', () => {
    expect(deleteNote(md, 0, 0, 'point card', 1)[0]).not.toContain('point card')
    expect(() => deleteNote(md, 0, 0, '#mochi point card', 1)).toThrow('Note changed in the file — try again')
    expect(() => editNote(md, 0, 1, 'range card', 2, 'x')).toThrow()
    expect(() => setCategory(md, 0, 3, 'plain old note', 9, 'mochi')).toThrow()
    expect(() => setCategory(md, 0, 9, 'plain old note', 6, 'mochi')).toThrow()
  })
})
