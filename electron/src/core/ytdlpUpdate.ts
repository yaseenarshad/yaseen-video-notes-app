import { spawn } from 'node:child_process'
import { accessSync, constants, openSync, readSync, closeSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { YTDLPError } from './errors'

/**
 * Keeps yt-dlp up to date. An old yt-dlp is the main reason caption downloads fail (YouTube changes often),
 * so the app updates it by itself: once a day when it is more than 14 days old (main process), after a failed
 * download when it is more than 7 days old (`withSelfHeal`), and from the menu. The update command depends on
 * how yt-dlp was installed (Homebrew, pip --user, or a standalone binary); never sudo, never a password.
 * One update at a time, and never while a download runs (`whileDownloading` / `updateYTDLP`).
 */

const DAY = 86_400_000
/** The daily check updates a yt-dlp older than this. */
export const DAILY_STALE_DAYS = 14
/** After a failed download, a yt-dlp older than this is updated and the download tried once more. */
export const FAILURE_STALE_DAYS = 7
/** The daily check runs at most this often. */
export const CHECK_INTERVAL_MS = DAY
/** After an update found nothing newer, a failed download does not try again for this long. */
export const RECHECK_AFTER_CURRENT_MS = 60 * 60 * 1000
const UPDATE_TIMEOUT_MS = 3 * 60 * 1000

// ---------- versions (pure) ----------

/**
 * The release day (UTC) of a yt-dlp version: "2026.08.19", "2026.08.19.1" (same-day release), brew's
 * "2026.8.19" / "2026.8.19_2", or "stable@2026.08.19". Null for anything else.
 */
export function versionDate(version: string | null | undefined): Date | null {
  const m = /^\s*(?:[a-z]+@)?(\d{4})\.(\d{1,2})\.(\d{1,2})(?:\.\d+)?(?:_\d+)?\s*$/i.exec(version ?? '')
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

/** Whole days since the version's release day, or null when the version is not a yt-dlp date version. */
export function ageDays(version: string | null | undefined, now: Date = new Date()): number | null {
  const d = versionDate(version)
  return d ? Math.floor((now.getTime() - d.getTime()) / DAY) : null
}

/** True when the version is more than `days` days old. An unknown version is never "old" (nothing to compare). */
export function isOlderThan(version: string | null | undefined, days: number, now: Date = new Date()): boolean {
  const a = ageDays(version, now)
  return a !== null && a > days
}

/** True when the daily check is due: never checked, or the last check (ISO time) is a day old (or in the future). */
export function checkDue(lastChecked: string | null | undefined, now: Date = new Date()): boolean {
  const t = lastChecked ? Date.parse(lastChecked) : NaN
  if (!Number.isFinite(t)) return true
  const since = now.getTime() - t
  return since >= CHECK_INTERVAL_MS || since < -60_000
}

// ---------- how it was installed (pure) ----------

export type InstallKind = 'brew' | 'pip' | 'standalone'

/**
 * How yt-dlp was installed, from its path and the path it resolves to: a Homebrew symlink into a Cellar,
 * a pip --user script in ~/Library/Python/3.x/bin, or else a standalone binary (which updates itself with -U).
 */
export function installKind(binary: string, realPath: string = binary, home: string = homedir()): InstallKind {
  if (/\/Cellar\/yt-dlp\//.test(realPath) || /^\/(opt\/homebrew|usr\/local)\/Cellar\//.test(realPath)) return 'brew'
  const pip = (p: string) => p.startsWith(home + '/Library/Python/') && /\/Library\/Python\/3\.\d+\/bin\/yt-dlp$/.test(p)
  if (pip(binary) || pip(realPath)) return 'pip'
  return 'standalone'
}

/** True for the folders Homebrew links its tools into (a yt-dlp there that is not a Cellar symlink may still be brew's). */
export const inBrewBin = (binary: string): boolean => /^\/(opt\/homebrew|usr\/local)\/bin\/yt-dlp$/.test(binary)

/** "3.9" from ".../Library/Python/3.9/bin/yt-dlp". */
export function pythonVersionOf(binary: string): string | null {
  return /\/Library\/Python\/(3\.\d+)\/bin\//.exec(binary)?.[1] ?? null
}

/** The interpreter in a script's "#!" line: "/usr/bin/python3", or "python3" for "#!/usr/bin/env python3". */
export function shebangPython(firstLine: string): string | null {
  const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(firstLine)
  if (!m) return null
  const cmd = m[1].endsWith('/env') ? m[2] ?? null : m[1]
  return cmd && /python/.test(cmd.split('/').pop() ?? '') ? cmd : null
}

export type UpdateMethod =
  | { kind: 'brew'; brew: string | null }
  | { kind: 'pip'; python: string }
  | { kind: 'standalone'; binary: string }

export interface Command { file: string; args: string[]; env: Record<string, string>; label: string }

/** The command that updates yt-dlp for a method. */
export function updateCommand(m: UpdateMethod): Command | null {
  switch (m.kind) {
    case 'brew':
      return m.brew ? { file: m.brew, args: ['upgrade', 'yt-dlp'], env: { HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_ENV_HINTS: '1' }, label: 'brew upgrade yt-dlp' } : null
    case 'pip':
      return { file: m.python, args: ['-m', 'pip', 'install', '--user', '-U', 'yt-dlp'], env: { PIP_DISABLE_PIP_VERSION_CHECK: '1' }, label: 'pip install --user -U yt-dlp' }
    case 'standalone':
      return { file: m.binary, args: ['-U'], env: {}, label: 'yt-dlp -U' }
  }
}

/** True when `brew upgrade yt-dlp` says the newest yt-dlp is already there ("Warning: yt-dlp 2026.8.19 already installed"). */
export const brewUpToDate = (output: string): boolean => /\byt-dlp\b[^\n]*\balready installed\b/i.test(output)

/** A short reason from a failed command's output: its last error lines, else its last lines. */
export function failureReason(output: string, code: number | null): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  const errs = lines.filter((l) => /^(error|fatal)\b|\berror:/i.test(l))
  const pick = (errs.length ? errs : lines).slice(-3).join('\n')
  return pick || (code === null ? 'it did not finish' : `it exited with code ${code}`)
}

// ---------- results ----------

export type UpdateResult =
  | { kind: 'updated'; from: string | null; to: string; how: string }
  | { kind: 'current'; version: string | null; how: string }
  | { kind: 'failed'; reason: string; how: string | null }

/** One line for a toast or a log: "updated from A to B" / "already up to date" / "failed: …". */
export function describe(r: UpdateResult): string {
  switch (r.kind) {
    case 'updated': return r.from ? `yt-dlp updated from ${r.from} to ${r.to}` : `yt-dlp updated to ${r.to}`
    case 'current': return `yt-dlp is already up to date${r.version ? ` (${r.version})` : ''}`
    case 'failed': return `Could not update yt-dlp: ${r.reason}`
  }
}

// ---------- running things ----------

/** The environment yt-dlp and its updaters run in: Homebrew and deno on PATH, and plain Node inside Electron. */
export function toolEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const home = homedir()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: ['/opt/homebrew/bin', '/usr/local/bin', `${home}/.deno/bin`, '/usr/bin', '/bin', '/usr/sbin', '/sbin', process.env.PATH ?? ''].join(':'),
    ...extra,
  }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

interface Run { code: number | null; output: string; timedOut: boolean; error?: string }

/** Runs a command (no shell, no stdin, so it can never wait for a password) and collects its output. */
function exec(file: string, args: string[], opts: { env?: Record<string, string>; timeout: number; onLine?: (l: string) => void }): Promise<Run> {
  return new Promise((resolve) => {
    let output = ''
    let buffer = ''
    let timedOut = false
    let p: ReturnType<typeof spawn>
    try {
      p = spawn(file, args, { env: toolEnv(opts.env), stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      resolve({ code: null, output: '', timedOut: false, error: e instanceof Error ? e.message : String(e) })
      return
    }
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGTERM') }, opts.timeout)
    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8')
      output += s
      if (!opts.onLine) return
      buffer += s
      const parts = buffer.split(/[\r\n]/)
      buffer = parts.pop() ?? ''
      parts.filter((l) => l.trim() !== '').forEach(opts.onLine)
    }
    p.stdout?.on('data', onData)
    p.stderr?.on('data', onData)
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: null, output, timedOut, error: e.message }) })
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, output, timedOut }) })
  })
}

