import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { acquireLock, isLockFile } from './fileLock'
import { FollowAlongError } from './errors'
import { entry, markdownFile, videoIDInMarkdown, type FolderEntry } from './folderMaker'
import { statusRootOf } from './status'
import { SIDECAR_FILE } from './transcript'

/**
 * The Library's folders: a library (a pinned folder like learning-log) holds video folders (`MM-DD-<slug>/` with
 * `<slug>.md` + `.follow-along.json`) and TOPIC folders (`learning-log/AI agents/`), which hold more video folders
 * and topics. Plain Node (no Electron), unit-tested in `library.test.ts`.
 *
 * - A **video folder** has `.follow-along.json`, or a transcript .md with a YouTube `- url:` line.
 * - A **topic folder** is any other folder that is not hidden, not a lock, not a resource folder (`assets`, `media`,
 *   …), and either has no visible `.md` files of its own (a new empty folder, `jev/`) or holds a video / topic
 *   folder. So a folder of notes from another tool (`10-02-poetry/` with its .md and `media/`) is not a topic.
 * - Moving a video between topics is a plain rename of its folder (status, notes, progress and the board order all
 *   travel with it: the status belongs to the library folder, the board order is keyed by video id).
 */

/** Folder names that are never topics (resources of the docs app / Obsidian, tooling). */
export const SKIP_DIRS = new Set(['assets', 'attachments', 'media', 'images', 'files', 'node_modules', '_resources', 'resources'])
/** How deep topics are looked for under a library. */
const MAX_DEPTH = 12

export type FolderKind = 'video' | 'topic' | 'other'

const names = (dir: string): string[] => { try { return readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })) } catch { return [] } }
/** A real directory (a symlink is never followed, so a link loop cannot hang the tree). */
const isRealDir = (p: string): boolean => { try { const s = lstatSync(p); return s.isDirectory() && !s.isSymbolicLink() } catch { return false } }

/** A name that can never be a video or topic folder. */
const skippedName = (n: string): boolean => n.startsWith('.') || isLockFile(n) || SKIP_DIRS.has(n.toLowerCase())

/** True for a video folder: `.follow-along.json`, or a transcript .md with a YouTube `- url:` line. */
export function isVideoFolder(d: string): boolean {
  if (existsSync(join(d, SIDECAR_FILE))) return true
  const md = markdownFile(d)
  return md !== null && videoIDInMarkdown(md) !== null
}

/** What a folder is (see the top). `memo` caches answers for one walk. */
export function folderKind(d: string, memo: Map<string, FolderKind> = new Map(), depth = 0): FolderKind {
  const hit = memo.get(d)
  if (hit) return hit
  let k: FolderKind = 'other'
  if (!skippedName(basename(d)) && isRealDir(d)) {
    if (isVideoFolder(d)) k = 'video'
    else if (depth < MAX_DEPTH) {
      const ns = names(d)
      const ownMd = ns.some((n) => n.endsWith('.md') && !n.startsWith('.') && !isLockFile(n))
      k = !ownMd || ns.some((n) => folderKind(join(d, n), memo, depth + 1) !== 'other') ? 'topic' : 'other'
    }
  }
  memo.set(d, k)
  return k
}

/** A folder in the sidebar tree: a library (pinned) or a topic in it. */
export interface FolderNode {
  path: string
  name: string
  /** Video folders right in it (its own, not its topics': Finder-style, what clicking it shows). */
  videos: number
  /** Video folders in it at any depth (its topics' too; the tooltip). */
  total: number
  /** Nothing in it but maybe a `.DS_Store` (only then can it be deleted). */
  empty: boolean
  /** Its topic folders, by name. */
  children: FolderNode[]
}

const ignorable = (n: string): boolean => n === '.DS_Store'

/** True when the folder holds nothing but maybe a `.DS_Store`. */
export function isEmptyFolder(d: string): boolean {
  try { return readdirSync(d).every(ignorable) } catch { return false }
}

/**
 * The tree under a library (or topic) folder: its topic folders, recursively, with video counts — `videos` its own
 * (direct) videos, `total` at any depth.
 */
export function folderTree(root: string, memo: Map<string, FolderKind> = new Map()): FolderNode {
  const walk = (d: string, depth: number): FolderNode => {
    const children: FolderNode[] = []
    let videos = 0, total = 0
    for (const n of names(d)) {
      const p = join(d, n)
      const k = folderKind(p, memo, depth + 1)
      if (k === 'video') { videos++; total++ }
      else if (k === 'topic' && depth < MAX_DEPTH) {
        const c = walk(p, depth + 1)
        total += c.total
        children.push(c)
      }
    }
    return { path: d, name: basename(d), videos, total, empty: isEmptyFolder(d), children }
  }
  return walk(resolve(root), 0)
}

