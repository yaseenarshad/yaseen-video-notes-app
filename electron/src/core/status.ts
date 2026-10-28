import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { atomicWrite } from './atomic'
import { graphemes, isSwiftDouble, trimWS, trimWSNL } from './text'
import { changeFile } from './notes'
import { withFileLock } from './fileLock'

/**
 * Per-video status, stored exactly the way yaseen-docs-app stores a Select column, so both apps
 * show the same value:
 *
 * - The column is declared in the STATUS FOLDER's `.folder.md` (`statusFolder`: the library folder, e.g.
 *   learning-log, even for a video in a topic subfolder of it; without a known library, the nearest folder that
 *   declares the column; else the video's parent) (`folder_settings.columns.status`,
 *   kind select, options `1-Backlog, 2-Todo, 3-In-Progress, 4-Done` — yaseen-docs-app's own default status
 *   options — and `optionSort: manual`).
 * - The value is in the transcript .md's own frontmatter, under that folder's id: `in:` →
 *   `<folderId>:` → `status: 3-In-Progress`. A folder with no id keeps a top-level `status:` key.
 *
 * Older versions wrote `1-To-Watch, 2-Watching, 3-Watched, 4-Carded`. Those are read as the new options
 * everywhere (`LEGACY`), an exactly-old option list in `.folder.md` is replaced when the app writes the column,
 * and `migrateStatus` (CLI `video-notes migrate-status`) rewrites old values in the files.
 *
 * Edits are minimal and line-based: only the lines for this value are added or changed; every other
 * key, its order, quoting and comments stay. A shape this code does not understand (e.g. a
 * flow-style `in: {…}`) is never overwritten.
 */
export const COLUMN = 'status'
export const DEFAULT_OPTIONS = ['1-Backlog', '2-Todo', '3-In-Progress', '4-Done']
/** The option list older versions of the app wrote (in this order). */
export const OLD_OPTIONS = ['1-To-Watch', '2-Watching', '3-Watched', '4-Carded']
/** Old value → new value. */
export const LEGACY: Readonly<Record<string, string>> = {
  '1-To-Watch': '2-Todo',
  '2-Watching': '3-In-Progress',
  '3-Watched': '3-In-Progress',
  '4-Carded': '4-Done',
}
/** Opening a video moves an empty / Backlog / Todo status here. Done is always set by hand. */
export const IN_PROGRESS = '3-In-Progress'
const BEFORE_IN_PROGRESS = ['1-Backlog', '2-Todo']
export const FOLDER_FILE = '.folder.md'

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])
/** True for exactly the option list older versions of the app wrote. */
export const isOldOptions = (o: readonly string[] | null): boolean => !!o && sameList(o, OLD_OPTIONS)

/** The options a folder's column really offers: the declared ones (an old app-written list reads as the new one), else the defaults. */
export function effectiveOptions(declared: string[] | null): string[] {
  if (!declared || declared.length === 0 || isOldOptions(declared)) return DEFAULT_OPTIONS
  return declared
}

/** A stored value as the app shows it: an old value reads as its new one when the folder's options have that (and not the old one). */
export function mapStatus(v: string | null, options: readonly string[] = DEFAULT_OPTIONS): string | null {
  if (v === null || v === '') return null
  if (options.includes(v)) return v
  const n = LEGACY[v]
  return n !== undefined && options.includes(n) ? n : v
}

/** Auto-advance on opening a video: empty / Backlog / Todo → In progress (when the folder offers it); else null (no change). */
export function openAdvance(current: string | null, options: readonly string[]): string | null {
  if (!options.includes(IN_PROGRESS)) return null
  const c = mapStatus(current, options)
  return c === null || BEFORE_IN_PROGRESS.includes(c) ? IN_PROGRESS : null
}

export class Refused extends Error {
  constructor(d: string) {
    super(d)
    this.name = 'Refused'
  }
  toString(): string {
    return this.message
  }
}

type Range = [number, number] // [start, end)

/** (frontmatter lines without the fences, body) or null when the content has no frontmatter. */
export function split(content: string): { lines: string[]; body: string } | null {
  const ls = content.split('\n')
  if (ls.length === 0 || trimWS(ls[0]) !== '---') return null
  let end = -1
  for (let i = 1; i < ls.length; i++) if (trimWS(ls[i]) === '---' || ls[i] === '...') { end = i; break }
  if (end < 0) return null
  return { lines: ls.slice(1, end), body: ls.slice(end).join('\n') }
}

const join_ = (fm: string[], body: string): string => '---\n' + fm.map((l) => l + '\n').join('') + body

