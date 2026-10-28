# Yaseen Video Notes

(Called **Follow Along** before; that is why its files are named `.follow-along.json` and
`.follow-along-progress.json`.)

A macOS app for watching YouTube talks and podcasts at 2–3× with a transcript that follows the
video (current phrase highlighted, auto-scroll) and quick notes that are saved inside the
transcript markdown, right under the paragraph they belong to.

The app is built with **Electron** and lives in [`electron/`](electron/). An earlier Swift version was
removed: it ran the player in WebKit, which drops the audio for a moment every time the playback speed
changes. Chromium changes speed smoothly, still plays 1080p, and still lets the app go past YouTube's
2× limit. Folders made by the Swift version use the same files and open fine.

How it works (pipeline, file formats, the YouTube trick, failure modes): [docs/how-it-works.md](docs/how-it-works.md).
Notes for coding agents: [CLAUDE.md](CLAUDE.md).

## Topic folders

A library (a pinned folder like `learning-log`) can hold **topic folders** (`learning-log/AI agents/…`). The
sidebar's Folders section is a tree: each library and its topics, recursively; expand / collapse is remembered. It
works like Finder: clicking a folder shows only the videos **right in it** — the library shows the loose videos still
to sort, a topic only its own (a subtopic's show when you click the subtopic) — and each folder's count is those
direct videos (the tooltip adds the total with subfolders). **📚 All videos** (next to Recent / In progress) shows every
video of every library at any depth, cards in a topic with a small topic chip. Moving a card out of the folder you are
looking at takes it off that board at once. Right-click a folder →
**New Folder…** / **Rename…** (inline) / **Show in Finder** / **Delete** (only an empty folder, after a confirm).

Move a video by dragging its card or row onto a folder in the tree, or right-click → **Move to ▸**. The whole video
folder is renamed into place ("Moved to AI agents · Undo"); a name that is already there is refused, and a tab playing
that video keeps playing. The status does not change: it belongs to the library (`in.<learning-log id>.status`), like a
yaseen-docs-app folder view, and the board order is the library's, keyed by video id (each view shows it filtered to
its cards; drag-reorder works in every folder view and in All videos). Paste a link while a topic is
selected (or pick it in the "→ folder" chip) to add the video there.

## 📺 Feed

The New Tab sidebar has a **📺 Feed** item, apart from the Library: the latest long-form videos of the YouTube
channels you follow, newest first, with thumbnails, a channel filter and a badge for videos that came out since you
last looked. Shorts are never shown. Nothing goes into your video folders until you press **Add to Library** (the same
as pasting the link: the folder is made in the destination folder and opens). **Hide** removes a video for good;
videos you already have show **In Library**.

- Follow with the "+ Follow channel" field (`@handle`, a channel link, or any video link), or right-click a Library
  row → Follow this channel. Unfollow: right-click a channel chip → Unfollow… and type `unfollow` to confirm.
- The followed channels live in **`~/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app/subscriptions.md`**
  (your synced skills repo, so every Mac sees the same list; setting `feedDir`, env `VIDEO_NOTES_FEED_DIR` for tests).
  It is a markdown list you can edit: add a line `- https://www.youtube.com/@handle` and the app fills in the name and
  ID; delete a line to unfollow. Hidden videos are in `feed-hidden.json` next to it.
- Videos come from yt-dlp listing each channel's Videos tab (one call per channel, hourly and when the Feed opens).
  YouTube's RSS feeds are not used for that: since October 2026 they answer 404 for most channels.

## Needs

- macOS 14+ on Apple silicon, Node 20+ (`brew install node`)
- `yt-dlp` (`brew install yt-dlp`), found in `/opt/homebrew/bin`, `~/Library/Python/3.*/bin` or `/usr/local/bin`.
  The app keeps it up to date by itself (`brew upgrade yt-dlp`, pip or `yt-dlp -U`, by how it was installed): daily
  when it is over 14 days old, after a failed caption download when it is over 7 days old (then tries again), and
  from **Yaseen Video Notes → Update yt-dlp Now**.

## Build and run

```bash
cd electron
npm install                 # Electron 43.4.1, electron-vite, React, vitest
npm run dev                 # run from source
npm test                    # unit tests (formatter, notes, chapters, edits, progress, status)
npm run package             # → electron/dist/Yaseen Video Notes.app (signed with "Yaseen Local Signing" if present)
npm run install-app         # package, quit the running app, replace /Applications/Yaseen Video Notes.app, open it
```

**Shipping a change:** `npm run install-app` is the way to put a change in front of the user. It packages the
app, quits the running installed copy (it saves its tabs and positions on quit), replaces
`/Applications/Yaseen Video Notes.app` with the fresh build (a real copy made with `ditto`, not a symlink) and
opens it.

