import { app, ipcMain, shell, type MenuItemConstructorOptions } from 'electron'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isLabs, Flavor } from '../../core/flavor'
import { analyze, loadWords } from '../../labs/analysis/analyze'
import { matchesTranscript } from '../../labs/analysis/validate'
import type { LabsMainContext, LabsMainHooks, LabsRawResponse, LabsVideoContext } from '../../labs/hooks'
import { EXPERIMENTS, experiment } from '../../labs/registry'
import { ensureSignals, readSignals } from '../../labs/signals'
import { analyzedIndex, LIBRARY_DIR, readAnalysis, readState, writeStateKey } from '../../labs/store'
import type { LabsInfo } from '../../shared/api'
import { DebugLog } from '../debugLog'
import { json, text, type Request, type Response } from '../server'
import { Settings } from '../settings'
import PAGE_API from '../../labs/page/api.js?raw'
import PAGE_LOADER from '../../labs/page/loader.js?raw'

/**
 * The 🧪 Labs flavor in the main process (inert in the normal app: nothing here runs unless `isLabs()`).
 * - the player page: /labs/boot.js (page API + the one generic loader), /labs/config.json, /labs/x/<id>.js (an
 *   enabled experiment's script), /labs/x/<id>/<path> (its main.ts route), the analysis and signals of the video,
 *   /labs/analyze (run it), /labs/state/<id> (per-experiment state)
 * - the shell: IPC labs:info / labs:setEnabled / labs:analyzed / labs:call
 * - the Labs menu
 */

/** The player scripts and main hooks of every experiment folder (collected at build time). */
const PLAYER_SCRIPTS = import.meta.glob<string>('../../labs/experiments/*/player.js', { query: '?raw', import: 'default', eager: true })
const MAIN_HOOKS = import.meta.glob<{ default: LabsMainHooks }>('../../labs/experiments/*/main.ts', { eager: true })
const byId = <T>(mods: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(mods).map(([p, m]) => [p.split('/').slice(-2, -1)[0], m]))
const SCRIPTS = byId(PLAYER_SCRIPTS)
const HOOKS: Record<string, LabsMainHooks> = Object.fromEntries(Object.entries(byId(MAIN_HOOKS)).map(([id, m]) => [id, m.default]))

/** The user's real learning-log (read-only in Labs) — pinned by default so Labs tries features on real videos. */
export const LEARNING_LOG = join(homedir(), 'Documents/GitHub/yaseen-docs-vault/learning-log')

export const userData = (): string => app.getPath('userData')
export const libraryDir = (): string => join(userData(), LIBRARY_DIR)
const mainContext = (): LabsMainContext => ({ userData: userData(), log: (l) => DebugLog.log(`labs: ${l}`) })

/** At start (Labs only): Labs' library folder, and the default sidebar = learning-log + labs-library. */
export function setUpLabsFolders(): void {
  mkdirSync(libraryDir(), { recursive: true })
  Settings.useLabsFolders(libraryDir(), [LEARNING_LOG, libraryDir()])
}

export function enabledIds(): string[] {
  const sw = Settings.labsEnabled
  return EXPERIMENTS.filter((e) => sw[e.id] ?? e.defaultOn).map((e) => e.id)
}

export function labsInfo(): LabsInfo | null {
  if (!isLabs()) return null
  const on = new Set(enabledIds())
  return { readOnly: Flavor.readOnlyVault, userData: userData(), library: libraryDir(), experiments: EXPERIMENTS.map((e) => ({ ...e, enabled: on.has(e.id) })) }
}

// ---------- the player page ----------

const BOOT_JS = PAGE_API + '\n' + PAGE_LOADER

/** player.html as served in Labs: + the boot script (page API and loader) at the end of the body. */
export function labsPlayerHTML(html: string): string {
  return html.replace('</body>', '<script src="/labs/boot.js"></script>\n</body>')
}

