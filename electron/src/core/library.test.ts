import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBoard, moveOnBoard } from './boardFile'
import { acquireLock, lockPath, withFileLock } from './fileLock'
import { entry, existingFolder } from './folderMaker'
import {
  createTopic, deleteEmptyTopic, directVideoFolders, folderKind, folderTree, isVideoFolder, listFolder, listLibrary, moveVideoFolder, relocatePath, renameTopic, sameTree, topicOf, videoFolders,
} from './library'
import { addColumn, advanceOnOpen, readStatus, setLibraryRoots, startInBacklog, statusFolder, statusRootOf, value, writeStatus } from './status'
import { migrateFolder } from './statusMigrate'

const LIB_ID = '3vzxnrx8km6f'
const folderMD = (id: string) => addColumn(`---\nid: ${id}\ntitle: Learning-Log\n---\n`)
const transcript = (vid: string, fm = '') =>
  `${fm}# Video ${vid}\n\n- channel: Chan\n- url: https://www.youtube.com/watch?v=${vid}\n\n---\n\n[0:00](https://www.youtube.com/watch?v=${vid}&t=0s) Words.\n`

let root: string
let lib: string

/** A video folder `<parent>/<name>/` with `<slug>.md` and (unless `plain`) a sidecar. */
function video(parent: string, name: string, vid: string, opts: { plain?: boolean; fm?: string } = {}): string {
  const d = join(parent, name)
  mkdirSync(d, { recursive: true })
  writeFileSync(join(d, name.slice(6) + '.md'), transcript(vid, opts.fm))
  if (!opts.plain) writeFileSync(join(d, '.follow-along.json'), JSON.stringify({ id: vid, title: 'T', paras: [] }))
  return d
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'library-'))
  lib = join(root, 'learning-log')
  mkdirSync(lib)
  writeFileSync(join(lib, '.folder.md'), folderMD(LIB_ID))
  setLibraryRoots([lib])
})
afterEach(() => { setLibraryRoots([]); rmSync(root, { recursive: true, force: true }) })

