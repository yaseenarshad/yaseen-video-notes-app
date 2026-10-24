import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'ask-the-video',
  title: 'Ask the video',
  description: 'A 🔎 Ask tab: type "where do they talk about X?" and get the passages, word for word with their times — instantly from a local keyword search (stemming, synonyms, typo-tolerant), and from Claude when it is logged in. It says which engine answered.',
  howTo: 'Open any video (no analysis needed), press / (or open the 🔎 Ask tab beside Chapters / Notes) and type a topic: keyword matches show as you type. Press Enter to also ask Claude (needs `claude` logged in; otherwise it says so and keeps the keyword matches). Click a passage to play it; hover to see it in the transcript.',
  area: 'player',
  defaultOn: false,
  order: 33,
})
