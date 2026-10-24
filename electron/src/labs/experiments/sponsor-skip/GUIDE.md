# Sponsor skip

**What it does.** Jumps over SponsorBlock segments while the video plays — sponsor reads, intros, outros,
self-promotion and "like and subscribe" reminders — so a 2 h podcast loses its ad reads without you reaching for →.

- When playback enters a segment of a category that is on, it jumps to the segment's end and shows
  **"Skipped sponsor (0:42) · Undo"** (0:42 = how much was skipped). Undo goes back to the start of the segment and
  never skips that one again (this session).
- The transcript's time column shows **⏭** at each segment's first paragraph, and the segment's words are struck
  through faintly. Hover ⏭ for the category and times; click it to watch that segment anyway.
- **"⏭ Skip 5/6"** under the video (5 of the video's 6 segments are set to skip). Click it for a switch per category
  (saved for every video) and the list of segments (click one to watch it).

## How to try it

1. 🧪 Labs → switch on **Sponsor skip**, open a video (or ⌘R an open one).
   A good test: *Flying Tesla Car, Robot Brains…* (learning-log, 10-17) has 5 sponsor segments and an outro.
2. Click a paragraph a few seconds before a ⏭ mark and let it play. It jumps; the toast appears; try **Undo**.
3. Click **⏭ Skip …** under the video, switch "outro" off, and see the ⏭ mark of the outro fade.

## What to judge it on

- Did it ever skip something you wanted to hear (wrong or too-long community segments)?
- Is the toast + Undo enough, or would you rather confirm before each skip?
- Are the struck-through words helpful or distracting?

## Known limits

- Segments come from the SponsorBlock community (sponsor.ajay.app). The app fetches them in the background ~4 s
  after a video opens; until then (first open of a video) the button reads "⏭ Skip: none" and it looks again a few
  times in the first ~30 s.
- A segment is skipped whenever playback is inside it, also when you click a word inside it; click its ⏭ mark (or
  Undo) to watch it.
- Skipping the outro jumps to the very end of the video.
