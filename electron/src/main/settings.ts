import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWrite } from '../core/atomic'
import { DebugLog } from './debugLog'

/**
 * App settings (the Swift app kept these in UserDefaults `com.yaseenarshad.followalong`):
 * player prefs, pinned folders, Recent, open tabs, app zoom, window bounds. One JSON file in the
 * app's userData folder, written atomically. On the first launch under the name Yaseen Video Notes the
 * settings.json of the app's old name ("Follow Along") is copied over (`core/migrate.ts`, marked as
 * already imported). Only without any settings are the Swift app's copied over (read-only on its defaults).
 */
export interface Recent { title: string; folder: string; url: string; opened: number }

interface Data {
  player: Record<string, unknown>
  pinnedFolders?: string[]
  openTabs: string[]
  outputParent?: string
  recents: Recent[]
  uiScale: number
  groupByStatus: boolean
  bounds?: { x: number; y: number; width: number; height: number }
  importedFromSwift?: boolean
}

const NUMBER_PREFS: Record<string, [number, number]> = {
  speed: [0.07, 16], lastSpeed: [0.07, 16], favSpeed: [0.07, 16], fontSize: [12, 32], split: [20, 80],
}
const BOOL_PREFS = ['badgeHidden', 'focus', 'hintShown']
const STRING_PREFS: Record<string, string[]> = { panel: ['chapters', 'notes'], noteCategory: ['general', 'mochi'] }
const PLAYER_DEFAULTS = { speed: 1.0, lastSpeed: 2.5, favSpeed: 2.5, badgeHidden: false, fontSize: 17.0, split: 46.0, focus: false, panel: 'chapters', hintShown: false, noteCategory: 'general' }

const exists = (p: string): boolean => { try { return existsSync(p) } catch { return false } }

class SettingsStore {
  private d: Data = { player: {}, openTabs: [], recents: [], uiScale: 1, groupByStatus: false }
  private file = ''
  private timer: NodeJS.Timeout | null = null

  load(): void {
    this.file = join(app.getPath('userData'), 'settings.json')
    try {
      this.d = { ...this.d, ...(JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Data>) }
    } catch { /* first launch */ }
  }

