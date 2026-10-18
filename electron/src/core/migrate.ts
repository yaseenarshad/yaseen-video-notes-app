import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from './atomic'

/**
 * The app was called "Follow Along" until it was renamed Yaseen Video Notes. Its settings folder is named
 * after the app (`~/Library/Application Support/Follow Along`), so the renamed app starts with a new, empty
 * folder. Only `settings.json` there matters (speed and player prefs, pinned folders, open tabs, Recent,
 * window bounds); the rest is Chromium's cache and cookies, which are safe to lose: the app never signs in
 * to YouTube, and Chromium encrypts cookies with a keychain key named after the app, so the old ones could
 * not be read under the new name anyway.
 */
export const OLD_APP_NAME = 'Follow Along'

const SETTINGS = 'settings.json'

/**
 * Copies `settings.json` from the old app's folder into the new one, once: only when the new file does not
 * exist and the old one is a JSON object. Read-only on the old folder. The copy is marked as already
 * imported from the Swift app, so that one-time import never runs again. Returns true when it copied.
 */
export function migrateSettings(oldDir: string, newDir: string): boolean {
  const from = join(oldDir, SETTINGS)
  const to = join(newDir, SETTINGS)
  if (existsSync(to) || !existsSync(from)) return false
  let data: Record<string, unknown>
  try {
    const o = JSON.parse(readFileSync(from, 'utf8')) as unknown
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false
    data = o as Record<string, unknown>
  } catch {
    return false
  }
  data.importedFromSwift = true
  mkdirSync(newDir, { recursive: true })
  atomicWrite(to, JSON.stringify(data, null, 2))
  return true
}
