# 🧪 Yaseen Video Notes Labs

A separate, experimental copy of the app — **"Yaseen Video Notes Labs"** — full of features to try on real videos and
keep only what is useful. It reads the user's real vault (learning-log) but **never writes to it**.

The problem Labs explores: long podcasts (1–3 h) watched at 2–3×, too much to keep up with. The user decides for
themselves what matters and **dislikes summaries** — the speakers' exact words and framing are the value. So every AI
feature is **extractive**: the AI points at time ranges and verbatim spans of the transcript; it never rewrites what
was said. Only tiny labels (≤ 6 words) may be AI-written, and they are always shown marked as labels
(`LABS.ui.label()` → "AI label · …").

## 1. The Labs app

| | normal | Labs |
|---|---|---|
| name | Yaseen Video Notes | Yaseen Video Notes Labs |
| bundle id | `com.yaseen.videonotes` | `com.yaseen.videonotes.labs` |
| userData | `~/Library/Application Support/Yaseen Video Notes` | `~/Library/Application Support/Yaseen Video Notes Labs` |
| icon | orange (`build/icon.icns`) | blue (`build/icon-labs.icns`, made by `scripts/make-labs-icon.swift`) |
| build output | `out/`, `dist/Yaseen Video Notes.app` | `out-labs/`, `dist/Yaseen Video Notes Labs.app` |
| CLI shim | `video-notes` | `video-notes-labs` (`build/video-notes-labs`, ~/.local/bin only) |

```bash
# in electron/
npm run dev:labs           # Labs from source (VIDEO_NOTES_FLAVOR=labs electron-vite dev)
npm run build:labs         # → out-labs/
npm run cli:labs -- analyze <folder>   # the CLI from out-labs (plain Node)
npm run package:labs       # → dist/Yaseen Video Notes Labs.app
npm run install-app:labs   # package + quit a running Labs (never the normal app) + replace
                           # /Applications/Yaseen Video Notes Labs.app + open it; installs ~/.local/bin/video-notes-labs
                           # (NOT the video-notes shim)
```

**How the flavor works.** `VIDEO_NOTES_FLAVOR=labs` at build time → `electron.vite.config.ts` compiles in
`__VN_FLAVOR__ = "labs"` and writes to `out-labs/`. `package.mjs --labs` packs with a builder config that has the Labs
name / bundle id / icon (`extraMetadata.main = out-labs/main/index.js`). At start, `main/index.ts` (and `cli/index.ts`)
set the app name, the userData folder, and call `configureLabs(userData)` (`core/flavor.ts`). In the normal build the
labs branch is dead code and every Labs route / IPC returns nothing (`isLabs()` is false): the normal app is unchanged.

The UI shows it is Labs: a **LABS** badge at the right of the tab bar, a "LABS · read-only" pill under the video, the
🧪 Labs sidebar entry, a **Labs** menu (🧪 Labs Experiments… ⌘⇧L, Analyze This Video, Open Labs Data Folder).

### Read-only on the vault: ONE guard

`core/flavor.ts` → `mayWrite(path, what)` / `writable(path)`. In Labs only paths under Labs' userData are writable;
every other write is **skipped** and logged to the debug log as `read-only (labs): skipped <what> <path>`. Every
low-level write path asks it:

- `atomicWrite` (core/atomic.ts) → returns `false` when skipped. That covers notes, status (`.md` frontmatter and
  `.folder.md`), the agent guide, board order (`.video-notes-board.json`), the Feed's `subscriptions.md` /
  `feed-hidden.json`, settings migration.
- `acquireLock` (core/fileLock.ts): no `<md>.lock` is created (a lock file is a write too).
- `changeFile` (core/notes.ts): when the write was skipped it returns the file as it is (`after = before`), so the page
  never shows an unsaved note as saved.
- folder creation and setup conversion (core/folderMaker.ts) throw `ReadOnlyError` instead of writing half a folder;
  the Feed folder is never created (main/feed.ts); `migrate.ts` refuses.
- the **resume spot** is redirected, not skipped: `core/progress.ts` reads/writes `<userData>/labs-progress/<hash>.json`
  (same format), and until Labs has one for a folder it reads the real `.follow-along-progress.json` (read-only).

UI hints where a write would happen: the note composer says **"Labs is read-only — notes aren't saved"** and the toast
"Labs is read-only — note not saved"; edit / delete / resolve toasts "Labs is read-only — not saved"; a board move /
status change shows the red chip "Labs is read-only — the status is not saved".

