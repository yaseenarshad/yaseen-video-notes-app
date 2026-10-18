# Follow Along

A macOS app for watching YouTube talks and podcasts at 2–3× with a transcript that follows the
video (current phrase highlighted, auto-scroll) and quick notes that are saved inside the
transcript markdown, right under the paragraph they belong to.

The app is built with **Electron** and lives in [`electron/`](electron/). An earlier Swift version was
removed: it ran the player in WebKit, which drops the audio for a moment every time the playback speed
changes. Chromium changes speed smoothly, still plays 1080p, and still lets the app go past YouTube's
2× limit. Folders made by the Swift version use the same files and open fine.

How it works (pipeline, file formats, the YouTube trick, failure modes): [docs/how-it-works.md](docs/how-it-works.md).
Notes for coding agents: [CLAUDE.md](CLAUDE.md).

## Needs

- macOS 14+ on Apple silicon, Node 20+ (`brew install node`)
- `yt-dlp` (`brew install yt-dlp`), found in `/opt/homebrew/bin`, `~/Library/Python/3.*/bin` or `/usr/local/bin`

## Build and run

```bash
cd electron
npm install                 # Electron 43.4.1, electron-vite, React, vitest
npm run dev                 # run from source
npm test                    # unit tests (formatter, notes, chapters, edits, progress, status)
npm run package             # → electron/dist/Follow Along.app (signed with "Yaseen Local Signing" if present)
open "dist/Follow Along.app"
```

The packaged app's bundle id is `com.yaseen.followalong`.

Headless / test modes (no UI):

```bash
FA="dist/Follow Along.app/Contents/MacOS/Follow Along"
"$FA" --make "https://www.youtube.com/watch?v=dthaDyttHns" --out /tmp/some-dir   # make the folder, print a summary
"$FA" --format captions.en.vtt --info video.info.json [--md out.md]            # format offline
"$FA" --open /path/to/video-folder --debug-log /tmp/fa.log                       # open one video, log player events
npm run build && npm run cli -- --make <url> --out <dir>                       # the same CLI as plain Node
```

`--open` is a test mode: it does not touch your open tabs or Recent list. For a fully separate test
instance add `--user-data-dir=<tmp dir> --mute --inactive`.

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
| `N` | new note (pauses; Enter saves, Shift+Enter new line, Esc cancels). With words highlighted: a note on those words |
| `F` | follow the video on / off |
| `Shift+F` | focus mode |
| `⌘F` / `Ctrl+F` | find in transcript (on the New Tab page: the filter) |
| `⌘+` / `⌘−` / `⌘0` | zoom the whole window (transcript text alone: A− / A+ buttons) |
| `⌘T` / `⌘W` / `⌘1…9` | new tab / close tab / go to tab |
| `⌘R` | reload the video (View → Reload Video) if it seems stuck; resumes at your spot |
| `?` | shortcuts cheat-sheet |

Hotkeys work while the video has focus too, and are ignored while typing in a note or the find box.
Right-click a note for Edit / Copy / Delete. Select words (drag, double-click) and press `N` for a note on them.
Right-click a tab for Copy YouTube Link / Copy .md Path / Show in Finder / Close Tab.
