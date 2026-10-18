// Port of Tests/FollowAlongKitTests/StatusTests.swift.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { insert, paragraphCount } from './notes'
import { addColumn, advanceStatus, DEFAULT_OPTIONS, folderInfo, readStatus, setValue, value, writeStatus, yaml } from './status'

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
        - 1-To-Watch
        - 2-Watching
        - 3-Watched
        - 4-Carded
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
        - 1-To-Watch
        - 2-Watching
        - 3-Watched
        - 4-Carded
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
      expect(advanceStatus(video, md, 1)).toBe('2-Watching')
      expect(advanceStatus(video, md, 1)).toBeNull() // already there
      expect(advanceStatus(video, md, 0)).toBeNull() // never backward
      expect(advanceStatus(video, md, 2)).toBe('3-Watched')
      writeStatus(video, md, '1-To-Watch') // manual change: any direction
      expect(readStatus(video, md)).toBe('1-To-Watch')
      expect(readFileSync(md, 'utf8').startsWith('---\nid: YAS-1\nin:\n  LL1:\n    status: 1-To-Watch\n---\n# T')).toBe(true)
      expect(readFileSync(join(parent, '.folder.md'), 'utf8')).toContain('    status:\n      kind: select')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
