import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/**
 * The build flavor: the normal app, or **Labs** ("Yaseen Video Notes Labs", bundle id com.yaseen.videonotes.labs,
 * its own userData) — an experimental copy that reads the user's real vault but never writes to it.
 *
 * Plain Node (no Electron): the app's main process and the CLI call `configureFlavor` once at start; the unit
 * tests call it directly. In the normal flavor every function here is a no-op pass-through.
 *
 * THE read-only guard (`mayWrite` / `writable`) is the one place that decides whether the app may write a file.
 * Every low-level write path asks it: `atomicWrite` (atomic.ts), the transcript lock (`acquireLock` in
 * fileLock.ts — a `<md>.lock` file is a write too), folder creation and setup conversion (folderMaker.ts) and the
 * Feed's folder (main/feed.ts). In Labs only paths under `writableRoots` (Labs' own userData) are written; every
 * other write is skipped and logged ("read-only (labs): skipped …"). The resume spot (`.follow-along-progress.json`)
 * is redirected into Labs' userData instead (`progressPath`).
 */
export type FlavorId = 'normal' | 'labs'

export interface FlavorState {
  id: FlavorId
  /** Labs: writes outside `writableRoots` are skipped (and logged). */
  readOnlyVault: boolean
  /** Folders that may be written while `readOnlyVault` (Labs' userData). Absolute. */
  writableRoots: string[]
  /** Labs: where resume spots live (`<userData>/labs-progress`); null = next to the transcript (normal). */
  progressDir: string | null
  /** Where "skipped" lines go (the app's debug log). */
  log: (line: string) => void
}

const NORMAL: FlavorState = { id: 'normal', readOnlyVault: false, writableRoots: [], progressDir: null, log: () => {} }

let state: FlavorState = { ...NORMAL }

/** The current flavor (read-only view). */
export const Flavor: Readonly<FlavorState> = new Proxy({} as FlavorState, { get: (_t, k) => state[k as keyof FlavorState] })

export const isLabs = (): boolean => state.id === 'labs'

/** Sets the flavor (app start / CLI start / tests). Paths are made absolute. */
export function configureFlavor(p: Partial<FlavorState>): void {
  state = { ...state, ...p }
  state.writableRoots = state.writableRoots.map((r) => resolve(r))
  if (state.progressDir) state.progressDir = resolve(state.progressDir)
}

/** Back to the normal flavor (tests). */
export function resetFlavor(): void { state = { ...NORMAL } }

/** The Labs app's name and its default userData folder (the CLI has no Electron `app.getPath`). */
export const LABS_APP_NAME = 'Yaseen Video Notes Labs'
export const labsUserDataDefault = (home: string = homedir()): string => join(home, 'Library/Application Support', LABS_APP_NAME)

/** The Labs flavor for a userData folder: read-only vault, only `userData` writable, resume spots inside it. */
export function configureLabs(userData: string, log: (line: string) => void = () => {}): void {
  configureFlavor({ id: 'labs', readOnlyVault: true, writableRoots: [userData], progressDir: join(userData, 'labs-progress'), log })
}

const inside = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/** True when the app may write `path` (always in the normal flavor). Silent. */
export function writable(path: string): boolean {
  if (!state.readOnlyVault) return true
  const abs = resolve(path)
  return state.writableRoots.some((r) => inside(abs, r))
}

/**
 * THE guard: true = go ahead and write `path`; false = Labs is read-only there — the caller skips the write
 * (a no-op) and a "read-only (labs): skipped <what> <path>" line goes to the debug log.
 */
export function mayWrite(path: string, what: string): boolean {
  if (writable(path)) return true
  state.log(`read-only (labs): skipped ${what} ${resolve(path)}`)
  return false
}

/** Thrown where skipping a write would leave nothing usable (making a folder in the vault, setting one up). */
export class ReadOnlyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReadOnlyError'
  }
}

/** The message the UI shows where a write would happen in Labs. */
export const READ_ONLY_HINT = 'Labs is read-only — this is not saved'

// ---------- resume spot (progress.ts) ----------

/** Labs: the resume file for a video folder inside Labs' userData (one small file per folder). */
export function labsProgressFile(folder: string): string | null {
  if (!state.progressDir) return null
  const key = createHash('sha1').update(resolve(folder)).digest('hex').slice(0, 16)
  return join(state.progressDir, `${key}.json`)
}
