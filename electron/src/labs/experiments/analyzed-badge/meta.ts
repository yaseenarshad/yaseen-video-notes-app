import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'analyzed-badge',
  title: 'Analyzed badge',
  description: 'A small 🧪 chip on board cards of videos that have a Labs analysis, with its number of highlights.',
  howTo: 'Analyze a video (🧪 Analyze under the video), then look at its card on the Board of learning-log.',
  area: 'board',
  defaultOn: true,
  order: 2,
})
