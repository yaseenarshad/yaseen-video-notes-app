// Port of Tests/FollowAlongKitTests/NoteEditTests.swift (NoteEditTests, ProgressTests).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deleteNote, editNote, note, paragraphCount, parse, restoreNote } from './notes'
import { left, PROGRESS_FILE, readProgress, writeProgress, finished } from './progress'

/** Paragraph 0 has a single-line note, a multi-line note, a range note with a quote and a hand-typed note; paragraph 1 has one note. */
const md = `---
id: YAS-1
---
# T

- url: https://www.youtube.com/watch?v=ID

---

[0:00](https://www.youtube.com/watch?v=ID&t=0s) First paragraph.

> 💬 [0:01](https://www.youtube.com/watch?v=ID&t=1s) single

> 💬 [0:02](https://www.youtube.com/watch?v=ID&t=2s) multi one
> multi two

> 💬 [0:03–0:05](https://www.youtube.com/watch?v=ID&t=3s) ranged
> “First paragraph.”
> 💬 typed by hand

[0:11](https://www.youtube.com/watch?v=ID&t=11s) — Second.

> 💬 [0:12](https://www.youtube.com/watch?v=ID&t=12s) other
`

const texts = (s: string): string[] => parse(s).map((n) => n.text)

describe('NoteEditTests', () => {
  it('delete each kind, and undo restores the exact file', () => {
    const cases: [number, number, string, number | null][] = [
      [0, 0, 'single', 1], [0, 1, 'multi one\nmulti two', 2], [0, 2, 'ranged', 3], [0, 3, 'typed by hand', null], [1, 0, 'other', 12],
    ]
    for (const [para, index, text, time] of cases) {
      const [out, removed] = deleteNote(md, para, index, text, time)
      expect(texts(out), `delete ${text}`).toEqual(texts(md).filter((t) => t !== text))
      expect(paragraphCount(out)).toBe(2)
      expect(out).toContain('[0:00](https://www.youtube.com/watch?v=ID&t=0s) First paragraph.')
      expect(restoreNote(out, removed), `undo ${text}`).toBe(md)
    }
  })

  it('delete removes the quote and the blank line before', () => {
    const [out, removed] = deleteNote(md, 0, 2, 'ranged', 3)
    expect(out).not.toContain('ranged')
    expect(out).not.toContain('“First paragraph.”')
    expect(out).toContain('> multi two\n> 💬 typed by hand')
    expect(removed.block).toEqual(['', '> 💬 [0:03–0:05](https://www.youtube.com/watch?v=ID&t=3s) ranged', '> “First paragraph.”'])
  })

  it('a changed note is not touched', () => {
    expect(() => deleteNote(md, 0, 0, 'something else', 1)).toThrow('Note changed in the file — try again')
    expect(() => deleteNote(md, 0, 0, 'single', 9)).toThrow()
    expect(() => deleteNote(md, 0, 7, 'single', 1)).toThrow()
    expect(() => editNote(md, 1, 0, 'changed', 12, 'x')).toThrow()
  })

  it('undo finds its spot after the file moved', () => {
    const [out, removed] = deleteNote(md, 1, 0, 'other', 12)
    const moved = out.replace('# T\n', '# T\n\nextra line added in Obsidian\n')
    const back = restoreNote(moved, removed)
    expect(parse(back).at(-1)).toEqual(note(1, 12, 'other'))
    expect(back).toContain('extra line added in Obsidian')
  })

  it('edit keeps time, range and quote', () => {
    let out = editNote(md, 0, 2, 'ranged', 3, 'new words\nsecond line')
    expect(out).toContain(`> 💬 [0:03–0:05](https://www.youtube.com/watch?v=ID&t=3s) new words
> second line
> “First paragraph.”
> 💬 typed by hand`)
    out = editNote(out, 0, 3, 'typed by hand', null, 'retyped')
    expect(out).toContain('> 💬 retyped\n')
    out = editNote(out, 0, 1, 'multi one\nmulti two', 2, 'one line now')
    expect(texts(out)).toEqual(['single', 'one line now', 'new words\nsecond line', 'retyped', 'other'])
    expect(parse(out)[2].quote).toBe('First paragraph.')
    expect(parse(out)[2].end).toBe(5)
  })
})

describe('ProgressTests', () => {
  it('save, load and a broken file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-pos-'))
    try {
      expect(readProgress(dir)).toBeNull()
      writeProgress(dir, 1808.4, 6271)
      const p = readProgress(dir)
      expect(p?.seconds).toBe(1808)
      expect(p?.duration).toBe(6271)
      expect(p && finished(p)).toBe(false)
      expect(p && Math.trunc(left(p))).toBe(4463)
      const json = JSON.parse(readFileSync(join(dir, PROGRESS_FILE), 'utf8'))
      expect(new Set(Object.keys(json))).toEqual(new Set(['seconds', 'duration', 'updated', 'device']))
      writeFileSync(join(dir, PROGRESS_FILE), 'not json')
      expect(readProgress(dir)).toBeNull()
      writeProgress(dir, 6250, 6271)
      const q = readProgress(dir)
      expect(q && finished(q)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes the bytes Swift JSONEncoder writes (pretty, sorted keys, " : ")', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-pos-'))
    try {
      writeProgress(dir, 853.4, 8071, new Date(Date.UTC(2026, 9, 18, 2, 11, 43, 512)))
      const text = readFileSync(join(dir, PROGRESS_FILE), 'utf8')
      const device = JSON.parse(text).device as string
      expect(text).toBe(`{\n  "device" : ${JSON.stringify(device).replaceAll('/', '\\/')},\n  "duration" : 8071,\n  "seconds" : 853,\n  "updated" : "2026-10-18T02:11:43Z"\n}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
