# ▤ Dense mode

**What it does.** A transcript view that hides the low-signal paragraphs. The analysis scores every paragraph
0 (filler) · 1 (ordinary) · 2 (substantive) · 3 (dense); paragraphs below your threshold collapse into one thin row,
"⋯ 12 min skipped (8 paragraphs) — show", which opens in place (opened paragraphs are slightly faded). The strip over
the transcript shows the threshold, and "Reading time: 9 min instead of 52". The paragraphs you see are the transcript
as it is — nothing rewritten.

## How to try it

1. Open an analyzed video (🧪 Analyze first if needed).
2. Press **▤ Dense** under the video (or **⇧U**). The strip appears at the top-left of the transcript.
3. Pick the threshold: **3 only** (just the densest) · **2+** (default) · **1+** (everything but filler).
4. Click a "⋯ skipped" row to show those paragraphs in place; click it again ("▾ … hide") to fold them.
5. Follow mode keeps working: when the video is inside a hidden part, its row turns yellow — **"You are here · 14:32 —
   inside 3 min (4 paragraphs) skipped — show"** — and stays in view.
6. Tick **Skip hidden while playing**: while the video plays, it jumps over hidden parts (≥ 8 s) to the next shown
   paragraph; the toast "Skipped 3 min of low-signal talk" has **Undo** (goes back and opens that part).
7. ✕ in the strip (or ▤ Dense / ⇧U again) turns it off. The setting is remembered.

## What to judge it on

- At 2+, do you lose anything you would have wanted? At 3 only, is it still followable?
- Is the reading-time saving real for a 1–2 h podcast?
- Watching with "Skip hidden while playing": does the talk still make sense, or do the jumps break the thread?
- Is "you are here" in a hidden part clear enough?

## Known limits

- Needs a Labs analysis (its `paragraphScores`); the scores are the AI's judgment per paragraph.
- Paragraphs that hold one of your notes are never hidden (so in a heavily annotated video the saving is smaller).
- Hidden runs break at chapter starts, so chapter headings always stay visible.
- Skipping jumps to the next shown paragraph; very short hidden parts (< 8 s) are simply played.
- Find (⌃F) still searches hidden paragraphs, but a hit inside a folded run is not visible until you open the run.