describe('topic vs video folders', () => {
  it('tells videos, topics and other folders apart', () => {
    const v = video(lib, '10-27-stanford', 'AAAAAAAAAAA')
    const plain = video(lib, '10-26-old-tool', 'BBBBBBBBBBB', { plain: true }) // .md with a "- url:" line, no sidecar
    const topic = join(lib, 'AI agents'); mkdirSync(topic)
    const nested = video(topic, '10-25-agents', 'CCCCCCCCCCC')
    const empty = join(lib, 'Empty topic'); mkdirSync(empty)
    // a folder of notes from another tool: own .md, no YouTube "- url:" line, a media folder → not a topic
    const notes = join(lib, '10-02-poetry'); mkdirSync(join(notes, 'media'), { recursive: true }); writeFileSync(join(notes, 'poetry.md'), '# Poetry\n')
    // a topic of such folders (no .md of its own) is a topic, with no videos
    const jev = join(lib, 'jev'); mkdirSync(join(jev, '10-01-x'), { recursive: true }); writeFileSync(join(jev, '10-01-x', 'synthesis.md'), '# S\n- **Source:** [YouTube](https://www.youtube.com/watch?v=x)\n')
    mkdirSync(join(lib, 'assets')); mkdirSync(join(lib, '.hidden'))
    // a topic WITH its own notes .md still counts when it holds a video
    const mixed = join(lib, 'Mixed'); video(mixed, '10-20-m', 'DDDDDDDDDDD'); writeFileSync(join(mixed, 'README.md'), '# notes\n')

    expect(isVideoFolder(v)).toBe(true)
    expect(isVideoFolder(plain)).toBe(true)
    expect(folderKind(v)).toBe('video')
    expect(folderKind(topic)).toBe('topic')
    expect(folderKind(nested)).toBe('video')
    expect(folderKind(empty)).toBe('topic')
    expect(folderKind(notes)).toBe('other')
    expect(folderKind(jev)).toBe('topic')
    expect(folderKind(join(jev, '10-01-x'))).toBe('other')
    expect(folderKind(join(lib, 'assets'))).toBe('other')
    expect(folderKind(join(lib, '.hidden'))).toBe('other')
    expect(folderKind(mixed)).toBe('topic')
  })

  it('the tree lists topics recursively with direct video counts (Finder-style), totals and emptiness', () => {
    video(lib, '10-27-a', 'AAAAAAAAAAA')
    const topic = join(lib, 'AI agents'); video(topic, '10-25-b', 'BBBBBBBBBBB')
    const sub = join(topic, 'Evals'); video(sub, '10-24-c', 'CCCCCCCCCCC'); video(sub, '10-23-d', 'DDDDDDDDDDD')
    mkdirSync(join(lib, 'Empty')); writeFileSync(join(lib, 'Empty', '.DS_Store'), '')
    const t = folderTree(lib)
    expect([t.videos, t.total]).toEqual([1, 4])
    expect(t.children.map((c) => [c.name, c.videos, c.total, c.empty])).toEqual([['AI agents', 1, 3, false], ['Empty', 0, 0, true]])
    expect(t.children[0].children.map((c) => [c.name, c.videos, c.total])).toEqual([['Evals', 2, 2]])
    expect(videoFolders(lib).map((p) => basename(p)).sort()).toEqual(['10-23-d', '10-24-c', '10-25-b', '10-27-a'])
    expect(videoFolders(topic).map((p) => basename(p)).sort()).toEqual(['10-23-d', '10-24-c', '10-25-b'])
    // a topic with no videos of its own still counts its subfolders' in the total
    const only = join(lib, 'Only nested'); video(join(only, 'Deep'), '10-22-e', 'EEEEEEEEEEE')
    const o = folderTree(lib).children.find((c) => c.name === 'Only nested')!
    expect([o.videos, o.total, o.empty]).toEqual([0, 1, false])
  })

  it('the all-videos listing shows every video at any depth with its topic chip', () => {
    video(lib, '10-27-a', 'AAAAAAAAAAA')
    const topic = join(lib, 'AI agents'); video(topic, '10-25-b', 'BBBBBBBBBBB')
    video(join(topic, 'Evals'), '10-24-c', 'CCCCCCCCCCC')
    const all = listLibrary(lib)
    expect(all.map((e) => [basename(e.folder), e.topic])).toEqual([['10-27-a', null], ['10-25-b', 'AI agents'], ['10-24-c', 'AI agents/Evals']])
    expect(listLibrary(topic).map((e) => [basename(e.folder), e.topic])).toEqual([['10-25-b', null], ['10-24-c', 'Evals']])
    expect(topicOf(join(lib, 'x'), lib)).toBeNull()
  })

  it('a folder view (library or topic) lists only the videos right in it, Finder-style', () => {
    video(lib, '10-27-a', 'AAAAAAAAAAA')
    video(lib, '10-20-z', 'ZZZZZZZZZZZ', { plain: true }) // made by another tool: still a video
    const topic = join(lib, 'AI agents'); video(topic, '10-25-b', 'BBBBBBBBBBB')
    const evals = join(topic, 'Evals'); video(evals, '10-24-c', 'CCCCCCCCCCC')
    mkdirSync(join(lib, 'Empty'))
    const notes = join(lib, '10-02-poetry'); mkdirSync(notes); writeFileSync(join(notes, 'poetry.md'), '# Poetry\n')
    expect(listFolder(lib).map((e) => [basename(e.folder), e.topic])).toEqual([['10-27-a', null], ['10-20-z', null]])
    expect(listFolder(topic).map((e) => [basename(e.folder), e.topic])).toEqual([['10-25-b', null]])
    expect(listFolder(evals).map((e) => basename(e.folder))).toEqual(['10-24-c'])
    expect(listFolder(join(lib, 'Empty'))).toEqual([])
    expect(directVideoFolders(lib).map((p) => basename(p))).toEqual(['10-20-z', '10-27-a'])
    // the counts of the tree match what each view lists
    const t = folderTree(lib)
    expect(t.videos).toBe(listFolder(lib).length)
    expect(t.total).toBe(listLibrary(lib).length)
    // a moved video leaves the library's own list and shows in the topic's
    moveVideoFolder(join(lib, '10-27-a'), evals)
    expect(listFolder(lib).map((e) => basename(e.folder))).toEqual(['10-20-z'])
    expect(listFolder(evals).map((e) => basename(e.folder))).toEqual(['10-27-a', '10-24-c'])
    expect(listLibrary(lib)).toHaveLength(4)
  })

  it('finds an existing folder of the same video anywhere in the library', () => {
    const topic = join(lib, 'AI agents')
    const v = video(topic, '10-25-b', 'BBBBBBBBBBB')
    expect(existingFolder('BBBBBBBBBBB', lib)).toBeNull() // only the direct children: not there
    expect(existingFolder('BBBBBBBBBBB', lib, videoFolders(lib))).toBe(v)
  })
})

