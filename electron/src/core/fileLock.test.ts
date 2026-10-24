// The lock every writer of a transcript .md takes (`<md>.lock`): the app and the agents' video-notes CLI.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireLock, isLockFile, LockTimeout, lockPath, withFileLock } from './fileLock'
import { markdownFile } from './folderMaker'
import { sampleMD } from './fixtures'

const temps: string[] = []
const tempDir = (): string => { const d = mkdtempSync(join(tmpdir(), 'fa-lock-')); temps.push(d); return d }
afterEach(() => { while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true }) })

const lockJSON = (o: { pid: number; host?: string; time: number }): string =>
  JSON.stringify({ pid: o.pid, host: o.host ?? hostname(), time: o.time, token: 'other' })

/** A pid that ran and is gone. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  return Number(r.stdout)
}

describe('file lock', () => {
  it('creates <md>.lock with pid / host / time, and removes it after (also when fn throws)', () => {
    const md = join(tempDir(), 'a.md'); writeFileSync(md, 'x')
    const seen = withFileLock(md, () => JSON.parse(readFileSync(lockPath(md), 'utf8')))
    expect(seen.pid).toBe(process.pid)
    expect(seen.host).toBe(hostname())
    expect(typeof seen.time).toBe('number')
    expect(existsSync(lockPath(md))).toBe(false)
    expect(() => withFileLock(md, () => { throw new Error('boom') })).toThrow('boom')
    expect(existsSync(lockPath(md))).toBe(false)
  })

  it('waits for a live holder, then times out (LockTimeout)', () => {
    const md = join(tempDir(), 'a.md'); writeFileSync(md, 'x')
    const release = acquireLock(md)
    const t0 = Date.now()
    expect(() => acquireLock(md, { waitMs: 150 })).toThrow(LockTimeout)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140)
    release()
    acquireLock(md, { waitMs: 150 })()
    expect(existsSync(lockPath(md))).toBe(false)
  })

  it('takes over a stale lock (older than 30 s)', () => {
    const md = join(tempDir(), 'a.md'); writeFileSync(md, 'x')
    // pid 1 (launchd) is alive: only the age makes it stale
    writeFileSync(lockPath(md), lockJSON({ pid: 1, time: Date.now() - 31_000 }))
    expect(withFileLock(md, () => 'got it', { waitMs: 200 })).toBe('got it')
    expect(existsSync(lockPath(md))).toBe(false)
    // a fresh one from a live pid is not stale
    writeFileSync(lockPath(md), lockJSON({ pid: 1, time: Date.now() }))
    expect(() => withFileLock(md, () => 1, { waitMs: 100 })).toThrow(LockTimeout)
    expect(existsSync(lockPath(md))).toBe(true)
  })

  it('takes over a fresh lock whose pid is dead on this host (not one from another host)', () => {
    const md = join(tempDir(), 'a.md'); writeFileSync(md, 'x')
    const pid = deadPid()
    writeFileSync(lockPath(md), lockJSON({ pid, time: Date.now() }))
    expect(withFileLock(md, () => 'ok', { waitMs: 200 })).toBe('ok')
    // the same pid on another computer (a synced vault): cannot tell, so wait for the age
    writeFileSync(lockPath(md), lockJSON({ pid, host: 'some-other-mac', time: Date.now() }))
    expect(() => withFileLock(md, () => 1, { waitMs: 100 })).toThrow(LockTimeout)
  })

  it('an empty lock file (writer died between create and write) is stale only when old', () => {
    const md = join(tempDir(), 'a.md'); writeFileSync(md, 'x')
    writeFileSync(lockPath(md), '')
    expect(() => withFileLock(md, () => 1, { waitMs: 80 })).toThrow(LockTimeout)
    expect(withFileLock(md, () => 2, { waitMs: 80, now: () => Date.now() + 31_000 })).toBe(2)
  })

  it('release leaves a lock someone else took over alone', () => {
    const md = join(tempDir(), 'a.md'); writeFileSync(md, 'x')
    const release = acquireLock(md)
    writeFileSync(lockPath(md), lockJSON({ pid: 1, time: Date.now() }))   // taken over after we were too slow
    release()
    expect(existsSync(lockPath(md))).toBe(true)
  })

  it('lock files are never transcripts or folders in lists', () => {
    expect(isLockFile('a.md.lock')).toBe(true)
    expect(isLockFile('a.md.lock.takeover')).toBe(true)
    expect(isLockFile('a.md')).toBe(false)
    const folder = join(tempDir(), '10-17-a'); mkdirSync(folder)
    writeFileSync(join(folder, 'a.md.lock'), lockJSON({ pid: 1, time: Date.now() }))
    expect(markdownFile(folder)).toBeNull()
    writeFileSync(join(folder, 'a.md'), sampleMD)
    expect(markdownFile(folder)).toBe(join(folder, 'a.md'))
    expect(readdirSync(folder).sort()).toEqual(['a.md', 'a.md.lock'])
  })
})
