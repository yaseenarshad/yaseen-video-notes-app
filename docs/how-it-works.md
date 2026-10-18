# How Yaseen Video Notes works

(The app was called **Follow Along** until it was renamed; that is why its files are named
`.follow-along.json`, `.follow-along-progress.json` and the agent guide is `follow-along guide vN`. Those names stay.)

Plain-language notes on what the app does and why it does it that way. Code paths are in
[CLAUDE.md](../CLAUDE.md).

The app is an **Electron** app (`electron/`). It replaced a Swift + WKWebView version that worked the same way
but ran the player in WebKit, which drops the audio for a moment on every `playbackRate` change — and the app is
used at 2–3× with frequent speed changes. Chromium changes the rate without a gap, still gets 1080p, and the main
process can still reach into the cross-origin YouTube iframe to go past 2×. The Swift version has been removed;
folders it made use the same files (see "Files from the old Swift version" at the end).

## 1. The pipeline: link → folder

1. **You paste a YouTube link** (New Tab page, or `Yaseen Video Notes --make <url> --out <dir>`).
2. **yt-dlp gets the captions and the metadata — not the video.** It is free, needs no login, and the app runs:
   `yt-dlp --skip-download --write-subs --write-auto-subs --sub-lang "en,en-US,en-orig" --sub-format vtt --write-info-json --extractor-args "youtube:player_client=tv,web,android" -o "<tmp>/%(id)s.%(ext)s" <url>`
   into a temp folder. The binary is looked up in `/opt/homebrew/bin`, `~/Library/Python/3.*/bin`, `/usr/local/bin`.
3. **The app turns the captions into two files** and throws the caption file away:
   - `<slug>.md` — the readable transcript: timestamped paragraphs. Your notes live here.
   - `.follow-along.json` — every word with the second it is spoken, per paragraph, plus chapters. The player
     reads words and times from here.

### Captions → words
YouTube auto-captions (WebVTT) carry a time for every word (`word<00:00:01.280><c> next</c>`). Each caption
"cue" repeats the previous line and a 10 ms cue repeats it again, so the parser keeps only the new text of each
cue — every word exactly once, in order. Manual captions have no word times; their cue's time is spread evenly
over its words. `>>` (speaker change) is removed and starts a new paragraph shown with a leading `— `.

### Words → paragraphs
New paragraph on every speaker change. A long turn breaks after ~110 words at the next sentence end
(`.`, `?`, `!`). Some auto-captions have no punctuation at all; then a turn also breaks after 165 words at a
pause of ≥ 0.6 s, and always after 220 words.

The words are never changed: the `.md` paragraph text and the JSON are the caption words, in order.
(For the test video `dthaDyttHns` that is 19,307 words in 581 paragraphs. The original prototype output had
19,220 words / 533 paragraphs because its raw transcript had dropped every repeated caption line — e.g. each
later "Yeah." — so 87 real words and 48 speaker turns were missing there.)

### The folder
`<parent>/MM-DD-<slug>/` — MM-DD is today; the slug is the title lowercased, every run of non-letters/digits
turned into one `-`, trimmed, cut to 80 characters (and a trailing `-` dropped). The `.md` starts with:

```
# <Title>

- channel: <channel>
- url: https://www.youtube.com/watch?v=<id>
- duration: <h:mm:ss>
- views: <view_count>
- uploaded: <YYYYMMDD>

<!-- follow-along guide v2 — rules for agents editing this file (the Yaseen Video Notes app reads it)
…  (the short agent guide: see "For agents processing notes" below)
-->

---

## 0:00 <Chapter title>            ← only for videos with YouTube chapters

[0:00](https://www.youtube.com/watch?v=<id>&t=0s) First paragraph…

[0:11](https://www.youtube.com/watch?v=<id>&t=11s) — Next speaker…
```

