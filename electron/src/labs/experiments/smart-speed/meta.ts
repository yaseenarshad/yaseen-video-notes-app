import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'smart-speed',
  title: 'Smart speed',
  description: 'Changes the speed by the AI signal: low-signal stretches (filler, ordinary talk) play at a "skim" speed (3.5×), dense ones at your "listen" speed. Smooth and slow to react — it looks ~20 s ahead and never flips back and forth.',
  howTo: 'Analyze a video (🧪 Analyze), then press A (click the transcript first) or "⚡ Smart" under the video. The badge on the video says e.g. "Smart 3.5× (low signal)". Click the badge or "⚡ Smart" to set the skim / listen speeds. Pressing S or D yourself pauses it for 30 s.',
  area: 'player',
  defaultOn: false,
  order: 23,
})