const indent = (line: string): number => { let n = 0; while (n < line.length && line[n] === ' ') n++; return n }

function isContent(line: string): boolean {
  const t = trimWS(line)
  return t !== '' && !t.startsWith('#')
}

/** The key of a `key: value` / `key:` line (unquoted or quoted), and the raw value. */
export function keyValue(line: string): { key: string; value: string } | null {
  const t = trimWS(line)
  if (t.startsWith('-') || t.startsWith('#')) return null
  let key = '', rest = ''
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = t[0]
    const close = t.indexOf(q, 1)
    if (close < 0) return null
    key = t.slice(1, close)
    rest = t.slice(close + 1)
    if (!rest.startsWith(':')) return null
    rest = rest.slice(1)
  } else {
    const m = /:(\s|$)/.exec(t)
    if (!m) return null
    key = t.slice(0, m.index)
    rest = t.slice(m.index + m[0].length)
  }
  return { key, value: trimWS(rest) }
}

/** The block under the line at `start`: following lines indented deeper (blank lines inside count). */
function blockEnd(ls: string[], start: number, parentIndent: number): number {
  let end = start + 1
  for (let i = start + 1; i < ls.length; i++) {
    if (isContent(ls[i])) {
      if (indent(ls[i]) <= parentIndent) break
      end = i + 1
    }
  }
  return end
}

/** Index of child `key` of the map whose lines are `range` (children at their first indent). */
function child(ls: string[], [a, b]: Range, key: string): { index: number; indent: number } | null {
  let first = -1
  for (let i = a; i < b; i++) if (isContent(ls[i])) { first = i; break }
  if (first < 0) return null
  const ci = indent(ls[first])
  for (let i = a; i < b; i++) {
    if (isContent(ls[i]) && indent(ls[i]) === ci && keyValue(ls[i])?.key === key) return { index: i, indent: ci }
  }
  return null
}

function childIndent(ls: string[], [a, b]: Range, parent: number): number {
  for (let i = a; i < b; i++) if (isContent(ls[i])) return indent(ls[i])
  return parent + 2
}

function scalar(raw: string): string {
  let v = raw
  const hash = v.indexOf(' #')
  if (hash >= 0) v = v.slice(0, hash)
  v = trimWS(v)
  if (graphemes(v).length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1)
  return v
}

/** A value as YAML: plain when that reads back as the same string, else double-quoted. */
export function yaml(s: string): string {
  const plain = /^[A-Za-z0-9][A-Za-z0-9 _.\-–—()/]*$/.test(s)
  const special = ['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'].includes(s.toLowerCase()) || isSwiftDouble(s) || s.endsWith(' ')
  if (plain && !special) return s
  return '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"'
}

const key = (s: string): string => (/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(s) ? s : yaml(s))

// ---------- the parent folder (.folder.md) ----------

export interface FolderInfo {
  id: string | null
  /** The column's options, if the column is declared. */
  options: string[] | null
}

export function folderInfo(content: string): FolderInfo {
  const s = split(content)
  if (!s) return { id: null, options: null }
  let id: string | null = null
  for (const l of s.lines) {
    if (indent(l) !== 0) continue
    const kv = keyValue(l)
    if (kv && kv.key === 'id' && kv.value !== '') id = scalar(kv.value)
  }
  return { id, options: columnOptions(s.lines) }
}

function columnOptions(fm: string[]): string[] | null {
  const s = child(fm, [0, fm.length], 'folder_settings')
  if (!s) return null
  const sEnd = blockEnd(fm, s.index, s.indent)
  const c = child(fm, [s.index + 1, sEnd], 'columns')
  if (!c) return null
  const cEnd = blockEnd(fm, c.index, c.indent)
  const st = child(fm, [c.index + 1, cEnd], COLUMN)
  if (!st) return null
  const stEnd = blockEnd(fm, st.index, st.indent)
  const o = child(fm, [st.index + 1, stEnd], 'options')
  if (!o) return []
  const oEnd = blockEnd(fm, o.index, o.indent)
  // block list ("- a") or flow list ("[a, b]")
  const inline = keyValue(fm[o.index])?.value
  if (inline !== undefined && inline.startsWith('[')) {
    const inner = graphemes(inline).slice(1, -1).join('')
    return inner.split(',').filter((x) => x.length > 0).map(scalar)
  }
  const out: string[] = []
  for (let i = o.index + 1; i < oEnd; i++) {
    const t = trimWS(fm[i])
    if (t.startsWith('- ')) out.push(scalar(t.slice(2)))
  }
  return out
}

