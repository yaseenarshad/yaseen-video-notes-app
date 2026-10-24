# Coverage map

**What it does.** Remembers what you actually **heard** of a video — the parts that played, at any speed — and what
you skipped (seeks, → jumps, clicks ahead, sponsor skips), across relaunches. For 2–3 h podcasts watched in pieces it
answers "what haven't I heard yet?".

- A **strip** at the right edge of the transcript (the outlined one): green = heard, hollow = not heard; the white
  line is where you are. Click it to jump.
- A **dot** per paragraph in the time column: ● heard, ◐ partly, ○ not heard.
- **"◐ 64%"** under the video; its tooltip and the **◐ Coverage** panel tab say
  **"Coverage 64% · 38 min not heard"** and list every not-heard part (≥ 10 s) with its times, length and its first
  words (verbatim). Click one to go there. "Reset" forgets this video's coverage.

## How to try it

1. 🧪 Labs → switch on **Coverage map**, open a video (or ⌘R).
2. Play a minute, press → a few times (or click further down the transcript), play again.
3. Watch the strip fill in green only where it played; the jumped-over parts stay hollow.
4. Click **◐ …%** under the video → the ◐ Coverage tab; click a not-heard part.
5. Quit Labs and open the video again: the coverage is still there.

## What to judge it on

- Is "what I haven't heard" the right question for long podcasts — would you use the list to go back?
- Is the green strip / the dots too much next to the other strips and marks?
- Should "heard at 3.5×" count the same as heard at 1×? (Now it does.)

## Known limits

- Saved in Labs' own state (`labs-state.json` in Labs' userData, key = the YouTube id) every 15 s while it changes
  and when the page goes away; a crash can lose the last ≤ 15 s.
- Starts empty for every video: what you heard before this experiment (or in the normal app) is not known.
- Heard = played while this experiment was on. Sampling (Chapter sampler) counts as heard; a sponsor skip does not.
