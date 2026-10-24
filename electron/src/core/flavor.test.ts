// The Labs flavor's read-only guard (flavor.ts): every write to the "vault" is a logged no-op; Labs' own
// userData stays writable; the resume spot goes to Labs' userData.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite } from './atomic'
import { moveOnBoard } from './boardFile'
import { claimFile } from './claims'
import { withFileLock } from './fileLock'
import { sampleMD } from './fixtures'
import { configureFlavor, Flavor, labsProgressFile, mayWrite, ReadOnlyError, resetFlavor, writable } from './flavor'
import { ensure, make } from './folderMaker'
import { migrateSettings } from './migrate'
import { addNote, changeFile, parse } from './notes'
import { readProgress, writeProgress, PROGRESS_FILE } from './progress'
import { writeStatus } from './status'
import { encodeSidecar, SIDECAR_FILE } from './transcript'

const MD = sampleMD.replaceAll('v=ID', 'v=VIDEOID0001')
let root = '', vault = '', labs = '', log: string[] = []
const md = () => join(vault, 'learning-log/10-17-video/video.md')
const folder = () => join(vault, 'learning-log/10-17-video')
const snapshot = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const walk = (d: string) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else out[p] = readFileSync(p, 'utf8') } }
  walk(dir)
  return out
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vn-flavor-'))
  vault = join(root, 'vault'); labs = join(root, 'labs-userdata')
  mkdirSync(folder(), { recursive: true }); mkdirSync(labs, { recursive: true })
  writeFileSync(md(), MD)
  writeFileSync(join(folder(), SIDECAR_FILE), encodeSidecar({ version: 1, id: 'VIDEOID0001', title: 'Title', channel: 'Chan', duration: 600,
    paras: [{ turn: false, w: ['First', 'paragraph', 'words.'] }, { turn: true, w: ['Second', 'paragraph.'] }, { turn: true, w: ['Third', 'paragraph.'] }],
    t: [[0, 1, 2], [11, 12], [3723, 3724]], chapters: [] }))
  writeFileSync(join(vault, 'learning-log/.folder.md'), '---\nid: abc123\n---\n')
  log = []
  configureFlavor({ id: 'labs', readOnlyVault: true, writableRoots: [labs], progressDir: join(labs, 'labs-progress'), log: (l) => log.push(l) })
})
afterEach(() => { resetFlavor(); rmSync(root, { recursive: true, force: true }) })

describe('Labs read-only guard', () => {
  it('only Labs userData is writable', () => {
    expect(writable(join(labs, 'settings.json'))).toBe(true)
    expect(writable(labs)).toBe(true)
    expect(writable(labs + '-other/x')).toBe(false) // a sibling with the same prefix is not inside
    expect(writable(md())).toBe(false)
    expect(mayWrite(md(), 'write')).toBe(false)
    expect(log).toEqual([`read-only (labs): skipped write ${md()}`])
  })

  it('atomicWrite to the vault is a logged no-op; to Labs userData it writes', () => {
    expect(atomicWrite(md(), 'X')).toBe(false)
    expect(readFileSync(md(), 'utf8')).toBe(MD)
    expect(log[0]).toMatch(/^read-only \(labs\): skipped write .*video\.md$/)
    expect(atomicWrite(join(labs, 'a.json'), '{}')).toBe(true)
    expect(readFileSync(join(labs, 'a.json'), 'utf8')).toBe('{}')
  })

  it('note save / changeFile / claims / status / board change nothing in the vault (no lock files either)', () => {
    const before = snapshot(vault)
    const notes = addNote(md(), 0, 1, 'a note')
    expect(notes).toEqual([]) // what the file holds, not the unsaved note
    const r = changeFile(md(), (t) => t + '\nmore')
    expect(r.after).toBe(r.before)
    expect(claimFile(md(), 'a1', { count: 1 })).toEqual([])
    writeStatus(folder(), md(), '3-In-Progress')
    moveOnBoard(join(vault, 'learning-log'), 'VIDEOID0001', '3-In-Progress', { top: true })
    let ran = false
    withFileLock(md(), () => { ran = true })
    expect(ran).toBe(true)
    expect(snapshot(vault)).toEqual(before)
    expect(parse(readFileSync(md(), 'utf8'))).toEqual([])
    expect(log.length).toBeGreaterThan(0)
    expect(log.every((l) => l.startsWith('read-only (labs): skipped '))).toBe(true)
  })

  it('the resume spot goes to Labs userData; the real file is read until then', () => {
    writeFileSync(join(folder(), PROGRESS_FILE), '{\n  "duration" : 600,\n  "seconds" : 100,\n  "updated" : "2026-10-17T18:02:11Z"\n}')
    expect(readProgress(folder())?.seconds).toBe(100)
    const before = snapshot(vault)
    writeProgress(folder(), 250, 600, new Date('2026-10-23T00:00:00Z'), 240)
    expect(snapshot(vault)).toEqual(before)
    const file = labsProgressFile(folder())!
    expect(file.startsWith(join(labs, 'labs-progress'))).toBe(true)
    expect(existsSync(file)).toBe(true)
    expect(readProgress(folder())).toMatchObject({ seconds: 250, home: 240 })
  })

  it('making a folder in the vault or setting one up refuses (nothing written)', async () => {
    const before = snapshot(vault)
    await expect(make('https://www.youtube.com/watch?v=AAAAAAAAAAA', join(vault, 'learning-log'))).rejects.toBeInstanceOf(ReadOnlyError)
    // an existing folder of the same video is reused (read-only is fine)
    expect((await make('https://www.youtube.com/watch?v=VIDEOID0001', join(vault, 'learning-log'))).folder).toBe(folder())
    rmSync(join(folder(), SIDECAR_FILE)) // needs timing → setup would write
    await expect(ensure(folder())).rejects.toBeInstanceOf(ReadOnlyError)
    delete before[join(folder(), SIDECAR_FILE)]
    expect(snapshot(vault)).toEqual(before)
  })

  it('settings migration only into Labs userData', () => {
    const old = join(root, 'old'); mkdirSync(old)
    writeFileSync(join(old, 'settings.json'), '{"a":1}')
    expect(migrateSettings(old, join(vault, 'x'))).toBe(false)
    expect(existsSync(join(vault, 'x'))).toBe(false)
    expect(migrateSettings(old, join(labs, 'y'))).toBe(true)
  })

  it('the normal flavor writes as before', () => {
    resetFlavor()
    expect(Flavor.id).toBe('normal')
    expect(writable(md())).toBe(true)
    expect(addNote(md(), 0, 1, 'a note').length).toBe(1)
    expect(readFileSync(md(), 'utf8')).toContain('> 💬 [0:01]')
    expect(log).toEqual([])
  })
})
