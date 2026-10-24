/**
 * The shape of a Labs experiment's registry entry (`src/labs/experiments/<id>/meta.ts`). Kept apart from
 * registry.ts so the meta files can import it without a circular import (registry.ts imports every meta file).
 */
export type ExperimentArea = 'player' | 'newtab' | 'board' | 'feed' // 'feed': added by feed-triage (inside each 📺 Feed row)

export interface ExperimentMeta {
  /** Kebab-case, the same as its folder name. */
  id: string
  /** Short name shown in the 🧪 Labs panel. */
  title: string
  /** One sentence: what it does. */
  description: string
  /** How to try it (a sentence or two: where to look, what to click / press). */
  howTo: string
  /** Where it lives: the player page, the New Tab page, or the board cards. */
  area: ExperimentArea
  /** On when the user has not switched it yet. */
  defaultOn: boolean
  /** Sort key in the panel (lower first; then by title). */
  order?: number
}

/** Identity helper for typed meta files: `export default defineExperiment({ … })`. */
export const defineExperiment = (m: ExperimentMeta): ExperimentMeta => m
