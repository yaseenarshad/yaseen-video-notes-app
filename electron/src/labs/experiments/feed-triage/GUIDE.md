# Feed: preview pull quotes

**What it does.** Every video in the 📺 Feed gets a **Preview pull quotes** button. Nothing happens until you click it
(captions are a real download, so never automatic). On click:

1. Labs gets the video's captions with the app's own caption fetch (yt-dlp, one caption track, under the yt-dlp lock)
   into **Labs' own cache**: `labs-cache/<videoId>/feed-preview.follow-along.json`. Never the vault. A Feed video that
   is already in your Library is read from its folder instead (read-only).
2. Right away (~10 s): **the chapter titles and each chapter's first sentence, word for word — no AI** (videos without
   chapters: ~10-minute windows). A very short first sentence ("All right.") runs on to the next one.
3. Then the Labs analysis (`claude -p`, the same engine and cache as 🧪 Analyze). When it works, the box switches to
   **the AI-picked pull quotes, verbatim** (+ signal %). When `claude -p` is unavailable (tonight: logged out), the box
   stays on step 2 and says "No AI pull quotes (claude -p is not logged in)". After a failure it does not try claude
   again for 10 minutes.

Click **Hide preview** to fold it; clicking again shows it without a new download. A preview that got an analysis also
makes that video "analyzed" for the player (same cache, same transcript hash) if you add it to the Library later.

**How to try it.** New Tab → 📺 Feed → "Preview pull quotes" under a long podcast. To see the AI path, log in to
`claude` in a terminal first (`claude`, then `/login`), then preview another video (1–2 minutes).

**Judge it on.**
- Does the chapter-openings view alone help you decide whether to add a Feed video?
- With claude working: are the pull quotes worth the minute of waiting per video?

**Known limits.**
- One preview runs at a time (others wait their turn).
- Chapter openings are only as good as the captions and the chapter marks; auto-captions have little punctuation, so
  "first sentence" may run to the 40-word cap ("…").
- The preview state lives in the main process: after a restart, clicking again re-reads the cache (no new download).
- This experiment needed a new slot area, `'feed'` (docs/labs.md → "Additions (Agent C)"). Uses
  `../triage-cards/digest.ts`.
