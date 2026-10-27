import { defineExperiment } from '../../experiment'

export default defineExperiment({
  id: 'notes-view',
  title: 'Notes view',
  description: 'A Transcript | Notes switch at the top of the transcript column. Notes = the video part by part (chapters, else ~5-minute parts): 🤖 AI notes in your notes format (each bullet plays from where it was said), the slides, your 💬 transcript notes, and a 🧑 Yasin editor (the docs app\'s Milkdown: bullets, Tab indent, ⌘B/⌘I, pasted images). It follows the video like the transcript; everything is saved in one bullet-only <slug>.notes.md (in Labs: Labs\' own cache).',
  howTo: 'Open a video and click Notes at the top left of the transcript (or ⇧T). Play: the current part and bullet light up and stay in view (Follow / Back to now as usual). Click a bullet, a slide\'s time or a part\'s title to play from there; double-click an image for the lightbox (← / →). Click "Type your notes for this part…" to write. No AI notes yet? "Write them" (needs `claude` logged in).',
  area: 'player',
  defaultOn: true,
  order: 12,
})
