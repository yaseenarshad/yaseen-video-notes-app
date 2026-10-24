import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'mochi-candidates',
  title: 'Mochi candidates',
  description: 'A 🃏 Cards tab of spans the AI thinks are worth a flashcard (term, concept, quote, person, book, stat): the exact words, an AI label, the #mochi note line the app would write, and "Copy note line" / "Copy all". Spans you already took a note on are marked.',
  howTo: 'Open an analyzed video (🧪 Analyze first), open the 🃏 Cards tab beside Chapters / Notes. Click a card to play it; "Preview as note" shows the exact > 💬 … #mochi lines; "Copy note line" (or "Copy all") puts them on the clipboard to paste into the .md — Labs never writes the file.',
  area: 'player',
  defaultOn: false,
  order: 32,
})