The packaged app's bundle id is `com.yaseen.videonotes` (it was `com.yaseen.followalong` as Follow Along).
Settings live in `~/Library/Application Support/Yaseen Video Notes/`; on the first launch the old
`Follow Along/settings.json` is copied over once (pinned folders, open tabs, Recent, speed, …).

Headless / test modes (no UI):

```bash
FA="dist/Yaseen Video Notes.app/Contents/MacOS/Yaseen Video Notes"
"$FA" --make "https://www.youtube.com/watch?v=dthaDyttHns" --out /tmp/some-dir   # make the folder, print a summary
"$FA" --format captions.en.vtt --info video.info.json [--md out.md]            # format offline
"$FA" --open /path/to/video-folder --debug-log /tmp/fa.log                       # open one video, log player events
npm run build && npm run cli -- --make <url> --out <dir>                       # the same CLI as plain Node
```

`--open` is a test mode: it does not touch your open tabs or Recent list. For a fully separate test
instance add `--user-data-dir=<tmp dir> --mute --inactive`.

## Agents: the `video-notes` command

Several AI agents can turn the `#mochi` notes of one transcript into Mochi cards at the same time (while you keep
taking notes). They never edit the `.md` by hand; they use `video-notes`, which locks the file for every write
(`<md>.lock`, shared with the app) and hands each note to exactly one agent:

```bash
video-notes claim   "<file.md>" --agent a1 --count 5      # JSON: your notes + context ([] when nothing is left)
video-notes resolve "<file.md>" --agent a1 --note <id> --done "made card \"…\" in deck Vocab"
video-notes release "<file.md>" --agent a1                # give your claims back
video-notes status  "<file.md>" --text                    # open / claimed by whom / expired / resolved
```

`npm run install-app` installs it as `/opt/homebrew/bin/video-notes` and `~/.local/bin/video-notes`
(`npm run install-app -- --cli-only` installs just the command). It runs the app's bundled CLI with the app's own
Electron as plain Node (`ELECTRON_RUN_AS_NODE=1`): no window, no dock icon, ~0.1 s per call. To try a build before
installing: `VIDEO_NOTES_APP="$PWD/dist/Yaseen Video Notes.app" build/video-notes status <file.md>`.
Claimed notes show "🤖 a1" in the player; the Notes tab has an "In progress" filter; right-click → Release claim.
Details: [docs/how-it-works.md](docs/how-it-works.md#several-agents-at-once-the-video-notes-command). Each transcript
`.md` has a one-line comment pointing agents to the skill file with the full rules
(`~/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app/SKILL.md`); rule changes go there, not into each `.md`.

## Hotkeys

| Key | Action |
|---|---|
| `S` / `D` | slower / faster (0.1) |
| `R` | reset (1× ↔ last speed) |
| `G` | favorite speed (2.5) |
| `V` | show / hide the speed badge |
| `Space` | play / pause |
| `Z` / `X` | back / forward 5 s |
| `←` / `→` | back / forward 10 s |
| `H` | 📍 jump home (your main spot, after jumping around) |
| `Shift+H` | make this spot Home |
| `⌘[` / `⌘]` | back / forward through the spots you jumped from (View → Back / Forward) |
| `N` | new note (pauses; Enter saves, Shift+Enter new line, Esc cancels). With words highlighted: a note on those words |
| `F` | follow the video on / off |
| `Shift+F` | focus mode |
| `⌘F` / `Ctrl+F` | find in transcript (on the New Tab page: the filter) |
| `⌘+` / `⌘−` / `⌘0` | zoom the whole window (transcript text alone: A− / A+ buttons) |
| `⌘T` / `⌘W` / `⌘1…9` | new tab / close tab / go to tab |
| `⌘R` | reload the video (View → Reload Video) if it seems stuck; resumes at your spot |
| `?` | shortcuts cheat-sheet |

Hotkeys work while the video has focus too, and are ignored while typing in a note or the find box.

**📍 Home.** Jump around freely (click a word, a chapter, a note, the seek bar): the player keeps your main spot.
While you play normally, Home follows you; a jump of more than ~20 s freezes it where you left. A
"📍 Home 23:14" chip by the controls and a 📍 pin in the transcript margin show it while you are away; click either
(or press `H`) to go back. Playing back into it makes it follow again. `Shift+H` / "Make this Home" moves it to
where you are (after ~3 min away the chip offers that; it never moves by itself). `⌘[` / `⌘]` step back / forward
through the spots you jumped from, like a browser. Reopening a video resumes at Home.
Right-click a note for Edit / Copy / Delete (and Release claim on a note an agent claimed). Select words (drag, double-click) and press `N` for a note on them.
Right-click a tab for Copy for Agent (a short prompt pointing an agent at the skill and this transcript) / Copy YouTube Link / Copy .md Path / Show in Finder / Close Tab.
