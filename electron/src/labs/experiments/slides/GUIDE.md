# 🖼 Slides — read a talk as a deck

**What it does.** For talks with a slide deck: finds every slide and shows it next to the transcript, so you can see
the slides (and read what was said on each) without watching the speaker. The slides are picked by **plain code, no
AI**. The slide text is read by macOS Vision (OCR) and labelled "slide text (OCR)". The words under each slide are the
transcript's exact words.

## How to try it

1. Open a talk and click **🖼 Extract slides** under the video. It takes ~30–40 s for a 45-min talk; the button shows
   `downloading… / looking… / saving… / reading text…`. Or from a terminal:
   `video-notes-labs slides <video folder> [--force] [--no-ocr]`.
   The 720p video is downloaded **into Labs' cache only** (`labs-cache/<id>/slides-tmp-…/`), looked at, and **deleted**.
   Only the images stay: `labs-cache/<id>/slides/slide-NNN.jpg` + `slides.json` (Labs' userData, never the vault).
   It runs once per video; Shift-click the button (or `--force`) to run it again.
2. **🖼 Slides tab** (beside Chapters / Notes): thumbnails with times. The slide on screen now is outlined and kept in
   view. Click = jump there. Hover = a big preview. The filter box searches the slide text (OCR), e.g. `memory`.
   `+2` = a slide built up in 3 steps; `↺ 5` = the same slide shown again (first as slide 5).
3. **Slides follow along** — **I** (or "▣ Follow along" in the tab): the big current slide takes the video's place;
   the video keeps playing small in the bottom-right corner (📹 hides it). **← / →** step to the previous / next slide
   (seeks there). **I** or **Esc** = back to the video. Double-click the slide = enlarge.
4. **Slides in the transcript**: each slide's thumbnail sits in the transcript where it first appears. Click = enlarge
   (◀ ▶, ▶ Play from here, 📖 In the deck). "☑ In transcript" in the tab switches them off.
5. **Deck reader** — **⇧I** (or "📖 Deck"): one slide at a time, large, with the words said while it was up and its
   OCR text. **← / →** or **J / K**, Home / End, **Enter** = play from this slide, **Esc** = close.

Follow along and the deck are one Labs mode (`LABS.mode` = `slides`): starting the reel, the chapter sampler or Read
mode ends them, and opening them ends those.

## How the slides are chosen (plain code: `frames.ts`, `deck.ts`)

1. **Look at every second.** ffmpeg decodes the video at 1 frame/s, shrunk to 320×180. Each frame is measured and
   kept as an 80×45 grey thumbnail.
2. **Change detection.** The thumbnail is cut into a 16×9 grid. Two frames differ when ≥ 1.2 % of the cells changed
   (a cell changed = its pixels moved by > 6/255 on average). Compression noise doesn't count; a new bullet does.
   The same grid is also the slide's identity (`hash` in slides.json is a 64-bit dHash of the thumbnail).
3. **The speaker camera in a corner.** Cells that change in more than 20 % of consecutive slide frames are the live
   camera box (picture in picture). They are left out of every comparison, so a moving speaker never looks like a new
   slide. (A "mask" bigger than 40 % of the frame means everything moves: then no mask.)
4. **Stability.** A picture counts only once it has stayed the same for **2 s**. Transitions, fades, animations and
   moving camera shots in between are skipped. The image is taken inside that still stretch, **~2 s after it settled**
   (never mid-transition), from the full 720p video.
5. **Slide or camera.** Each frame gets four numbers: flat background blocks, hard (text) edges, share of the 8 most
   common colours, soft shading (faces, rooms, photos). Slide = flat ≥ 30 %, hard edges ≥ 1.5 %, top-8 colours ≥ 70 %,
   soft ≤ 40 %; nearly all flat with no edges = blank; anything else = camera. A slide with the speaker in a corner is
   still a slide. A still stretch is what most of its frames are; only slide stretches become slides.
6. **Builds** (bullets appearing one by one). When the next picture is the previous one **plus** new content (something
   appeared where it was empty background, the title band did not change, at most 25 % of the old content moved) it is
   the same slide. **Choice: one deck entry per built-up slide, its image is the final (fullest) state**, and `steps`
   lists when each part appeared. Reading the deck you see the whole slide at once.
7. **Repeats.** The same picture right after a camera cut continues the slide. The same picture later in the talk
   (after other slides) is a new entry with `repeatOf` = the earlier slide's number.
8. **Times.** A slide starts when its first still picture starts and lasts until the next slide starts. When no slide is
   on screen for more than 2 min after it (Q&A on camera), it ends with its own picture.
9. **No slides.** Slides on screen < 20 % of the video, or fewer than 3 distinct pictures → "No slides found" (an
   interview with a few photo inserts is not a deck). No images are made then.

## slides.json

```jsonc
{ "version": 1, "videoId": "L1OBRtfPS34", "title": "…", "createdAt": "…", "elapsedMs": 36266,
  "timings": { "download": 9185, "sample": 10286, "grab": 772, "ocr": 15962 },
  "video": { "format": "136", "bytes": 24159329, "deleted": true },
  "noSlides": false, "reason": "…only when noSlides…", "ocr": { "state": "ok" | "failed" | "off", "error": "…" },
  "stats": { "frames", "slideFrames", "cameraFrames", "blankFrames", "runs", "slideRuns", "maskedCells", "builds", "repeats", "merged" },
  "slides": [{ "n": 12, "t0": 508, "t1": 604, "file": "slides/slide-012.jpg", "kind": "slide", "hash": "573d2b0b2f2e4c80",
               "steps": [{ "t0": 508, "t1": 604 }], "repeatOf": 3, "grab": 510, "text": "What the agent knows lives in files\n…" }] }
```

OCR: `ocr.swift` (VNRecognizeTextRequest, accurate) is compiled once with `swiftc -O` into
`<Labs userData>/labs-tools/slides-ocr-<hash>`; without swiftc the `swift` interpreter is tried; without Swift the
slides work and the filter box says the text is off.

## What to judge it on

- Is every slide there, once, and nothing that isn't a slide (faces, audience shots)?
- Follow along: can you listen and follow the talk from the slide alone?
- Deck reader: can you get a 45-min talk in a few minutes this way?
- Are the build groups right (one slide, final state), or would you rather see each step?

## Known limits

- Needs yt-dlp and ffmpeg (`brew install ffmpeg`); a download of the 720p video-only stream (23–50 MB for 30–45 min).
- 1 frame per second: a slide shown for less than 2 s is skipped.
- A slide that only changes in a tiny spot (one word, < 2 grid cells) can merge with the one before.
- Slides with a playing video or animation in them have no still stretch while it plays: those seconds belong to the
  slide before.
- Picture-heavy slides (full-bleed photos) can read as "camera"; photo inserts in an interview can read as "slide"
  (they are short, so the 20 % rule still says "no slides").
- Two-column slides: the OCR text reads row by row across the columns.
- No "ask Claude" check for ambiguous frames (the code alone decides).
