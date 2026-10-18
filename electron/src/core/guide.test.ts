// The agent guide in each transcript .md (an HTML comment) and the parsers that must skip it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sampleMD } from './fixtures'
import { commentMask, ensureGuide, findGuides, GUIDE, GUIDE_VERSION, withoutComments } from './guide'
import { addNote, deleteNote, insert, note, paragraphCount, parse } from './notes'
import { writeStatus } from './status'
import { mkdirSync } from 'node:fs'

const temps: string[] = []
afterEach(() => { while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true }) })

const L = 'https://www.youtube.com/watch?v=ID'
const withGuide = ensureGuide(sampleMD)
const count = (s: string, sub: string): number => s.split(sub).length - 1

describe('agent guide', () => {
  it('mentions the current tags and formats (one copy of the text, in core)', () => {
    expect(GUIDE.startsWith(`<!-- follow-along guide v${GUIDE_VERSION} — `)).toBe(true)
    for (const s of ['#mochi', '#resolved', '> ↳ resolved:', '> 💬 [m:ss](link&t=Ns) text', '> “quote”', 'WITHOUT #resolved']) expect(GUIDE).toContain(s)
    expect(GUIDE.endsWith('\n-->')).toBe(true)
  })

  it('goes after the header list and before its "---", below frontmatter and title', () => {
    expect(withGuide).toBe(sampleMD.replace('- uploaded: 20261017\n\n---\n', `- uploaded: 20261017\n\n${GUIDE}\n\n---\n`))
    expect(withGuide.startsWith('---\nid: YAS-398\n---\n# Title')).toBe(true)
    // idempotent: exactly one block
    expect(ensureGuide(withGuide)).toBe(withGuide)
    expect(count(ensureGuide(ensureGuide(withGuide)), 'follow-along guide v')).toBe(1)
    // no header "---": nothing to do
    expect(ensureGuide('just text\n')).toBe('just text\n')
  })

  it('paragraph and note counts ignore everything inside comment blocks', () => {
    const md = insert(withGuide, 1, 13, 'real note')
    expect(paragraphCount(md)).toBe(paragraphCount(sampleMD))
    expect(parse(md)).toEqual([note(1, 13, 'real note')])
    // even comment lines that look exactly like paragraphs and notes
    const tricky = md.replace('# Title\n', `# Title\n<!--\n[0:00](${L}&t=0s) not a paragraph\n> 💬 [0:01](${L}&t=1s) not a note\n## 0:00 not a chapter\n-->\n`)
    expect(paragraphCount(tricky)).toBe(paragraphCount(sampleMD))
    expect(parse(tricky)).toEqual([note(1, 13, 'real note')])
    expect(withoutComments(tricky)).not.toContain('not a note')
    expect(commentMask(['a', '<!-- one line -->', 'b', '<!-- never closed', 'c'])).toEqual([false, true, false, true, false])
    // edits / deletes find the right note with the guide in the file
    expect(parse(deleteNote(tricky, 1, 0, 'real note', 13)[0])).toEqual([])
  })

  it('an old file gets the guide when a note is saved (and only then)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-guide-')); temps.push(dir)
    const path = join(dir, 'a.md')
    writeFileSync(path, sampleMD)
    addNote(path, 1, 13.7, 'my note')
    const out = readFileSync(path, 'utf8')
    expect(out).toBe(ensureGuide(insert(sampleMD, 1, 13.7, 'my note')))
    expect(count(out, 'follow-along guide v')).toBe(1)
    addNote(path, 1, 14, 'second')
    expect(count(readFileSync(path, 'utf8'), 'follow-along guide v')).toBe(1)
    expect(parse(readFileSync(path, 'utf8')).map((n) => n.text)).toEqual(['my note', 'second'])
  })

  it('a status write adds it too; the frontmatter and paragraphs stay', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fa-guide-')); temps.push(dir)
    const folder = join(dir, '10-17-a'); mkdirSync(folder)
    const path = join(folder, 'a.md')
    writeFileSync(path, sampleMD)
    writeStatus(folder, path, '2-Watching')
    const out = readFileSync(path, 'utf8')
    expect(count(out, 'follow-along guide v')).toBe(1)
    expect(out).toContain('status: 2-Watching')
    expect(paragraphCount(out)).toBe(paragraphCount(sampleMD))
    expect(out).toContain(`- uploaded: 20261017\n\n${GUIDE}\n\n---\n`)
  })

  it('an older version is replaced in place; extra copies go', () => {
    const v0 = '<!-- follow-along guide v0 — old rules\n- something old\n-->'
    const old = sampleMD.replace('- uploaded: 20261017\n\n---\n', `- uploaded: 20261017\n\n${v0}\n\n---\n`)
    expect(findGuides(old.split('\n')).map((g) => g.version)).toEqual([0])
    expect(ensureGuide(old)).toBe(withGuide)
    const twice = withGuide.replace('# Title\n', `# Title\n${GUIDE}\n`)
    // the first copy stays, the later one goes with its blank line
    expect(ensureGuide(twice)).toBe(sampleMD.replace('# Title\n', `# Title\n${GUIDE}\n`))
    expect(count(ensureGuide(twice), 'follow-along guide v')).toBe(1)
  })
})
