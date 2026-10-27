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

### Additions (Agent B2)

Two small additions to `src/labs/page/api.js` (marked `// added by mochi-candidates`):

```
LABS.notes() → [{ id, para, time, end, t, text, quote, category: 'general'|'mochi', resolved }]   the user's notes as the
               player shows them (read-only copies, by time; time null = a note without a time)
LABS.ui.copy(text)   text → the system clipboard (the app's own copy message, like right-click → Copy note)
```

Experiments using them: `mochi-candidates` (marks candidates you already noted; "Copy note line" / "Copy all").
In tests, stub the clipboard with `LABS.ui.copy = (t) => …` (experiments call it at click time).

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

## Additions (Agent B1)

Two small additions to `src/labs/page/api.js` (each marked `// added by …` in the code):

```
LABS.video.box()            → the 16:9 element that holds the YouTube frame (added by highlight-reel). Restyle it
                              (e.g. position: fixed for a focused layout); never move it in the DOM — that reloads the frame.
LABS.transcript.scroller()  → the scrolling transcript column (added by dense-mode). Its parent is position: relative,
                              so floating UI can sit over the transcript (absolute, like the A−/A+ tools).
```

Experiments by Agent B1 (each folder has a `GUIDE.md`): `highlight-reel` (▶ Reel, key E), `pull-quotes` (❝ Quotes tab,
Read mode ⇧Q), `dense-mode` (▤ Dense, ⇧U). While the reel or Read mode is open they take the keyboard with a
capture-phase `keydown` listener (and give it back when closed), because their keys (↑ ↓ ← → Space Esc Enter) are app keys
that `LABS.ui.addKey` never takes over.

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

## Additions (Agent C)

Three shell experiments (triage), six more analyses, and three small shared hooks — each shared edit is commented
`// added by <id>` in the code.

### The Labs launch flag: `#labs=<flag>` (added by triage-cards)

A shell experiment can open a video so that its player experiments know *why* it was opened:

```ts
const s = await window.fa.state()
window.fa.openFolder(s.active!, folder, 'labs=reel')   // 3rd argument: the hash, Labs only
```

- The player page loads at `http://localhost:<port>/#labs=reel` (several flags: `#labs=reel,x`). Only `labs=[a-z0-9,-]`
  passes (`window.ts` `launcher:open`), and only in Labs; the normal app ignores it.
- When that video is **already open**, its tab is shown and the hash is set again (`history.replaceState` + `location.hash`),
  so the page gets a `hashchange` — read it with `LABS.launch.onChange`.
- ⌘R (Reload Video) reloads without the hash.
- Page API (`api.js`): `LABS.launch.flags()` → `['reel']` · `.has('reel')` · `.onChange(fn(flags))` → off · `.clear()`.
- **`reel`** = "open straight into the highlight reel": sent by the triage-cards ▶ Reel button and the Triage queue's `→`.
  A highlight-reel player experiment should check `LABS.launch.has('reel')` once at start (after `LABS.analysis.get()`)
  and in `LABS.launch.onChange`.
- Plumbing: `shared/api.ts` + `preload/shell.ts` (`openFolder(tabId, path, hash?)`), `main/window.ts` (`openFolder` →
  `runWork` → `openPlayer(t, replacing, hash)`), `main/session.ts` (`SessionOptions.hash` → `loadURL(pageURL + '#' + hash)`).

### A fourth slot area: `'feed'` (added by feed-triage)

`area: 'feed'` renders `renderer.tsx` inside every 📺 Feed row (under its channel / date line), with the prop
`feedItem: FeedItem` (`<LabsSlot area="feed" feedItem={i} />` in `renderer/Feed.tsx`). Edits: `ExperimentArea` in
`labs/experiment.ts`, the allowed areas in `registryProblems()`, `LabsSlotProps.feedItem` + the panel's area name in
`renderer/labs.tsx`.

### The experiments

