import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isLockFile } from './fileLock'
import { markdownFile } from './folderMaker'
import { ensureFolderColumn, folderInfo, FOLDER_FILE, migrateStatus } from './status'

/**
 * `video-notes migrate-status <folder>`: moves a parent folder (like learning-log) from the old status options
 * (`1-To-Watch…4-Carded`) to yaseen-docs-app's defaults (`1-Backlog…4-Done`). The `.folder.md` option list is
 * replaced only when it is exactly the old app-written one; each transcript's old value is rewritten to its new
 * one (minimal edit, locked). Safe to run again: a second run changes nothing.
 */
export interface FolderMigration {
  parent: string
  /** The `.folder.md` option lists, when they change. */
  options: { from: string[]; to: string[] } | null
  transcripts: { md: string; from: string; to: string }[]
  /** Transcripts that could not be changed (path: why). */
  errors: string[]
  dryRun: boolean
}

const isDir = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }

export function migrateFolder(parent: string, dryRun = false): FolderMigration {
  const out: FolderMigration = { parent, options: null, transcripts: [], errors: [], dryRun }
  const folder = ensureFolderColumnIfOld(parent, dryRun)
  if (folder) out.options = folder
  let names: string[] = []
  try { names = readdirSync(parent).sort() } catch (e) { out.errors.push(`${parent}: ${String(e)}`); return out }
  for (const n of names) {
    const d = join(parent, n)
    if (n.startsWith('.') || isLockFile(n) || !isDir(d)) continue
    const md = markdownFile(d)
    if (!md) continue
    try {
      const c = migrateStatus(md, parent, dryRun)
      if (c) out.transcripts.push({ md, ...c })
    } catch (e) {
      out.errors.push(`${md}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

/** Replaces an exactly-old option list in `.folder.md` (never adds a missing column here). */
function ensureFolderColumnIfOld(parent: string, dryRun: boolean): { from: string[]; to: string[] } | null {
  const before = folderInfo(readOr(join(parent, FOLDER_FILE))).options
  if (before === null) return null // no column: nothing to migrate (the app adds it on its first status write)
  const r = ensureFolderColumn(parent, dryRun)
  const after = r.info.options ?? []
  return r.after !== r.before ? { from: before, to: after } : null
}

function readOr(p: string): string {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

/** The report the CLI prints. */
export function migrationText(m: FolderMigration): string {
  const lines: string[] = []
  const rel = (p: string): string => (p.startsWith(m.parent + '/') ? p.slice(m.parent.length + 1) : p)
  lines.push(`${m.dryRun ? 'Dry run (nothing written): ' : ''}${m.parent}`)
  if (m.options) lines.push(`  ${FOLDER_FILE}: options ${m.options.from.join(', ')} → ${m.options.to.join(', ')}`)
  for (const t of m.transcripts) lines.push(`  ${rel(t.md)}: ${t.from} → ${t.to}`)
  for (const e of m.errors) lines.push(`  error: ${rel(e)}`)
  const n = m.transcripts.length
  lines.push(`${m.dryRun ? 'Would change' : 'Changed'} ${n} transcript${n === 1 ? '' : 's'}${m.options ? ` and ${FOLDER_FILE}` : ''}` +
    `${m.errors.length ? `; ${m.errors.length} error${m.errors.length === 1 ? '' : 's'}` : ''}.`)
  if (!m.options && n === 0 && !m.errors.length) lines[lines.length - 1] = 'Nothing to migrate.'
  return lines.join('\n')
}
