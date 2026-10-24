import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCLI } from '../cli/run'
import { arrangeColumn, BOARD_FILE, cardId, columnLabel, encodeBoard, moveCard, newestFirst, parseBoard, prune } from './board'
import { moveOnBoard, readBoard } from './boardFile'
import { listFolders } from './folderMaker'
import { writeStatus } from './status'

interface C { id: string; date: number; modified: number }
const c = (id: string, date: number): C => ({ id, date, modified: 0 })
const ids = (cs: C[]): string[] => cs.map((x) => x.id)
const arrange = (cs: C[], order?: string[]): string[] => ids(arrangeColumn(cs, order, (x) => x.id, newestFirst))

describe('board order', () => {
  it('unordered cards go below the ordered ones, newest first', () => {
    const cards = [c('a', 1), c('b', 3), c('c', 2), c('d', 4)]
    expect(arrange(cards)).toEqual(['d', 'b', 'c', 'a'])
    expect(arrange(cards, ['a', 'c'])).toEqual(['a', 'c', 'd', 'b'])
    expect(arrange(cards, ['gone', 'c', 'c'])).toEqual(['c', 'd', 'b', 'a']) // stale + repeat ignored
  })

  it('insert into an empty list: before / after / top / nothing', () => {
    const shown = ['d', 'b', 'c', 'a'] // all unordered
    expect(moveCard({}, 'x', 'T', shown, { top: true })).toEqual({ T: ['x'] })
    expect(moveCard({}, 'x', 'T', shown, {})).toEqual({ T: ['x'] }) // end of the (empty) ordered part = top
    // below unordered cards: the ones above become ordered so they stay put
    expect(moveCard({}, 'x', 'T', shown, { before: 'c' })).toEqual({ T: ['d', 'b', 'x'] })
    expect(moveCard({}, 'x', 'T', shown, { after: 'a' })).toEqual({ T: ['d', 'b', 'c', 'a', 'x'] })
    expect(moveCard({}, 'x', 'T', [], { before: null, after: null })).toEqual({ T: ['x'] })
  })

  it('move between columns: out of the old list, into the new one at the drop spot', () => {
    const order = { A: ['x', 'y'], B: ['p', 'q'] }
    // column B as shown after the status change: p, q (ordered), then x (unordered, its status is B now)
    const out = moveCard(order, 'x', 'B', ['p', 'q', 'x'], { before: 'q' })
    expect(out).toEqual({ A: ['y'], B: ['p', 'x', 'q'] })
    // last one out of a list: the empty list goes
    expect(moveCard({ A: ['x'] }, 'x', 'B', ['x'], { top: true })).toEqual({ B: ['x'] })
  })

  it('reorder within a column', () => {
    const order = { T: ['a', 'b', 'c'] }
    expect(moveCard(order, 'c', 'T', ['a', 'b', 'c', 'u'], { top: true })).toEqual({ T: ['c', 'a', 'b'] })
    expect(moveCard(order, 'a', 'T', ['a', 'b', 'c', 'u'], { after: 'b' })).toEqual({ T: ['b', 'a', 'c'] })
    expect(moveCard(order, 'a', 'T', ['a', 'b', 'c', 'u'], { before: 'c' })).toEqual({ T: ['b', 'a', 'c'] })
    // dropped below the unordered card u: u joins the list above it
    expect(moveCard(order, 'a', 'T', ['a', 'b', 'c', 'u'], { after: 'u' })).toEqual({ T: ['b', 'c', 'u', 'a'] })
    // an unordered card dragged to the top
    expect(moveCard(order, 'u', 'T', ['a', 'b', 'c', 'u'], { before: 'a' })).toEqual({ T: ['u', 'a', 'b', 'c'] })
  })

  it('a drop onto a collapsed column puts the card at the top of that column\'s order', () => {
    // Done is collapsed; it shows d1, d2 (ordered) and d3 (unordered); x comes from In progress
    const order = { '3-In-Progress': ['x', 'y'], '4-Done': ['d1', 'd2'] }
    const out = moveCard(order, 'x', '4-Done', ['d1', 'd2', 'd3', 'x'], { top: true })
    expect(out).toEqual({ '3-In-Progress': ['y'], '4-Done': ['x', 'd1', 'd2'] }) // unordered d3 stays unordered, below
    expect(arrange([c('d1', 1), c('d2', 1), c('d3', 9), c('x', 0)], out['4-Done'])).toEqual(['x', 'd1', 'd2', 'd3'])
    // into a column with no saved order yet
    expect(moveCard({}, 'x', '4-Done', ['d3', 'x'], { top: true })).toEqual({ '4-Done': ['x'] })
    // on files: the status is already 4-Done when the order is written (moveOnBoard), same result
  })

  it('stale ids (folders gone, or now in another column) are dropped', () => {
    const live = new Map<string, string | null>([['a', 'T'], ['b', 'D'], ['c', 'T'], ['n', null]])
    expect(prune({ T: ['a', 'gone', 'b', 'c', 'a', 'n'], D: ['gone2'] }, live)).toEqual({ T: ['a', 'c'] })
  })

  it('file text: pretty JSON, tolerant reading', () => {
    expect(encodeBoard({ '3-In-Progress': ['abc', 'def'], '4-Done': [] })).toBe('{\n  "order": {\n    "3-In-Progress": [\n      "abc",\n      "def"\n    ]\n  }\n}\n')
    expect(parseBoard(encodeBoard({ X: ['a'] }))).toEqual({ X: ['a'] })
    expect(parseBoard('nope')).toEqual({})
    expect(parseBoard(null)).toEqual({})
    expect(parseBoard('{"order": {"A": ["a", 3, "a", ""], "B": "x"}}')).toEqual({ A: ['a'] })
  })

  it('ids and labels', () => {
    expect(cardId({ videoId: 'abc', folder: '/x/10-17-a' })).toBe('abc')
    expect(cardId({ videoId: null, folder: '/x/10-17-a/' })).toBe('folder:10-17-a')
    expect(columnLabel('3-In-Progress')).toBe('In progress')
    expect(columnLabel('1-Backlog')).toBe('Backlog')
    expect(columnLabel('2-Todo')).toBe('Todo')
    expect(columnLabel('4-Done')).toBe('Done')
    expect(columnLabel('1 - Awaiting Outbound')).toBe('Awaiting outbound')
    expect(columnLabel('Doing')).toBe('Doing')
  })
})