const isExecutable = (p: string): boolean => { try { accessSync(p, constants.X_OK); return statSync(p).isFile() } catch { return false } }

/** The installed version (`yt-dlp --version`), or null when it does not run. */
export async function installedVersion(binary: string): Promise<string | null> {
  const r = await exec(binary, ['--version'], { timeout: 20_000 })
  const v = r.code === 0 ? r.output.trim().split(/\s+/)[0] : ''
  return v || null
}

/**
 * The version to judge the age by: `installedVersion`, or VIDEO_NOTES_FAKE_YTDLP_VERSION when set (tests: it
 * makes the app believe yt-dlp is old, so the update path runs, without downgrading anything).
 */
export async function versionForAge(binary: string): Promise<string | null> {
  const fake = process.env.VIDEO_NOTES_FAKE_YTDLP_VERSION ?? process.env.FOLLOW_ALONG_FAKE_YTDLP_VERSION
  return fake || installedVersion(binary)
}

const BREWS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
export const findBrew = (): string | null => BREWS.find(isExecutable) ?? null

function firstLine(path: string): string {
  try {
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(256)
      const n = readSync(fd, buf, 0, 256, 0)
      return buf.subarray(0, n).toString('utf8').split('\n')[0]
    } finally { closeSync(fd) }
  } catch { return '' }
}