Unit test: `core/flavor.test.ts` (notes, claims, status, board, lock files, progress redirect, make / setup refusal,
migrate; the normal flavor still writes). Verified in a Labs test instance: after opening videos, seeking, toggling,
saving a note, the vault's `git status` was clean and no file in learning-log was newer than the test start.

### Folders, "Add to Library", resume

- Sidebar default (Labs settings without `pinnedFolders`): the user's real **learning-log**
  (`~/Documents/GitHub/yaseen-docs-vault/learning-log`, read-only) + **labs-library** (`<userData>/labs-library`).
- **Add to Library / paste a link** in Labs always makes the folder in `labs-library` (window.ts `create` uses
  `Settings.forcedOutputParent`; the destination chip shows `→ labs-library` and has no menu).
- Folders that "need setup" (no `.follow-along.json`) cannot be opened in Labs (setting them up writes into the
  vault): open them once in the normal app, or add the video's link in Labs (→ labs-library).
- First launch from Finder: macOS asks once whether Labs may access the Documents folder (it is a new app). Allow it,
  or Labs cannot read learning-log.

## 2. The framework: experiments

An experiment is **one folder** `electron/src/labs/experiments/<id>/` — no edits to shared files:

| file | needed for | what |
|---|---|---|
| `meta.ts` | every experiment | `export default defineExperiment({ id, title, description, howTo, area, defaultOn, order? })` |
| `player.js` | area `player` | a page script, loaded into the player while the experiment is on; uses `window.LABS` |
| `renderer.tsx` | area `newtab` / `board` | default export: a React component rendered in that slot of the shell |
| `main.ts` | optional | main-process hooks: `export default defineMainHooks({ route, ipc })` (src/labs/hooks.ts) |

**The registry** is `src/labs/registry.ts`: it collects every `experiments/*/meta.ts` with `import.meta.glob` at build
time (so "one registry entry" = your `meta.ts`). `registryProblems()` + `src/labs/labs.test.ts` check that the id equals
the folder name, the fields are filled, and the area's file exists. The main process collects `player.js` (as text) and
`main.ts` the same way (`src/main/labs/index.ts`); the shell collects `renderer.tsx` (`src/renderer/labs.tsx`).

**On / off:** the 🧪 Labs panel (sidebar entry "🧪 Labs", or Labs → Labs Experiments… ⌘⇧L) lists every experiment
with its title, area, description, "How to try it" and a switch. Switches are saved in Labs' `settings.json`
(`labsEnabled: { id: bool }`; unset = `defaultOn`). Shell experiments switch at once; **player experiments apply to
videos opened or reloaded (⌘R) after the switch.**

### Adding a player experiment (the usual case)

```
electron/src/labs/experiments/heatmap-gutter/meta.ts
electron/src/labs/experiments/heatmap-gutter/player.js
```

```ts
// meta.ts
import { defineExperiment } from '../../experiment'
export default defineExperiment({
  id: 'heatmap-gutter', title: 'Most-replayed gutter', area: 'player', defaultOn: false,
  description: 'Marks the paragraphs YouTube viewers replay most.',
  howTo: 'Open a long video; look for 🔥 in the time column.',
})
```

```js
// player.js — plain browser JS, runs after window.LABS exists. Use ONLY the LABS API.
(function () {
  var L = window.LABS
  L.analysis.signals().then(function (s) {
    if (!s || !s.heatmap.points) return
    var g = L.transcript.addGutterLayer('heatmap')
    s.heatmap.points.filter(function (p) { return p.value > 0.7 }).forEach(function (p) {
      g.set(L.transcript.at(p.start).para, '🔥', { title: 'most replayed', onClick: function () { L.video.seek(p.start) } })
    })
  })
})()
```

That is all: rebuild (`npm run build:labs` / `package:labs`), switch it on in 🧪 Labs, open a video.

### Adding a New Tab / board experiment

```tsx
// experiments/<id>/renderer.tsx  (meta.ts: area 'newtab' or 'board')
import type { LabsSlotProps } from '../../../renderer/labs'
export default function MyThing({ area, row, rows, source, tabId, labs }: LabsSlotProps) { … }
```

