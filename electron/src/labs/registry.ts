/// <reference types="vite/client" />
/**
 * THE Labs experiment registry. Every experiment is one folder, `src/labs/experiments/<id>/`, whose `meta.ts`
 * default-exports its entry; this file collects them (Vite's `import.meta.glob`, at build time), so adding an
 * experiment never edits a shared file and parallel work merges cleanly. See docs/labs.md.
 *
 *   experiments/<id>/meta.ts       required: `export default defineExperiment({ id, title, … })`
 *   experiments/<id>/player.js     area 'player': a page script, loaded into the player when the experiment is on
 *                                  (uses window.LABS — src/labs/page/api.js)
 *   experiments/<id>/renderer.tsx  area 'newtab' | 'board': a React component, rendered in that slot of the shell
 *   experiments/<id>/main.ts       optional: main-process hooks (HTTP routes for the page, IPC for the shell)
 *
 * Used by the main process (the Labs panel's list, which scripts to load) and the shell renderer (the panel, the
 * slots). Plain data only, so it is safe in both.
 */
import type { ExperimentMeta } from './experiment'

export { defineExperiment, type ExperimentArea, type ExperimentMeta } from './experiment'

const modules = import.meta.glob<{ default: ExperimentMeta }>('./experiments/*/meta.ts', { eager: true })

/** Folder name of a glob path `./experiments/<id>/meta.ts`. */
export const folderOf = (path: string): string => path.split('/').slice(-2, -1)[0] ?? ''

export const EXPERIMENTS: ExperimentMeta[] = Object.entries(modules)
  .map(([path, m]) => ({ ...m.default, id: m.default?.id ?? folderOf(path) }))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title))

export const experiment = (id: string): ExperimentMeta | undefined => EXPERIMENTS.find((e) => e.id === id)

/** Problems with the registry (the unit test asserts there are none). */
export function registryProblems(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const [path, m] of Object.entries(modules)) {
    const e = m.default
    const where = folderOf(path)
    if (!e || typeof e !== 'object') { out.push(`${where}: meta.ts has no default export`); continue }
    if (e.id !== where) out.push(`${where}: id "${e.id}" must equal the folder name`)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id ?? '')) out.push(`${where}: id must be kebab-case`)
    if (seen.has(e.id)) out.push(`${where}: duplicate id`)
    seen.add(e.id)
    for (const k of ['title', 'description', 'howTo'] as const) if (typeof e[k] !== 'string' || !e[k].trim()) out.push(`${where}: ${k} missing`)
    if (!['player', 'newtab', 'board'].includes(e.area)) out.push(`${where}: area must be player | newtab | board`)
    if (typeof e.defaultOn !== 'boolean') out.push(`${where}: defaultOn must be true or false`)
  }
  return out
}
