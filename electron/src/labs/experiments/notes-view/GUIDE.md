# 📝 Notes view (`notes-view`, player, on by default)

A **Transcript | Notes** switch at the top left of the transcript column (⇧T). Notes shows the same video, part by
part, in the same column — not a split view.

## What it does

- **Parts** = the video's chapters (a part before the first chapter is "Start"), else ~5-minute windows that start on a
  paragraph. Each part's header shows the time and title; click it to play from there. Every part folds (chevron).
- In each part, in this order:
  1. **🤖 AI notes** — notes in your notes format (`notes-format.md` from the skills folder, read fresh every run), made by
     `claude -p` one part at a time. Each bullet knows the paragraph it came from (and the word where its words are),
     so a click plays it and the current bullet lights up while the video plays. Bullets with children fold.
     **Slides** (from the `slides` experiment's `slides.json`) sit between the bullets by time, as docs-app image
     bullets: the time chip plays from the slide, the corner button / chevron folds it to a chip.
  2. **💬 Your transcript notes** of that part (read-only copies; click to play).
  3. **🧑 Yasin** — your own notes for that part: the docs app's editor (Milkdown Crepe + the docs app's add-ons).
- **Follow-along:** while the video plays the current part and AI bullet are highlighted and kept in view; scrolling
  the notes turns Follow off ("Back to now" brings it back), exactly like the transcript.
- **Switching lands on the same moment:** with Follow on, both views show the current time; with Follow off, the
  other view opens at the time under the reading line (35 % down) of the view you left.
- **Images:** double-click any image (a slide, a pasted screenshot) for the lightbox; ← / → page through every image
  in the Notes view.
- The last choice (Transcript / Notes) is remembered per video; folds too.

## How to try it

1. Open the Stanford talk (`10-27-stanford-cs146s-how-always-on-agents-work`) or the Flying Tesla episode — both
   have AI notes pre-generated in Labs' cache. Click **Notes**.
2. Play at 3×: watch the part and the bullet follow. Scroll away, then **Back to now**.
3. Click **Type your notes for this part…**: type, Enter = new bullet, Tab / ⇧Tab = indent / outdent, ⌘B / ⌘I,
   paste a screenshot (⌘V) or drop an image. The player's keys (Space, S, D, N…) do not fire while you type; Esc leaves
   the editor. "● edited" → "saved hh:mm" (autosave 0.7 s after the last key, and on leaving the editor).
4. Another video: **Write missing** (bar at the top) or **Write them** in a part. Needs `claude` logged in; otherwise it
   says "AI notes need `claude` login" and keeps what is there. **⟳ 🤖** on a part's header (hover) writes that part
   again — your 🧑 notes are never touched.

## The notes file (`<slug>.notes.md`)

One bullet-only file per video. In Labs it is `<Labs userData>/labs-cache/<videoId>/<slug>.notes.md` (Labs never
writes to the vault); the code can also put it beside the transcript (`notesPath(…, { beside: true })`).

```
# Notes — <video title>

* [12:14](https://www.youtube.com/watch?v=ID&t=734s) Firecracker VMs
   * Agent runs on its own computer = a Linux box (Firecracker VM) <!-- p:41 -->
      * Easy to snapshot the machine → shut it down → start it back up <!-- p:42 -->
   * ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 -->
   * Yasin:
      * this is why always-on agents are cheap to pause
      * ![notes-20261027-144035|400](notes-images/notes-20261027-144035.png)
```