- `area: 'newtab'` renders above the list / board of a New Tab (props: `tabId`, `rows` = the shown folders, `source`).
- `area: 'board'` renders inside every board card, under its notes line (props: `row` = that card's `FolderEntry`).
- Data from the main process: `window.fa.labsAnalyzed()` (analyzed videos), `window.fa.labsInfo()`, or your own
  `main.ts` → `ipc: { method(ctx, ...args) {…} }` called with `window.fa.labsCall('<id>', 'method', ...args)`.
- A crash in an experiment hides only that experiment (error boundary).
- Example: `experiments/analyzed-badge/` (a 🧪 "18 highlights" chip on analyzed cards).

### main.ts hooks (optional)

```ts
import { defineMainHooks } from '../../hooks'
export default defineMainHooks({
  // the player page: fetch('/labs/x/<id>/<path>') → JSON (or { status, type, body }); undefined = 404
  route: async (req, ctx) => ({ hello: ctx.videoId, path: req.path }),
  // the shell: window.fa.labsCall('<id>', 'count')
  ipc: { count: (ctx) => 42 },
})
```
`ctx`: `{ userData, log, videoId, title, folder, markdown, sidecar }` (video fields only in `route`). Write only into
`ctx.userData` (e.g. via `writeCache` in `src/labs/store.ts`); the vault is read-only anyway.

### Rules for experiments
- Extractive: show transcript text only via `LABS.transcript.text(span)` (or the sidecar words). Never display model
  text except a ≤ 6-word `label`, always through `LABS.ui.label()`.
- Use the `LABS` API, not player.html internals (they may change). If you need something the API lacks, add it to
  `src/labs/page/api.js` (small, documented) rather than reaching into `FA_INTERNAL`.
- Keys: `LABS.ui.addKey('k', fn)` — the app's own keys (Space S D R G Z X V N F H ? ←/→ ⇧F ⇧H) are never taken
  over. Keys pressed while the YouTube frame has focus are not forwarded for Labs keys (click the transcript first).
- State that must survive: `LABS.store('<id>').get(key) / .set(key, value)` (Labs' `labs-state.json`).

## 3. The page API (`window.LABS`, src/labs/page/api.js)

Loaded only in Labs: the session server serves player.html with `<script src="/labs/boot.js">` (the API + THE one
loader, src/labs/page/loader.js). The loader waits for player.html (`window.FA_INTERNAL` / the `fa-ready` event), reads
`/labs/config.json`, builds `window.LABS`, adds the Labs basics (read-only pill, **🧪 Analyze** button) and then loads
`/labs/x/<id>.js` for each enabled player experiment, in registry order.

A **span** is `{ startPara, startWord, endPara, endWord }` — inclusive, paragraph-local word numbers into the
`.follow-along.json` words (`paras[p].w[w]`).

```
LABS.version, LABS.flavor ('labs'), LABS.readOnly (true), LABS.config, LABS.enabled(id), LABS.log(...)
LABS.video
  time() duration() rate() speed() paused()
  seek(t, { play = true, follow = true })   play() pause() toggle() setRate(r)
  onTick(fn({ t, rate, paused, para, word, chapter }), ms = 250) → off()
LABS.transcript
  id title channel duration wordCount
  paragraphs: [{ index, turn, start, words: [...], times: [...] }]    chapters: [{ start, end, title, para }]
  text(span) → the exact words          spanTimes(span) → { t0, t1 }      at(seconds) → { para, word }
  eachWord(span, fn(p, w))   flat(p, w) / pos(flat) → [p, w]   current() → { para, word, chapter, follow }
  paraEl(p)  wordEl(p, w)   scrollTo(p, w)   (turns Follow off)
  highlightRange(span, { className = 'labs-hl', color, title }) → { remove() }
  addGutterLayer(name) → { set(p, content, { title, onClick }) → el, clear(), remove() }   (the time column)
  addPanelTab(id, label, render(container, LABS)) → { show(), refresh(), el }  (beside Chapters | Notes)
LABS.analysis
  get() → Promise<LabsAnalysis | null>   (null: not analyzed, or analyzed for another version of the transcript)
  refresh()  onChange(fn) → off   status() → { state: idle|running|done|failed, lines, error, startedAt, finishedAt }
  run({ force }) → starts the analysis in the app (one at a time)
  signals() → Promise<{ heatmap: { points | null }, sponsorblock: { segments } } | null>
LABS.ui
  toast(msg, ms)  actionToast(msg, buttonLabel, fn)  addButton({ id, label, title, onClick }) → el (the bar under the video)
  addKey(key | 'shift+key', fn, description) → false when it is one of the app's keys
  css(id, text)  el(tag, attrs, children)  fmt(seconds) → "1:02:03"   label(text) → an "AI label" element
LABS.store(experimentId) → { get(key?), set(key, value) }
```

Example of the pattern end to end: `experiments/analysis-inspector/` (a 🧪 Analysis panel tab listing the analysis,
each item with its transcript words; click = seek, hover = words marked in the transcript).

## 4. The analysis engine

```bash
video-notes-labs analyze <video folder | .md | .follow-along.json> [--force] [--model m] [--signals-only | --no-signals]
                         [--prompt-out <dir>] [--response <file>]… [--user-data-dir <dir>] [--json]
npm run cli:labs -- analyze ~/Documents/GitHub/yaseen-docs-vault/learning-log/10-22-elon-musk-…   # same, from source
```

In the app: **🧪 Analyze** under the video (or Labs → Analyze This Video); the Analysis inspector shows it. Code:
`src/labs/analysis/` — `prompt.ts` (prompt + chunks), `claude.ts` (the CLI call), `validate.ts` (validator),
`analyze.ts` (the run), `words.ts` (transcript helpers), `schema.ts` (the format).

1. **Prompt** (`prompt.ts`): the sidecar's paragraphs as `P12 [3:45] (new speaker) {0} So the … {10} next …` — a stable
   paragraph id, its time, and a word-number marker before every 10th word (half the tokens of numbering every word) —
   plus the chapters (`C3 4:33 (starts at P19) Title`; no chapters → ~10-minute windows `W0 0:00–10:00`). The model must
   return ONE JSON object with spans `[startPara, startWord, endPara, endWord]` plus `first` / `last` anchor words.
   A 2 h podcast (~25k words ≈ 35k tokens) is **one call**; above 45k words the transcript is split at chapter starts
   (else paragraphs) into chunks, asked one after another and merged.
2. **The call** (`claude.ts`): `~/.local/bin/claude -p --output-format json --tools "" --safe-mode
   --no-session-persistence --disable-slash-commands --system-prompt <extractive analyst>` with the prompt on stdin;
   default model (`--model` to choose); env without a parent Claude Code session's variables; 20 min timeout.
   `is_error` (e.g. "Not logged in") → a clear error ("run `claude` in a terminal and /login").
3. **Validation** (`validate.ts`): parse (code fences tolerated) → shape check → every span checked against the
   transcript: paragraphs that do not exist → dropped; word numbers past the end → clamped; numbers that are off are
   **moved to where the anchor words really are** (±40 words, punctuation / case ignored); reversed → dropped.
   Highlights: < 10 s dropped, > 120 s trimmed (at a sentence end when possible), overlaps → the better score wins,
   at most 20; labels cut to 6 words; enums mapped or defaulted; paragraph scores padded / cut to one per paragraph.
   Every repair is noted in `repairs`. **An unusable answer** (not JSON, wrong shape, highlights that point nowhere)
   is asked for **once more** with the error message; a second failure is the error. The app never shows model text
   (except labels): every quote is re-derived from the transcript. Stored analyses are checked against the sidecar
   (`transcript: { paras, words, hash }`); a mismatch → treated as not analyzed.
4. **Signals** (`src/labs/signals.ts`): YouTube's **"most replayed" heatmap** (yt-dlp `--skip-download
   --write-info-json` once, through the app's yt-dlp lock `whileDownloading`; the `heatmap` field, often absent) and
   **SponsorBlock** (`https://sponsor.ajay.app/api/skipSegments?videoID=<id>&categories=[sponsor,intro,outro,selfpromo,interaction]`,
   404 = none). Cached, refetched after 7 days (failures after 1 day). Fetched by `analyze`, by the Analyze button, and
   in the background ~4 s after a video opens in Labs when not cached.

### `labs-analysis.json` (schema.ts, `ANALYSIS_VERSION = 1`)

```jsonc
{
  "version": 1, "videoId": "AQnwQHMnCrE", "title": "…", "createdAt": "2026-10-24T05:05:22Z",
  "source": "claude -p", "elapsedMs": 61000, "chunks": 1,
  "transcript": { "paras": 119, "words": 6333, "hash": "…" },
  // every span below: startPara, startWord, endPara, endWord (inclusive) + t0, t1 (seconds, from the sidecar times)
  "highlights":      [{ …span, "label": "≤6 words (AI)", "why": "claim|story|number|framing|disagreement|insight|quote", "score": 1-5 }],  // 10–20, 20–120 s, no overlaps
  "paragraphScores": [{ "para": 0, "score": 0-3 }],          // every paragraph: 0 filler · 1 ordinary · 2 substantive · 3 dense
  "pullQuotes":      [{ …span, "group": 3, "groupKind": "chapter|window" }],   // 1–2 per chapter (or ~10-min window)
  "questions":       [{ "question": {…span}, "answer": {…span} | null }],       // the host's questions + where the answer starts
  "claims":          [{ …span, "type": "stat|person|company|book|claim" }],
  "mochiCandidates": [{ …span, "type": "vocab|concept|quote|person|book|stat", "label": "≤6 words (AI)" }],
  "repairs":         ["highlight 3: end moved +2 words to its anchor", …]
}
```

### Cache locations (Labs userData; never the vault)

```
~/Library/Application Support/Yaseen Video Notes Labs/
  labs-cache/<videoId>/labs-analysis.json   the analysis
  labs-cache/<videoId>/signals.json          { heatmap: { fetchedAt, points|null, error? }, sponsorblock: { fetchedAt, segments, error? } }
  labs-cache/<videoId>/info.json             trimmed yt-dlp info (title, description, chapters, heatmap, counts…)
  labs-cache/<videoId>/prompt-N.txt          the prompt(s) sent;  response-N.txt (+ -retry): the raw answers
  labs-library/                              videos added in Labs
  labs-progress/<hash>.json                  resume spots
  labs-state.json                            LABS.store data
  settings.json                              Labs' settings (labsEnabled, pinned folders, …)
```

## 5. Testing a Labs instance

- Run the packaged binary **from a shell** (not `open`), so it inherits the shell's Documents access (a fresh bundle
  launched by LaunchServices waits on the macOS Documents-folder prompt and blocks), with its own userData, muted,
  behind other windows, and a temp Feed folder:
  ```bash
  VIDEO_NOTES_FEED_DIR=/private/tmp/…/feed "dist/Yaseen Video Notes Labs.app/Contents/MacOS/Yaseen Video Notes Labs" \
    --user-data-dir=/private/tmp/…/ud --mute --inactive --remote-debugging-port=9337 --debug-log /private/tmp/…/debug.log
  ```
  Copy `labs-cache/` from the real Labs userData into the test userData to have analyses there.
