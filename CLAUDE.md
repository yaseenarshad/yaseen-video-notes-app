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
npm run cli -- migrate-status <folder> --dry-run   # old statuses → docs-app defaults (drop --dry-run to write)
npm run cli -- status <md> --text             # the agents' CLI (claim / resolve / release / status) as plain Node
VIDEO_NOTES_APP="$PWD/dist/Yaseen Video Notes.app" build/video-notes status <md>   # the video-notes shim against a dist build
"dist/Yaseen Video Notes.app/Contents/MacOS/Yaseen Video Notes" --make <url> --out <dir>      # same CLI from the packaged app
"dist/Yaseen Video Notes.app/Contents/MacOS/Yaseen Video Notes" --open <folder> --debug-log <file>   # one video, event log
```

**Shipping a change to the user:** `npm run install-app` (`scripts/install-app.mjs`). It packages, quits the running
installed copy (`com.yaseen.videonotes`; waits for it to exit), replaces `/Applications/Yaseen Video Notes.app` with
the fresh build (copied with `ditto`, not a symlink) and opens it. It also installs the `video-notes` command
(`build/video-notes`) as `/opt/homebrew/bin/video-notes` and `~/.local/bin/video-notes` (skips a location that is
not writable; `-- --cli-only` installs only the command). The shim runs
`ELECTRON_RUN_AS_NODE=1 "<app>/Contents/MacOS/Yaseen Video Notes" "<app>/Contents/Resources/app.asar/out/main/cli.js"`
(no window, no dock icon, ~0.1 s). The first time it also quits a running old
"Follow Along" (`com.yaseen.followalong`) so its tabs are saved before the new app copies its settings.
Environment variables are `VIDEO_NOTES_*` (`DEBUG_LOG`, `USER_DATA`, `MUTE`, `NO_IMPORT`); the old `FOLLOW_ALONG_*` names still work.
`VIDEO_NOTES_FEED_DIR=<tmp>` points the 📺 Feed's files somewhere else: **always set it for test instances** (the default is the
user's real `~/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app/`, which also holds their SKILL.md — never touch that).
`VIDEO_NOTES_MENU_SCRIPT=<file>` (test instances only): context menus and the delete-folder confirm are answered with the
file's next line (an item id / `delete` / empty) instead of being shown, and logged, so CDP tests can drive them.
Real-network Feed checks: `VIDEO_NOTES_NETWORK_TESTS=1 npx vitest run src/core/feedFetch.network.test.ts`.

yt-dlp upkeep: the app updates yt-dlp itself (daily if > 14 days old, after a yt-dlp failure if > 7 days old, menu
"Update yt-dlp Now"); `VIDEO_NOTES_FAKE_YTDLP_VERSION=2026.01.01` makes a test instance treat it as old (the update is real).

Homebrew tools need full paths in agent shells (`/opt/homebrew/bin/node`, `/opt/homebrew/bin/yt-dlp`).
Do not commit unless asked.

## Where things are (`electron/src/`)

- `core/` — plain Node, no Electron; every file format lives here and is unit-tested
  - `captions.ts` — WebVTT → words with times (rolling auto-captions, manual captions, `>>` turns)
  - `transcript.ts` — paragraphs, chapters, `.md` header/body, sidecar, slug, YouTube id
  - `notes.ts` — note parse / insert / edit / delete / restore / category / claim tags / note ids, and `changeFile`
    (locked read-change-write of a transcript); `atomic.ts` — atomic file writes
  - `fileLock.ts` — the `<md>.lock` every writer of a transcript takes (O_EXCL, retry ~10 s, stale after 30 s or dead pid)
  - `claims.ts` — the agents' claim / resolve / release / status (pure text functions + locked file versions, note context)
  - `guide.ts` — the agent guide comment written into each `.md` (the only copy of its text; since v3 a one-line pointer
    to the agent skill file) + HTML-comment masking
  - `noteAnchor.ts` — where a note card shows in the player (after the word it is about); self-contained,
    served to the page as `/note-anchor.js` via `toString()`, so keep it free of imports and outside helpers
  - `migrate.ts` — first launch under the new name: copies the old `Follow Along/settings.json` once (read-only on the old folder)
  - `folderMaker.ts` — yt-dlp runner (one caption track, 429 retries, self-heal), make / reuse / set up folders, New Tab folder list
  - `ytdlpUpdate.ts` — keeps yt-dlp up to date: version age, update method by install path (brew / pip / -U),
    one update at a time and never during a download, self-heal after a failed download
  - `feed.ts` — the 📺 Feed's pure logic: `subscriptions.md` read / minimal line edits (follow, unfollow, resolve a typed
    link; code blocks and comments skipped), `feed-hidden.json`, the yt-dlp Videos-tab listing, Videos-tab page and RSS
    parsing, the Shorts decision, merge / sort / hide / In-Library / badge; `feedFetch.ts` — its network side
    (resolve a channel, list a channel: yt-dlp → Videos tab page → RSS); `feedFixtures.ts` — real saved output for the tests
  - `status.ts` — per-video status in the yaseen-docs-app format (+ old-value mapping, `migrateStatus`);
    `statusMigrate.ts` — the `migrate-status` folder run; `progress.ts` — the resume file
  - `library.ts` — the Library's folders: video vs topic folder (`folderKind`), the sidebar tree (`folderTree`: direct
    `videos` count + `total` at any depth), Finder-style folder views = direct videos only (`listFolder`,
    `directVideoFolders`), videos at any depth (`videoFolders`, `listLibrary` + `topic` chip: 📚 All videos, In progress,
    the board file), topic new / rename / delete-if-empty,
    `moveVideoFolder` (rename under the transcript's lock; across disks copy + byte check + delete; refuses collisions
    and moves to another library), `relocatePath`
  - `board.ts` — Kanban board order logic (pure, used by the renderer too); `boardFile.ts` — `.video-notes-board.json` (`seconds` + optional
    `home`; resume at home, New Tab progress from the furthest of the two)
  - `home.ts` — 📍 home (main spot) + back / forward history logic; self-contained, served as `/home.js` via
    `toString()` like `noteAnchor.ts` (no imports or outside helpers)
  - `text.ts` — Swift-compatible whitespace / trimming / number parsing (byte-identical output)
  - `*.test.ts` — the ported Swift unit tests (+ `fixtures.ts`)
- `main/` — the Electron main process
  - `index.ts` — entry: CLI modes, app start, restore tabs, the daily yt-dlp check and "Update yt-dlp Now"; `menu.ts` — app menus and keys
  - `feed.ts` — the 📺 Feed service: the feed folder (`feedDir` setting / `VIDEO_NOTES_FEED_DIR`), file watching, the per-machine
    cache (`feed-cache.json` in userData), refresh rounds (sequential, 429 back-off, yt-dlp update lock), IPC
  - `window.ts` — the window: tab strip (shell view) + one WebContentsView per video, IPC, dialogs
  - `session.ts` — one video: local HTTP server (notes/prefs/position API) + its view + iframe injection
  - `server.ts` — the 127.0.0.1 HTTP server; `settings.ts` — prefs JSON in userData (+ one-time import of the Swift app's UserDefaults); `debugLog.ts`
  - `player.html` — the whole player page (HTML/CSS/JS, served by the session's server)
  - `injected.js` — JS injected into the YouTube iframe (rate, seek, status, keys)
- `preload/` — `shell.ts` (window.fa, typed IPC) and `player.ts` (window.faNative.post)
- `renderer/` — the shell: `TabBar.tsx` (the yaseen-docs-app tab bar look), `FolderTree.tsx` (the sidebar's folder tree:
  libraries + topics, direct counts (+ total in the tooltip), drop a card / row to move it, inline New Folder / Rename),
  `NewTab.tsx` (Finder-style New Tab page: a folder shows only its own videos, 📚 All videos everything with topic chips,
  Board | Table toggle; Board is the default, Table is not saved), `Board.tsx` (the Kanban board: columns,
  collapsible to strips (`collapsedColumns` setting), cards with thumbnails, drag and drop),
  `Feed.tsx` (the 📺 Feed view, typed-confirm Unfollow… dialog)
- `cli/` — the CLI (`run.ts`, used by both the app binary and `cli.js`; `agent.ts` = `claim | resolve | release | status`)
- `build/video-notes` — the `video-notes` shim (installed by install-app)
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
   when read: `#mochi` = make a flashcard from this note (untagged = general); `#claimed:<agent>@<ISO UTC minute>`
   (e.g. `#claimed:a1@2026-10-23T14:30Z`, agent = `[a-z0-9-]{1,24}`) = an agent works on it, expired after the
   lease (30 min default) and then claimable again; `#resolved` = done (untagged = open). Written lowercase in the
   order `#mochi #claimed:… #resolved`; never both claimed and resolved (resolving drops the claim). Never write
   `#general` / `#open`. **Resolution lines** `> ↳ resolved by <agent>: what was done` (older: `> ↳ resolved: …`,
   still read) go after the note text and before the quote line (last line when there is no quote). Tags and
   resolution lines are not note text (edit/delete/toggle matching compares the text without them); edits keep
   them; toggles change only the tags. **Note id** = short hash of paragraph index + start time + text (no tags /
   resolution / quote): tag changes keep it, a text edit changes it.
   Frontmatter (`---\nid: YAS-NNN\n---`) may be added above `# Title` by another tool and must be tolerated.
   **Agent guide:** a `<!-- follow-along guide vN … -->` comment after the header list, before the header's `---`
   (`core/guide.ts`). Since v3 it is ONE line pointing agents to the skill file with the full agent rules,
   `/Users/yasin/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app/SKILL.md` (outside this repo, kept by
   the user): **agent-rule changes go in that skill, never into each .md** (no backfills). Only a change to the
   pointer itself bumps the version. Every parser skips HTML comment blocks (`commentMask`). It is written into new folders and
   setup conversions; an existing file gets it (or a newer version, replaced in place, exactly one) only when the
   app writes that file anyway (note save/edit/delete/toggle, status write) — never a write just for the guide.