// ---------- on files (temp folders only) ----------

const temps: string[] = []
afterEach(() => { while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true }) })

const OLD_FOLDER = '---\nid: LL\ntitle: Learning-Log\nfolder_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - 1-To-Watch\n        - 2-Watching\n        - 3-Watched\n        - 4-Carded\n      optionSort: manual\n---\n'

function video(parent: string, name: string, id: string, status: string | null): string {
  const d = join(parent, name)
  mkdirSync(d, { recursive: true })
  const fm = status ? `---\nid: YAS-${id}\nin:\n  LL:\n    status: ${status}\n---\n` : `---\nid: YAS-${id}\n---\n`
  const slug = name.slice(6)
  writeFileSync(join(d, slug + '.md'), `${fm}# Video ${id}\n\n- channel: Chan ${id}\n- url: https://www.youtube.com/watch?v=${id}\n\n---\n\n[0:00](https://www.youtube.com/watch?v=${id}&t=0s) Words.\n`)
  return d
}

function parentWith(): string {
  const root = mkdtempSync(join(tmpdir(), 'fa-board-')); temps.push(root)
  const parent = join(root, 'learning-log'); mkdirSync(parent)
  writeFileSync(join(parent, '.folder.md'), OLD_FOLDER)
  video(parent, '10-01-a', 'aaaaaaaaaaa', '2-Watching')
  video(parent, '10-02-b', 'bbbbbbbbbbb', '3-Watched')
  video(parent, '10-03-c', 'ccccccccccc', '4-Carded')
  video(parent, '10-04-d', 'ddddddddddd', null)
  return parent
}

