# ▶ Highlight reel

**What it does.** A TikTok-style Reel mode over the AI highlights of a video. The video stays on top; under it, a
big card shows the highlight's exact transcript words (each word lights up as it is said), the AI label (marked
"AI label · …"), the `why` tag (claim / story / number / framing / disagreement / insight / quote), the AI score,
its position ("7 / 18"), the time range and its chapter. Highlights play back to back at your normal speed — when one
ends, the next starts. A timeline under the video shows where every highlight sits in the whole episode; a rail on
the right shows the 18 stops (yellow = now, grey = visited, pink = saved). At the end a summary: "18 highlights ·
17 min of 37 min · watched in 7 min", your saved moments with "▶ Jump in here", and every highlight.

Nothing in the card is written by the AI except the label: the words are the transcript's.

## How to try it

1. Open a video that has a Labs analysis (the button under the video says **▶ Reel · 18**; without one: 🧪 Analyze first).
2. Click **▶ Reel**, or press **E**. If you are already some way into the video, the reel starts at the next highlight
   from where you are ("Starting at 7 / 18") — ↑ goes to the earlier ones.
3. In the reel:

| key / gesture | does |
|---|---|
| `↓` `→` `J`, swipe / wheel down | next highlight |
| `↑` `←` `K`, swipe / wheel up | previous highlight |
| `Space`, click the video | pause / play |
| `L` (or ♡ Save) | save this moment (again = unsave). Saved moments get a ♥ in the transcript's time column |
| `O` (or In order / By score at the top) | chronological ↔ strongest first |
| `Enter` (or ⏎ Keep watching) | close the reel and keep watching the full video from this exact spot |
| `Esc` (or ✕) | close the reel and go back to where you were before it |
| `S` `D` `R` `G` `Z` `X` | the usual speed / ±5 s keys still work |
| click a word in the card | jump to that word |

4. After the last highlight (or `↓` on the last one): the summary. `Esc` = back to where you were, `Enter` = keep
   watching after the last highlight, `↑` = back into the reel.

## What to judge it on

- Does watching the 18 highlights at your speed give you the episode's best moments in a few minutes?
- Are the highlight boundaries right — do they start and end at sensible points, or cut speakers mid-thought?
- Is "Keep watching from here" the escape hatch you want when a moment hooks you?
- In order vs By score: which one do you actually use?
- Is saving (L) + the summary list useful, or would you rather save straight into notes?

## Known limits

- Needs a Labs analysis (10–20 highlights of 20–120 s). Highlights only as good as the analysis.
- Saved moments live in Labs (`labs-state.json`, per video) — never in the vault, so they are not notes.
- YouTube needs a moment to buffer after each jump; very short highlights at 3× can feel jumpy.
- Keys pressed while the YouTube frame itself has focus are not seen by the reel; the reel puts a shield over the
  video so this normally cannot happen (click the dark area if keys stop responding).
- "Watched in" counts the time the video played while the reel was open (not paused time).
- If an ad plays, the reel waits and may jump back to the highlight's start once.
