import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWrite } from './atomic'
import { graphemes, isSwiftDouble, trimWS, trimWSNL } from './text'

/**
 * Per-video status, stored exactly the way yaseen-docs-app stores a Select column, so both apps
 * show the same value:
 *
 * - The column is declared in the PARENT folder's `.folder.md` (`folder_settings.columns.status`,
 *   kind select, options `1-To-Watch…4-Carded`, `optionSort: manual`).
 * - The value is in the transcript .md's own frontmatter, under that folder's id: `in:` →
 *   `<folderId>:` → `status: 2-Watching`. A folder with no id keeps a top-level `status:` key.
 *
 * Edits are minimal and line-based: only the lines for this value are added or changed; every other
 * key, its order, quoting and comments stay. A shape this code does not understand (e.g. a
 * flow-style `in: {…}`) is never overwritten.
 */
export const COLUMN = 'status'
export const DEFAULT_OPTIONS = ['1-To-Watch', '2-Watching', '3-Watched', '4-Carded']
export const FOLDER_FILE = '.folder.md'

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

/** The parent folder of a video folder, and what its .folder.md says. */
export function parentInfo(videoFolder: string): { parent: string; info: FolderInfo } {
  const parent = dirname(videoFolder)
  return { parent, info: folderInfo(readText(join(parent, FOLDER_FILE)) ?? '') }
}

/** The status of a video folder's transcript (null: not set). */
export function readStatus(videoFolder: string, markdown: string): string | null {
  const text = readText(markdown)
  if (text === null) return null
  return value(text, parentInfo(videoFolder).info.id)
}

/** The column's options for this video's parent folder (the declared ones, else the defaults). */
export function statusOptions(videoFolder: string): string[] {
  const o = parentInfo(videoFolder).info.options
  return o && o.length ? o : DEFAULT_OPTIONS
}

/** Writes a status: declares the column in the parent's .folder.md if missing, then sets the value in the transcript's frontmatter. Both writes are atomic. */
export function writeStatus(videoFolder: string, markdown: string, val: string): void {
  if (!existsSync(markdown)) throw new Refused('no transcript .md')
  const folderMD = join(dirname(videoFolder), FOLDER_FILE)
  const folderText = readText(folderMD) ?? ''
  const withColumn = addColumn(folderText)
  if (withColumn !== folderText) atomicWrite(folderMD, withColumn)
  const id = folderInfo(withColumn).id
  const text = readFileSync(markdown, 'utf8')
  const updated = setValue(text, id, val)
  if (updated !== text) atomicWrite(markdown, updated)
}

/** Moves the status forward to option `index` (never backward). Returns the new value if written. */
export function advanceStatus(videoFolder: string, markdown: string, index: number, log: (s: string) => void = () => {}): string | null {
  const opts = statusOptions(videoFolder)
  if (index >= opts.length) return null
  const current = readStatus(videoFolder, markdown)
  const found = current === null ? -1 : opts.indexOf(current)
  const at = current === null ? -1 : found >= 0 ? found : Number.MAX_SAFE_INTEGER
  if (!(at < index)) return null
  try {
    writeStatus(videoFolder, markdown, opts[index])
    log(`status ${current ?? '-'} → ${opts[index]} for ${videoFolder.split('/').pop()}`)
    return opts[index]
  } catch (e) {
    log(`could not set status: ${String(e)}`)
    return null
  }
}