describe('board file', () => {
  it('entries carry the id, channel and the new status', () => {
    const parent = parentWith()
    const es = listFolders(parent)
    expect(es.map((e) => [e.videoId, e.channel, e.status])).toEqual([
      ['ddddddddddd', 'Chan ddddddddddd', null],
      ['ccccccccccc', 'Chan ccccccccccc', '4-Done'],
      ['bbbbbbbbbbb', 'Chan bbbbbbbbbbb', '3-In-Progress'],
      ['aaaaaaaaaaa', 'Chan aaaaaaaaaaa', '3-In-Progress'],
    ])
  })

  it('reorder writes the hidden file (pretty, only on change) and drops stale ids', () => {
    const parent = parentWith()
    const path = join(parent, BOARD_FILE)
    expect(readBoard(parent)).toEqual({})
    // In progress shows b (newest), a; move a to the top
    moveOnBoard(parent, 'aaaaaaaaaaa', '3-In-Progress', { top: true })
    expect(readFileSync(path, 'utf8')).toBe('{\n  "order": {\n    "3-In-Progress": [\n      "aaaaaaaaaaa"\n    ]\n  }\n}\n')
    const before = readFileSync(path, 'utf8')
    moveOnBoard(parent, 'aaaaaaaaaaa', '3-In-Progress', { top: true }) // same spot: same text
    expect(readFileSync(path, 'utf8')).toBe(before)
    // a stale id in the file goes on the next write
    writeFileSync(path, encodeBoard({ '3-In-Progress': ['zzzzzzzzzzz', 'aaaaaaaaaaa'], '4-Done': ['ccccccccccc', 'gone'] }))
    moveOnBoard(parent, 'bbbbbbbbbbb', '3-In-Progress', { after: 'aaaaaaaaaaa' })
    expect(readBoard(parent)).toEqual({ '3-In-Progress': ['aaaaaaaaaaa', 'bbbbbbbbbbb'], '4-Done': ['ccccccccccc'] })
    expect(listFolders(parent).length).toBe(4) // the hidden file is not a folder entry
  })

  it('a collapsed-column drop on files: status set first, then the card goes to the top', () => {
    const parent = parentWith()
    writeFileSync(join(parent, BOARD_FILE), encodeBoard({ '4-Done': ['ccccccccccc'] }))
    const md = join(parent, '10-01-a', 'a.md')
    writeStatus(join(parent, '10-01-a'), md, '4-Done')
    moveOnBoard(parent, 'aaaaaaaaaaa', '4-Done', { top: true })
    expect(readBoard(parent)).toEqual({ '4-Done': ['aaaaaaaaaaa', 'ccccccccccc'] })
    expect(readFileSync(md, 'utf8')).toContain('  LL:\n    status: 4-Done\n')
  })
})

describe('video-notes migrate-status', () => {
  const run = async (args: string[]) => {
    const out: string[] = [], err: string[] = []
    const code = await runCLI(args, (s) => out.push(s), (s) => err.push(s))
    return { code, out: out.join('\n'), err: err.join('\n') }
  }

  it('--dry-run prints the changes and writes nothing; the real run writes; a rerun changes nothing', async () => {
    const parent = parentWith()
    const snapshot = () => listFolders(parent).map((e) => readFileSync(join(e.folder, e.folder.split('/').pop()!.slice(6) + '.md'), 'utf8')).join('|') + readFileSync(join(parent, '.folder.md'), 'utf8')
    const before = snapshot()
    const dry = await run(['migrate-status', parent, '--dry-run'])
    expect(dry.code).toBe(0)
    expect(dry.out).toBe([
      `Dry run (nothing written): ${parent}`,
      '  .folder.md: options 1-To-Watch, 2-Watching, 3-Watched, 4-Carded → 1-Backlog, 2-Todo, 3-In-Progress, 4-Done',
      '  10-01-a/a.md: 2-Watching → 3-In-Progress',
      '  10-02-b/b.md: 3-Watched → 3-In-Progress',
      '  10-03-c/c.md: 4-Carded → 4-Done',
      'Would change 3 transcripts and .folder.md.',
    ].join('\n'))
    expect(snapshot()).toBe(before)
    expect(existsSync(join(parent, '.folder.md.lock'))).toBe(false)

    const real = await run(['migrate-status', parent])
    expect(real.code).toBe(0)
    expect(real.out.split('\n').slice(-1)[0]).toBe('Changed 3 transcripts and .folder.md.')
    expect(readFileSync(join(parent, '.folder.md'), 'utf8')).toContain('        - 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done\n')
    expect(readFileSync(join(parent, '10-03-c', 'c.md'), 'utf8')).toContain('---\nid: YAS-ccccccccccc\nin:\n  LL:\n    status: 4-Done\n---\n')
    expect(readFileSync(join(parent, '10-04-d', 'd.md'), 'utf8')).toBe(before.split('|')[0]) // no status: untouched

    const again = await run(['migrate-status', parent])
    expect(again.out.split('\n').slice(-1)[0]).toBe('Nothing to migrate.')
    expect((await run(['migrate-status'])).code).toBe(2)
    expect((await run(['migrate-status', parent, '--bogus'])).code).toBe(2)
  })
})