  /** Writes soon (several changes in a row make one write). */
  private save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.file) return
    try { atomicWrite(this.file, JSON.stringify(this.d, null, 2)) } catch (e) { DebugLog.log(`could not save settings: ${e}`) }
  }

  // ---------- player prefs ----------

  get playerPrefs(): Record<string, unknown> {
    const out: Record<string, unknown> = { ...PLAYER_DEFAULTS }
    for (const k of [...Object.keys(NUMBER_PREFS), ...BOOL_PREFS, ...Object.keys(STRING_PREFS)]) if (k in this.d.player) out[k] = this.d.player[k]
    return out
  }

  savePlayerPrefs(json: string): void {
    let o: Record<string, unknown>
    try { o = JSON.parse(json) } catch { return }
    if (!o || typeof o !== 'object') return
    for (const [k, [lo, hi]] of Object.entries(NUMBER_PREFS)) {
      const v = o[k]
      if (typeof v === 'number' && v >= lo && v <= hi) this.d.player[k] = v
    }
    for (const k of BOOL_PREFS) if (typeof o[k] === 'boolean' || typeof o[k] === 'number') this.d.player[k] = !!o[k]
    for (const [k, allowed] of Object.entries(STRING_PREFS)) if (typeof o[k] === 'string' && allowed.includes(o[k] as string)) this.d.player[k] = o[k]
    this.save()
  }

  // ---------- folders ----------

  get outputParent(): string { return this.d.outputParent ?? join(homedir(), 'Documents/Yaseen Video Notes') }
  set outputParent(v: string) { this.d.outputParent = v; this.save() }

  /** Folders pinned in the New Tab sidebar (the output folder by default). */
  get pinnedFolders(): string[] { return (this.d.pinnedFolders ?? [this.outputParent]).filter(exists) }
  set pinnedFolders(v: string[]) { this.d.pinnedFolders = v; this.save() }

  get openTabs(): string[] { return this.d.openTabs }
  set openTabs(v: string[]) { this.d.openTabs = v; this.save() }

  get recents(): Recent[] { return this.d.recents.filter((r) => exists(r.folder)) }
  addRecent(r: Recent): void {
    this.d.recents = [r, ...this.recents.filter((x) => x.folder !== r.folder)].slice(0, 8)
    this.save()
  }

  get groupByStatus(): boolean { return this.d.groupByStatus }
  set groupByStatus(v: boolean) { this.d.groupByStatus = v; this.save() }

  get bounds(): Data['bounds'] { return this.d.bounds }
  set bounds(v: Data['bounds']) { this.d.bounds = v; this.save() }

  // ---------- app zoom (⌘+ / ⌘− / ⌘0): 0.8…2.0 in 0.1 steps ----------

  get uiScale(): number { return Math.min(2, Math.max(0.8, this.d.uiScale || 1)) }
  stepScale(d: number): number {
    const next = d === 0 ? 1 : Math.round((this.uiScale + d * 0.1) * 10) / 10
    this.d.uiScale = Math.min(2, Math.max(0.8, next))
    this.save()
    return this.d.uiScale
  }
  get percent(): string { return `${Math.round(this.uiScale * 100)}%` }

  // ---------- first launch: copy the Swift app's settings ----------

  importFromSwift(): void {
    if (this.d.importedFromSwift) return
    this.d.importedFromSwift = true
    let xml = ''
    try {
      xml = execFileSync('/usr/bin/defaults', ['export', 'com.yaseenarshad.followalong', '-'], { encoding: 'utf8', timeout: 5000 })
    } catch {
      this.save()
      return
    }
    const p = parsePlist(xml) as Record<string, unknown> | null
    if (!p || typeof p !== 'object') { this.save(); return }
    const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
    if (strings(p.pinnedFolders)) this.d.pinnedFolders = strings(p.pinnedFolders)
    if (typeof p.outputParent === 'string') this.d.outputParent = p.outputParent
    if (strings(p.openTabs)) this.d.openTabs = strings(p.openTabs)!
    if (typeof p.groupByStatus === 'boolean') this.d.groupByStatus = p.groupByStatus
    if (typeof p.uiScale === 'number') this.d.uiScale = p.uiScale
    for (const [k, v] of Object.entries(p)) if (k.startsWith('player.')) this.d.player[k.slice(7)] = v
    if (p.recents instanceof Uint8Array) {
      try {
        // Swift's JSONEncoder: dates as seconds since 2001-01-01.
        const list = JSON.parse(new TextDecoder().decode(p.recents)) as { title: string; folder: string; url: string; opened: number }[]
        this.d.recents = list.map((r) => ({ title: r.title, folder: r.folder, url: r.url, opened: (r.opened + 978307200) * 1000 }))
      } catch { /* skip */ }
    }
    DebugLog.log('imported the Swift app settings')
    this.save()
  }
}

/** A small XML property list reader (dict, array, string, real, integer, true, false, data, date). */
export function parsePlist(xml: string): unknown {
  const tokens = xml.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, '').match(/<[^>]+>|[^<]+/g) ?? []
  let i = 0
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const skip = () => { while (i < tokens.length && !tokens[i].startsWith('<')) i++ }
  const text = (tag: string): string => {
    let s = ''
    while (i < tokens.length && tokens[i] !== `</${tag}>`) s += tokens[i++]
    i++
    return unescape(s)
  }
  const value = (): unknown => {
    skip()
    const t = tokens[i++]
    if (t === '<plist version="1.0">' || t.startsWith('<plist')) { const v = value(); skip(); i++; return v }
    if (t === '<dict/>') return {}
    if (t === '<array/>') return []
    if (t === '<string/>') return ''
    if (t === '<true/>') return true
    if (t === '<false/>') return false
    if (t === '<dict>') {
      const o: Record<string, unknown> = {}
      for (;;) {
        skip()
        if (tokens[i] === '</dict>') { i++; return o }
        i++ // <key>
        const k = text('key')
        o[k] = value()
      }
    }
    if (t === '<array>') {
      const a: unknown[] = []
      for (;;) {
        skip()
        if (tokens[i] === '</array>') { i++; return a }
        a.push(value())
      }
    }
    if (t === '<string>') return text('string')
    if (t === '<real>') return Number(text('real'))
    if (t === '<integer>') return Number(text('integer'))
    if (t === '<date>') return text('date')
    if (t === '<data>') return new Uint8Array(Buffer.from(text('data').replace(/\s+/g, ''), 'base64'))
    return null
  }
  try { return value() } catch { return null }
}

export const Settings = new SettingsStore()
