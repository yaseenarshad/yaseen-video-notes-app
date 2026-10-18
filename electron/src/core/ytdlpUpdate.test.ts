import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FollowAlongError, YTDLPError } from './errors'
import {
  ageDays, brewUpToDate, checkDue, describe as describeResult, downloadsRunning, failureReason, inBrewBin, installKind, isOlderThan,
  healAfterFailure, isUpdating, pythonVersionOf, resetForTests, shebangPython, updateCommand, updateYTDLP, versionDate, whileDownloading, withSelfHeal,
  type UpdateResult,
} from './ytdlpUpdate'

const HOME = '/Users/someone'
const day = (s: string) => new Date(s + 'T12:00:00Z')

describe('versionDate', () => {
  it('reads yt-dlp versions', () => {
    expect(versionDate('2026.08.19')?.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(versionDate('2026.08.19.1')?.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(versionDate('2026.08.19.123')?.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(versionDate(' 2026.08.19\n')?.toISOString()).toBe('2026-08-19T00:00:00.000Z')
  })

  it('reads brew and -U spellings', () => {
    expect(versionDate('2026.8.19')?.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(versionDate('2026.8.19_2')?.toISOString()).toBe('2026-08-19T00:00:00.000Z')
    expect(versionDate('stable@2026.08.19')?.toISOString()).toBe('2026-08-19T00:00:00.000Z')
  })

  it('rejects anything else', () => {
    for (const v of ['', 'garbage', 'yt-dlp 2026.08.19', '2026.13.01', '2026.02.30', '2026.08', '26.08.19', '2026-08-19', '2026.08.19.x', null, undefined]) {
      expect(versionDate(v), String(v)).toBeNull()
    }
  })
})

describe('age', () => {
  it('counts whole days since the release day', () => {
    expect(ageDays('2026.08.19', day('2026-08-19'))).toBe(0)
    expect(ageDays('2026.08.19', day('2026-09-02'))).toBe(14)
    expect(ageDays('2026.08.19.1', day('2026-10-17'))).toBe(59)
    expect(ageDays('garbage', day('2026-10-17'))).toBeNull()
  })

  it('is old only past the threshold', () => {
    const v = '2026.10.01'
    expect(isOlderThan(v, 14, day('2026-10-15'))).toBe(false) // 14 days
    expect(isOlderThan(v, 14, day('2026-10-16'))).toBe(true) // 15 days
    expect(isOlderThan(v, 7, day('2026-10-08'))).toBe(false) // 7 days
    expect(isOlderThan(v, 7, day('2026-10-09'))).toBe(true) // 8 days
  })

  it('never calls an unknown version old', () => {
    expect(isOlderThan('garbage', 7, day('2030-01-01'))).toBe(false)
    expect(isOlderThan(null, 7, day('2030-01-01'))).toBe(false)
  })
})

describe('checkDue', () => {
  const now = new Date('2026-10-17T12:00:00Z')
  it('is due when never checked or a day has passed', () => {
    expect(checkDue(undefined, now)).toBe(true)
    expect(checkDue('nonsense', now)).toBe(true)
    expect(checkDue('2026-10-16T12:00:00.000Z', now)).toBe(true)
    expect(checkDue('2026-10-16T12:00:01.000Z', now)).toBe(false)
    expect(checkDue('2026-10-17T11:00:00.000Z', now)).toBe(false)
  })
  it('is due when the last check is in the future (clock changed)', () => {
    expect(checkDue('2026-10-20T12:00:00.000Z', now)).toBe(true)
  })
})

describe('installKind', () => {
  it('Homebrew: a symlink into the Cellar', () => {
    expect(installKind('/opt/homebrew/bin/yt-dlp', '/opt/homebrew/Cellar/yt-dlp/2026.8.19_2/bin/yt-dlp', HOME)).toBe('brew')
    expect(installKind('/usr/local/bin/yt-dlp', '/usr/local/Cellar/yt-dlp/2026.8.19/bin/yt-dlp', HOME)).toBe('brew')
  })

  it('pip --user: ~/Library/Python/3.x/bin', () => {
    expect(installKind(`${HOME}/Library/Python/3.9/bin/yt-dlp`, `${HOME}/Library/Python/3.9/bin/yt-dlp`, HOME)).toBe('pip')
    expect(installKind(`${HOME}/Library/Python/3.12/bin/yt-dlp`, undefined, HOME)).toBe('pip')
  })

  it('anything else is a standalone binary', () => {
    expect(installKind('/usr/local/bin/yt-dlp', '/usr/local/bin/yt-dlp', HOME)).toBe('standalone')
    expect(installKind(`${HOME}/.local/bin/yt-dlp`, `${HOME}/.local/bin/yt-dlp`, HOME)).toBe('standalone')
    expect(installKind('/usr/bin/yt-dlp', '/usr/bin/yt-dlp', HOME)).toBe('standalone')
  })

  it('knows the brew bin folders', () => {
    expect(inBrewBin('/opt/homebrew/bin/yt-dlp')).toBe(true)
    expect(inBrewBin('/usr/local/bin/yt-dlp')).toBe(true)
    expect(inBrewBin(`${HOME}/.local/bin/yt-dlp`)).toBe(false)
  })
})

describe('update commands', () => {
  it('brew upgrade, without cleanup or hints, and nothing without brew', () => {
    const c = updateCommand({ kind: 'brew', brew: '/opt/homebrew/bin/brew' })!
    expect([c.file, ...c.args]).toEqual(['/opt/homebrew/bin/brew', 'upgrade', 'yt-dlp'])
    expect(c.env).toMatchObject({ HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_ENV_HINTS: '1' })
    expect(updateCommand({ kind: 'brew', brew: null })).toBeNull()
  })

  it('pip with the matching python; -U for a standalone binary; never sudo', () => {
    const p = updateCommand({ kind: 'pip', python: '/usr/bin/python3' })!
    expect([p.file, ...p.args]).toEqual(['/usr/bin/python3', '-m', 'pip', 'install', '--user', '-U', 'yt-dlp'])
    const s = updateCommand({ kind: 'standalone', binary: '/x/yt-dlp' })!
    expect([s.file, ...s.args]).toEqual(['/x/yt-dlp', '-U'])
    for (const c of [p, s]) expect([c.file, ...c.args].join(' ')).not.toContain('sudo')
  })

  it('finds the python of a pip install', () => {
    expect(pythonVersionOf(`${HOME}/Library/Python/3.9/bin/yt-dlp`)).toBe('3.9')
    expect(pythonVersionOf('/opt/homebrew/bin/yt-dlp')).toBeNull()
    expect(shebangPython('#!/Library/Developer/CommandLineTools/usr/bin/python3')).toBe('/Library/Developer/CommandLineTools/usr/bin/python3')
    expect(shebangPython('#!/usr/bin/env python3.11')).toBe('python3.11')
    expect(shebangPython('#!/bin/sh')).toBeNull()
    expect(shebangPython('\x7fELF')).toBeNull()
  })
})

describe('command output', () => {
  it('brew saying it is already up to date', () => {
    expect(brewUpToDate('Warning: yt-dlp 2026.8.19_2 already installed\n')).toBe(true)
    expect(brewUpToDate('==> Upgrading 1 outdated package:\nyt-dlp 2026.8.19 -> 2026.10.1')).toBe(false)
    expect(brewUpToDate('Error: yt-dlp not installed')).toBe(false)
  })

  it('a short failure reason', () => {
    expect(failureReason('==> Fetching\nError: No such keg: /opt/homebrew/Cellar/yt-dlp\n', 1)).toBe('Error: No such keg: /opt/homebrew/Cellar/yt-dlp')
    expect(failureReason('a\nb\nc\nd\n', 2)).toBe('b\nc\nd')
    expect(failureReason('', 3)).toBe('it exited with code 3')
  })

  it('describes results', () => {
    expect(describeResult({ kind: 'updated', from: '2026.08.19', to: '2026.10.01', how: 'x' })).toBe('yt-dlp updated from 2026.08.19 to 2026.10.01')
    expect(describeResult({ kind: 'current', version: '2026.08.19', how: 'x' })).toBe('yt-dlp is already up to date (2026.08.19)')
    expect(describeResult({ kind: 'failed', reason: 'no network', how: null })).toBe('Could not update yt-dlp: no network')
  })
})

describe('one update at a time, never during a download', () => {
  beforeEach(() => resetForTests())
  const deferred = <T>() => { let resolve!: (v: T) => void; const p = new Promise<T>((r) => { resolve = r }); return { p, resolve } }
  const current: UpdateResult = { kind: 'current', version: '2026.08.19', how: 'fake' }

  it('a second update call shares the running one', async () => {
    let runs = 0
    const d = deferred<UpdateResult>()
    const fake = async () => { runs += 1; return d.p }
    const a = updateYTDLP('/x', undefined, fake)
    const b = updateYTDLP('/x', undefined, fake)
    expect(isUpdating()).toBe(true)
    d.resolve(current)
    expect(await a).toEqual(current)
    expect(await b).toEqual(current)
    expect(runs).toBe(1)
    expect(isUpdating()).toBe(false)
  })

  it('waits for a running download, and a download started meanwhile waits for the update', async () => {
    const order: string[] = []
    const dl = deferred<void>()
    const first = whileDownloading(async () => { order.push('download 1 start'); await dl.p; order.push('download 1 end') })
    expect(downloadsRunning()).toBe(1)
    const lines: string[] = []
    const upd = updateYTDLP('/x', (l) => lines.push(l), async () => { order.push('update'); return current })
    await new Promise((r) => setTimeout(r, 5))
    const second = whileDownloading(async () => { order.push('download 2') })
    await new Promise((r) => setTimeout(r, 5))
    expect(order).toEqual(['download 1 start'])
    dl.resolve()
    await Promise.all([first, upd, second])
    expect(order).toEqual(['download 1 start', 'download 1 end', 'update', 'download 2'])
    expect(lines).toContain('Waiting for the caption download to finish…')
  })
})

describe('withSelfHeal', () => {
  beforeEach(() => resetForTests())

  it('updates and tries once more after a yt-dlp failure', async () => {
    let n = 0
    const r = await withSelfHeal(async () => { n += 1; if (n === 1) throw new YTDLPError('yt-dlp failed (exit 1).'); return 'ok' }, async () => ({ retry: true }))
    expect(r).toBe('ok')
    expect(n).toBe(2)
  })

  it('tries only once more', async () => {
    let n = 0
    await expect(withSelfHeal(async () => { n += 1; throw new YTDLPError(`fail ${n}`) }, async () => ({ retry: true }))).rejects.toThrow('fail 2')
    expect(n).toBe(2)
  })

  it('adds a hint when the update failed, and keeps the error when nothing was newer', async () => {
    await expect(withSelfHeal(async () => { throw new YTDLPError('HTTP Error 429') }, async () => ({ retry: false, hint: 'The app tried to update yt-dlp, but that failed: offline' })))
      .rejects.toThrow('HTTP Error 429\n\nThe app tried to update yt-dlp, but that failed: offline')
    await expect(withSelfHeal(async () => { throw new YTDLPError('HTTP Error 429') }, async () => ({ retry: false }))).rejects.toThrow(/^HTTP Error 429$/)
  })

  it('leaves other errors alone', async () => {
    let healed = false
    await expect(withSelfHeal(async () => { throw new FollowAlongError('This video has no English captions.') }, async () => { healed = true; return { retry: true } }))
      .rejects.toThrow('no English captions')
    expect(healed).toBe(false)
  })
})

describe('healAfterFailure', () => {
  const env = process.env.VIDEO_NOTES_FAKE_YTDLP_VERSION
  beforeEach(() => resetForTests())
  afterEach(() => { if (env === undefined) delete process.env.VIDEO_NOTES_FAKE_YTDLP_VERSION; else process.env.VIDEO_NOTES_FAKE_YTDLP_VERSION = env })
  const now = day('2026-10-17')
  const fake = (r: UpdateResult) => { const calls: string[] = []; return { calls, run: async (b: string) => { calls.push(b); return r } } }

  it('updates a yt-dlp older than 7 days, then asks for a retry', async () => {
    process.env.VIDEO_NOTES_FAKE_YTDLP_VERSION = '2026.10.01'
    const f = fake({ kind: 'updated', from: '2026.10.01', to: '2026.10.15', how: 'fake' })
    const lines: string[] = []
    expect(await healAfterFailure('/x/yt-dlp', (l) => lines.push(l), now, f.run)).toEqual({ retry: true })
    expect(f.calls).toEqual(['/x/yt-dlp'])
    expect(lines).toEqual(['Updating yt-dlp…', 'yt-dlp updated to 2026.10.15; trying again…'])
  })

  it('leaves a recent yt-dlp alone', async () => {
    process.env.VIDEO_NOTES_FAKE_YTDLP_VERSION = '2026.10.12'
    const f = fake({ kind: 'current', version: 'x', how: 'fake' })
    expect(await healAfterFailure('/x/yt-dlp', () => {}, now, f.run)).toEqual({ retry: false })
    expect(f.calls).toEqual([])
  })

  it('no retry when nothing newer was found, and no second update within the hour', async () => {
    process.env.VIDEO_NOTES_FAKE_YTDLP_VERSION = '2026.08.19'
    const f = fake({ kind: 'current', version: '2026.08.19', how: 'fake' })
    expect(await healAfterFailure('/x/yt-dlp', () => {}, now, f.run)).toEqual({ retry: false })
    expect(await healAfterFailure('/x/yt-dlp', () => {}, new Date(), f.run)).toEqual({ retry: false })
    expect(f.calls.length).toBe(1)
  })

  it('a hint when the update failed', async () => {
    process.env.VIDEO_NOTES_FAKE_YTDLP_VERSION = '2026.08.19'
    const f = fake({ kind: 'failed', reason: 'no network', how: 'fake' })
    expect(await healAfterFailure('/x/yt-dlp', () => {}, now, f.run)).toEqual({ retry: false, hint: 'The app tried to update yt-dlp, but that failed: no network' })
  })
})
