# Yaseen Video Notes — notes for agents

The app was called **Follow Along** before the rename (repo was `video-follow-along-app`). The file formats keep
that name on purpose — `.follow-along.json`, `.follow-along-progress.json`, the `follow-along guide vN` comment —
because existing vault folders depend on them. Do not rename them.

macOS app, **Electron 43** (TypeScript, electron-vite, React for the shell — the same stack as
yaseen-docs-app), in [`electron/`](electron/). The user pastes a YouTube link; the app gets the captions
with yt-dlp, writes a transcript folder (`MM-DD-<slug>/<slug>.md` + `.follow-along.json`), then plays the
real YouTube video next to a transcript that follows it, with notes saved in the `.md`. Full
explanation: [docs/how-it-works.md](docs/how-it-works.md).

**History:** the first version was Swift + WKWebView (bundle id `com.yaseenarshad.followalong`). It was
removed because WebKit drops the audio for a moment on every `playbackRate` change; Chromium does not.
Do not move the player back to WebKit (that includes Tauri, which uses WebKit on macOS). The Electron app
was proven byte-identical to the Swift app's files before the Swift code was deleted, so existing vault
folders made by either version work.

## Commands (run in `electron/`)

```bash
npm install                                   # once (Electron 43.4.1)
npm run dev                                   # the app from source (electron-vite dev, hot reload of the shell)
npm test                                      # unit tests (vitest; ported from the Swift tests, must pass)
npm run typecheck
npm run package                               # → electron/dist/Yaseen Video Notes.app (bundle id com.yaseen.videonotes, signed)
npm run install-app                           # package + quit the running app + replace /Applications/Yaseen Video Notes.app + open it
npm run cli -- --make <url> --out <dir>       # headless folder creation (plain Node; needs `npm run build` first)
"dist/Yaseen Video Notes.app/Contents/MacOS/Yaseen Video Notes" --make <url> --out <dir>      # same CLI from the packaged app
"dist/Yaseen Video Notes.app/Contents/MacOS/Yaseen Video Notes" --open <folder> --debug-log <file>   # one video, event log
```

**Shipping a change to the user:** `npm run install-app` (`scripts/install-app.mjs`). It packages, quits the running
installed copy (`com.yaseen.videonotes`; waits for it to exit), replaces `/Applications/Yaseen Video Notes.app` with
the fresh build (copied with `ditto`, not a symlink) and opens it. The first time it also quits a running old
"Follow Along" (`com.yaseen.followalong`) so its tabs are saved before the new app copies its settings.
Environment variables are `VIDEO_NOTES_*` (`DEBUG_LOG`, `USER_DATA`, `MUTE`, `NO_IMPORT`); the old `FOLLOW_ALONG_*` names still work.

Homebrew tools need full paths in agent shells (`/opt/homebrew/bin/node`, `/opt/homebrew/bin/yt-dlp`).
Do not commit unless asked.

## Where things are (`electron/src/`)

- `core/` — plain Node, no Electron; every file format lives here and is unit-tested
  - `captions.ts` — WebVTT → words with times (rolling auto-captions, manual captions, `>>` turns)
  - `transcript.ts` — paragraphs, chapters, `.md` header/body, sidecar, slug, YouTube id
  - `notes.ts` — note parse / insert / edit / delete / restore / category; `atomic.ts` — atomic file writes
  - `guide.ts` — the agent guide comment written into each `.md` (the only copy of its text) + HTML-comment masking
  - `noteAnchor.ts` — where a note card shows in the player (after the word it is about); self-contained,
    served to the page as `/note-anchor.js` via `toString()`, so keep it free of imports and outside helpers
  - `migrate.ts` — first launch under the new name: copies the old `Follow Along/settings.json` once (read-only on the old folder)
  - `folderMaker.ts` — yt-dlp runner, make / reuse / set up folders, New Tab folder list
  - `status.ts` — per-video status in the yaseen-docs-app format; `progress.ts` — the resume file
  - `text.ts` — Swift-compatible whitespace / trimming / number parsing (byte-identical output)
  - `*.test.ts` — the ported Swift unit tests (+ `fixtures.ts`)