/** Labs routes of a player page's server (`/labs/…`). */
export async function labsRoute(ctx: LabsVideoContext, req: Request): Promise<Response> {
  const p = req.path
  if (p === '/labs/boot.js') return text(BOOT_JS, 200, 'text/javascript; charset=utf-8')
  if (p === '/labs/config.json') {
    const enabled = enabledIds()
    return json({ flavor: 'labs', readOnly: Flavor.readOnlyVault, enabled, player: Object.keys(SCRIPTS), experiments: labsInfo()?.experiments ?? [] })
  }
  const x = /^\/labs\/x\/([a-z0-9-]+)(\.js|\/.*)$/.exec(p)
  if (x) {
    const [, id, rest] = x
    if (!experiment(id) || !enabledIds().includes(id)) return json({ error: `experiment ${id} is off or unknown` }, 404)
    if (rest === '.js') return SCRIPTS[id] ? text(SCRIPTS[id], 200, 'text/javascript; charset=utf-8') : text('not found', 404)
    const hook = HOOKS[id]?.route
    if (!hook) return text('not found', 404)
    try {
      const out = await hook({ method: req.method, path: rest.slice(1), query: req.query, body: req.body }, ctx)
      if (out === undefined) return text('not found', 404)
      const raw = out as LabsRawResponse
      return raw && typeof raw === 'object' && typeof raw.status === 'number' && 'body' in raw ? raw : json(out)
    } catch (e) {
      ctx.log(`${id} route ${rest}: ${e}`)
      return json({ error: e instanceof Error ? e.message : String(e) }, 500)
    }
  }
  if (p === '/labs/analysis.json') {
    const a = readAnalysis(ctx.userData, ctx.videoId)
    if (!a) return json({ error: 'not analyzed' }, 404)
    try { if (!matchesTranscript(a, loadWords(ctx.sidecar))) return json({ error: 'the analysis is of another version of this transcript' }, 404) } catch { /* sidecar unreadable: serve it anyway */ }
    return json(a)
  }
  if (p === '/labs/signals.json') {
    const s = readSignals(ctx.userData, ctx.videoId)
    return s ? json(s) : json({ error: 'not fetched yet' }, 404)
  }
  if (p === '/labs/analyze' && req.method === 'POST') return json(startAnalysis(ctx, req.query.get('force') === '1'))
  if (p === '/labs/analyze/status') return json(job(ctx.videoId))
  const st = /^\/labs\/state\/([a-z0-9-]+)$/.exec(p)
  if (st) {
    if (req.method === 'POST') {
      let o: { key?: unknown; value?: unknown }
      try { o = JSON.parse(req.body) } catch { return json({ error: 'bad body' }, 400) }
      if (typeof o.key !== 'string') return json({ error: 'key missing' }, 400)
      writeStateKey(ctx.userData, st[1], o.key, o.value)
    }
    return json(readState(ctx.userData)[st[1]] ?? {})
  }
  return text('not found', 404)
}

// ---------- analysis jobs (one at a time; the page polls /labs/analyze/status) ----------

interface Job { state: 'idle' | 'running' | 'done' | 'failed'; startedAt?: string; finishedAt?: string; lines: string[]; error?: string }
const jobs = new Map<string, Job>()
let queue: Promise<unknown> = Promise.resolve()

const job = (videoId: string): Job => jobs.get(videoId) ?? { state: 'idle', lines: [] }

export function startAnalysis(ctx: LabsVideoContext, force: boolean): Job {
  const cur = jobs.get(ctx.videoId)
  if (cur?.state === 'running') return cur
  const j: Job = { state: 'running', startedAt: new Date().toISOString(), lines: [] }
  jobs.set(ctx.videoId, j)
  const log = (l: string) => { j.lines = [...j.lines, l].slice(-40); ctx.log(`analyze ${ctx.videoId}: ${l}`) }
  queue = queue.then(async () => {
    try {
      await ensureSignals(ctx.userData, ctx.videoId, { log }).catch(() => {})
      await analyze(ctx.sidecar, { userData: ctx.userData, force, log })
      j.state = 'done'
    } catch (e) {
      j.state = 'failed'
      j.error = e instanceof Error ? e.message : String(e)
      log(`failed: ${j.error}`)
    } finally {
      j.finishedAt = new Date().toISOString()
    }
  })
  return j
}

/** A video opened in Labs: fetch its heatmap + SponsorBlock in the background when not cached yet (cheap, once). */
export function onLabsSessionOpen(ctx: LabsVideoContext): void {
  if (readSignals(ctx.userData, ctx.videoId)) return
  setTimeout(() => {
    queue = queue.then(() => ensureSignals(ctx.userData, ctx.videoId, { log: ctx.log }).catch((e) => ctx.log(`signals: ${e}`)))
  }, 4000)
}

export function videoContext(v: Omit<LabsVideoContext, 'userData' | 'log'>): LabsVideoContext {
  return { ...v, ...mainContext() }
}

// ---------- the shell (IPC) and the menu ----------

export function registerLabsIPC(onChange: () => void): void {
  ipcMain.handle('labs:info', () => labsInfo())
  ipcMain.handle('labs:setEnabled', (_e, id: string, on: boolean) => {
    if (!isLabs() || !experiment(id)) return labsInfo()
    Settings.setLabsEnabled(id, !!on)
    DebugLog.log(`labs: ${id} ${on ? 'on' : 'off'}`)
    onChange()
    return labsInfo()
  })
  ipcMain.handle('labs:analyzed', () => (isLabs() ? analyzedIndex(userData()) : {}))
  ipcMain.handle('labs:call', async (_e, id: string, method: string, args: unknown[]) => {
    if (!isLabs() || !enabledIds().includes(id)) throw new Error(`experiment ${id} is off or unknown`)
    const f = HOOKS[id]?.ipc?.[method]
    if (!f) throw new Error(`${id} has no method ${method}`)
    return f(mainContext(), ...(Array.isArray(args) ? args : []))
  })
}

/** The Labs menu (Labs only). */
export function labsMenu(actions: { showLabs: () => void; analyze: () => void }): MenuItemConstructorOptions {
  return {
    label: 'Labs',
    submenu: [
      { label: '🧪 Labs Experiments…', accelerator: 'CmdOrCtrl+Shift+L', click: actions.showLabs },
      { label: 'Analyze This Video', click: actions.analyze },
      { type: 'separator' },
      { label: 'Open Labs Data Folder', click: () => void shell.openPath(userData()) },
    ],
  }
}
