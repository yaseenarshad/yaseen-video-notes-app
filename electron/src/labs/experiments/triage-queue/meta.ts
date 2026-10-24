import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'triage-queue',
  title: 'Triage queue',
  description: 'A "🎯 Triage" bar on the New Tab with a counter ("12 to triage"); it opens a one-video-at-a-time queue of the un-started videos (Backlog / Todo / no status) showing their pull quotes word for word — or, when a video is not analyzed, its chapter titles and first sentences (no AI) — so you can decide in seconds: → watch the reel, ↓ skip for now, D done.',
  howTo: 'Open learning-log in a New Tab, click "Start triage" in the 🎯 Triage bar above the board. Keys: → watch reel · ↓ skip for now · D mark done · Enter open normally · ↑ previous · Esc close. Choices are kept in Labs only (not your vault\'s status).',
  area: 'newtab',
  defaultOn: true,
  order: 21,
})
