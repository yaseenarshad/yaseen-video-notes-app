// Labs experiment "triage-cards": main-process side. The board asks for one card's digest at a time
// (window.fa.labsCall('triage-cards', 'card', folder, videoId)); only the video folder's .follow-along.json and
// Labs' own cache are read.
import { defineMainHooks } from '../../hooks'
import { digestOfFolder } from './digest'

export default defineMainHooks({
  ipc: {
    card: (ctx, folder, videoId) => {
      if (typeof folder !== 'string') return null
      const d = digestOfFolder(ctx.userData, folder, typeof videoId === 'string' ? videoId : null)
      if (!d || !d.analyzed) return null
      return { highlights: d.highlights, highlightSeconds: d.highlightSeconds, signalPct: d.signalPct, quotes: d.quotes.slice(0, 2) }
    },
  },
})
