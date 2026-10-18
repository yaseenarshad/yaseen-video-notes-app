// The one-time copy of the old "Follow Along" settings into the renamed app's settings folder.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateSettings, OLD_APP_NAME } from './migrate'

const temps: string[] = []
afterEach(() => { while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true }) })

/** A fake "Application Support" folder with the old app's settings in it. */
function appSupport(settings: string | null): { oldDir: string; newDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'vnotes-migrate-'))
  temps.push(root)
  const oldDir = join(root, OLD_APP_NAME)
  mkdirSync(oldDir)
  writeFileSync(join(oldDir, 'Cookies'), 'not copied')
  if (settings !== null) writeFileSync(join(oldDir, 'settings.json'), settings)
  return { oldDir, newDir: join(root, 'Yaseen Video Notes') }
}

const old = {
  player: { speed: 2.4, fontSize: 19 },
  openTabs: ['/v/a', '/v/b'],
  recents: [{ title: 'A', folder: '/v/a', url: 'u', opened: 1 }],
  uiScale: 1.1,
  groupByStatus: true,
  importedFromSwift: true,
  pinnedFolders: ['/v'],
  outputParent: '/v',
  bounds: { x: 1, y: 2, width: 3, height: 4 },
}

describe('settings migration from Follow Along', () => {
  it('copies settings.json once when the new one is missing; the old folder is left as it was', () => {
    const { oldDir, newDir } = appSupport(JSON.stringify(old, null, 2))
    const before = readFileSync(join(oldDir, 'settings.json'), 'utf8')
    const mtime = statSync(join(oldDir, 'settings.json')).mtimeMs
    chmodSync(oldDir, 0o555) // read-only: a write there would throw
    try {
      expect(migrateSettings(oldDir, newDir)).toBe(true)
    } finally {
      chmodSync(oldDir, 0o755)
    }
    expect(JSON.parse(readFileSync(join(newDir, 'settings.json'), 'utf8'))).toEqual(old)
    expect(existsSync(join(newDir, 'Cookies'))).toBe(false)
    expect(readFileSync(join(oldDir, 'settings.json'), 'utf8')).toBe(before)
    expect(statSync(join(oldDir, 'settings.json')).mtimeMs).toBe(mtime)
    // second launch: the new file exists, nothing happens (even after the user changed it)
    writeFileSync(join(newDir, 'settings.json'), '{"openTabs":[]}')
    expect(migrateSettings(oldDir, newDir)).toBe(false)
    expect(readFileSync(join(newDir, 'settings.json'), 'utf8')).toBe('{"openTabs":[]}')
  })

  it('marks the copy as imported from the Swift app, so that import never runs again', () => {
    const { importedFromSwift: _, ...noFlag } = old
    const { oldDir, newDir } = appSupport(JSON.stringify(noFlag))
    expect(migrateSettings(oldDir, newDir)).toBe(true)
    expect(JSON.parse(readFileSync(join(newDir, 'settings.json'), 'utf8')).importedFromSwift).toBe(true)
  })

  it('does nothing without an old settings file, or with one that is not a JSON object', () => {
    for (const s of [null, '', 'not json', '[1,2]', 'null']) {
      const { oldDir, newDir } = appSupport(s)
      expect(migrateSettings(oldDir, newDir)).toBe(false)
      expect(existsSync(join(newDir, 'settings.json'))).toBe(false)
    }
  })
})