- Drive it with CDP (`Runtime.evaluate` on the `http://localhost:<port>/` player target: `window.LABS…`;
  `Page.captureScreenshot` works while the window is behind others).
- The debug log shows every skipped write (`read-only (labs): skipped …`), `labs: <id> on/off`, `analyze <id>: …`.
- After a test: `git -C ~/Documents/GitHub/yaseen-docs-vault status` must be clean.

## Additions (Agent A)

Three small additions to `LABS.ui` in `src/labs/page/api.js` (block marked `// added by Agent A`), for the player
experiments `signal-strip`, `sponsor-skip`, `chapter-sampler`, `smart-speed` and `coverage-map`:

```
LABS.ui
  addRail(id, { width, title }) → { el, timeAt(clientY), setWidth(px), remove() }
      a thin vertical rail along the transcript's right edge = a minimap of the whole video (top 0:00, bottom the end).
      Rails of several experiments stand side by side; the transcript text keeps clear of them (padding follows).
  videoBadge(id) → el     a small dark badge over the top of the video, after the speed badge (empty = hidden)
  keyMode(fn(key, event) → true when used) → off()
      a temporary key handler that sees keys BEFORE the app — for a mode that needs ← / → / Enter / Esc (which
      addKey never gives out). key is lowercase ('arrowright', 'enter', 'escape', 'shift+c'); typing in inputs and
      ⌘/⌃/⌥ combos never reach it. Call off() when the mode ends.
```

