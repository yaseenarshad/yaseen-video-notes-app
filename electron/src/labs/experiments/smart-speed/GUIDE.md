# Smart speed

**What it does.** Rides the speed for you, using the AI signal of each paragraph: low-signal stretches (score 0–1:
filler, ordinary talk) play at a **skim** speed (default 3.5×), dense ones (score 3) at your **listen** speed (by
default the speed you were at when you first turned it on), substantive ones (2) about halfway between.

It is made not to thrash:
- it averages the score over the next ~20 s (and the last 5 s), so one short paragraph never moves the speed and it
  starts slowing down a little before a dense stretch;
- only 5 levels (listen, ¼, ½, ¾ of the way, skim); a new level must hold for 2 s, and at least 8 s pass between
  changes;
- each change ramps in 0.25× steps (one every 0.35 s) instead of jumping.

The badge on the video shows what it is doing: **"Smart 3.5× (low signal)"**, "Smart 2.5× (dense)".
Pressing **S / D** (or R / G) yourself pauses it for 30 s ("Smart paused · 24 s"), then it takes over again.

## How to try it

1. 🧪 Labs → switch on **Smart speed**, open an analyzed video (or press **🧪 Analyze** first).
2. Set your normal speed (e.g. 2.5×), then press **A** (click the transcript first) or click **⚡ Smart** → On.
3. Play. Watch the badge and the speed number on the video change as the talk gets denser or thinner.
4. Click the badge (or ⚡ Smart) to change **Skim** and **Listen** (− / +, or "now" = the current speed).
5. Press **D** once: it says it is paused for 30 s. Press **A** again to turn it off: your listen speed comes back.

## What to judge it on

- Does it slow down at the moments you would have slowed down yourself, and early enough?
- Does it ever feel jumpy? (It should change at most every ~8 s, in small steps.)
- Is 3.5× a good skim speed, or do you miss things at it?

## Known limits

- Needs the analysis (paragraph scores). Without one the badge says "Smart: analyze first" and nothing changes.
- On/off and the speeds are remembered for every video (Labs' own state, never the vault).
- The speed it sets is saved as the video speed like any S/D change; if you quit while it skims, the next video
  starts at that speed — smart mode (or turning it off with A) gives your listen speed back.
- Uses the A key; if another experiment also takes A, the one loaded last wins.
