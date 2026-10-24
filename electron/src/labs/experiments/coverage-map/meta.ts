import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'coverage-map',
  title: 'Coverage map',
  description: 'Remembers what you actually heard (played, at any speed) and what you skipped, across relaunches: a strip along the transcript (heard = solid, not heard = hollow), dots in the time column, "Coverage 64% · 38 min not heard", and a clickable list of the parts you have not heard.',
  howTo: 'Play a video for a bit, skip ahead (→ or a click), play again. The green strip at the right edge of the transcript fills in where you listened. "◐ … heard" under the video opens the ◐ Coverage tab: the line and the not-heard parts (click one to go there).',
  area: 'player',
  defaultOn: false,
  order: 24,
})