/** Every video folder under `root`, at any depth through its topic folders (sorted by path). */
export function videoFolders(root: string, memo: Map<string, FolderKind> = new Map()): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    for (const n of names(d)) {
      const p = join(d, n)
      const k = folderKind(p, memo, depth + 1)
      if (k === 'video') out.push(p)
      else if (k === 'topic' && depth < MAX_DEPTH) walk(p, depth + 1)
    }
  }
  walk(resolve(root), 0)
  return out
}

/** The video folders right in `dir` (not in its topic folders; sorted by name). */
export function directVideoFolders(dir: string, memo: Map<string, FolderKind> = new Map()): string[] {
  const d = resolve(dir)
  return names(d).map((n) => join(d, n)).filter((p) => folderKind(p, memo, 1) === 'video')
}

/** "AI agents/Evals" for a video in `<root>/AI agents/Evals/<video>`; null when it is right in `root`. */
export function topicOf(videoFolder: string, root: string): string | null {
  const rel = relative(resolve(root), dirname(resolve(videoFolder)))
  return rel === '' || rel.startsWith('..') ? null : rel
}

const entries = (folders: string[], dir: string): FolderEntry[] => folders
  .map((d): FolderEntry | null => { const e = entry(d); return e ? { ...e, topic: topicOf(d, dir) } : null })
  .filter((e): e is FolderEntry => e !== null)
  .sort((a, b) => (a.date !== b.date ? b.date - a.date : b.modified - a.modified))

/**
 * Every video of a folder, newest first: the ones right in it and in its topics, at any depth. Each carries `topic`
 * (its folder relative to `dir`) when it is in a topic. "📚 All videos" (per library), In progress, the board file.
 */
export function listLibrary(dir: string): FolderEntry[] {
  return entries(videoFolders(dir), dir)
}

/**
 * What clicking a library or topic folder shows (Finder-style), newest first: only the videos right in it — a
 * topic's videos show when the topic is clicked. For a library these are the ones still to sort into a topic.
 */
export function listFolder(dir: string): FolderEntry[] {
  return entries(directVideoFolders(dir), dir)
}

// ---------- paths that move ----------

/** `p` after folder `from` moved to `to` (`p` is `from` or inside it), else `p` unchanged. */
export function relocatePath(p: string, from: string, to: string): string {
  if (p === from) return to
  if (p.startsWith(from + '/')) return to + p.slice(from.length)
  return p
}

// ---------- topic folders: new / rename / delete ----------

/** A folder name typed by the user, or why it cannot be one. */
export function checkFolderName(raw: string): { name: string } | { error: string } {
  const name = raw.trim()
  if (!name) return { error: 'Type a name.' }
  if (name.includes('/') || name.includes(':')) return { error: 'A folder name cannot contain "/" or ":".' }
  if (name.startsWith('.')) return { error: 'A folder name cannot start with ".".' }
  if (name === '..' || name.length > 200) return { error: 'That name cannot be used.' }
  return { name }
}

/** Makes a new plain topic folder `name` in `parent` (no `.folder.md`: the docs app adds its own when needed). */
export function createTopic(parent: string, rawName: string): string {
  const c = checkFolderName(rawName)
  if ('error' in c) throw new FollowAlongError(c.error)
  if (!isRealDir(parent)) throw new FollowAlongError(`${basename(parent)} is not a folder.`)
  const p = join(parent, c.name)
  if (existsSync(p)) throw new FollowAlongError(`There is already a "${c.name}" in ${basename(parent)}.`)
  mkdirSync(p)
  return p
}

/** Renames a topic folder in place. Never overwrites. Returns the new path. */
export function renameTopic(path: string, rawName: string): string {
  const c = checkFolderName(rawName)
  if ('error' in c) throw new FollowAlongError(c.error)
  if (!isRealDir(path)) throw new FollowAlongError(`${basename(path)} is not a folder.`)
  if (c.name === basename(path)) return path
  const to = join(dirname(path), c.name)
  // a case-only rename on a case-insensitive disk is fine: existsSync(to) is that same folder
  const caseOnly = c.name.toLowerCase() === basename(path).toLowerCase()
  if (existsSync(to) && !caseOnly) throw new FollowAlongError(`There is already a "${c.name}" in ${basename(dirname(path))}.`)
  renameSync(path, to)
  return to
}

