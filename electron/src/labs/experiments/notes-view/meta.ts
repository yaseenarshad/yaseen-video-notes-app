import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'notes-view',
  title: 'Notes view',
  description: 'A Transcript | Notes switch at the top of the transcript column. Notes = the video part by part (chapters, else ~5-minute parts), one editor per part (the docs app\'s Milkdown): 🤖 AI notes in your notes format (each bullet plays from where it was said), the slides, and your own words typed anywhere in between, highlighted automatically. Edit the AI bullets freely (✎ shows the AI original, Restore original). Right-click a bullet or type /mochi /note to make a 💬 transcript note. It follows the video like the transcript; everything is saved in one bullet-only <slug>.notes.md (in Labs: Labs\' own cache).',
  howTo: 'Open a video and click Notes at the top left of the transcript (or ⇧T). Play: the current part and bullet light up and stay in view (Follow / Back to now as usual). A bullet\'s time chip (hover), a slide\'s time or a part\'s title plays from there; double-click an image for the lightbox (← / →). Click anywhere in a part and type: Enter = new bullet, Tab = child; your words turn green. Right-click a bullet → Add note… / Add Mochi note…, or type /mochi at its end. No AI notes yet? "Write them" (needs `claude` logged in).',
  area: 'player',
  defaultOn: true,
  order: 12,
})