function columnBlock(ind: number, options: string[]): string[] {
  const p = ' '.repeat(ind)
  return [`${p}${COLUMN}:`, `${p}  kind: select`, `${p}  options:`, ...options.map((o) => `${p}    - ${yaml(o)}`), `${p}  optionSort: manual`]
}

/** The folder file with the status column declared. Only adds: when the column is already there (in any form) the content comes back unchanged. */
export function addColumn(content: string, options: string[] = DEFAULT_OPTIONS): string {
  const s = split(content)
  if (!s) {
    const fm = ['folder_settings:', '  columns:', ...columnBlock(4, options)]
    if (trimWSNL(content) === '') return join_(fm, '---\n')
    return join_(fm, '---\n' + content)
  }
  const fm = [...s.lines]
  if (columnOptions(fm) !== null) return content
  const fs = child(fm, [0, fm.length], 'folder_settings')
  if (fs) {
    const v = keyValue(fm[fs.index])?.value
    if (v !== undefined && v !== '') throw new Refused('folder_settings is not a block map')
    const sEnd = blockEnd(fm, fs.index, fs.indent)
    const ci = childIndent(fm, [fs.index + 1, sEnd], fs.indent)
    const c = child(fm, [fs.index + 1, sEnd], 'columns')
    if (c) {
      const cv = keyValue(fm[c.index])?.value
      if (cv !== undefined && cv !== '') throw new Refused('folder_settings.columns is not a block map')
      const cEnd = blockEnd(fm, c.index, c.indent)
      const gi = childIndent(fm, [c.index + 1, cEnd], c.indent)
      fm.splice(cEnd, 0, ...columnBlock(gi, options))
    } else {
      const p = ' '.repeat(ci)
      fm.splice(sEnd, 0, `${p}columns:`, ...columnBlock(ci + 2, options))
    }
  } else {
    fm.push('folder_settings:', '  columns:', ...columnBlock(4, options))
  }
  return join_(fm, s.body)
}

/**
 * The folder file with an exactly-old option list (`1-To-Watch…4-Carded`, written by older versions of this
 * app) replaced by the new defaults: only those option lines change. Any other list (the user's own) and a
 * missing column come back unchanged.
 */
export function migrateOptions(content: string): string {
  const s = split(content)
  if (!s) return content
  const fm = [...s.lines]
  if (!isOldOptions(columnOptions(fm))) return content
  const fsK = child(fm, [0, fm.length], 'folder_settings')!
  const c = child(fm, [fsK.index + 1, blockEnd(fm, fsK.index, fsK.indent)], 'columns')!
  const st = child(fm, [c.index + 1, blockEnd(fm, c.index, c.indent)], COLUMN)!
  const o = child(fm, [st.index + 1, blockEnd(fm, st.index, st.indent)], 'options')!
  const inline = keyValue(fm[o.index])?.value
  if (inline !== undefined && inline.startsWith('[')) {
    fm[o.index] = `${' '.repeat(o.indent)}options: [${DEFAULT_OPTIONS.map(yaml).join(', ')}]`
  } else {
    let k = 0
    for (let i = o.index + 1; i < blockEnd(fm, o.index, o.indent) && k < DEFAULT_OPTIONS.length; i++) {
      const t = trimWS(fm[i])
      if (!t.startsWith('- ')) continue
      fm[i] = fm[i].slice(0, fm[i].indexOf('- ') + 2) + yaml(DEFAULT_OPTIONS[k++])
    }
  }
  return join_(fm, s.body)
}

/** What the app writes into a folder file: the status column added when missing, an old app-written option list replaced. */
export const withColumn = (content: string): string => migrateOptions(addColumn(content))

// ---------- the note (.md) ----------

/** The note's status for the folder `folderId` (null folder id: the top-level key). */
export function value(content: string, folderId: string | null): string | null {
  const s = split(content)
  if (!s) return null
  const fm = s.lines
  if (folderId === null) {
    const c = child(fm, [0, fm.length], COLUMN)
    if (!c) return null
    const kv = keyValue(fm[c.index])
    if (!kv) return null
    const v = scalar(kv.value)
    return v === '' ? null : v
  }
  const inKey = child(fm, [0, fm.length], 'in')
  if (!inKey) return null
  const inEnd = blockEnd(fm, inKey.index, inKey.indent)
  const f = child(fm, [inKey.index + 1, inEnd], folderId)
  if (!f) return null
  const fEnd = blockEnd(fm, f.index, f.indent)
  const st = child(fm, [f.index + 1, fEnd], COLUMN)
  if (!st) return null
  const kv = keyValue(fm[st.index])
  if (!kv) return null
  const out = scalar(kv.value)
  return out === '' ? null : out
}

