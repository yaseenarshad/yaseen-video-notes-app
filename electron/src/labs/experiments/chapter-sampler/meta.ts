import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'chapter-sampler',
  title: 'Chapter sampler',
  description: 'A "Sample" mode that plays the first ~30 s of each chapter back to back at your current speed, so you can taste the whole video in a few minutes and stay where it gets good. Videos without chapters use 10-minute windows.',
  howTo: 'Press "▶ Sample" under the video (or Shift+C; click the transcript first). The chip on the video says "Chapter 4/22 · Sampling". → next sample, ← previous, Enter = keep watching this chapter, Esc = stop and go back to where you were, 1/2/3/4 = 15/30/45/60 s samples.',
  area: 'player',
  defaultOn: false,
  order: 22,
})