describe('the status folder is the library, at any depth', () => {
  it('resolves: pinned library first, else the nearest folder with the column, else the parent', () => {
    const topic = join(lib, 'AI agents'); const v = video(topic, '10-25-b', 'BBBBBBBBBBB')
    // the docs app may add its own .folder.md (own id) to a topic: status still goes to the library
    writeFileSync(join(topic, '.folder.md'), folderMD('topicid12345'))
    expect(statusFolder(v)).toBe(lib)
    expect(statusFolder(v, [])).toBe(topic) // not pinned: the nearest folder with the column (the topic has one here)
    rmSync(join(topic, '.folder.md'))
    expect(statusFolder(v, [])).toBe(lib) // not pinned: the nearest folder that declares the column
    const other = join(root, 'elsewhere'); const w = video(other, '10-01-w', 'WWWWWWWWWWW')
    expect(statusFolder(w, [])).toBe(other) // nothing declares it: the parent (as before topics)
    expect(statusRootOf(topic)).toBe(lib)
  })

  it('a moved video keeps the same status value and key; new videos in a topic start in Backlog under the library id', () => {
    const v = video(lib, '10-27-stanford', 'AAAAAAAAAAA', { fm: '---\nid: YAS-1\n---\n' })
    const md = join(v, 'stanford.md')
    writeStatus(v, md, '3-In-Progress')
    const before = readFileSync(md, 'utf8')
    expect(value(before, LIB_ID)).toBe('3-In-Progress')
    const topic = createTopic(lib, 'AI agents')
    const r = moveVideoFolder(v, topic)!
    const movedMd = join(r.to, 'stanford.md')
    expect(readFileSync(movedMd, 'utf8')).toBe(before) // the move writes nothing
    expect(readStatus(r.to, movedMd)).toBe('3-In-Progress')
    expect(value(readFileSync(movedMd, 'utf8'), LIB_ID)).toBe('3-In-Progress') // same key: in.<library id>.status
    writeFileSync(join(topic, '.folder.md'), folderMD('topicid12345')) // a docs-app .folder.md appears in the topic
    expect(readStatus(r.to, movedMd)).toBe('3-In-Progress')
    writeStatus(r.to, movedMd, '4-Done')
    const after = readFileSync(movedMd, 'utf8')
    expect(value(after, LIB_ID)).toBe('4-Done')
    expect(after).not.toContain('topicid12345')
    expect(readFileSync(join(topic, '.folder.md'), 'utf8')).toBe(folderMD('topicid12345')) // the topic's file is never written
    // a new video made in a topic: Backlog, keyed to the library; watching moves it to In progress there
    const n = video(topic, '10-27-new', 'NNNNNNNNNNN')
    const nmd = join(n, 'new.md')
    expect(startInBacklog(n, nmd)).toBe('1-Backlog')
    expect(value(readFileSync(nmd, 'utf8'), LIB_ID)).toBe('1-Backlog')
    expect(advanceOnOpen(n, nmd)).toBe('3-In-Progress')
    expect(value(readFileSync(nmd, 'utf8'), LIB_ID)).toBe('3-In-Progress')
    // the entry (New Tab list) reads the same
    expect(entry(n)?.status).toBe('3-In-Progress')
  })

  it('migrate-status covers topics and keys to the library', () => {
    writeFileSync(join(lib, '.folder.md'), `---\nid: ${LIB_ID}\nfolder_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - 1-To-Watch\n        - 2-Watching\n        - 3-Watched\n        - 4-Carded\n      optionSort: manual\n---\n`)
    const v = video(join(lib, 'AI agents'), '10-25-b', 'BBBBBBBBBBB', { fm: `---\nin:\n  ${LIB_ID}:\n    status: 2-Watching\n---\n` })
    const m = migrateFolder(lib)
    expect(m.options?.to).toEqual(['1-Backlog', '2-Todo', '3-In-Progress', '4-Done'])
    expect(m.transcripts.map((t) => [basename(t.md), t.from, t.to])).toEqual([['b.md', '2-Watching', '3-In-Progress']])
    expect(value(readFileSync(join(v, 'b.md'), 'utf8'), LIB_ID)).toBe('3-In-Progress')
    expect(migrateFolder(lib).transcripts).toEqual([]) // a second run changes nothing
  })
})

