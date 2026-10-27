import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'slides',
  title: 'Slides (read a talk as a deck)',
  description: 'For talks with a slide deck: finds every slide (plain code, no AI — builds grouped, camera shots left out) and shows them next to the transcript: a 🖼 Slides tab, a "slides follow along" view instead of the speaker, slide thumbnails inside the transcript, and a deck reader with the exact words spoken on each slide. Slide text is read by macOS Vision (OCR) for search.',
  howTo: 'Open a talk, click "🖼 Extract slides" under the video (≈ 30–60 s: it downloads the 720p video into Labs\' cache, keeps one image per slide and deletes the video). Then: the 🖼 Slides tab (click = jump, hover = big preview, filter box searches the slide text), I = slides follow along (← / → step slides), ⇧I = the deck reader (← / → or J / K, Enter = play from here, Esc).',
  area: 'player',
  defaultOn: true,
  order: 13,
})
