# 📝 Notes view (`notes-view`, player, on by default)

A **Transcript | Notes** switch at the top left of the transcript column (⇧T). Notes shows the same video, part by
part, in the same column — not a split view.

## What it does

- **Parts** = the video's chapters (a part before the first chapter is "Start"), else ~5-minute windows that start on a
  paragraph. Each part's header shows the time and title; click it to play from there. Every part folds (chevron).
- In each part:
  1. **One editor** (the docs app's Milkdown Crepe + its add-ons) holding the **🤖 AI notes** — notes in your notes
     format (`notes-format.md` from the skills folder, read fresh every run), made by the Labs AI engine (Codex ·
     gpt-6.1-sol by default, or Claude — 🧪 Labs panel) one part at a time, **automatically when you open a video**
     that has parts with no notes (a chip "🤖 Writing notes 4/12 · Codex" shows progress; parts appear as they finish) —
     the **slides** (from the `slides` experiment's `slides.json`, as docs-app image bullets at 400 px, between the
     bullets by time) **and your own words**. Type anywhere: Enter after a bullet = a new bullet (at the end of a bullet
     with children: its first child), Tab = make it a child, type inside an AI bullet to add words in the middle.
     **A bullet you write or change gets a small "Yaseen" chip** (stored as the tag `#yaseen`, the first token of the
     bullet's text; your words themselves stay plain). AI bullets are yours to edit
     too: reword, delete words or whole bullets, merge (Backspace at the start) or split (Enter in the middle).
  2. **💬 Your transcript notes** of that part (read-only copies; click to play).
- **Sync rides on the bullet, not its text:** every AI bullet carries its source paragraph (`p:N`, a node attribute
  read from / written to a hidden `<!-- p:N -->`). Editing or rewording keeps it; a merge keeps the first bullet's;
  both halves of a split keep it; copy / paste inside the editor keeps it; deleting the bullet drops it. A bullet you
  add with Enter has none. The time chip at the end of a bullet (shown on hover, always on slides) plays it.
- **✎ = you edited this AI bullet** (it differs from what the AI wrote). Hover ✎: "You edited this note", the AI's
  original, and **Restore original** (the AI's text again; the `#yaseen` tag goes too). The originals live in the
  sidecar `<slug>.notes-ai.json` (written when AI notes are written; for older files made on first load from the
  bullets that have `p:N` and no `#yaseen` / `==`).
- **💬 notes from the Notes view** (written to the TRANSCRIPT .md through the player's own composer and locked note
  write — General / 🃏 Mochi pills, ×, Enter saves; Labs shows its "read-only — notes aren't saved" hint):
  - **Right-click a bullet** → "💬 Add note…", "🃏 Add Mochi note…" (and on your own bullet "🃏 Make Mochi note",
    prefilled with its text). The note goes under the bullet's paragraph (your bullet: the nearest bullet above with
    one; a slide: the slide's time). With words selected inside an AI bullet that are found in that paragraph, it is a
    note on those words (range + the transcript's exact words as the quote), else at the paragraph's start.
  - **`/mochi` or `/note`** in any bullet → a tiny menu (filter as you type, ↑↓, Enter / Tab, Esc). Picking one
    removes the command and opens the composer prefilled with the bullet's text (no `#yaseen` tag, no command).
  - A sent bullet gets a 🃏 / 💬 badge (`<!-- note:<id> -->`, core/notes.ts id); click it to play the note. The 💬
    mirrors update at once.
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
3. Click into any part and type: after a bullet (Enter), as a child (Tab), inside an AI bullet. The bullet gets a "Yaseen" chip;
   ✎ appears on AI bullets you changed. ⌘B / ⌘I, paste a screenshot (⌘V) or drop an image. The player's keys (Space,
   S, D, N…) do not fire while you type; Esc leaves the editor. "● edited" → "saved hh:mm" in the part's header
   (autosave 0.7 s after the last key, and on leaving the editor).
4. Right-click a bullet (or select a few words in it first) → Add note…; or type `/mochi` at the end of a bullet.
5. Another video: **Write missing** (bar at the top: parts with no AI notes that you have not written in) or **Write
   them** in a part (by hand; also lifts a usage-limit pause). If the engine is not signed in it says so ("run `codex
   login`") and keeps what is there.
   **⟳ 🤖** on a part's header (hover) writes that part again; when you touched the part it asks first ("This part has
   your notes. Rewrite the AI notes and keep yours attached?").

## The notes file (`<slug>.notes.md`) + the originals (`<slug>.notes-ai.json`)

One bullet-only file per video. In Labs it is `<Labs userData>/labs-cache/<videoId>/<slug>.notes.md` (Labs never
writes to the vault); the code can also put it beside the transcript (`notesPath(…, { beside: true })`).

```
# Notes — <video title>

* [12:14](https://www.youtube.com/watch?v=ID&t=734s) Firecracker VMs
   * #yaseen Agent runs on its own computer, my own words = a Linux box (Firecracker VM) <!-- p:41 -->
      * #yaseen a child I typed
      * Easy to snapshot the machine → shut it down → start it back up <!-- p:42 --> <!-- note:k3j9a0b -->
   * ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 -->
   * #yaseen my own bullet
      * ![notes-20261027-144035|400](notes-images/notes-20261027-144035.png)
```

- One optional H1, then one top-level bullet per part: `* [m:ss](url&t=Ns) Title` (the `t=` is the part's key).
- 3 spaces per level. `<!-- p:N -->` = the transcript paragraph the bullet follows (sync). A bullet without one is
  yours (or a hand edit). **`#yaseen`** as the FIRST token of a bullet's text (before any `1) ` numbering) = you wrote
  this bullet or changed it in any way (typed, pasted, deleted words, merged, split); the exact change stays visible
  through ✎ and the `.notes-ai.json` originals. Added automatically on your first edit of a bullet (in the same undo
  step, so ⌘Z takes it back), never by the app's own edits (regeneration, migration, restore); an AI bullet whose
  words equal the original again loses it. **Legacy `==…==`** (the first inline version highlighted your words) is read
  forever: on load the marks go and the bullet gets `#yaseen`; the new form is written on the next save.
  An AI bullet whose text differs from its original in the sidecar was edited by you. `<!-- note:<id> -->` = sent as a
  💬 transcript note. Slides end with `<!-- slide:N -->`; a heading made from a slide's title adds
  `<!-- slide-title:N -->` after its `p:N`, slide-only text `… (slide) <!-- p:N --> <!-- slide:N -->`.
  **Name corrections:** `Palmer Luckey <!-- was: Palmer Lucky -->` = a person / company / product / book name the
  model corrected from its own knowledge (fixes from slides, title, chapters, description carry no mark), anywhere in
  the text, right after the name. The name = the capitalised words right before the marker (`nameBefore`: "Then" /
  "The" or a word ending a clause never belong to it; a lowercase term takes as many words as the captions' spelling).
  In the editor it is a mark on the name (`view/wasMark.ts`, not inclusive): typing next to it leaves it alone, deleting
  the name deletes the marker; dotted underline, tooltip "Captions said: Palmer Lucky". In the Transcript view the
  captions' spelling gets the same underline, tooltip "Likely: Palmer Luckey (from the notes)" (`GET hints` →
  `LABS.transcript.highlightRange`; display only — the transcript and its .md never change). Pasted images are in `notes-images/` next to the file
  (relative links; `|400` = the display width, Obsidian's syntax, as in the docs app).
- **Legacy:** the first version kept your notes under a `* Yasin:` bullet at the end of the part. Such files still
  load: those bullets show inline at the end of the part as `#yaseen` bullets and are written that way on the next
  save of that part (or the next AI rewrite of it). Never lost.
- `<slug>.notes-ai.json`: `{ "version": 1, "parts": { "<part t>": { "<p>": ["AI text", …] } } }` — per part and
  paragraph, the AI's texts in document order. Each AI bullet is matched to an original of its paragraph (exact text
  first, then in order), which drives ✎ / Restore and "touched".
- Writes: `withFileLock(<notes.md>)` + `atomicWrite`, read fresh each time (the sidecar under the same lock). A save of
  a part sends the part's signature; a part that changed meanwhile (an AI rewrite landed) answers 409, your version is
  kept as `labs-cache/<id>/notes-conflict-<t>-<time>.md` and the part reloads.
- **Regenerating** (`setAiNotes`) keeps everything you touched: your bullets, and every AI bullet of a paragraph in
  which you edited a bullet (`#yaseen`, reworded, legacy `==`, no original, sent as a note — the paragraph is "pinned": its new AI bullets
  are not added, so your version is never doubled). Only untouched AI bullets are replaced. Kept bullets re-attach by
  `p:N`: after the last new bullet with that paragraph or the nearest earlier one; your own bullets by the paragraph
  of the bullet above them (previous sibling, else parent); none earlier → top of the part. "Write missing" skips
  touched parts; refreshing slides replaces only slide bullets.
- The editor's markdown is the file's part with transport fields in the markers (`<!-- p:41 t:738.5 o:3 -->`: time,
  original's index); `setPart` drops them, takes out the escapes the editor adds that the text never needed (`1\)` at
  the start, `Q\&A`, a leading `\=`) — measured: both pre-generated files (410 / 1,099 bullets) round-trip through the
  editors byte-identically.
- Code: `notesFile.ts` (parse / serialize / merge / originals, unit-tested), `checks.ts` ("nothing lost" checks,
  unit-tested), `noteTarget.ts` (bullet → 💬 note:
  paragraph, time, quote, text; unit-tested), `sections.ts` (parts, bullet times), `aiNotes.ts` (prompt, validator;
  an AI text never contains `==`), `store.ts` (paths, locked writes, sidecar, slides.json), `main.ts` (routes, the AI
  job).

## AI notes

- **Prompt** (`aiNotes.ts buildNotesPrompt`, inputs gathered by `store.ts promptContext`):
  - notes-format.md (with its "Video notes: outline, cleanup, punch" section) and the "Aim for card prose…" + "Use
    direct verbs and short sentences…" paragraphs of `skills-global-yaseen/mochi/card-making/principles.md` — both
    read fresh on every run (`VIDEO_NOTES_NOTES_FORMAT` / `VIDEO_NOTES_PRINCIPLES` override the paths).
  - **Slides** (`labs-cache/<id>/slides.json`, real slides only): number, t0–t1, title (first OCR line) and the full OCR
    text of each slide shown during the part → slide-title headings at the slide's time, the speaker's points nested.
  - **No slides** (most podcasts): the YouTube chapter of the part, the host's questions in it from the Labs analysis
    (`labs-analysis.json` questions; no analysis → the model finds them), topic-shift headings named with the
    speaker's own key phrase.
  - **Spelling sources**: video title, chapter titles, YouTube description (`labs-cache/<id>/info.json`; fetched once
    with yt-dlp and cached when missing).
  - The part's paragraphs as `P41 [12:14] …words…` (`labs-cache/<id>/notes-prompt-<t>.txt`; answers `notes-response-<t>.txt`).
- **Answer / file markers**: every bullet `<!-- p:N -->`; a heading from a slide's title adds `<!-- slide-title:N -->`
  (the Notes view shows 🖼 before it, and the slide picture sits right before that heading); slide text the speaker never
  said ends ` (slide)` and adds `<!-- slide:N -->` after its paragraph marker.
- **Validator**: bullets only, any indentation; ids in the part (out of range → clamped, missing → inherited, a slide
  bullet without one → the paragraph at its slide's start, `(P12)` forms accepted); slide markers must name a slide of
  the part; `(slide)` added when missing; `==` escaped (it would read as legacy user words); bold / headers / mochi tags /
  non-bullet lines are **violations** → asked once more, then stripped.
- **"Nothing lost" checks** (`checks.ts`, code, unit-tested; a ⚠ line under the part's header, click to open; never
  blocks saving): coverage (every paragraph with real content — not filler-only like "Yeah." / "[applause]" — cited
  by a `p:N`; uncovered ones as clickable times), numbers and names (every number and capitalised name / proper noun
  of the part's paragraphs appears in its notes; a spelling taken from the sources is fine, letters only, ~40 % edits),
  format, and "cut, don't rewrite" (a bullet with under 70 % of its content words in its source paragraph ± 1 or its
  slide → "may be reworded"; a corrected name counts as the captions' words). A caption spelling corrected with
  `<!-- was: … -->` is not missing; corrected names show as an info line "ℹ N corrected names".
- **Compare with previous notes**: when `<slug>.notes.v1.md` exists beside the notes file, the bar has "🕘 Compare
  with previous notes": every part switches to the previous version (read-only) and back.
- **Engine and automatic jobs:** see docs/labs.md "The AI engine". The job runner (`main.ts`): one job per video,
  parts one after another, at most 2 videos at a time, an automatic job only fills parts with no AI notes that you did
  not touch (checked again before each part) and stops when "Write AI notes automatically" goes off or a usage limit
  pauses the engine; the next open resumes the missing parts.
- **Measured with Codex** (gpt-6.1-sol, effort medium; "The only SaaS moats left in 2026", 39.8 min, no chapters →
  8 parts): written automatically on open in 120 s (11.9–16.7 s per part, one after another), 499 bullets, 12.7 words
  per bullet, coverage 100 %, 0 numbers / names missing, 0 format problems, 3 "may be reworded"; the analysis alongside
  in 62 s. Tokens: ~35k in per part (≈13–24k of them cached — Codex's own instructions), ~1.5k out; the whole video ≈
  280k in / 17k out for the notes + 39k in / 5.6k out for the analysis.
- Pre-generating without an engine (what was done for the Stanford and Tesla notes, twice):
  ```bash
  npx vite-node src/labs/experiments/notes-view/tool.ts -- prompts <video folder> <out dir> <userData dir>   # the exact prompts
  # answer each section-<t>.txt as section-<t>.answer.md; check one without writing anything:
  npx vite-node src/labs/experiments/notes-view/tool.ts -- try <video folder> <out dir> <userData dir> <t>
  npx vite-node src/labs/experiments/notes-view/tool.ts -- apply <video folder> <out dir> <userData dir> --keep-v1
  npx vite-node src/labs/experiments/notes-view/tool.ts -- check <notes.md> [<video folder> <userData dir>]
  npx vite-node src/labs/experiments/notes-view/tool.ts -- compare <old.md> <new.md> <video folder> <userData dir>
  ```
- **The remake (v2, 2026-10-27)**, answered by Claude subagents following the prompts, run through the validator and
  checks; the first notes are `<slug>.notes.v1.md`:

  | | Stanford (slides) v1 → v2 | Flying Tesla (podcast) v1 → v2 |
  |---|---|---|
  | AI bullets | 410 → 405 | 1,099 → 946 |
  | words per bullet | 16.2 → 15.7 | 12.9 → 14.2 |
  | coverage (real paragraphs) | 100 % → 100 % | 90.2 % → 98.2 % |
  | numbers / names missing | 0 → 0 | 45 → 28 (all spelling fixes the sources do not confirm, e.g. Palmer Lucky → Luckey) |
  | "may be reworded" | 0 → 0 | 49 → 12 (all from name fixes) |
  | slide-title headings / (slide) bullets | 0 / 0 → 43 / 42 | — |

  Then the general-knowledge name fixes got their `was:` markers (Tesla: 29 — Moore's, Franc, Nicolas Appert, Greg
  Maryniak, Lindbergh ×3, St. Louis, Raymond Orteig, Le Bourget, Schelling ×2, Global Learning XPRIZE ×2, Palmer
  Luckey, Visioneering ×6, Martine Rothblatt, Steven Kotler, Ilya Sutskever, Mundie, VoiceRun, Sadhguru ×2, Maslow;
  Stanford: none — its fixes came from the slides and the description): missing numbers / names 28 → 14 (left: caption
  fragments like "X-P", and fixes from the sources the letter match does not catch, e.g. Sling → Salim).

## The editor (one Crepe per part)

One editor per part (`view/partEditor.ts`), created when the part comes near the screen (600 px ahead); until then
the part is a static copy in the same Crepe list DOM (a click opens the editor there). Each part saves on its own.
Measured (packaged Labs, Stanford, 3× playback, typing at the end of a bullet): keydown → next paint (Event Timing)
p50 16 ms / p90 24 ms / max 24 ms; mounting a part's editor 22–200 ms (Flying Tesla, 15 parts, 1,099 bullets).

- List item **attributes** `nvP` / `nvSlide` / `nvT` / `nvO` / `nvNotes` (+ `data-nv-*` DOM attributes, so copy / paste
  keeps them), read from and written to the bullet's trailing comments. A new empty bullet that copied a marker another
  bullet still has (Enter at the end) drops it.
- **`#yaseen`:** an appendTransaction, in the same history step as the edit, sets the list item's `nvYaseen`
  attribute when a user transaction changes the item's first block (compared with the item before the transaction:
  so Tab / ⇧Tab never tag); the app's edits (`NO_MARK`) and undo / redo never add it; an AI bullet equal to its
  original again loses it. Serialized as raw `#yaseen` first (never escaped); a chip widget shows it. The docs app's
  highlight mark is still loaded for old `==` text (legacy).
- **Decorations only** (nothing ProseMirror would wipe): the current bullet (follow-along) is a node decoration on the
  list item; the time chip, ✎ and the note badges are widgets.
- `/mochi`, `/note`: the editor's only slash menu (BlockEdit is not loaded).

**Vendored from yaseen-docs-app** (`client/src/editor/` @ `4608f7a8`, each file says so in its first line), in `view/docs/`:
image node view (`imageView.ts/.css`, resize handles, fold button, double-click), `imageSrc.ts`, the highlight mark
(`highlight.ts` syntax + schema only, `htmlPairs.ts`), `imageOptions.ts`,
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

- Bullet times are word matches inside the source paragraph (of the AI's original text when there is one).
- The AI job runs one part at a time and stops at the first failure (e.g. logged out). While a part is being
  rewritten its editor is read-only.
- Milkdown drops an image whose mdast `title` is null (the commonmark schema wants a string): `partEditor.ts` clears
  it first — without that, slides and pasted screenshots vanished on load (the first version's 🧑 editor parsed the same
  way, so its saved screenshots most likely did not show after a reload).
- In Labs every 💬 note says "read-only" (the transcript is in the vault); the note is really written only for a video
  in `labs-library` (Labs' own folder) — that is how the composer flow was verified.
- A slide bullet you indent under another bullet is kept as text; a later slides.json change adds the slide again.