describe('moving a video folder', () => {
  it('moves with a rename, undo moves it back, same folder is a no-op', () => {
    const v = video(lib, '10-27-a', 'AAAAAAAAAAA')
    writeFileSync(join(v, '.follow-along-progress.json'), '{"seconds" : 10}')
    const topic = createTopic(lib, 'AI agents')
    expect(existsSync(join(topic, '.folder.md'))).toBe(false) // a plain directory
    expect(moveVideoFolder(v, lib)).toBeNull() // already there
    const r = moveVideoFolder(v, topic)!
    expect(r).toEqual({ from: v, to: join(topic, '10-27-a') })
    expect(existsSync(v)).toBe(false)
    expect(readdirSync(r.to).sort()).toEqual(['.follow-along-progress.json', '.follow-along.json', 'a.md']) // no lock left behind
    const back = moveVideoFolder(r.to, lib)! // Undo
    expect(back.to).toBe(v)
    expect(readdirSync(v).sort()).toEqual(['.follow-along-progress.json', '.follow-along.json', 'a.md'])
  })

  it('refuses a name collision and never overwrites', () => {
    const v = video(lib, '10-27-a', 'AAAAAAAAAAA')
    const topic = createTopic(lib, 'AI agents')
    const other = video(topic, '10-27-a', 'ZZZZZZZZZZZ')
    expect(() => moveVideoFolder(v, topic)).toThrow(/already a folder named "10-27-a"/)
    expect(existsSync(v)).toBe(true)
    expect(readFileSync(join(other, 'a.md'), 'utf8')).toContain('ZZZZZZZZZZZ')
    expect(existsSync(lockPath(join(v, 'a.md')))).toBe(false)
  })

  it('refuses a folder that is not a video, a move into itself and a move to another library', () => {
    const v = video(lib, '10-27-a', 'AAAAAAAAAAA')
    const topic = createTopic(lib, 'AI agents')
    expect(() => moveVideoFolder(topic, lib)).toThrow(/not a video folder/)
    const other = join(root, 'other-lib'); mkdirSync(other)
    setLibraryRoots([lib, other])
    expect(() => moveVideoFolder(v, other)).toThrow(/another library/)
    expect(existsSync(v)).toBe(true)
  })

  it('takes the transcript lock: waits for a writer, and an agent cannot write mid-move', () => {
    const v = video(lib, '10-27-a', 'AAAAAAAAAAA')
    const topic = createTopic(lib, 'AI agents')
    const md = join(v, 'a.md')
    const release = acquireLock(md) // an agent is writing
    process.env.VIDEO_NOTES_LOCK_WAIT_MS = '150'
    try {
      expect(() => moveVideoFolder(v, topic, { rename: () => { throw new Error('must not rename while locked') } })).toThrow(/busy/)
    } finally { delete process.env.VIDEO_NOTES_LOCK_WAIT_MS }
    release()
    expect(existsSync(v)).toBe(true)
    let lockedDuringRename = false
    const r = moveVideoFolder(v, topic, { rename: (a, b) => { lockedDuringRename = existsSync(lockPath(md)); renameSync(a, b) } })!
    expect(lockedDuringRename).toBe(true)
    expect(existsSync(lockPath(join(r.to, 'a.md')))).toBe(false) // released at the new place
    withFileLock(join(r.to, 'a.md'), () => undefined) // and can be taken again
  })

  it('across disks: copy, check every byte, delete the original', () => {
    const v = video(lib, '10-27-a', 'AAAAAAAAAAA')
    mkdirSync(join(v, 'media')); writeFileSync(join(v, 'media', 'x.bin'), Buffer.from([1, 2, 3]))
    const topic = createTopic(lib, 'AI agents')
    const snapshot = join(root, 'snap'); mkdirSync(snapshot); renameSync(v, join(snapshot, '10-27-a')); video(lib, '10-27-a', 'AAAAAAAAAAA')
    mkdirSync(join(v, 'media')); writeFileSync(join(v, 'media', 'x.bin'), Buffer.from([1, 2, 3]))
    const exdev = () => { const e = new Error('cross-device') as NodeJS.ErrnoException; e.code = 'EXDEV'; throw e }
    const r = moveVideoFolder(v, topic, { rename: exdev })!
    expect(existsSync(v)).toBe(false)
    expect(sameTree(join(snapshot, '10-27-a'), r.to)).toBe(true)
    expect(existsSync(lockPath(join(r.to, 'a.md')))).toBe(false)
  })

  it('keeps the board order entry (keyed by video id, file at the library)', () => {
    const a = video(lib, '10-27-a', 'AAAAAAAAAAA', { fm: `---\nin:\n  ${LIB_ID}:\n    status: 2-Todo\n---\n` })
    video(lib, '10-26-b', 'BBBBBBBBBBB', { fm: `---\nin:\n  ${LIB_ID}:\n    status: 2-Todo\n---\n` })
    moveOnBoard(lib, 'AAAAAAAAAAA', '2-Todo', { top: true })
    expect(readBoard(lib)).toEqual({ '2-Todo': ['AAAAAAAAAAA'] })
    const topic = createTopic(lib, 'AI agents')
    moveVideoFolder(a, topic)
    // a later write (listing the library at any depth) keeps the moved card's entry
    moveOnBoard(lib, 'BBBBBBBBBBB', '2-Todo', { after: 'AAAAAAAAAAA' })
    expect(readBoard(lib)).toEqual({ '2-Todo': ['AAAAAAAAAAA', 'BBBBBBBBBBB'] })
  })
})

