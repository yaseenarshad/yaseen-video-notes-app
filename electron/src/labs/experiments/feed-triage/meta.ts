import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'feed-triage',
  title: 'Feed: preview pull quotes',
  description: 'A "Preview pull quotes" button on each 📺 Feed video. Only when you click it, Labs fetches that video\'s captions into its own cache (never the vault), shows the chapter titles with each chapter\'s first sentence word for word (no AI), then — when claude -p works — the AI-picked pull quotes, verbatim.',
  howTo: 'Open 📺 Feed, click "Preview pull quotes" under a video (captions take ~10 s; the AI pull quotes a minute or two, or not at all while claude -p is logged out). Click it again to fold.',
  area: 'feed',
  defaultOn: true,
  order: 22,
})
