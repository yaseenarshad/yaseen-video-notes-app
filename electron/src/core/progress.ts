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
 *       "seconds" : 1808,
 *       "updated" : "2026-10-17T18:02:11Z"
 *     }
 *
 * The vault is synced across computers with git, so the spot travels with it. It is its own tiny
 * file (the big .follow-along.json is never rewritten) and the app writes it rarely. A missing or
 * broken file means "not started". The format (pretty, sorted keys, `" : "`) is what Swift's
 * JSONEncoder writes, so both apps produce the same bytes.
 */
export interface Progress {
  seconds: number
  duration: number
  updated: string
  device: string | null
}

export const PROGRESS_FILE = '.follow-along-progress.json'

/** Within the last 30 s or the last 2 %: counts as watched to the end. */
export const finished = (p: Progress): boolean => p.duration > 0 && p.seconds >= p.duration - Math.max(30, p.duration * 0.02)
export const left = (p: Progress): number => Math.max(0, p.duration - p.seconds)
export const fraction = (p: Progress): number => (p.duration > 0 ? Math.min(1, Math.max(0, p.seconds / p.duration)) : 0)

export function readProgress(folder: string): Progress | null {
  try {
    const o = JSON.parse(readFileSync(join(folder, PROGRESS_FILE), 'utf8')) as Record<string, unknown>
    if (typeof o.seconds !== 'number' || typeof o.duration !== 'number' || typeof o.updated !== 'string') return null
    return { seconds: o.seconds, duration: o.duration, updated: o.updated, device: typeof o.device === 'string' ? o.device : null }
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
  rows.push(['duration', JSON.stringify(p.duration)], ['seconds', JSON.stringify(p.seconds)], ['updated', swiftString(p.updated)])
  return '{\n' + rows.map(([k, v]) => `  "${k}" : ${v}`).join(',\n') + '\n}'
}

export function writeProgress(folder: string, seconds: number, duration: number, date: Date = new Date()): void {
  const p: Progress = { seconds: swiftRound(seconds), duration: swiftRound(duration), updated: iso(date), device: device() }
  atomicWrite(join(folder, PROGRESS_FILE), encodeProgress(p))
}

/** Swift `Double.rounded()`: half away from zero. */
export const swiftRound = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x))