| id | area | what |
|---|---|---|
| `triage-cards` | board | analyzed cards: "🎬 18 highlights · 21 min", signal % (paragraphs scored 2–3), top 2 pull quotes verbatim (2 lines, click to expand), ▶ Reel (`#labs=reel`) |
| `triage-queue` | newtab | 🎯 Triage bar ("12 to triage") → one-at-a-time queue of un-started videos (Backlog / Todo / none; optional "+ barely started" = In progress < 10 %): pull quotes, or chapter openings when not analyzed. Keys → reel · ↓ skip · D done · ⏎ open · ↑ back · Esc. Labs-local state in `labs-state.json` → `triage-queue` |
| `feed-triage` | feed | "Preview pull quotes" per Feed video, on click only: captions → `labs-cache/<id>/feed-preview.follow-along.json`, chapter titles + first sentences verbatim (no AI) at once, AI pull quotes when `claude -p` works |

Each folder has a `GUIDE.md` (what it does, how to try it, what to judge, known limits). The shared logic is
`experiments/triage-cards/digest.ts` (+ `digest.test.ts`): ranked verbatim pull quotes, highlight minutes, signal %,
chapter openings (the non-AI fallback). triage-queue and feed-triage import it.

### More analyses (Labs userData, `labs-cache/<id>/labs-analysis.json`)

`claude -p` was logged out, so the answers were written by Claude Code sub-agents from the exact prompt
(`analyze --prompt-out`) and run through the real validator (`analyze --response`); the spans' word numbers were
computed from verbatim phrases by a helper, so no anchor repairs were needed. Signals were fetched by the same run.

| video | id | highlights | pull quotes | repairs | signals |
|---|---|---|---|---|---|
| Zuckerberg's $100 Billion Bet | XfdIhd1g6EI | 19 | 23 | 5 (questions > 120 words dropped) | heatmap none · SponsorBlock 5 |
| CoreWeave Crash… | _b3LfMflIGs | 18 | 11 | 1 (a flashcard > 90 words dropped) | none · 1 |
| The Frontier Ideas a16z… | -9XQMHhpypc | 17 | 21 | 2 (flashcards > 90 words dropped) | none · 0 |
| OpenAI Bulk-Solves 722 Math Problems… | A5YVqEpbgaU | 18 | 29 | 0 | none · 6 |
| Charlie Munger's Final Interview (labs-library) | H5Oom5Rjp_Y | 20 | 53 | 2 (pull-quote chapter regrouped / dropped) | heatmap 100 points · 0 |
| Anthropic Rebuilt Git (labs-library) | hiI0Vk4NgeY | 17 | 21 | 2 (pull-quote chapter regrouped / dropped) | none · 1 |

## Additions (integration pass)

One shared flag in `src/labs/page/api.js` (marked `// added by labs-integration`), so the experiments that take over
the player never run at the same time:

```
LABS.mode
  enter(name, endFn)   start a mode; the mode that is on is ended first (its endFn is called: stop quietly, no seek)
  exit(name)           the mode ended by itself       current() → 'reel' | 'sample' | 'read' | null
  onChange(fn(name | null)) → off
```

| mode | who | while it is on |
|---|---|---|
| `reel` | highlight-reel | smart-speed gives your speed back and waits; sponsor-skip and dense-mode's "skip hidden" stand still |
| `sample` | chapter-sampler | smart-speed waits; dense-mode's "skip hidden" stands still; sponsor-skip still skips (the sampler then samples from where it landed) |
| `read` | pull-quotes Read mode | (an overlay; the video is not driven) |

Starting one ends the other: E (or a board ▶ Reel / `#labs=reel`) during sampling or Read mode, ⇧C during Read mode,
⇧P during sampling. Inside the reel and Read mode their own key handlers keep the other Labs keys out.

## Additions (slides)

The `slides` experiment (player, on by default; `experiments/slides/`, details in its `GUIDE.md`): finds a talk's
slides with **plain code (no AI)**, then shows them in four ways — a 🖼 Slides tab, "slides follow along" (I), slide
thumbnails inside the transcript, and a deck reader with the words said on each slide (⇧I).

**Extraction** (`extract.ts`, run by "🖼 Extract slides" under the video or `video-notes-labs slides <folder> [--force]
[--no-ocr]`): yt-dlp downloads the 720p video-only stream (`136/247/398/bestvideo[height<=720]`, under the yt-dlp lock,
429 retried) into `labs-cache/<id>/slides-tmp-…/`; ffmpeg decodes it at 1 frame/s (320×180); `frames.ts` + `deck.ts`
choose the slides; ffmpeg saves one 720p JPEG per slide; **the video is deleted** (also after an error); macOS Vision
reads each slide's text (`ocr.swift`, compiled once into `<userData>/labs-tools/`). Cached in
`labs-cache/<id>/slides.json` + `labs-cache/<id>/slides/slide-NNN.jpg`.

