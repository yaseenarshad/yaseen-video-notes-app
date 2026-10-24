import { randomUUID } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { FollowAlongError } from './errors'
import { mayWrite } from './flavor'

/**
 * Writes to a temp file in the same folder, then renames it over the target, so a reader
 * (Obsidian, git, the docs app) never sees half a file.
 *
 * Returns false when the write was skipped: in the Labs flavor every path outside Labs' own userData is
 * read-only (`mayWrite` in flavor.ts, the one read-only guard; it logs the skip).
 */
export function atomicWrite(path: string, data: string | Uint8Array): boolean {
  if (!mayWrite(path, 'write')) return false
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID().toUpperCase()}.tmp`)
  writeFileSync(tmp, data)
  try {
    renameSync(tmp, path)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    throw new FollowAlongError(`Could not save ${basename(path)}: ${(e as Error).message}`)
  }
  return true
}
