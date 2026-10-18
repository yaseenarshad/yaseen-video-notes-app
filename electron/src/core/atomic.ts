import { randomUUID } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { FollowAlongError } from './errors'

/**
 * Writes to a temp file in the same folder, then renames it over the target, so a reader
 * (Obsidian, git, the docs app) never sees half a file.
 */
export function atomicWrite(path: string, data: string | Uint8Array): void {
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID().toUpperCase()}.tmp`)
  writeFileSync(tmp, data)
  try {
    renameSync(tmp, path)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    throw new FollowAlongError(`Could not save ${basename(path)}: ${(e as Error).message}`)
  }
}
