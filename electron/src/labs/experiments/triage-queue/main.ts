// Labs experiment "triage-queue": main-process side. Triage choices are Labs-local: they live in Labs' own
// labs-state.json (key "triage-queue": { <videoId>: { state, at } }) and never touch the vault's status.
import { defineMainHooks } from '../../hooks'
import { readState, writeStateKey } from '../../store'
import { digestOfFolder } from '../triage-cards/digest'

const ID = 'triage-queue'
const STATES = ['reel', 'skip', 'done']

export default defineMainHooks({
  ipc: {
    states: (ctx) => readState(ctx.userData)[ID] ?? {},
    setState: (ctx, key, state) => {
      if (typeof key !== 'string' || !key || key.length > 600) throw new Error('bad key')
      writeStateKey(ctx.userData, ID, key, typeof state === 'string' && STATES.includes(state) ? { state, at: new Date().toISOString() } : null)
      return readState(ctx.userData)[ID] ?? {}
    },
    /** One video's digest: verbatim pull quotes + AI labels when analyzed, else chapter openings (no AI). */
    digest: (ctx, folder, videoId) => {
      if (typeof folder !== 'string') return null
      const d = digestOfFolder(ctx.userData, folder, typeof videoId === 'string' ? videoId : null)
      return d && { ...d, quotes: d.quotes.slice(0, 4), labels: d.labels.slice(0, 4), openings: d.openings.slice(0, 30) }
    },
  },
})