/** Deletes a folder only when it is empty (a lone `.DS_Store` does not count). */
export function deleteEmptyTopic(path: string): void {
  if (!isRealDir(path)) throw new FollowAlongError(`${basename(path)} is not a folder.`)
  const ns = readdirSync(path)
  if (!ns.every(ignorable)) throw new FollowAlongError(`${basename(path)} is not empty, so it was not deleted.`)
  for (const n of ns) unlinkSync(join(path, n))
  rmdirSync(path) // fails (and deletes nothing) if something appeared meanwhile
}

// ---------- moving a video folder ----------

export interface MoveResult { from: string; to: string }

export interface MoveOptions {
  /** For tests: the rename (to fake a move across disks). */
  rename?: (from: string, to: string) => void
  /** The library folders (default: the app's pinned ones, see `status.ts`). */
  roots?: readonly string[]
}

/** All files under `d` (relative paths), lock files left out. */
function filesUnder(d: string, base = d): string[] {
  const out: string[] = []
  for (const n of readdirSync(d)) {
    if (isLockFile(n)) continue
    const p = join(d, n)
    const s = lstatSync(p)
    if (s.isDirectory()) out.push(...filesUnder(p, base))
    else out.push(relative(base, p))
  }
  return out.sort()
}

/** True when `b` has exactly the files of `a`, byte for byte (lock files aside). */
export function sameTree(a: string, b: string): boolean {
  const fa = filesUnder(a), fb = filesUnder(b)
  if (fa.length !== fb.length || fa.some((f, i) => f !== fb[i])) return false
  return fa.every((f) => {
    const pa = join(a, f), pb = join(b, f)
    if (lstatSync(pa).isSymbolicLink() || lstatSync(pb).isSymbolicLink()) return true
    return readFileSync(pa).equals(readFileSync(pb))
  })
}

/**
 * Moves the video folder `src` into `destParent` (a library or topic folder), keeping its name: a plain rename
 * (same disk); across disks, copy + check every byte + delete the original. Under the transcript's file lock, so
 * an agent's `video-notes` write cannot land mid-move. Refuses a name that is already there (never overwrites),
 * a folder that is not a video folder, and a move to another library (its status belongs to its library).
 * Returns null when it is already there (nothing to do).
 */
export function moveVideoFolder(src: string, destParent: string, opts: MoveOptions = {}): MoveResult | null {
  const from = resolve(src), parent = resolve(destParent)
  if (!isRealDir(from) || !isVideoFolder(from)) throw new FollowAlongError(`${basename(from)} is not a video folder.`)
  if (!isRealDir(parent)) throw new FollowAlongError(`${basename(parent)} is not a folder.`)
  if (dirname(from) === parent) return null
  if (parent === from || parent.startsWith(from + '/')) throw new FollowAlongError('A folder cannot go inside itself.')
  const roots = opts.roots
  if (statusRootOf(dirname(from), roots) !== statusRootOf(parent, roots)) {
    throw new FollowAlongError(`${basename(parent)} is in another library; videos move only between the folders of ${basename(statusRootOf(dirname(from), roots))}.`)
  }
  const to = join(parent, basename(from))
  if (existsSync(to)) throw new FollowAlongError(`There is already a folder named "${basename(from)}" in ${basename(parent)}. Nothing was moved.`)
  const md = markdownFile(from)
  const release = md ? acquireLock(md) : null
  const movedMd = md ? join(to, basename(md)) : null
  let moved = false
  try {
    try {
      (opts.rename ?? renameSync)(from, to)
      moved = true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
      // another disk: copy (never over anything), check every byte, then delete the original
      cpSync(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, filter: (s) => !isLockFile(basename(s)) })
      if (!sameTree(from, to)) {
        rmSync(to, { recursive: true, force: true })
        throw new FollowAlongError(`Copying ${basename(from)} to ${basename(parent)} did not give the same files; the original was kept.`)
      }
      rmSync(from, { recursive: true, force: true }) // takes our lock file with it
      moved = true
    }
    // re-check: the transcript is at its new place and the old folder is gone
    if (existsSync(from) || (movedMd && !existsSync(movedMd))) throw new FollowAlongError(`Moving ${basename(from)} did not finish as expected; check ${parent}.`)
  } finally {
    if (release) release(moved && movedMd ? movedMd : undefined)
  }
  return { from, to }
}