- One optional H1, then one top-level bullet per part: `* [m:ss](url&t=Ns) Title` (the `t=` is the part's key).
- 3 spaces per level. AI bullets end with `<!-- p:N -->` (source paragraph; a child without one inherits it). Slides
  end with `<!-- slide:N -->`. Your notes are the children of `* Yasin:`; pasted images are in `notes-images/` next to
  the file (relative links; `|400` = the display width, Obsidian's syntax, as in the docs app).
- Anything else under a part (a bullet added in another app) is kept as it is.
- Writes: `withFileLock(<file>)` + `atomicWrite`, read fresh each time. Writing AI notes replaces only that part's AI
  bullets; refreshing slides replaces only slide bullets; `Yasin:` subtrees are never touched.
- Code: `notesFile.ts` (parse / serialize / merge, unit-tested), `sections.ts` (parts, bullet times), `aiNotes.ts`
  (prompt, validator), `store.ts` (paths, locked writes, slides.json), `main.ts` (routes, the AI job).

## AI notes

- Prompt = notes-format.md + the answer rules + the part's paragraphs as `P41 [12:14] …words…`
  (`labs-cache/<id>/notes-prompt-<t>.txt`; answers `notes-response-<t>.txt`).
- Validator: bullets only, any indentation; ids in the part (out of range → clamped, missing → inherited, `(P12)`
  forms accepted); bold / headers / mochi tags / non-bullet lines are **violations** → asked once more, then stripped.
  Reports paragraphs no bullet cites (mostly "Yeah." / "Okay." turns).
- Pre-generating without `claude` (what was done for the two videos):
  ```bash
  npx vite-node src/labs/experiments/notes-view/tool.ts -- prompts <video folder> <out dir>      # the exact prompts
  # answer each section-<t>.txt as section-<t>.answer.md
  npx vite-node src/labs/experiments/notes-view/tool.ts -- apply <video folder> <out dir> <userData dir>
  npx vite-node src/labs/experiments/notes-view/tool.ts -- check <notes.md>
  ```

## The editor (one Crepe per part)

One small editor per part, created when the part comes near the screen (or on click when it is empty): typing
touches a tiny document (no lag on a 1 h 44 video with 1,100 AI bullets), the AI notes stay outside any editor (they
are read-only), and each part saves on its own. Measured while the video played at 3×: keydown → next paint p50 24 ms /
p90 32 ms / max 40 ms (Event Timing) — identical to a plain `<textarea>` on the same page.

**Vendored from yaseen-docs-app** (`client/src/editor/` @ `4608f7a8`, each file says so in its first line), in `view/docs/`:
image node view (`imageView.ts/.css`, resize handles, fold button, double-click), `imageSrc.ts`, `imageOptions.ts`,
`insertImage.ts` (paste / drop of image bytes), `imageModal.css` + `imageModal.ts` (the React `ImageModal.tsx` ported to
plain DOM), collapsible bullets (`outlineFolding.ts/.css`, `listNodes.ts`, `foldCarry.ts`, `outlineFoldKeys.ts`,
`viewActions.ts`), guide lines (`guideLines.ts/.css`), the outliner keymap (`listCommands.ts`: Tab / ⇧Tab / Enter /
Backspace), `bullets.css`, and an excerpt of `app.css` (`editor.css`). Adapted with thin shims (`shims.ts`): image
writes go to this experiment's route, image srcs resolve to it, no zoom / heading folds. The two patched Milkdown
packages the docs app installs (`@milkdown/components` yaz1410, `@milkdown/plugin-tooltip` yaz2238) are in `vendor/`
and installed the same way (`file:` + `overrides`). Not loaded: BlockEdit (slash menu, drag handle), CodeMirror, tables.

The view (`view/index.ts`) is bundled by esbuild at build time (`?iife`, electron.vite.config.ts) and served as
`/labs/x/notes-view/view.js` + `view.css`; player.js loads it the first time Notes is shown.

## What to judge

- Does following along in Notes beat reading the transcript at 2–3×?
- Are the AI notes faithful enough (your words, every sentence) to trust without the transcript?
- Does the editor feel like the docs app?

## Known limits

- Bullet times are word matches inside the source paragraph (exact when the bullet keeps the speaker's words);
  a bullet that rephrases gets its paragraph's previous match.
- The AI job runs one part at a time and stops at the first failure (e.g. logged out).
- `⟳ 🤖` while you type in that part is fine (your notes are kept), but a part's AI box is redrawn when it lands.
