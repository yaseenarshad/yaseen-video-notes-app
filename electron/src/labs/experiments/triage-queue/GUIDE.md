# Triage queue

**What it does.** A **🎯 Triage** bar above the New Tab's board / table, with a counter ("12 to triage"). **Start
triage** opens a queue of the un-started videos of that view (status Backlog, Todo or none), one video at a time:

- analyzed: 🎬 highlights · minutes · signal %, the **top 4 pull quotes word for word**, and the top highlights'
  labels (marked "AI label ·");
- not analyzed: **the chapter titles + each chapter's first sentence, word for word (no AI)** — or ~10-minute windows
  when the video has no chapters.

Decide with one key:

| key | what |
|---|---|
| `→` | **watch reel** — opens the video at `#labs=reel` (straight into the highlight reel); not analyzed: just opens it |
| `↓` | **skip for now** — next video |
| `D` | **mark done** — done triaging (not the vault's 4-Done) |
| `Enter` | open normally · `↑` previous · `Esc` close |

The queue on the right lists what is left (🎬 = analyzed, listed first, then newest first). "show triaged" brings back
the ones you already decided on, each with an **undo**.

**Labs-local.** The choices are kept in Labs only — `labs-state.json` in Labs' data folder, key `triage-queue`
(`{ <videoId>: { state: reel|skip|done, at } }`). Your vault's status is never changed (Labs is read-only); the
dialog says so.

**"+ N barely started".** Opening a video in the app moves it to In progress, so most of learning-log is "In progress"
and the strict queue there is empty. The bar offers a switch to also include In-progress videos watched less than
10 % (remembered per Labs install).

**How to try it.** New Tab → labs-library (Munger, Anthropic Rebuilt Git: no status, analyzed) → Start triage. Or
learning-log → tick "+ N barely started" → Start triage. Press `↓`, `→`, `D`.

**Judge it on.**
- Can you decide on a video in under ~10 seconds from the quotes alone?
- Are the non-AI chapter openings enough for an un-analyzed video, or do they read as noise?
- Do you want "reel / skip / done" to become real statuses (in the normal app, they would write the vault)?

**Known limits.**
- It triages the rows of the current view only (one folder, Recent or In progress), not every folder at once.
- Videos that "need setup" (no `.follow-along.json`) are left out — Labs cannot set them up (read-only).
- Keys work while the dialog is open; the bar has no keys of its own. It is a New Tab bar + dialog, not a sidebar
  entry (a sidebar entry would mean editing the shared NewTab.tsx).
- Uses `../triage-cards/digest.ts`.
