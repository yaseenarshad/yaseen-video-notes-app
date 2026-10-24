import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'triage-cards',
  title: 'Triage cards',
  description: 'Board cards of analyzed videos show "🎬 18 highlights · 21 min", a signal % (share of paragraphs the analysis scored substantive or dense), the top 2 pull quotes word for word (click to expand), and a ▶ Reel button that opens the video straight into the highlight reel.',
  howTo: 'Open learning-log (Board view) and look at the cards of analyzed videos (Zuckerberg, CoreWeave, a16z, OpenAI 722…). Click a quote to read all of it; click ▶ Reel to open the video at its highlights (needs the highlight-reel player experiment on).',
  area: 'board',
  defaultOn: true,
  order: 20,
})
