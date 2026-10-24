# Signal strip

**What it does.** A slim vertical strip along the right edge of the transcript: a minimap of the whole video
(top = 0:00, bottom = the end) that shows where the good parts are, so you can see at a glance where to slow down.

- **Purple lane: the AI signal.** The analysis scores every paragraph 0–3 (filler · ordinary · substantive · dense).
  The strip shows it smoothed into slices of ~3 px: a longer, darker bar = denser talk. Thin orange ticks on the
  lane's left edge are the AI highlights.
- **Orange lane: YouTube "most replayed"** (the heatmap), shown only when the video has one — longer, brighter bar =
  replayed more. Two separate lanes, not blended, so you always know which source is saying "this part is good".
- The **white line** is where you are now.

Nothing in it is AI-written text: the hover card shows the paragraph's own first words.

## How to try it

1. 🧪 Labs → switch on **Signal strip**, then open a video (or ⌘R an open one).
2. If the video is not analyzed yet, press **🧪 Analyze** under the video and wait for "Analysis ready".
3. Look at the strip at the right edge of the transcript (left of the scrollbar).
4. Hover it: a card shows the time, the AI score of that paragraph (and "replayed N%" when there is a heatmap) and
   the paragraph's first ~18 words, verbatim.
5. Click it: the video jumps to the start of that paragraph.

## What to judge it on

- Do the dark/long purple stretches match the parts you would have wanted to hear at normal speed?
- Is it useful while watching (glance → skip ahead to the next dense stretch), or only before starting?
- Is the strip too thin / too noisy / in the way of the text?

## Known limits

- None of the videos analyzed so far has a YouTube heatmap (newer or little-watched videos have none), so usually
  only the purple lane shows. The heat lane was checked with a synthetic heatmap in a test copy.
- No analysis → the AI lane is hatched (nothing to show). It redraws by itself when an analysis finishes.
- The strip is a whole-video minimap; it does not show which part of the transcript is on screen.