/** The python that installed a pip --user yt-dlp: its script's "#!" interpreter, else python3.x, else python3. */
function pythonFor(binary: string): string {
  const sheb = shebangPython(firstLine(binary))
  if (sheb && sheb.startsWith('/') && isExecutable(sheb)) return sheb
  const v = pythonVersionOf(binary)
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', '/Library/Frameworks/Python.framework/Versions/' + (v ?? '3') + '/bin', '/usr/bin']
  for (const name of [v ? `python${v}` : null, 'python3']) {
    if (!name) continue
    for (const d of dirs) if (isExecutable(`${d}/${name}`)) return `${d}/${name}`
  }
  return '/usr/bin/python3'
}

/** How to update the yt-dlp at `binary`. */
export async function detectMethod(binary: string): Promise<UpdateMethod> {
  let real = binary
  try { real = realpathSync(binary) } catch { /* keep */ }
  const kind = installKind(binary, real)
  if (kind === 'brew') return { kind: 'brew', brew: findBrew() }
  if (kind === 'pip') return { kind: 'pip', python: pythonFor(binary) }
  const brew = findBrew()
  if (brew && inBrewBin(binary)) {
    const r = await exec(brew, ['list', '--versions', 'yt-dlp'], { timeout: 30_000, env: { HOMEBREW_NO_ENV_HINTS: '1' } })
    if (r.code === 0 && /\byt-dlp\b/.test(r.output)) return { kind: 'brew', brew }
  }
  return { kind: 'standalone', binary }
}

const BREW_MISSING = 'yt-dlp was installed with Homebrew, but brew was not found in /opt/homebrew/bin or /usr/local/bin. Run "brew upgrade yt-dlp" in Terminal.'

/** Runs the update once (no lock: use `updateYTDLP`) and compares the version before and after. */
export async function runUpdate(binary: string, progress: (line: string) => void = () => {}): Promise<UpdateResult> {
  const before = await installedVersion(binary)
  const method = await detectMethod(binary)
  const cmd = updateCommand(method)
  if (!cmd) return { kind: 'failed', reason: BREW_MISSING, how: null }
  progress(`Updating yt-dlp (${cmd.label})…`)
  const r = await exec(cmd.file, cmd.args, { env: cmd.env, timeout: UPDATE_TIMEOUT_MS })
  const after = await installedVersion(binary)
  if (after && after !== before && (before === null || (versionDate(after)?.getTime() ?? 0) >= (versionDate(before)?.getTime() ?? 0))) {
    return { kind: 'updated', from: before, to: after, how: cmd.label }
  }
  if (r.timedOut) return { kind: 'failed', reason: `"${cmd.label}" did not finish within ${UPDATE_TIMEOUT_MS / 60000} minutes.`, how: cmd.label }
  if (r.error) return { kind: 'failed', reason: `Could not run "${cmd.label}": ${r.error}`, how: cmd.label }
  if (r.code === 0 || (method.kind === 'brew' && brewUpToDate(r.output))) return { kind: 'current', version: after ?? before, how: cmd.label }
  return { kind: 'failed', reason: `"${cmd.label}" failed: ${failureReason(r.output, r.code)}`, how: cmd.label }
}

