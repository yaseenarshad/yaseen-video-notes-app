import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { hostname } from 'node:os'
import { basename } from 'node:path'

/**
 * A lock next to a transcript .md (`<md>.lock`) that every writer of that .md takes: the app (note
 * save / edit / delete / category / resolved / release, status writes, guide insertion, setup
 * conversion) and the `video-notes` CLI that agents use (claim / resolve / release). Inside the lock a
 * writer reads the file fresh, changes it and writes it atomically, so two writers never erase each
 * other's change.
 *
 * The lock file is created with O_EXCL (`wx`) and holds `{ pid, host, time, token }` as JSON. A writer
 * that finds it retries with a short backoff for up to ~10 s. A lock older than 30 s, or one whose pid
 * no longer runs on this host, is stale and is taken over. Taking over goes through a second, short
 * `<md>.lock.takeover` file so two waiters never both remove a lock (one of them would remove the
 * other's fresh lock).
 *
 * Synchronous on purpose: the app's write paths are synchronous, and a lock is held for milliseconds.
 */

export const LOCK_SUFFIX = '.lock'
export const LOCK_WAIT_MS = 10_000
export const LOCK_STALE_MS = 30_000

/** Waited ~10 s and the lock was still held by a live writer. */
export class LockTimeout extends Error {
  constructor(readonly path: string, readonly holder: LockInfo | null) {
    super(`${basename(path)} is busy (locked${holder ? ` by pid ${holder.pid} on ${holder.host}` : ''}); try again`)
    this.name = 'LockTimeout'
  }
}

export interface LockInfo { pid: number; host: string; time: number; token: string }

export interface LockOptions {
  /** How long to wait for a held lock (ms). */
  waitMs?: number
  /** Age after which a lock is stale (ms). */
  staleMs?: number
  /** For tests: the clock. */
  now?: () => number
}

export const lockPath = (path: string): string => path + LOCK_SUFFIX

/** True for a lock file name (hidden from folder lists). */
export const isLockFile = (name: string): boolean => name.endsWith(LOCK_SUFFIX) || name.endsWith(LOCK_SUFFIX + '.takeover')

const sab = new Int32Array(new SharedArrayBuffer(4))
/** Blocks the thread for `ms` (no busy loop). */
export const sleepSync = (ms: number): void => { Atomics.wait(sab, 0, 0, Math.max(1, Math.round(ms))) }

const HOST = hostname()

function readLock(p: string): LockInfo | null {
  try {
    const o = JSON.parse(readFileSync(p, 'utf8')) as Partial<LockInfo>
    if (typeof o.pid === 'number' && typeof o.host === 'string' && typeof o.time === 'number') return { pid: o.pid, host: o.host, time: o.time, token: String(o.token ?? '') }
  } catch { /* empty (being written) or gone */ }
  return null
}

/** True when that pid runs (EPERM: it runs, as another user). */
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

const mtime = (p: string): number | null => { try { return statSync(p).mtimeMs } catch { return null } }

/** Why the lock at `p` may be taken over, or null while it is live. */
function staleReason(p: string, info: LockInfo | null, now: number, staleMs: number): string | null {
  if (info) {
    if (now - info.time > staleMs) return 'old'
    if (info.host === HOST && info.pid !== process.pid && !pidAlive(info.pid)) return 'dead pid'
    return null
  }
  // no readable content: a writer between open and write, or a crash right there
  const m = mtime(p)
  return m !== null && now - m > staleMs ? 'old' : null
}

/** Creates `p` with O_EXCL and writes `info`; false when it exists. */
function create(p: string, info: LockInfo): boolean {
  let fd: number
  try { fd = openSync(p, 'wx') } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
  try { writeSync(fd, JSON.stringify(info)) } finally { closeSync(fd) }
  return true
}

/** Removes a stale lock, unless another waiter is doing it or it changed since it was judged stale. */
function takeOver(p: string, seen: LockInfo | null, now: number, staleMs: number): void {
  const t = p + '.takeover'
  const m = mtime(t)
  if (m !== null && now - m > 5_000) { try { unlinkSync(t) } catch { /* someone else did */ } }
  if (!create(t, { pid: process.pid, host: HOST, time: now, token: randomUUID() })) return
  try {
    const again = readLock(p)
    const same = (again === null && seen === null) || (again !== null && seen !== null && again.token === seen.token && again.time === seen.time)
    if (same && staleReason(p, again, now, staleMs)) { try { unlinkSync(p) } catch { /* gone */ } }
  } finally {
    try { unlinkSync(t) } catch { /* gone */ }
  }
}

/**
 * Takes the lock for `path` (waits up to ~10 s); returns the release function. `release(at)`: the file (and so its
 * lock) was moved to `at` meanwhile (a video folder moved to another folder): releases the lock there.
 */
export function acquireLock(path: string, opts: LockOptions = {}): (at?: string) => void {
  const p = lockPath(path)
  // VIDEO_NOTES_LOCK_WAIT_MS: for tests of the CLI's "file busy" exit code
  const envWait = Number(process.env.VIDEO_NOTES_LOCK_WAIT_MS)
  const waitMs = opts.waitMs ?? (envWait > 0 ? envWait : LOCK_WAIT_MS), staleMs = opts.staleMs ?? LOCK_STALE_MS
  const now = opts.now ?? Date.now
  const start = Date.now()
  let delay = 4
  for (;;) {
    const info: LockInfo = { pid: process.pid, host: HOST, time: now(), token: randomUUID() }
    if (create(p, info)) {
      return (at?: string) => {
        // only our own lock (a writer that took it over after 30 s keeps theirs)
        const lp = at === undefined ? p : lockPath(at)
        const cur = readLock(lp)
        if (cur && cur.token === info.token) { try { unlinkSync(lp) } catch { /* gone */ } }
      }
    }
    const held = readLock(p)
    if (staleReason(p, held, now(), staleMs)) { takeOver(p, held, now(), staleMs); continue }
    if (Date.now() - start >= waitMs) throw new LockTimeout(path, held)
    sleepSync(delay * (0.5 + Math.random()))
    delay = Math.min(delay * 2, 100)
  }
}

/**
 * Runs `fn` while holding the lock for `path`; the lock is always released (finally). Read the file,
 * change it and write it inside `fn`.
 */
export function withFileLock<T>(path: string, fn: () => T, opts: LockOptions = {}): T {
  const release = acquireLock(path, opts)
  try { return fn() } finally { release() }
}
