# Chapter sampler

**What it does.** A "Sample" mode for deciding where to spend your time: it plays the first ~30 s of every chapter
back to back, at your current speed, so you hear how each chapter actually opens (the speakers' own words, no
summary) and stop on the one worth watching. Videos without chapters are cut into 10-minute windows.

A chip on the video shows **"Chapter 4/22 · Sampling"**, the chapter title, the seconds left of this sample and
buttons ◀ ▶ · 30 s · Keep watching · ✕.

## How to try it

1. 🧪 Labs → switch on **Chapter sampler**, open a video with chapters (or ⌘R).
2. Press **▶ Sample** under the video, or **Shift+C** (click the transcript first so keys reach the page).
   It starts with the chapter you are in (if you are within its first 5 s), otherwise with the next one.
3. While sampling:
   - **→** next sample · **←** previous sample
   - **Enter** keep watching this chapter (sampling stops, playback goes on)
   - **Esc** stop and go back to where you were before sampling
   - **1 / 2 / 3 / 4** sample length 15 / 30 / 45 / 60 s (or click the "30 s" button on the chip; it is remembered)
4. After the last chapter it pauses and says "Sampled all N chapters".

## What to judge it on

- After one pass, did you know which chapters you wanted? Was 30 s the right length at your speed?
- Do chapter openings carry the point, or is it mostly the host's set-up (then a longer sample may be better)?
- Is Enter/Esc the right split (stay here vs. go back)?

## Known limits

- ←, → and Esc are taken over only while sampling; the app's 10 s seek works again after it stops.
- Keys pressed while the YouTube frame has focus do not reach Labs keys: click the transcript first (the chip's
  buttons always work).
- Seeking somewhere else yourself (a click in the transcript) stops sampling. A small forward jump made by another
  experiment (e.g. Sponsor skip at a chapter start) just moves on to the next sample.
- Chapters are YouTube's (the creator's), not the AI's.
