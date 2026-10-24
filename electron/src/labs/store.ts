import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from '../core/atomic'
import type { LabsAnalysis } from './analysis/schema'

/**
 * Where Labs keeps its own data — always inside Labs' userData (`~/Library/Application Support/Yaseen Video Notes
 * Labs/` by default), never in the vault:
 *
 *   labs-cache/<videoId>/labs-analysis.json   the analysis (analysis/schema.ts)
 *   labs-cache/<videoId>/signals.json          YouTube "most replayed" heatmap + SponsorBlock segments (signals.ts)
 *   labs-cache/<videoId>/info.json             a trimmed yt-dlp info json (title, description, chapters, heatmap…)
 *   labs-cache/<videoId>/prompt-<n>.txt        the prompt(s) sent to `claude -p` (debugging, re-runs)
 *   labs-cache/<videoId>/response-<n>.txt      the model's raw answer(s) (never shown; the validator reads them)
 *   labs-library/                              videos added from a link in Labs ("Add to Library")
 *   labs-progress/<hash>.json                  resume spots (core/progress.ts)
 *   labs-state.json                            per-experiment state (LABS.store in the page API)
 *   settings.json                              Labs' settings, incl. `labsEnabled` (the on/off switches)
 */
export const CACHE_DIR = 'labs-cache'
export const LIBRARY_DIR = 'labs-library'
export const STATE_FILE = 'labs-state.json'
export const ANALYSIS_FILE = 'labs-analysis.json'
export const SIGNALS_FILE = 'signals.json'
export const INFO_FILE = 'info.json'

const safeId = (id: string): string => {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) throw new Error(`not a video id: ${id}`)
  return id
}

export const cacheDir = (userData: string, videoId: string): string => join(userData, CACHE_DIR, safeId(videoId))

export function readJSON<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return null }
}

/** Writes a file in a video's cache folder (atomic; creates the folder). */
export function writeCache(userData: string, videoId: string, name: string, data: string): string {
  const dir = cacheDir(userData, videoId)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  atomicWrite(p, data)
  return p
}

export const analysisPath = (userData: string, videoId: string): string => join(cacheDir(userData, videoId), ANALYSIS_FILE)

export function readAnalysis(userData: string, videoId: string): LabsAnalysis | null {
  const a = readJSON<LabsAnalysis>(analysisPath(userData, videoId))
  return a && typeof a === 'object' && Array.isArray(a.highlights) ? a : null
}

export function writeAnalysis(userData: string, a: LabsAnalysis): string {
  return writeCache(userData, a.videoId, ANALYSIS_FILE, JSON.stringify(a, null, 1))
}

/** Every analyzed video: id → when, and how many highlights (for the New Tab / board experiments). */
export function analyzedIndex(userData: string): Record<string, { createdAt: string; highlights: number }> {
  const out: Record<string, { createdAt: string; highlights: number }> = {}
  const root = join(userData, CACHE_DIR)
  if (!existsSync(root)) return out
  for (const id of readdirSync(root)) {
    const a = readJSON<LabsAnalysis>(join(root, id, ANALYSIS_FILE))
    if (a && Array.isArray(a.highlights)) out[id] = { createdAt: a.createdAt, highlights: a.highlights.length }
  }
  return out
}

/** Per-experiment state (`labs-state.json`: { [experimentId]: { [key]: value } }). */
export function readState(userData: string): Record<string, Record<string, unknown>> {
  return readJSON<Record<string, Record<string, unknown>>>(join(userData, STATE_FILE)) ?? {}
}

export function writeStateKey(userData: string, experiment: string, key: string, value: unknown): void {
  const all = readState(userData)
  const mine = { ...(all[experiment] ?? {}) }
  if (value === undefined || value === null) delete mine[key]
  else mine[key] = value
  all[experiment] = mine
  mkdirSync(userData, { recursive: true })
  atomicWrite(join(userData, STATE_FILE), JSON.stringify(all, null, 1))
}