4. **Atomic writes** for every file the app changes (`atomicWrite`: temp file in the same folder + rename).
   Note edits/deletes check that the note's text in the file still matches what the player showed (409 otherwise).
   **Every write to a transcript .md runs under its lock** (`withFileLock` / `changeFile`: `<md>.lock` next to it,
   O_EXCL, pid + host + time): read fresh, change, `atomicWrite`, unlock in `finally`. The app and the agents'
   `video-notes` CLI share it; never write a transcript outside it, and never nest it (it is not re-entrant).
   Agents never hand-edit the .md: `video-notes claim | resolve | release | status` (exit codes 0 / 2 usage /
   3 not owner or note gone / 4 lock timeout).
5. **Never rewrite a user's file silently.** A plain transcript from another tool is reformatted only after the user
   says yes, and the original is kept as `<slug>.original.md`. Existing notes are never removed.
6. **`.follow-along.json` is written once** (at creation / setup) — it is big and the vault is synced to git.
   The resume spot lives in the tiny `.follow-along-progress.json` next to it (`home` = where to resume, optional:
   old files without it read as `seconds`; byte-pinned by tests) (synced with the vault, so it works
   across computers) and is written rarely (pause, seek, tab switch, close, quit; at most once a minute while
   playing; not if it moved < 5 s) to keep git quiet.