Another tool in the vault later adds `---\nid: YAS-NNN\n---` frontmatter above `# Title` and a `.folder.md`;
the app does not create them and works with them there.

If a folder for the same video already exists in the parent (found by its `.follow-along.json` id or the `- url:`
line), it is reused and nothing in it is overwritten. Folders made by the older tool (a plain, unformatted
transcript `.md` with a `- url:` line, no `.follow-along.json`) show as **needs setup**: opening one gets the
captions and asks **"Format this transcript for Yaseen Video Notes?"**. Yes rewrites the body as timestamped
paragraphs (keeping the frontmatter and header) and keeps the original as `<slug>.original.md`; Cancel changes
nothing.

## 2. The player

- **The video streams from YouTube** in its normal embed player, full quality (the app asks the player for its
  best level once, e.g. hd1080), nothing is downloaded.
- **The transcript (words, highlight, chapters) comes from `.follow-along.json`; notes come from the `.md`.**
- **Highlight:** the video reports its current time ~16× a second; the page interpolates between reports and
  binary-searches the word times to find the paragraph, the current phrase (4–6 words, split at punctuation) and
  the word. No audio analysis. The current phrase is the main highlight (at 2–3× a single word flickers); the
  current word gets an underline.
- The page is served by a tiny HTTP server in the app's main process (Node `http`, bound to 127.0.0.1, one per
  open video) on `http://localhost:<random port>/`. It serves the page, `/data.json`, `/api/notes` (GET/POST, `/api/notes/edit`, `/api/notes/delete`, `/api/notes/category`), `/note-anchor.js`,
  `/api/prefs` and `/api/position`.

### Why a script is injected into the YouTube iframe
- The official YouTube IFrame API caps speed at **2×**, and a normal web page cannot touch a cross-origin iframe.
- Electron's main process can run JavaScript in any frame of a page, cross-origin or not: on every
  `did-frame-finish-load` of the player's WebContents it looks up the frame (`webFrameMain.fromId`) and, if it is a
  YouTube `/embed/` frame, runs the script there (`frame.executeJavaScript`). It also injects on
  `did-frame-navigate` and on each new subframe's `dom-ready`. A reload of the iframe loads a new
  document, so the script goes in again; it is idempotent per document, and until the page reports a connected
  player the app also re-checks every frame every 2 s.
- **Watchdog (the bridge must never stay down):** the page expects a status message ~16×/s. If none comes for
  more than 2.5 s while the tab is shown, it asks the app to reconnect (`reconnect` message). The app injects into
  every YouTube frame again; when there is no live YouTube frame (the iframe crashed or went blank) the page
  reloads the embed at the last known time, playing if it was playing (≈3 s from a crash to the highlight moving
  again). Still nothing: a "Reconnecting to video…" chip on the video, then a **Reload video** button. The
  debug log shows `reconnect #n (no status for N ms): …`, `reload-video`, `reconnected`. The script runs **inside** the YouTube iframe. There it finds the `<video>`, sets `playbackRate` directly (any speed, 3× and more; it re-applies
  the rate if YouTube resets it), and talks to the page with `window.parent.postMessage` (allowed across origins):
  status out (time, rate, paused, quality) ~16×/s; commands in (rate, seek, play, pause).
- It also catches the app's hotkeys inside the iframe (so YouTube's own `F` = fullscreen etc. never fire) and
  forwards them to the page, so every hotkey works wherever the focus is.
- **Why not play the raw stream instead:** only YouTube's format 18 (360p) has audio and video in one file; HD
  is split into separate audio and video streams, so a plain `<video src>` would be 360p.
- **Which embed approach worked:** the page is served from `http://localhost:<port>` and embeds
  `https://www.youtube.com/embed/<id>` normally. YouTube embeds fail with **"Error 153 / video player
  configuration error"** when the embedding page has no valid http(s) origin/referrer (`loadHTMLString` with a
  nil base URL, `file://`, custom schemes) — the localhost server avoids that.
