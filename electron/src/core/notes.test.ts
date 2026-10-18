// Port of Tests/FollowAlongKitTests/NotesTests.swift (NotesTests, FolderTests).
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensure, existingFolder, format, headPart, titleInMarkdown } from './folderMaker'
import { rollingVTT, sampleMD } from './fixtures'
import { addNote, insert, note, paragraphCount, parse, shortQuote } from './notes'
import { encodeSidecar, SIDECAR_FILE, videoInfo } from './transcript'

const temps: string[] = []
const tempDir = (prefix: string): string => { const d = mkdtempSync(join(tmpdir(), prefix)); temps.push(d); return d }
afterEach(() => { while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true }) })

describe('NotesTests', () => {
  it('frontmatter and header are not paragraphs or notes', () => {
    expect(paragraphCount(sampleMD)).toBe(3)
    expect(parse(sampleMD)).toEqual([])
    expect(titleInMarkdown(sampleMD)).toBe('Title')
  })

  it('insert a single-time note', () => {
    const md = insert(sampleMD, 1, 13.7, 'my note')
    expect(md).toContain(`[0:11](https://www.youtube.com/watch?v=ID&t=11s) — Second paragraph.

> 💬 [0:13](https://www.youtube.com/watch?v=ID&t=13s) my note

[1:02:03]`)
    expect(parse(md)).toEqual([note(1, 13, 'my note')])
  })

  it('notes go after existing notes and multi-line works', () => {
    let md = insert(sampleMD, 0, 2, 'one')
    md = insert(md, 0, 5, 'two\nsecond line')
    expect(md).toContain(`> 💬 [0:02](https://www.youtube.com/watch?v=ID&t=2s) one

> 💬 [0:05](https://www.youtube.com/watch?v=ID&t=5s) two
> second line

[0:11]`)
    expect(parse(md)).toEqual([note(0, 2, 'one'), note(0, 5, 'two\nsecond line')])
  })

  it('insert into the last paragraph', () => {
    const md = insert(sampleMD, 2, 3725, 'late')
    expect(md).toContain('— Third paragraph.\n\n> 💬 [1:02:05](https://www.youtube.com/watch?v=ID&t=3725s) late')
    expect(parse(md)[0]?.para).toBe(2)
    expect(() => insert(sampleMD, 3, 0, 'x')).toThrow()
  })

  it('range note format and parse', () => {
    const md = insert(sampleMD, 1, 1781.4, "the user's note\nmore", 1798.9, 'exact highlighted\nwords here')
    expect(md).toContain(`> 💬 [29:41–29:58](https://www.youtube.com/watch?v=ID&t=1781s) the user's note
> more
> “exact highlighted words here”`)
    expect(parse(md)).toEqual([note(1, 1781, "the user's note\nmore", 1798, 'exact highlighted words here')])
  })

  it('long quotes keep the first and last six words', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => `w${i + 1}`).join(' ')
    expect(shortQuote(fifteen)).toBe(fifteen)
    const long = 'manufacturing and all sorts of things. We built it, then we sold it. And so now you can smooth'
    expect(shortQuote(long)).toBe('manufacturing and all sorts of things. … And so now you can smooth')
    const md = insert(sampleMD, 0, 1, 'n', 9, long)
    expect(md).toContain('> 💬 [0:01–0:09](https://www.youtube.com/watch?v=ID&t=1s) n\n> “manufacturing and all sorts of things. … And so now you can smooth”')
    expect(parse(md)[0]?.quote).toBe('manufacturing and all sorts of things. … And so now you can smooth')
    // An old full-length quote still parses.
    const old = sampleMD.replace('First paragraph words.\n', `First paragraph words.\n\n> 💬 [0:00–0:20](https://www.youtube.com/watch?v=ID&t=0s) x\n> “${long}”\n`)
    expect(parse(old)[0]?.quote).toBe(long)
  })

  it('a one-word highlight is a single time with its quote', () => {
    const md = insert(sampleMD, 1, 1191.2, 'what is this', 1191.6, 'labbotomized')
    expect(md).toContain('> 💬 [19:51](https://www.youtube.com/watch?v=ID&t=1191s) what is this\n> “labbotomized”')
    expect(parse(md)).toEqual([note(1, 1191, 'what is this', null, 'labbotomized')])
  })

  it('range note with single-line text', () => {
    const md = sampleMD.replace('— Second paragraph.\n', `— Second paragraph.

> 💬 [0:11–1:00:02](https://www.youtube.com/watch?v=ID&t=11s) why
> “Second paragraph.”
`)
    expect(parse(md)).toEqual([note(1, 11, 'why', 3602, 'Second paragraph.')])
  })

  it('hand-typed notes belong to the paragraph above', () => {
    const md = sampleMD
      .replace('First paragraph words.\n', 'First paragraph words.\n> 💬 typed in Obsidian\n>continued\n')
      .replace('— Third paragraph.\n', '— Third paragraph.\n\n>💬no space\n\nnot a note\n> plain quote, not a note\n')
    expect(parse(md)).toEqual([note(0, null, 'typed in Obsidian\ncontinued'), note(2, null, 'no space')])
  })

  it('a note above the first paragraph is ignored', () => {
    expect(parse(sampleMD.replace('# Title\n', '# Title\n> 💬 stray\n'))).toEqual([])
  })

  it('frontmatter added later does not move notes', () => {
    const plain = sampleMD.replace('---\nid: YAS-398\n---\n', '')
    const a = insert(plain, 1, 12, 'x')
    const withFM = '---\nid: YAS-999\n---\n' + a
    expect(parse(withFM)).toEqual([note(1, 12, 'x')])
    const b = insert(withFM, 1, 14, 'y')
    expect(parse(b).map((n) => n.text)).toEqual(['x', 'y'])
    expect(b.startsWith('---\nid: YAS-999\n---\n# Title')).toBe(true)
  })

  it('atomic add writes the file', () => {
    const dir = tempDir('fa-notes-')
    const path = join(dir, 't.md')
    writeFileSync(path, sampleMD)
    const notes = addNote(path, 0, 1, 'saved')
    expect(notes.length).toBe(1)
    expect(parse(readFileSync(path, 'utf8'))[0]?.text).toBe('saved')
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('FolderTests', () => {
  it('ensure reuses a folder and keeps notes', async () => {
    const parent = tempDir('fa-folder-')
    const folder = join(parent, '10-17-a-title')
    mkdirSync(folder, { recursive: true })
    const info = videoInfo({ id: 'abcdefghijk', title: 'A Title', channel: 'C', duration: 60, viewCount: 1, uploadDate: '20261017' })
    const made = format(info, rollingVTT)
    const md = join(folder, 'a-title.md')
    const withNote = insert('---\nid: YAS-1\n---\n' + made.markdown, 1, 12, 'keep me')
    writeFileSync(md, withNote)
    writeFileSync(join(folder, SIDECAR_FILE), encodeSidecar(made.sidecar))

    expect(realpathSync(existingFolder('abcdefghijk', parent)!)).toBe(realpathSync(folder))
    expect(existingFolder('zzzzzzzzzzz', parent)).toBeNull()
    const t = await ensure(md) // a .md path works too; no download needed
    expect(t.reused).toBe(true)
    expect(t.markdown.split('/').pop()).toBe('a-title.md')
    expect(readFileSync(md, 'utf8')).toBe(withNote)
  })

  it('existing folder found by the markdown url line', () => {
    const parent = tempDir('fa-folder-')
    const folder = join(parent, '10-01-something')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'something.md'), sampleMD.replaceAll('v=ID', 'v=abcdefghijk'))
    expect(realpathSync(existingFolder('abcdefghijk', parent)!)).toBe(realpathSync(folder))
  })

  it('head part keeps frontmatter and header', () => {
    const head = headPart(sampleMD)
    expect(head?.startsWith('---\nid: YAS-398\n---\n# Title')).toBe(true)
    expect(head?.endsWith('- uploaded: 20261017\n\n---\n')).toBe(true)
  })
})