7. **Status format is shared with yaseen-docs-app — do not change it.** Column in the **status folder's** `.folder.md`
   (`folder_settings.columns.status`, kind select, options `1-Backlog, 2-Todo, 3-In-Progress, 4-Done` — the docs
   app's own defaults — `optionSort: manual`), value in the transcript's frontmatter at `in.<status folder id>.status`
   (top-level `status` when the folder has no id). **The status folder is the library** (the pinned folder, e.g.
   learning-log), not the video's parent: videos may sit in topic subfolders (`learning-log/AI agents/10-27-x/`) and
   keep `in.<learning-log id>.status`, like a docs-app folder view (rows = notes at any depth). Resolution
   (`statusFolder` / `statusRootOf` in `core/status.ts`): nearest pinned ancestor (`setLibraryRoots`, set by
   `Settings`); else the nearest ancestor whose `.folder.md` declares the column (the CLI); else the parent. Moving a
   video between topics must never change its status. Never create `.folder.md` in a topic; tolerate one (its own id
   is ignored for status). Only add the column when missing; minimal line edits under the
   file's lock; never touch other keys. The old app-written options `1-To-Watch…4-Carded` are read as the new ones
   everywhere (`1-To-Watch`→`2-Todo`, `2-Watching`/`3-Watched`→`3-In-Progress`, `4-Carded`→`4-Done`); an exactly-old
   option list is replaced when the app writes `.folder.md`; `video-notes migrate-status <folder> [--dry-run]`
   rewrites old values. A newly added video starts in Backlog (`startInBacklog`); about 30 s of real playback moves empty/Backlog/Todo → In progress (just opening it does not); nothing else changes it by itself
   (Done is manual). The board's manual order is `<library>/.video-notes-board.json` (`core/board.ts`, `boardFile.ts`),
   keyed by video id, for the videos at any depth; every folder view (only its direct videos) and 📚 All videos show it
   filtered (All videos merges the libraries' files; a card's move is written to its own library's file).
8. **Don't change file formats casually.** The vault already holds folders made by the old Swift version and by
   this app; the unit tests pin the exact bytes. Any format change must keep reading the existing files.
9. **Never write test output into `/Users/yasin/Documents/GitHub/yaseen-docs-vault`.** Test with a temp folder
   (`/private/tmp/claude-501/...`), copying vault folders there if needed (read-only on the vault).
10. **Test instances never collide with the user.** Run the app with its own settings folder and muted, behind
    other windows: `--user-data-dir=<tmp> --mute --inactive` (add `--remote-debugging-port=<n>` to drive it with
    CDP). Only drive and quit windows you started. `--open` also leaves the user's tabs / Recent alone.
11. **The 📺 Feed never writes into video folders** (only "Add to Library" does, through the normal make flow). Its
    `subscriptions.md` is the user's file: only minimal line edits of channel lines (add / delete / rewrite one typed
    link); never the title, intro, Format section, code blocks or comments. Shorts are never shown. Unfollowing needs
    the typed confirm. Details: [docs/how-it-works.md](docs/how-it-works.md) section 7.
