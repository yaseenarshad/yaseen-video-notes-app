import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'analysis-inspector',
  title: 'Analysis inspector',
  description: 'A 🧪 Analysis tab beside Chapters / Notes that lists the raw Labs analysis — highlights, pull quotes, questions, claims, flashcard candidates — each with its exact words from the transcript.',
  howTo: 'Open a video, press "🧪 Analyze" under the video (takes a minute or two), then open the 🧪 Analysis tab in the side panel. Click any item to jump there; hover a highlight to see its words marked in the transcript.',
  area: 'player',
  defaultOn: true,
  order: 1,
})
