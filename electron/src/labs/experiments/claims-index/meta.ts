import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'claims-index',
  title: 'Claims index',
  description: 'A 📌 Claims tab: the numbers and stats, people, companies, books and bold claims in the video, grouped by type with counts, word for word; repeated names are merged ("×3") with every mention clickable.',
  howTo: 'Open an analyzed video (🧪 Analyze first), open the 📌 Claims tab beside Chapters / Notes. Click a type chip to jump to that group, click any line (or a time chip of a repeated name) to play from there; hover to see the words marked in the transcript.',
  area: 'player',
  defaultOn: false,
  order: 31,
})
