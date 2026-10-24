import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'dense-mode',
  title: 'Dense mode',
  description: 'Hides the low-signal paragraphs of the transcript (by the AI\'s per-paragraph scores) behind thin "⋯ 12 min skipped (8 paragraphs) — show" rows, so you read only the substance. Threshold: 3 only / 2+ / 1+. Optionally skips the hidden parts while the video plays.',
  howTo: 'Open an analyzed video and press "▤ Dense" under the video (or ⇧U). Pick 3 only / 2+ / 1+ in the strip over the transcript; click a "⋯ skipped" row to open it in place. Follow still works: inside a hidden part its row says "you are here". Tick "Skip hidden parts while playing" to jump over them (the toast has Undo).',
  area: 'player',
  defaultOn: true,
  order: 12,
})