/** The note's content with its status set: only the status line (and any missing `in:` / folder lines above it) is written. Frontmatter is created when there is none. */
export function setValue(content: string, folderId: string | null, val: string): string {
  const line = `${COLUMN}: ${yaml(val)}`
  const s = split(content)
  if (!s) {
    const fm = folderId !== null ? ['in:', `  ${key(folderId)}:`, `    ${line}`] : [line]
    return join_(fm, '---\n' + content)
  }
  const fm = [...s.lines]
  if (folderId === null) {
    const c = child(fm, [0, fm.length], COLUMN)
    if (c) fm[c.index] = line
    else fm.push(line)
    return join_(fm, s.body)
  }
  const inKey = child(fm, [0, fm.length], 'in')
  if (inKey) {
    const v = keyValue(fm[inKey.index])?.value
    if (v !== undefined && v !== '') throw new Refused('"in" is not a block map')
    const inEnd = blockEnd(fm, inKey.index, inKey.indent)
    const fi = childIndent(fm, [inKey.index + 1, inEnd], inKey.indent)
    const f = child(fm, [inKey.index + 1, inEnd], folderId)
    if (f) {
      const fv = keyValue(fm[f.index])?.value
      if (fv !== undefined && fv !== '') throw new Refused(`"in.${folderId}" is not a block map`)
      const fEnd = blockEnd(fm, f.index, f.indent)
      const si = childIndent(fm, [f.index + 1, fEnd], f.indent)
      const p = ' '.repeat(si)
      const st = child(fm, [f.index + 1, fEnd], COLUMN)
      if (st) fm[st.index] = p + line
      else fm.splice(fEnd, 0, p + line)
    } else {
      const p = ' '.repeat(fi)
      fm.splice(inEnd, 0, `${p}${key(folderId)}:`, `${p}  ${line}`)
    }
  } else {
    fm.push('in:', `  ${key(folderId)}:`, `    ${line}`)
  }
  return join_(fm, s.body)
}

// ---------- files ----------

const readText = (p: string): string | null => { try { return readFileSync(p, 'utf8') } catch { return null } }

// ---------- which folder a video's status belongs to ----------

/**
 * The library folders (the New Tab sidebar's pinned folders, like learning-log). Set by the app whenever they
 * change; the CLI leaves it empty. A video can sit in topic subfolders of a library
 * (`learning-log/AI agents/10-27-x/`): its status still belongs to the library, like a yaseen-docs-app folder view,
 * whose rows are the notes at ANY depth under the folder.
 */
let libraryRoots: string[] = []
export function setLibraryRoots(roots: readonly string[]): void { libraryRoots = roots.map((r) => resolve(r)) }
export const getLibraryRoots = (): string[] => [...libraryRoots]

const hasColumn = (dir: string): boolean => folderInfo(readText(join(dir, FOLDER_FILE)) ?? '').options !== null

/** `dir` and its ancestors, nearest first (up to the home folder or the file system root). */
function ancestorsOrSelf(dir: string): string[] {
  const out: string[] = []
  const home = homedir()
  let d = resolve(dir)
  for (;;) {
    out.push(d)
    const up = dirname(d)
    if (up === d || d === home) break
    d = up
  }
  return out
}

/**
 * The folder whose `.folder.md` holds the status column for things in `dir` (`dir` itself counts): the nearest
 * library folder (`roots`, default the pinned ones); with none, the nearest folder whose `.folder.md` declares the
 * status column; else `dir` itself (as before topics existed).
 */
export function statusRootOf(dir: string, roots: readonly string[] = libraryRoots): string {
  const chain = ancestorsOrSelf(dir)
  const rs = new Set(roots.map((r) => resolve(r)))
  const pinned = chain.find((d) => rs.has(d))
  if (pinned) return pinned
  return chain.find(hasColumn) ?? resolve(dir)
}

/**
 * The folder a video's status belongs to (its column in that folder's `.folder.md`, its value at
 * `in.<that folder's id>.status`): `statusRootOf` its parent. A video moved between topics of one library keeps
 * the same folder, so the same key and value.
 */
export const statusFolder = (videoFolder: string, roots: readonly string[] = libraryRoots): string => statusRootOf(dirname(resolve(videoFolder)), roots)

/** The folder a video's status belongs to (`statusFolder`), and what its .folder.md says. */
export function parentInfo(videoFolder: string, roots: readonly string[] = libraryRoots): { parent: string; info: FolderInfo } {
  const parent = statusFolder(videoFolder, roots)
  return { parent, info: folderInfo(readText(join(parent, FOLDER_FILE)) ?? '') }
}