// ---------- one at a time, never during a download ----------

let updating: Promise<UpdateResult> | null = null
let downloads = 0
let idle: (() => void)[] = []
let last: { at: number; result: UpdateResult } | null = null

export const isUpdating = (): boolean => updating !== null
export const downloadsRunning = (): number => downloads
/** The last update's result and when it finished (ms), or null. */
export const lastUpdate = (): { at: number; result: UpdateResult } | null => last

/** Runs a download: waits for a running update first, and keeps updates out while it runs. */
export async function whileDownloading<T>(fn: () => Promise<T>): Promise<T> {
  while (updating) await updating
  downloads += 1
  try {
    return await fn()
  } finally {
    downloads -= 1
    if (downloads === 0) idle.splice(0).forEach((f) => f())
  }
}

/**
 * Updates yt-dlp (one at a time: a second call while one runs gets the same result). Waits for running
 * downloads to finish first; downloads that start meanwhile wait for the update.
 */
export function updateYTDLP(binary: string, progress: (line: string) => void = () => {}, run: typeof runUpdate = runUpdate): Promise<UpdateResult> {
  if (updating) return updating
  const p = (async (): Promise<UpdateResult> => {
    await Promise.resolve()
    try {
      while (downloads > 0) {
        progress('Waiting for the caption download to finish…')
        await new Promise<void>((r) => idle.push(r))
      }
      return await run(binary, progress)
    } catch (e) {
      return { kind: 'failed', reason: e instanceof Error ? e.message : String(e), how: null }
    }
  })().then((result) => {
    last = { at: Date.now(), result }
    updating = null
    return result
  })
  updating = p
  return p
}

// ---------- self-heal after a failed download ----------

export interface Heal {
  /** Whether to try the download once more (yt-dlp was updated). */
  retry: boolean
  /** Added to the error when the download is not tried again (the update failed). */
  hint?: string
}

/**
 * After a failed download: when yt-dlp is more than 7 days old, update it. Not again within an hour after an
 * update found nothing newer (the failure has another cause then).
 */
export async function healAfterFailure(binary: string, progress: (line: string) => void, now: Date = new Date(), run: typeof runUpdate = runUpdate): Promise<Heal> {
  const version = await versionForAge(binary)
  if (!isOlderThan(version, FAILURE_STALE_DAYS, now)) return { retry: false }
  if (last && last.result.kind === 'current' && now.getTime() - last.at < RECHECK_AFTER_CURRENT_MS) return { retry: false }
  progress('Updating yt-dlp…')
  const r = await updateYTDLP(binary, progress, run)
  if (r.kind === 'updated') {
    progress(`yt-dlp updated to ${r.to}; trying again…`)
    return { retry: true }
  }
  if (r.kind === 'current') {
    progress(describe(r))
    return { retry: false }
  }
  progress(describe(r))
  return { retry: false, hint: `The app tried to update yt-dlp, but that failed: ${r.reason}` }
}

/**
 * Runs `attempt` (a whole caption download). If it fails because of yt-dlp (`YTDLPError`, including 429 after
 * its retries), `heal` may update yt-dlp; then the download is tried once more. Other errors pass through.
 */
export async function withSelfHeal<T>(attempt: () => Promise<T>, heal: () => Promise<Heal>): Promise<T> {
  try {
    return await whileDownloading(attempt)
  } catch (e) {
    if (!(e instanceof YTDLPError)) throw e
    let h: Heal
    try { h = await heal() } catch { throw e }
    if (h.retry) return await whileDownloading(attempt)
    if (h.hint) throw new YTDLPError(`${e.message}\n\n${h.hint}`)
    throw e
  }
}

/** Tests only: forget the last update result. */
export function resetForTests(): void { last = null; updating = null; downloads = 0; idle = [] }