describe('topic folders and paths', () => {
  it('new / rename / delete (only when empty)', () => {
    const t = createTopic(lib, '  AI agents ')
    expect(basename(t)).toBe('AI agents')
    expect(() => createTopic(lib, 'AI agents')).toThrow(/already/)
    expect(() => createTopic(lib, 'a/b')).toThrow()
    expect(() => createTopic(lib, '.x')).toThrow()
    const r = renameTopic(t, 'Agents')
    expect(r).toBe(join(lib, 'Agents'))
    createTopic(lib, 'Other')
    expect(() => renameTopic(r, 'Other')).toThrow(/already/)
    video(r, '10-27-a', 'AAAAAAAAAAA')
    expect(() => deleteEmptyTopic(r)).toThrow(/not empty/)
    expect(existsSync(join(r, '10-27-a', 'a.md'))).toBe(true)
    const e = createTopic(lib, 'Empty'); writeFileSync(join(e, '.DS_Store'), '')
    deleteEmptyTopic(e)
    expect(existsSync(e)).toBe(false)
    const withFolderMd = createTopic(lib, 'Docs'); writeFileSync(join(withFolderMd, '.folder.md'), '---\nid: x\n---\n')
    expect(() => deleteEmptyTopic(withFolderMd)).toThrow(/not empty/)
  })

  it('relocatePath moves a folder and everything in it, nothing else', () => {
    const from = '/v/learning-log/10-27-a', to = '/v/learning-log/AI agents/10-27-a'
    expect(relocatePath(from, from, to)).toBe(to)
    expect(relocatePath(from + '/a.md', from, to)).toBe(to + '/a.md')
    expect(relocatePath('/v/learning-log/10-27-ab', from, to)).toBe('/v/learning-log/10-27-ab')
    expect(relocatePath('/v/learning-log', from, to)).toBe('/v/learning-log')
  })
})
