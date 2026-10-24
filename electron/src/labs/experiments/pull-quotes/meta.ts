import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'pull-quotes',
  title: 'Pull quotes (TL;DR without rewriting)',
  description: 'A ❝ Quotes tab beside Chapters / Notes: per chapter (or 10-minute window) the 1–2 lines the AI picked, word for word, with the chapter title and time — the whole video in about a minute of reading. A Read mode shows only this list, large, as a page.',
  howTo: 'Open an analyzed video, click the ❝ Quotes tab in the side panel. Click a quote to jump there (hover marks its words in the transcript). "📖 Read mode" (or ⇧Q) opens the big page: scroll or J / K through the quotes, Enter or click ▶ to play from one, Esc to close.',
  area: 'player',
  defaultOn: true,
  order: 11,
})
