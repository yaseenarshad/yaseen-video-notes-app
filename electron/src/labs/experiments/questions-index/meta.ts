import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'questions-index',
  title: 'Questions index',
  description: 'A ❓ Questions tab listing every question the host asked, word for word, with a jump to the question and to where the answer starts; an "Interview map" mode you step through with Q / Shift+Q.',
  howTo: 'Open an analyzed video (🧪 Analyze first), open the ❓ Questions tab beside Chapters / Notes. Click a question to play from it, "▶ answer" to skip to the answer; type in the filter box to narrow. Switch to "Interview map" and press Q (next question) / Shift+Q (previous) — click the transcript first so the keys reach the page.',
  area: 'player',
  defaultOn: false,
  order: 30,
})