How slides are chosen, in plain words:
1. **Change detection** — each frame's 80×45 grey thumbnail on a 16×9 grid; two frames differ when ≥ 1.2 % of the cells
   changed by > 6/255 (a small perceptual hash; noise doesn't count, a new bullet does).
2. **Speaker camera (picture in picture)** — grid cells that change in > 20 % of consecutive slide frames are masked out.
3. **Stability** — a picture counts once it stays the same for 2 s; the image is taken ~2 s after it settled.
4. **Slide vs camera** — flat background, hard text edges, few colours, little soft shading → slide (a speaker box in a
   corner is fine); otherwise camera; camera stretches never become slides.
5. **Builds** — the previous slide plus new content (in empty space, title unchanged) = the same slide; one entry, the
   final (fullest) image, `steps` = when each part appeared.
6. **Repeats** — the same picture later in the talk = a new entry with `repeatOf`.
7. **No slides** — slides < 20 % of the video or < 3 pictures → "No slides found".

Results: Stanford CS146S "How always-on agents work" (L1OBRtfPS34, 45 min, slides + speaker box) → 46 slides in ~36 s
(download 24 MB 8–9 s · look 10–13 s · save 1 s · OCR 13–16 s incl. the one-time compile); "Harness Engineering on
Rails" (L6-3a_rwLIg, 32 min, slides + camera cuts) → 80 slides (5 build steps grouped, 8 repeats) in ~28 s; the Elon
Musk interview (AQnwQHMnCrE) → "no slides found" (slides 1 % of the video) in ~13 s.

Shared-file edits (each commented `// added by slides`):

```
LABS.transcript.addInlineCard(p, w, node) → { el, remove() } | null
    a block card inside paragraph p, just before its word w — like a note card: the words stay one run, no paragraph
    element is created. Put NO text nodes in it (title / CSS attr() labels), so a copied selection never picks it up.
    CSS class labs-icard (display block, not selectable).
```
- `src/labs/page/api.js` — `addInlineCard` and its one CSS line.
- `src/cli/run.ts` — the `slides` command (`experiments/slides/cli.ts`).

| mode | who | while it is on |
|---|---|---|
| `slides` | slides follow along / deck reader | ← → (J K Enter Esc in the deck) step slides; the video keeps playing (follow along: small in a corner; the deck: hidden) |

## Additions (notes-view)

The `notes-view` experiment (player, on by default; `experiments/notes-view/`, details in its `GUIDE.md`): a
**Transcript | Notes** switch at the top left of the transcript column (⇧T). Notes = the video part by part (chapters,
else ~5-minute windows on paragraph boundaries). Each part is ONE editor (the docs app's Milkdown Crepe + its vendored
add-ons) holding the 🤖 AI notes in the user's notes format (`claude -p`, one part at a time, notes-format.md read fresh
each run), the part's slides (from `slides.json`) and the user's own words — typed or pasted text is highlighted
automatically and stored as `==…==`; AI bullets can be reworded, merged, split or deleted (✎ + "Restore original"
from the `.notes-ai.json` sidecar). Every AI bullet keeps its source paragraph as a node attribute (`<!-- p:N -->`),
so it plays on click and lights up during playback whatever its text. Below, the part's 💬 transcript notes
(read-only mirror). Right-click a bullet or type `/mochi` / `/note` to make a real 💬 transcript note (the player's
own composer, written to the transcript .md; read-only hint in Labs). Follow / Back to now work as in the transcript;
switching views lands on the same moment.

### The notes file: `<slug>.notes.md` (+ `<slug>.notes-ai.json`)