/** The status of a video folder's transcript as the app shows it (old values read as new ones; null: not set). */
export function readStatus(videoFolder: string, markdown: string): string | null {
  const text = readText(markdown)
  if (text === null) return null
  const info = parentInfo(videoFolder).info
  return mapStatus(value(text, info.id), effectiveOptions(info.options))
}

/** The column's options for this video's parent folder (the declared ones, else the defaults; an old app-written list reads as the new one). */
export function statusOptions(videoFolder: string): string[] {
  return effectiveOptions(parentInfo(videoFolder).info.options)
}

/**
 * Declares the column in a parent folder's .folder.md when missing and replaces an old app-written option
 * list (under the file's lock: read fresh, change, atomic write, only when it changed). Returns the folder's info.
 */
export function ensureFolderColumn(parent: string, dryRun = false): { info: FolderInfo; before: string; after: string } {
  const folderMD = join(parent, FOLDER_FILE)
  const run = () => {
    const before = readText(folderMD) ?? ''
    const after = withColumn(before)
    if (after !== before && !dryRun) atomicWrite(folderMD, after)
    return { info: folderInfo(after), before, after }
  }
  return dryRun ? run() : withFileLock(folderMD, run)
}

/** Writes a status (an old value is written as its new one): declares the column in the status folder's .folder.md (`statusFolder`) if missing, then sets the value in the transcript's frontmatter. Both writes are locked and atomic. */
export function writeStatus(videoFolder: string, markdown: string, val: string): void {
  if (!existsSync(markdown)) throw new Refused('no transcript .md')
  const { info } = ensureFolderColumn(statusFolder(videoFolder))
  const v = mapStatus(val, effectiveOptions(info.options)) ?? val
  // under the transcript's file lock (agents write it too): read fresh, change, atomic write;
  // the file is written anyway, so it gets the current agent guide too (idempotent)
  changeFile(markdown, (text) => setValue(text, info.id, v))
}

export const BACKLOG = '1-Backlog'

/** A video just added: an empty status becomes Backlog (when the folder offers it). Returns the new value if written. */
export function startInBacklog(videoFolder: string, markdown: string, log: (s: string) => void = () => {}): string | null {
  if (readStatus(videoFolder, markdown) !== null || !statusOptions(videoFolder).includes(BACKLOG)) return null
  try {
    writeStatus(videoFolder, markdown, BACKLOG)
    log(`status - → ${BACKLOG} for ${videoFolder.split('/').pop()} (new video)`)
    return BACKLOG
  } catch (e) {
    log(`could not set status: ${String(e)}`)
    return null
  }
}

/** Watching a video (~30 s of playback): an empty / Backlog / Todo status becomes In progress. Returns the new value if written. */
export function advanceOnOpen(videoFolder: string, markdown: string, log: (s: string) => void = () => {}): string | null {
  const current = readStatus(videoFolder, markdown)
  const next = openAdvance(current, statusOptions(videoFolder))
  if (next === null) return null
  try {
    writeStatus(videoFolder, markdown, next)
    log(`status ${current ?? '-'} → ${next} for ${videoFolder.split('/').pop()}`)
    return next
  } catch (e) {
    log(`could not set status: ${String(e)}`)
    return null
  }
}

/**
 * Rewrites an old status value (`1-To-Watch`…`4-Carded`) in a transcript's frontmatter to its new one, when
 * the parent folder's options have the new value. A minimal edit (only the status line), under the file's lock
 * through `changeFile` (so the agent-guide rules hold). Returns the change, or null when there was nothing to do.
 * `dryRun`: reports without writing.
 */
export function migrateStatus(mdPath: string, parentFolder: string /* the status folder */, dryRun = false): { from: string; to: string } | null {
  const info = folderInfo(readText(join(parentFolder, FOLDER_FILE)) ?? '')
  const options = effectiveOptions(info.options)
  const plan = (text: string): { from: string; to: string } | null => {
    const from = value(text, info.id)
    if (from === null || LEGACY[from] === undefined) return null
    const to = mapStatus(from, options)
    return to !== null && to !== from ? { from, to } : null
  }
  if (dryRun) {
    const text = readText(mdPath)
    return text === null ? null : plan(text)
  }
  let change: { from: string; to: string } | null = null
  changeFile(mdPath, (text) => {
    change = plan(text)
    return change ? setValue(text, info.id, change.to) : text
  })
  return change
}
