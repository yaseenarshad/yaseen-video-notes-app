import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'sponsor-skip',
  title: 'Sponsor skip',
  description: 'Skips SponsorBlock segments (sponsor, intro, outro, self-promo, interaction reminders) automatically, with an Undo toast, ⏭ marks in the transcript\'s time column and an on/off switch per category.',
  howTo: 'Open a video that has SponsorBlock segments (the "⏭ Skip" button under the video shows how many). Play through one: it jumps over it and shows "Skipped sponsor (0:42) · Undo". Click "⏭ Skip" to switch categories on or off; click a ⏭ mark to watch that segment anyway.',
  area: 'player',
  defaultOn: false,
  order: 21,
})