- **Speed changes:** Chromium changes `playbackRate` without an audio gap (the reason for Electron). Taps in a row
  are still batched — the badge updates at once and the rate is set once, 180 ms after the last tap — so each run
  of S/D taps is one rate change. Every `ratechange` inside the iframe is logged to the debug log with the rate
  the app wants; a change that was not the app's (YouTube resetting it) is put back at once, and the page re-sends
  its rate if the reported rate differs for more than 0.5 s. A test held 3.00× for 3+ minutes with exactly one
  ratechange (the app's own). Best quality is requested only until the player has it (forcing it later would
  switch streams mid-play).
- The player pages run with context isolation and the sandbox on, no Node. Their only line to the app is
  `window.faNative.post(message)` (a preload, IPC to the main process): copy to clipboard, and the events the
  app logs or acts on (position for resume, finished → status). Notes, prefs and the position go through the
  page's own localhost server, like before.

## 3. Notes in the markdown

How the parser tells things apart (line by line):

- `[m:ss](…&t=Ns) …` → a **paragraph** (they are counted: paragraph 0, 1, 2…). Never delete these lines — notes
  and the JSON are matched to paragraphs by their order.
- `> 💬 …` → a **note**, belonging to the paragraph above it. Following lines that start with `>` continue it.
- `## m:ss Title` → a chapter heading (not transcript text; a new note never goes below a heading of the next
  paragraph).
- Everything else (frontmatter, header, blank lines) is ignored.

Note formats:

```
> 💬 [29:41](https://www.youtube.com/watch?v=ID&t=1781s) a note at one moment
> a second line of the same note

> 💬 [29:41–29:58](https://www.youtube.com/watch?v=ID&t=1781s) a note on highlighted words
> “manufacturing and all sorts of things. … And so now you can smooth”

> 💬 typed by hand in Obsidian (no time) — belongs to the paragraph above

> 💬 [19:51](https://www.youtube.com/watch?v=ID&t=1191s) #mochi a note to make a flashcard from
```

- The **💬 Note pill** shows next to where the mouse let go of the selection (offset so it does not cover the
  words under the pointer, kept inside the transcript); for Shift+arrow selections and double/triple clicks, next
  to the selection's moving end. It stays on that spot while scrolling and hides while the spot is out of view.
  The composer and the saved note still go after the last selected word.
- A **range note** (highlight words, press N or the 💬 Note pill) has start–end times (en dash; the link's `t=` is
  the start; the times are the first and last word the selection touches, partial words count) and a last line
  with **exactly the selected text** in curly quotes: **all of it if ≤ 15 words, else the first 6 words + ` … ` +
  the last 6.** A highlight inside one second (e.g. one word) is written with a single time: `[19:51]` + quote. With the start and end times that still pins the exact span (find the start
  words at the start time and the end words just before the end time). Older notes with a full-length quote
  parse too.
- **Category: `#mochi` right after the time = make a flashcard from this note; untagged = general.** The tag
  is the first token after the time link (or right after `> 💬 ` in a note without a time), read in any case,
  written as `#mochi`; range notes carry it on the first line, the quote line is unchanged. `#general` is never
  written, so every older note is general. The player shows a 🃏 Mochi badge; in the composer two pills
  (General / 🃏 Mochi, Tab flips them) pick it, starting with the last-used one (`noteCategory` in
  `settings.json`); right-click a note → **Make Mochi / Make General** changes only the tag (atomic write, same
  check as edit); the Notes tab has All · General · Mochi filter chips.
- New notes go right under their paragraph, after its existing notes. Every change is an **atomic write**
  (temp file + rename), so Obsidian never sees half a file.