The experiments (each folder has a `GUIDE.md`: what it does, how to try it, what to judge, limits):

| id | what | keys / UI | state (`LABS.store`) |
|---|---|---|---|
| `signal-strip` | rail: AI paragraph score (purple, smoothed) + YouTube "most replayed" (orange, own lane, only when present) + AI highlight ticks; hover = time, score, first words; click = seek | rail | — |
| `sponsor-skip` | auto-skips SponsorBlock sponsor / selfpromo / interaction / intro / outro; "Skipped sponsor (0:42) · Undo"; ⏭ in the time column, struck-through words | "⏭ Skip n/m" popover | `categories` |
| `chapter-sampler` | Sample mode: first 15/30/45/60 s of each chapter (10-min windows without chapters), chip "Chapter 4/22 · Sampling" | ▶ Sample, Shift+C; while sampling → ← Enter Esc 1–4 (keyMode) | `len` |
| `smart-speed` | speed by the AI score: 0–1 skim (3.5×), 3 listen (your speed), 2 halfway; smoothed over −5…+20 s, 5 levels, 2 s hold, ≥ 8 s apart, 0.25× ramp; S/D pauses it 30 s; badge "Smart 3.5× (low signal)" | A, ⚡ Smart popover | `cfg` (on, skim, listen, lastApplied) |
| `coverage-map` | what you heard (played continuously, any speed) vs skipped; rail (green = heard, hollow = not), ● ◐ ○ in the time column, "Coverage 64% · 38 min not heard", ◐ Coverage tab with the not-heard ranges | "◐ n%" button, ◐ Coverage tab | `<videoId>`: { heard: [[t0, t1]…] } |