- `main/` — the Electron main process
  - `index.ts` — entry: CLI modes, app start, restore tabs; `menu.ts` — app menus and keys
  - `window.ts` — the window: tab strip (shell view) + one WebContentsView per video, IPC, dialogs
  - `session.ts` — one video: local HTTP server (notes/prefs/position API) + its view + iframe injection
  - `server.ts` — the 127.0.0.1 HTTP server; `settings.ts` — prefs JSON in userData (+ one-time import of the Swift app's UserDefaults); `debugLog.ts`
  - `player.html` — the whole player page (HTML/CSS/JS, served by the session's server)
  - `injected.js` — JS injected into the YouTube iframe (rate, seek, status, keys)
- `preload/` — `shell.ts` (window.fa, typed IPC) and `player.ts` (window.faNative.post)
- `renderer/` — the shell: `TabBar.tsx` (the yaseen-docs-app tab bar look), `NewTab.tsx` (Finder-style New Tab page)
- `cli/` — the CLI (`run.ts`, used by both the app binary and `cli.js`)
- `scripts/` — `package.mjs` (packaging + signing), `install-app.mjs` (package + install into /Applications + open)

## Rules that must not break

1. **Word-for-word transcript.** The words in the `.md` paragraphs and in `.follow-along.json` are exactly the caption
   words in order; only the `>>` speaker markers are removed (they become `— ` + a new paragraph). Chapter headings
   (`## m:ss Title`) are not transcript words — word checks read `[m:ss](…)` paragraph lines only.
2. **Paragraph lines are the anchors.** A paragraph line starts `[m:ss](https://www.youtube.com/watch?v=ID&t=Ns) `.
   Notes are tied to paragraphs by counting these lines, and `.follow-along.json` has one entry per paragraph.
   Never add, remove or merge paragraph lines in an existing file.
3. **Notes format.** `> 💬 [m:ss](url&t=Ns) text`, continuation lines `> …`. A note on highlighted words:
   `> 💬 [m:ss–m:ss](url&t=STARTs) text` + last line `> “quote”` — the quote is the exact selected text when ≤ 15
   words, else first 6 + ` … ` + last 6; a range inside one second is written as a single `[m:ss]`. Hand-typed `> 💬 text` (no time) belongs to the paragraph above.
   **Tags** right after the time link (or right after `> 💬 ` with no time), space-separated, any order and case
   when read: `#mochi` = make a flashcard from this note (untagged = general); `#resolved` = done (untagged = open).
   Written lowercase, `#mochi` before `#resolved`, e.g. `> 💬 [m:ss](url&t=Ns) #mochi #resolved text`. Never write
   `#general` / `#open`. **Resolution lines** `> ↳ resolved: what was done` (written by agents) go after the note
   text and before the quote line (last line when there is no quote). Tags and resolution lines are not note text
   (edit/delete/toggle matching compares the text without them); edits keep them; toggles change only the tags.
   Frontmatter (`---\nid: YAS-NNN\n---`) may be added above `# Title` by another tool and must be tolerated.
   **Agent guide:** a `<!-- follow-along guide vN … -->` comment after the header list, before the header's `---`
   (`core/guide.ts`). Every parser skips HTML comment blocks (`commentMask`). It is written into new folders and
   setup conversions; an existing file gets it (or a newer version, replaced in place, exactly one) only when the
   app writes that file anyway (note save/edit/delete/toggle, status write) — never a write just for the guide.
4. **Atomic writes** for every file the app changes (`atomicWrite`: temp file in the same folder + rename).
   Note edits/deletes check that the note's text in the file still matches what the player showed (409 otherwise).
5. **Never rewrite a user's file silently.** A plain transcript from another tool is reformatted only after the user
   says yes, and the original is kept as `<slug>.original.md`. Existing notes are never removed.
6. **`.follow-along.json` is written once** (at creation / setup) — it is big and the vault is synced to git.
   The resume spot lives in the tiny `.follow-along-progress.json` next to it (synced with the vault, so it works
   across computers) and is written rarely (pause, seek, tab switch, close, quit; at most once a minute while
   playing; not if it moved < 5 s) to keep git quiet.
7. **Status format is shared with yaseen-docs-app — do not change it.** Column in the parent folder's `.folder.md`
   (`folder_settings.columns.status`, kind select, options `1-To-Watch…4-Carded`, `optionSort: manual`), value in
   the transcript's frontmatter at `in.<parent folder id>.status` (top-level `status` when the folder has no id).
   Only add the column when missing; minimal line edits; never touch other keys.
8. **Don't change file formats casually.** The vault already holds folders made by the old Swift version and by
   this app; the unit tests pin the exact bytes. Any format change must keep reading the existing files.
9. **Never write test output into `/Users/yasin/Documents/GitHub/yaseen-docs-vault`.** Test with a temp folder
   (`/private/tmp/claude-501/...`), copying vault folders there if needed (read-only on the vault).
10. **Test instances never collide with the user.** Run the app with its own settings folder and muted, behind
    other windows: `--user-data-dir=<tmp> --mute --inactive` (add `--remote-debugging-port=<n>` to drive it with
    CDP). Only drive and quit windows you started. `--open` also leaves the user's tabs / Recent alone.
