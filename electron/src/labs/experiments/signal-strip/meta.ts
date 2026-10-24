import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'signal-strip',
  title: 'Signal strip',
  description: 'A slim strip along the right edge of the transcript showing where the good parts are: YouTube\'s "most replayed" heatmap (when the video has one) and the AI signal score of every paragraph, as two thin lanes.',
  howTo: 'Analyze a video (🧪 Analyze), then look at the strip at the right edge of the transcript: longer, darker bars = denser talk. Hover it to see the time and the first words there; click to jump. The white line is where you are.',
  area: 'player',
  defaultOn: false,
  order: 20,
})