- Notes typed in Obsidian show up in the player within ~1 s (the page polls; the app re-parses only when the
  file's modified time or size changes).
- **Editing the transcript text in the `.md` does not change the player** — the words and times come from the
  JSON. Edit notes freely; leave the `[m:ss](…)` lines alone.
- **In the player a note card shows right after the word it is about** (display only; the `.md` is unchanged):
  a range note after its last highlighted word (the quote pins the words — first/last words, the ` … ` short
  form, partial words — else the times), with a soft underline under the covered words; a point note after
  the word spoken at its time, which gets a small dot; a note without a time at the bottom of its paragraph.
  Times outside the paragraph clamp to its first/last word; several notes on one word stack in file order. The
  card is a block inside the paragraph (the words stay one run), is not selectable and never ends up in a
  quote; the composer opens where the saved note will appear. Logic: `core/noteAnchor.ts` (unit-tested).
- Right-click a note (in the transcript or the Notes tab) → **Edit** (inline, keeps time/range/quote/tags/resolution; × or Esc cancels), **Make Mochi / Make General**, **Mark resolved / Reopen**, **Copy**, **Delete** (asks "Delete this note?").
  Edit/delete find the note by paragraph + its place among that paragraph's notes **and** check that its text in
  the file is still what the player shows; if the file changed meanwhile you get "Note changed in the file — try
  again" and nothing is touched.

### For agents processing notes
Each transcript `.md` carries a short guide for agents (an HTML comment after the header list; the app and every
parser ignore HTML comments). The rules:

- Only act on notes **without** `#resolved`. `#mochi` = make a flashcard from this note.
- When done: add `#resolved` to the tags right after the time (keep the other tags; lowercase; `#mochi` first)
  and a line `> ↳ resolved: <what was done>` after the note text, before the `> “quote”` line (or as the last
  line when there is no quote):

```
> 💬 [19:51](https://www.youtube.com/watch?v=ID&t=1191s) #mochi #resolved lobotomized = over-specialized
> ↳ resolved: made Mochi card "lobotomized" in deck Vocab
> “labbotomized”
```

- Never delete or reword the user's note text; never touch paragraph lines (`[m:ss](…)`), `## m:ss` chapter
  headings, the header or the frontmatter. Notes with no time (`> 💬 text`) belong to the paragraph above.
- In the player a resolved note is a small ✓ chip (click it to see the note, struck through, and the resolution);
  right-click → **Mark resolved / Reopen** changes only the tag. The Notes tab filters All · General · Mochi ·
  Open · Resolved.

### Selecting words
Selection is the browser's own, character-precise: drag, double-click (one word), triple-click (paragraph),
Shift+click and Shift+←/→ (Shift+Alt by word) — none of these seek. A plain click (no movement, nothing
selected) seeks to the word after a short wait (so a double-click never seeks). While the mouse is down or a
selection exists, the transcript does not auto-scroll and only CSS classes change (the highlight is
background/box-shadow only), so the text never moves under the selection while the video plays.

## 4. Resume where you left off

`<video folder>/.follow-along-progress.json`:

```json
{ "seconds": 1808, "duration": 6271, "updated": "2026-10-17T18:02:11Z", "device": "Yasin's MacBook Pro" }
```

- It sits next to the transcript so it travels with the git-synced vault to other computers (last write wins;
  the file is re-read every time a video opens, and the toast says which computer it came from if it was
  another one).
- It is its **own tiny file** because `.follow-along.json` is big and must not be rewritten (big git diffs).
- Writes are **rare** to keep git quiet: on pause, after a seek, tab switch, tab close and quit, and at most once
  a minute while playing — and never if the spot moved less than 5 s. Opening a video writes nothing.
- On open the video jumps to 3 s before the saved spot and shows "Resumed at 30:08 · Start over". Within the last
  30 s / 2 % it counts as finished and starts at 0:00.

## 5. Status (shared with yaseen-docs-app — do not change the format)

Each video has a status, stored exactly as yaseen-docs-app stores a Select column, so both apps show the same
value:

- The column is declared once in the **parent folder's** `.folder.md` (e.g. `learning-log/.folder.md`):
  ```yaml
  folder_settings:
    columns:
      status:
        kind: select
        options:
          - 1-To-Watch
          - 2-Watching
          - 3-Watched
          - 4-Carded
        optionSort: manual
  ```
  The app only adds this when the folder has no `status` column; an existing column (and its options) is used
  as it is, and no other setting (id, title, views, other columns) is touched.
- The value is in the transcript `.md`'s own frontmatter, under the parent folder's `id` (from its `.folder.md`):
  ```yaml
  ---
  id: YAS-398
  in:
    3vzxnrx8km6f:
      status: 2-Watching
  ---
  ```
  If the parent folder has no `id`, the value is a top-level `status:` key (the docs app's fallback).
- Edits are line-level: only the status line (and a missing `in:` / folder line) is added or changed; every other
  key keeps its place and quoting. A frontmatter shape the app does not understand (e.g. `in: {…}`) is left alone.
- Status only moves forward by itself: opening a video moves an empty / `1-To-Watch` status to `2-Watching`;
  finishing it (the resume rule) moves it to `3-Watched`. You can set any value by hand (New Tab table: the Status
  cell, right-click → Set Status, or "Group by status" and drag a row to another group).

## 6. The app

- One window with tabs (⌘T new, ⌘W close, ⌘1…9). The tab strip and the New Tab pages are one web view (the
  "shell", React); each open video is its own web view laid over the shell below the strip. Only the visible
  tab plays; switching pauses the one you leave, and a hidden tab that starts playing (a restored tab's resume
  seek starts the YouTube player) is paused at once. Open tabs come back on the next launch.
- The New Tab page is a Finder-style browser: sidebar (Recent, In progress, pinned folders like learning-log,
  Add Folder…, Other Folder…), a paste-a-link field with the destination folder chip, and a sortable table
  (Title, Date, Progress, Status, Notes), optionally grouped by status. Enter or double-click opens.
- Settings live in `~/Library/Application Support/Yaseen Video Notes/settings.json` (written atomically): speed,
  favorite/last speed, transcript text size, focus mode, divider position, side-panel tab, app zoom (`uiScale`),
  pinned folders, Recent, open tabs, window size. On the first launch under the new name, when that file does
  not exist yet, `~/Library/Application Support/Follow Along/settings.json` (the old name's) is copied over once
  (`core/migrate.ts`; the old folder is only read). The rest of the old folder is Chromium cache and a few
  YouTube visitor cookies: the app never signs in to YouTube, and Chromium encrypts cookies with a keychain key
  named after the app, so they are not carried over. (Only with no settings at all does the app copy the old
  Swift app's UserDefaults, `com.yaseenarshad.followalong`, if any exist — read only. Copied settings are marked
  as already imported, so that never runs again.)
- App zoom (⌘+ / ⌘− / ⌘0, View → Zoom In / Zoom Out / Actual Size) scales the whole window, 80–200 % — the
  tab strip, the New Tab page and every player (`webContents.setZoomFactor`); it is kept across launches. The
  transcript-only text size is the A− / A+ buttons.
- Packaging: `npm run package` → `electron/dist/Yaseen Video Notes.app`, bundle id `com.yaseen.videonotes` (before the
  rename: `Follow Along.app`, `com.yaseen.followalong`), signed with the self-signed "Yaseen Local Signing"
  certificate when the keychain has it (ad-hoc otherwise), like yaseen-docs-app. `npm run install-app` packages,
  quits the running copy, replaces `/Applications/Yaseen Video Notes.app` (a real copy, `ditto`) and opens it.

### Readability (player colors)
WCAG contrast on the page background, light / dark: body text 16.2 / 14.2, past paragraphs 11.9 / 10.7,
timestamps and meta 5.7 / 6.8, current-phrase text on its highlight 13.5 / 12.0, note text 15.0 / 12.0, note
time 5.1 / 6.7, chapter time 5.0 / 7.3. Nothing is below 4.5. Focus mode is the same view with the other
paragraphs faded and the current one larger.

## Hotkeys

| Key | Action |
|---|---|
| `S` / `D` | slower / faster (0.1) |
| `R` | reset (1× ↔ last speed) |
| `G` | favorite speed (2.5) |
| `V` | show / hide speed badge |
| `Space` | play / pause |
| `Z` / `X` | back / forward 5 s |
| `←` / `→` | back / forward 10 s |
| `N` | new note (pauses while typing; Enter saves; Shift+Enter new line; Esc cancels; resumes after). With words highlighted: a range note |
| `F` | follow on / off ("Back to now") |
| `Shift+F` | focus mode |
| `⌘F` / `Ctrl+F` | find in transcript (Enter / Shift+Enter next / previous, Esc closes; does not seek) |
| `⌘+` / `⌘−` / `⌘0` | zoom the whole window (transcript text alone: A− / A+) |
| `⌘T` / `⌘W` / `⌘1…9` | tabs |
| `?` | shortcuts cheat-sheet |

Hotkeys are ignored while typing in a note, the find box or a dialog.

## Known failure modes and fixes

- **"yt-dlp failed" / no captions downloaded:** YouTube changes often; update with `brew upgrade yt-dlp`
  (or `pip3 install -U --user yt-dlp`). The error box shows yt-dlp's last ERROR lines.
- **"yt-dlp was not found":** install it (`brew install yt-dlp`).
- **"This video has no English captions":** nothing to follow along with; the app makes no folder.
- **"The YouTube player is not reporting"** under the video: the video may not allow embedding, or the network
  is down. Videos with embedding disabled cannot be played in the app.
- **Error 153 in the player:** the page was not loaded from the localhost server (should not happen in the app).
- **"has N paragraphs but the captions make M":** a folder's `.md` paragraphs no longer match fresh captions
  (YouTube re-generated them, or paragraph lines were edited) and there is no `.follow-along.json`; the app will
  not guess.
- **Ads** play in the embed like on YouTube; the player shows "· ad" and the transcript waits.
- **Audio skid on a speed change** was WebKit re-timing the audio (the Swift app). The Electron app does not have it.
- **The transcript stops following while the video plays** (highlight and auto-scroll frozen, Follow still on,
  no "Back to now"): seen once in the packaged app. Cause found: while the mouse is down in the transcript nothing
  in the text changes (so a selection never moves), and only a `mouseup` ended that state — a lost `mouseup`
  (released over the video frame or another app, a text drag-and-drop, switching apps mid-drag) froze it until
  a restart. Now it also ends on pointerup/cancel, drag start/end, window blur, the tab hiding, the first mouse
  move with no button held, and after 20 s at most (`mouse-released` in the debug log). The second way to lose
  sync — the YouTube iframe crashing or reloading — is covered by the watchdog above. A click in the transcript
  also takes the keyboard back from the YouTube frame.
- **A YouTube embed that never reports** (the "connecting…" label stays): the script did not get into the iframe.
  The debug log (`--debug-log`) shows `injected into https://www.youtube.com/embed/<id>` once per iframe load.

## Files from the old Swift version

The first version of the app was Swift + WKWebView. Before it was deleted, the Electron app was proven to write
the same bytes for every file: the folder name, the `.md` (header, chapter headings, paragraphs, notes incl.
range notes and the short-quote rule), `.follow-along.json`, `.follow-along-progress.json` (pretty JSON: sorted
keys, `" : "`, no final newline), the status lines in the frontmatter and the `.folder.md` column, and
`<slug>.original.md`. The only difference was key order inside `.follow-along.json` (Swift wrote keys in a random
order; Electron writes them in declaration order) — both read fine. The Swift unit tests were ported one to one
(`electron/src/core/*.test.ts`) and pin these formats now.