Labs: `labs-cache/<videoId>/<slug>.notes.md` (+ `notes-images/` for pasted images; slide srcs point at `slides/`;
the AI's originals in `<slug>.notes-ai.json`). The same code can write it beside the transcript for the normal app
(`notesPath(…, { beside: true })`).

```
# Notes — <video title>

* [12:14](https://www.youtube.com/watch?v=ID&t=734s) Firecracker VMs
   * Agent runs on its own computer ==my own words== = a Linux box (Firecracker VM) <!-- p:41 -->
      * ==a child I typed==
      * Easy to snapshot the machine → shut it down → start it back up <!-- p:42 --> <!-- note:k3j9a0b -->
   * ![Slide 12 · 12:20](slides/slide-012.jpg) <!-- slide:12 -->
   * ==my own bullet==
```

Bullets only (one optional H1), 3-space indents; a part = `* [m:ss](url&t=Ns) Title`; `<!-- p:N -->` = the paragraph
a bullet follows; no marker = the user's own bullet; `==…==` = the user's words; `<!-- note:<id> -->` = sent as a 💬
transcript note; slides end with `<!-- slide:N -->`. The first version's `* Yasin:` subtree (the separate editor) is
legacy: still read, shown inline at the end of its part and written in the inline form on the next save. Every write:
`withFileLock` + `atomicWrite`, read fresh. Regenerating a part keeps every bullet the user touched (and the AI bullets
of any paragraph where they edited one) and re-attaches them by `p:N`; "Write missing" skips touched parts; slides.json
changes replace only slide bullets (unit tests: `notesView.test.ts`). Pre-generated with `claude` logged out (prompts
dumped, answered by hand, run through the real validator: `tool.ts prompts | apply | check`): Stanford CS146S
(L1OBRtfPS34, 10 parts, 410 bullets) and the Flying Tesla episode (dthaDyttHns, 15 parts, 1,099 bullets), in the real
Labs cache; both round-trip through the editors byte-identically.

**Generation (v2):** the prompt also gets the concise-writing paragraphs of the Mochi skill's principles.md (read
fresh), the part's slides (title = first OCR line, OCR text, t0–t1) or — with no slides — the chapter and the host's
questions (Labs analysis), and the spelling sources (title, chapters, YouTube description from `info.json`, fetched
once when missing). New markers: `<!-- slide-title:N -->` (a heading from a slide's title; the Notes view shows 🖼) and
`… (slide) <!-- p:N --> <!-- slide:N -->` (slide-only text). Deterministic "nothing lost" checks (`checks.ts`: coverage,
numbers and names, format, "cut, don't rewrite") show as a ⚠ line per part. Both pre-generated videos were remade (v2)
and the first notes kept as `<slug>.notes.v1.md`; "🕘 Compare with previous notes" switches every part between them.
Name corrections from the model's own knowledge are marked inline, `Palmer Luckey <!-- was: Palmer Lucky -->` (a mark on
the name in the editor, dotted underline; the Transcript view underlines the captions' spelling with "Likely: … (from
the notes)" — display only, the transcript is never changed); the checks count such a name as covered and list it as
"ℹ N corrected names".

Shared-file edits (each commented `// added by notes-view`):

```
LABS.transcript.setFollow(on)   Follow on / off, exactly like the Follow button / F (a view over the transcript turns it
                                off when the user scrolls it, and follows the video while it is on)
LABS.composeNote({ host, para, time, end?, quote?, words?, category, text?, onSaved(notes), onClose() }) → bool
                                the player's own note composer (General / 🃏 Mochi pills, ×, Enter saves through the
                                normal locked note write; Labs shows its read-only hint) opened inside `host`
LABS.notes()                    each note now also has its `id` (core/notes.ts)
```
- `src/labs/page/api.js` — `setFollow`, `composeNote`, `id` in `notes()`.
- `src/main/player.html` — `openComposer(sel, edit, opts)`: optional `opts` = `{ host, para, time, category, text,
  onSaved, onClose }` (no opts = exactly as before); `FA_INTERNAL.openComposer`.
- `electron.vite.config.ts` — the `iife` plugin: `import x from './entry.ts?iife'` → `{ js, css }`, the file bundled
  for the browser by esbuild (one minified IIFE; `*.css?inline` → a string). notes-view's `main.ts` serves its Milkdown
  bundle with it (`/labs/x/notes-view/view.js` + `view.css`), loaded by `player.js` only the first time Notes is shown.
  Type: `experiments/notes-view/iife.d.ts`.
- `package.json` — devDependencies `@milkdown/crepe` + `@milkdown/kit` 7.22.1 and the docs app's two patched packages
  (`@milkdown/components` yaz1410, `@milkdown/plugin-tooltip` yaz2238, tarballs in `experiments/notes-view/vendor/`,
  pinned with `overrides` exactly like yaseen-docs-app).
