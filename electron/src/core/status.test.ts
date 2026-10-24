// Port of Tests/FollowAlongKitTests/StatusTests.swift.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { insert, paragraphCount } from './notes'
import {
  addColumn, advanceOnOpen, DEFAULT_OPTIONS, effectiveOptions, folderInfo, mapStatus, migrateOptions, migrateStatus, OLD_OPTIONS, openAdvance, readStatus,
  setValue, statusOptions, value, withColumn, writeStatus, yaml,
} from './status'

const body = '# T\n\n- url: https://www.youtube.com/watch?v=ID\n\n---\n\n[0:00](https://www.youtube.com/watch?v=ID&t=0s) Words.\n'

describe('StatusTests', () => {
  it('a note without frontmatter gets one', () => {
    const out = setValue(body, '3vzxnrx8km6f', '2-Watching')
    expect(out).toBe('---\nin:\n  3vzxnrx8km6f:\n    status: 2-Watching\n---\n' + body)
    expect(value(out, '3vzxnrx8km6f')).toBe('2-Watching')
    expect(paragraphCount(out)).toBe(1)
    expect(insert(out, 0, 1, 'n').split('💬').length).toBe(2)
  })

  it('existing frontmatter keeps id and other blocks', () => {
    const md = '---\nid: YAS-398\ntitle: "Keep: me"\nin:\n  otherfolder:\n    Status: Done\n    rank: 3\ntags:\n  - a\n---\n' + body
    let out = setValue(md, '3vzxnrx8km6f', '2-Watching')
    expect(out).toBe('---\nid: YAS-398\ntitle: "Keep: me"\nin:\n  otherfolder:\n    Status: Done\n    rank: 3\n  3vzxnrx8km6f:\n    status: 2-Watching\ntags:\n  - a\n---\n' + body)
    out = setValue(out, '3vzxnrx8km6f', '3-Watched')
    expect(out).toContain('  3vzxnrx8km6f:\n    status: 3-Watched\ntags:')
    expect(value(out, 'otherfolder')).toBeNull() // other folder has "Status", not "status"
    expect(value(out, '3vzxnrx8km6f')).toBe('3-Watched')
    expect(out.split('\n').filter((l) => l.startsWith('id: YAS-398')).length).toBe(1)
    // A value in a block that also holds other columns: only the status line changes.
    const more = out.replace('    status: 3-Watched\n', '    rating: 5\n    status: 3-Watched\n')
    expect(setValue(more, '3vzxnrx8km6f', '4-Carded')).toContain('    rating: 5\n    status: 4-Carded\n')
  })

  it('a folder without an id uses the top-level key', () => {
    const md = '---\nid: YAS-1\n---\n' + body
    const out = setValue(md, null, '1-To-Watch')
    expect(out).toBe('---\nid: YAS-1\nstatus: 1-To-Watch\n---\n' + body)
    expect(value(out, null)).toBe('1-To-Watch')
  })

  it('a flow-style `in` is never overwritten', () => {
    expect(() => setValue('---\nin: {x: {status: a}}\n---\n' + body, 'y', '2-Watching')).toThrow()
  })

  it('quoting of odd values', () => {
    expect(yaml('2-Watching')).toBe('2-Watching')
    expect(yaml('1 - Awaiting Outbound')).toBe('1 - Awaiting Outbound')
    expect(yaml('yes')).toBe('"yes"')
    expect(yaml('a: b')).toBe('"a: b"')
    expect(value(setValue('---\n---\n', 'f', 'a: b'), 'f')).toBe('a: b')
  })

  it('the folder file column add is idempotent and keeps everything', () => {
    const folder = '---\nid: 3vzxnrx8km6f\ntitle: Learning-Log\n---\n'
    const once = addColumn(folder)
    expect(once).toBe(`---
id: 3vzxnrx8km6f
title: Learning-Log
folder_settings:
  columns:
    status:
      kind: select
      options:
        - 1-Backlog
        - 2-Todo
        - 3-In-Progress
        - 4-Done
      optionSort: manual
---
`)
    expect(addColumn(once)).toBe(once)
    expect(folderInfo(once)).toEqual({ id: '3vzxnrx8km6f', options: DEFAULT_OPTIONS })
  })

  it('the column is added beside other settings and an existing column is kept', () => {
    const folder = `---
folder_settings:
  columns:
    Name:
      kind: text
  views:
    - type: table
      name: Table
status: null
id: abc
---
`
    expect(addColumn(folder)).toBe(`---
folder_settings:
  columns:
    Name:
      kind: text
    status:
      kind: select
      options:
        - 1-Backlog
        - 2-Todo
        - 3-In-Progress
        - 4-Done
      optionSort: manual
  views:
    - type: table
      name: Table
status: null
id: abc
---
`)
    const existing = folder.replace('    Name:\n      kind: text\n', '    status:\n      kind: select\n      options:\n        - 1-Backlog\n        - 2-Todo\n')
    expect(addColumn(existing)).toBe(existing)
    expect(folderInfo(existing).options).toEqual(['1-Backlog', '2-Todo'])
    const noColumns = '---\nid: x\nfolder_settings:\n  views:\n    - type: board\n      name: Board\n---\n'
    expect(addColumn(noColumns)).toContain('folder_settings:\n  views:\n    - type: board\n      name: Board\n  columns:\n    status:\n')
  })

  it('write and advance on copies', () => {
    const root = mkdtempSync(join(tmpdir(), 'fa-status-'))
    try {
      const parent = join(root, 'learning-log')
      const video = join(parent, '10-17-x')
      mkdirSync(video, { recursive: true })
      writeFileSync(join(parent, '.folder.md'), '---\nid: LL1\ntitle: Learning-Log\n---\n')
      const md = join(video, 'x.md')
      writeFileSync(md, '---\nid: YAS-1\n---\n' + body)
      expect(readStatus(video, md)).toBeNull()
      expect(advanceOnOpen(video, md)).toBe('3-In-Progress') // empty → In progress
      expect(advanceOnOpen(video, md)).toBeNull() // already there
      writeStatus(video, md, '4-Done') // manual change: any direction
      expect(advanceOnOpen(video, md)).toBeNull() // Done stays Done
      writeStatus(video, md, '1-Backlog')
      expect(readStatus(video, md)).toBe('1-Backlog')
      expect(readFileSync(md, 'utf8').startsWith('---\nid: YAS-1\nin:\n  LL1:\n    status: 1-Backlog\n---\n# T')).toBe(true)
      expect(readFileSync(join(parent, '.folder.md'), 'utf8')).toContain('    status:\n      kind: select\n      options:\n        - 1-Backlog\n')
      expect(advanceOnOpen(video, md)).toBe('3-In-Progress') // Backlog → In progress
      writeStatus(video, md, '2-Todo')
      expect(advanceOnOpen(video, md)).toBe('3-In-Progress') // Todo → In progress
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const OLD_FOLDER = `---
id: 3vzxnrx8km6f
title: Learning-Log
folder_settings:
  columns:
    status:
      kind: select
      options:
        - 1-To-Watch
        - 2-Watching
        - 3-Watched
        - 4-Carded
      optionSort: manual
---
`

describe('old statuses (1-To-Watch…4-Carded) → docs-app defaults (1-Backlog…4-Done)', () => {
  it('old values read as new ones', () => {
    expect(mapStatus('1-To-Watch')).toBe('2-Todo')
    expect(mapStatus('2-Watching')).toBe('3-In-Progress')
    expect(mapStatus('3-Watched')).toBe('3-In-Progress')
    expect(mapStatus('4-Carded')).toBe('4-Done')
    expect(mapStatus('2-Todo')).toBe('2-Todo')
    expect(mapStatus(null)).toBeNull()
    expect(mapStatus('')).toBeNull()
    expect(mapStatus('Someday')).toBe('Someday') // not an old value: as is
    // a folder whose own options still have the old value keeps it
    expect(mapStatus('2-Watching', ['2-Watching', 'Done'])).toBe('2-Watching')
    // a custom list without the new value: as is
    expect(mapStatus('2-Watching', ['A', 'B'])).toBe('2-Watching')
    // an exactly-old option list reads as the new one
    expect(effectiveOptions(OLD_OPTIONS)).toEqual(DEFAULT_OPTIONS)
    expect(effectiveOptions(null)).toEqual(DEFAULT_OPTIONS)
    expect(effectiveOptions(['A', 'B'])).toEqual(['A', 'B'])
    expect(effectiveOptions(['1-To-Watch', '2-Watching', '3-Watched'])).toEqual(['1-To-Watch', '2-Watching', '3-Watched'])
  })

  it('auto-advance on open: empty / Backlog / Todo → In progress; never from In progress or Done', () => {
    expect(openAdvance(null, DEFAULT_OPTIONS)).toBe('3-In-Progress')
    expect(openAdvance('1-Backlog', DEFAULT_OPTIONS)).toBe('3-In-Progress')
    expect(openAdvance('2-Todo', DEFAULT_OPTIONS)).toBe('3-In-Progress')
    expect(openAdvance('1-To-Watch', DEFAULT_OPTIONS)).toBe('3-In-Progress') // old Todo
    expect(openAdvance('3-In-Progress', DEFAULT_OPTIONS)).toBeNull()
    expect(openAdvance('2-Watching', DEFAULT_OPTIONS)).toBeNull() // old In progress
    expect(openAdvance('4-Done', DEFAULT_OPTIONS)).toBeNull()
    expect(openAdvance('4-Carded', DEFAULT_OPTIONS)).toBeNull()
    expect(openAdvance('Someday', DEFAULT_OPTIONS)).toBeNull() // unknown value: left alone
    expect(openAdvance(null, ['A', 'B'])).toBeNull() // the user's own options: no auto-advance
  })

  it('.folder.md: the old app-written set is replaced (minimal), a custom set is untouched, idempotent', () => {
    const once = migrateOptions(OLD_FOLDER)
    expect(once).toBe(OLD_FOLDER.replace('- 1-To-Watch\n        - 2-Watching\n        - 3-Watched\n        - 4-Carded',
      '- 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done'))
    expect(migrateOptions(once)).toBe(once)
    expect(withColumn(OLD_FOLDER)).toBe(once)
    expect(folderInfo(once).options).toEqual(DEFAULT_OPTIONS)
    // flow style
    const flow = '---\nfolder_settings:\n  columns:\n    status:\n      kind: select\n      options: [1-To-Watch, 2-Watching, 3-Watched, 4-Carded]\n---\n'
    expect(migrateOptions(flow)).toBe(flow.replace('[1-To-Watch, 2-Watching, 3-Watched, 4-Carded]', '[1-Backlog, 2-Todo, 3-In-Progress, 4-Done]'))
    // custom sets (other order, fewer, extra) are the user's own
    const reordered = OLD_FOLDER.replace('- 1-To-Watch\n        - 2-Watching', '- 2-Watching\n        - 1-To-Watch')
    expect(migrateOptions(reordered)).toBe(reordered)
    const extra = OLD_FOLDER.replace('        - 4-Carded\n', '        - 4-Carded\n        - 5-Later\n')
    expect(migrateOptions(extra)).toBe(extra)
    expect(withColumn(extra)).toBe(extra)
    const custom = OLD_FOLDER.replace(/- 1-To-Watch[\s\S]*- 4-Carded/, '- Idea\n        - Doing')
    expect(withColumn(custom)).toBe(custom)
    // no column: nothing to migrate (addColumn adds the new set)
    expect(migrateOptions('---\nid: x\n---\n')).toBe('---\nid: x\n---\n')
  })

  it('a write in an old-set folder replaces the options and writes the new value', () => {
    const root = mkdtempSync(join(tmpdir(), 'fa-status-'))
    try {
      const parent = join(root, 'learning-log')
      const video = join(parent, '10-17-x')
      mkdirSync(video, { recursive: true })
      writeFileSync(join(parent, '.folder.md'), OLD_FOLDER)
      const md = join(video, 'x.md')
      writeFileSync(md, '---\nid: YAS-1\nin:\n  3vzxnrx8km6f:\n    status: 1-To-Watch\n---\n' + body)
      expect(readStatus(video, md)).toBe('2-Todo') // read: old → new
      expect(statusOptions(video)).toEqual(DEFAULT_OPTIONS)
      expect(advanceOnOpen(video, md)).toBe('3-In-Progress')
      expect(readFileSync(join(parent, '.folder.md'), 'utf8')).toBe(migrateOptions(OLD_FOLDER))
      expect(value(readFileSync(md, 'utf8'), '3vzxnrx8km6f')).toBe('3-In-Progress')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('migrateStatus: minimal edit of the value; id and other `in` blocks kept; idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'fa-status-'))
    try {
      const parent = join(root, 'learning-log')
      const video = join(parent, '10-17-x')
      mkdirSync(video, { recursive: true })
      writeFileSync(join(parent, '.folder.md'), OLD_FOLDER)
      const md = join(video, 'x.md')
      const before = '---\nin:\n  otherfolder:\n    status: 2-Watching\n  3vzxnrx8km6f:\n    status: 3-Watched\n    rank: 2\nid: YAS-409\n---\n' + body
      writeFileSync(md, before)
      expect(migrateStatus(md, parent, true)).toEqual({ from: '3-Watched', to: '3-In-Progress' })
      expect(readFileSync(md, 'utf8')).toBe(before) // dry run: nothing written
      expect(migrateStatus(md, parent)).toEqual({ from: '3-Watched', to: '3-In-Progress' })
      const after = readFileSync(md, 'utf8')
      // only the status line under this folder changed (plus the agent guide, which every app write adds)
      expect(after.startsWith('---\nin:\n  otherfolder:\n    status: 2-Watching\n  3vzxnrx8km6f:\n    status: 3-In-Progress\n    rank: 2\nid: YAS-409\n---\n# T')).toBe(true)
      expect(after.split('\n').filter((l) => l.includes('3-Watched')).length).toBe(0)
      expect(migrateStatus(md, parent)).toBeNull() // second run: nothing to do
      expect(readFileSync(md, 'utf8')).toBe(after)
      // a value that is already new, or none: nothing to do
      const fresh = join(video, 'y.md')
      writeFileSync(fresh, '---\nid: YAS-2\n---\n' + body)
      expect(migrateStatus(fresh, parent)).toBeNull()
      expect(readFileSync(fresh, 'utf8')).toBe('---\nid: YAS-2\n---\n' + body)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
