import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { atomicWrite } from './atomic'

/**
 * Where a video was left, in a small file next to its transcript:
 * `<video folder>/.follow-along-progress.json`
 *
 *     {
 *       "device" : "Yasin's MacBook Pro",
 *       "duration" : 6271,
 *       "home" : 1808,
 *       "seconds" : 1808,
 *       "updated" : "2026-10-17T18:02:11Z"
 *     }
 *
 * The vault is synced across computers with git, so the spot travels with it. It is its own tiny
 * file (the big .follow-along.json is never rewritten) and the app writes it rarely. A missing or
 * broken file means "not started". The format (pretty, sorted keys, `" : "`) is what Swift's
 * JSONEncoder writes, so both apps produce the same bytes. No final newline.
 *
 * `home` (added later, optional) is the player's 📍 main spot (`core/home.ts`): where the video resumes. It
 * differs from `seconds` (where the playhead was) after a detour, e.g. a jump to the end to check something.
 * Old files have no `home`: it reads as `seconds`. The New Tab progress and "min left" use the furthest of the
 * two (a detour ahead of home still counts as seen); resume uses home.
 */
export interface Progress {
  seconds: number
  duration: number
  updated: string
  device: string | null
  /** The 📍 home spot; null when the file has none (then it is `seconds`). */
  home: number | null
}

/** Where to resume: home, else seconds. */
export const homeOf = (p: Progress): number => p.home ?? p.seconds
/** The furthest of seconds / home (New Tab progress, min left, finished). */
export const furthest = (p: Progress): number => Math.max(p.seconds, p.home ?? p.seconds)

export const PROGRESS_FILE = '.follow-along-progress.json'

/** Within the last 30 s or the last 2 %: counts as watched to the end. */
export const finished = (p: Progress): boolean => p.duration > 0 && furthest(p) >= p.duration - Math.max(30, p.duration * 0.02)
export const left = (p: Progress): number => Math.max(0, p.duration - furthest(p))
export const fraction = (p: Progress): number => (p.duration > 0 ? Math.min(1, Math.max(0, furthest(p) / p.duration)) : 0)

export function readProgress(folder: string): Progress | null {
  try {
    const o = JSON.parse(readFileSync(join(folder, PROGRESS_FILE), 'utf8')) as Record<string, unknown>
    if (typeof o.seconds !== 'number' || typeof o.duration !== 'number' || typeof o.updated !== 'string') return null
    return { seconds: o.seconds, duration: o.duration, updated: o.updated, device: typeof o.device === 'string' ? o.device : null,
      home: typeof o.home === 'number' && Number.isFinite(o.home) ? o.home : null }
  } catch {
    return null
  }
}

let deviceName: string | null = null
/** The computer's name as macOS shows it ("Yasin's MacBook Pro"), like `Host.current().localizedName`. */
export function device(): string {
  if (deviceName === null) {
    try {
      deviceName = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim()
    } catch {
      deviceName = ''
    }
    if (!deviceName) deviceName = hostname()
  }
  return deviceName
}

/** ISO 8601 in UTC without fractions: "2026-10-17T18:02:11Z". */
export const iso = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Swift's JSON string (escapes "/" as "\/" like JSONEncoder without `.withoutEscapingSlashes`). */
const swiftString = (s: string): string => JSON.stringify(s).replaceAll('/', '\\/')

export function encodeProgress(p: Progress): string {
  const rows: [string, string][] = []
  if (p.device !== null) rows.push(['device', swiftString(p.device)])
  rows.push(['duration', JSON.stringify(p.duration)])
  if (p.home !== null) rows.push(['home', JSON.stringify(p.home)])
  rows.push(['seconds', JSON.stringify(p.seconds)], ['updated', swiftString(p.updated)])
  return '{\n' + rows.map(([k, v]) => `  "${k}" : ${v}`).join(',\n') + '\n}'
}

/** Writes the progress file; `home` (the 📍 main spot) is written when given. */
export function writeProgress(folder: string, seconds: number, duration: number, date: Date = new Date(), home: number | null = null): void {
  const p: Progress = { seconds: swiftRound(seconds), duration: swiftRound(duration), updated: iso(date), device: device(),
    home: home === null || !Number.isFinite(home) ? null : swiftRound(home) }
  atomicWrite(join(folder, PROGRESS_FILE), encodeProgress(p))
}

/** Swift `Double.rounded()`: half away from zero. */
export const swiftRound = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))
