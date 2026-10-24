import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'highlight-reel',
  title: 'Highlight reel',
  description: 'A TikTok-style Reel mode: the AI highlights play back to back at your speed, the video on top and the speakers\' exact words below it (word by word as they are said). Swipe or press ↓ / ↑ to move, L to save a moment, Enter to keep watching from there.',
  howTo: 'Open an analyzed video and press "▶ Reel" under the video (or E). ↓ → J next · ↑ ← K previous · Space pause · L save · O order (time / score) · Enter keep watching from here · Esc back to where you were. Trackpad swipe / mouse wheel moves too. At the end: a summary with your saved moments.',
  area: 'player',
  defaultOn: true,
  order: 10,
})
