# Triage cards

**What it does.** On the Board, every card of an analyzed video gets a small triage block under its notes line:

- **🎬 18 highlights · 21 min** — how many highlights the Labs analysis picked and how long they take at 1×.
- **signal 34 %** — the share of the video's paragraphs the analysis scored 2 (substantive) or 3 (dense).
- **The top 2 pull quotes, word for word**, 2 lines each, with their time. Click a quote to read all of it; click
  again to fold it. They are ranked by the highlight they sit in (score), then by how dense their paragraphs are.
- **▶ Reel** — opens the video straight into its highlight reel. It opens the player at `#labs=reel` (the Labs
  launch flag, see docs/labs.md → "Additions (Agent C)"); the highlight-reel player experiment reads it.

Everything shown is extractive: the quote text is re-derived from the transcript's own words (`spanText`); the AI
only chose which spans. "verbatim · AI-picked" under the quotes says so.

**How to try it.** Open a New Tab → learning-log (Board). The analyzed videos (Zuckerberg's $100B Bet, CoreWeave
Crash, The Frontier Ideas a16z…, OpenAI Bulk-Solves 722…, Flying Tesla Car, Elon Musk) show the block; so do Munger
and Anthropic Rebuilt Git in labs-library. Click a quote; click ▶ Reel.

**Judge it on.**
- Do the two quotes tell you, in a few seconds, whether the video is worth your time?
- Is "signal %" a useful number across videos (e.g. 70 % Munger vs 31 % Flying Tesla), or noise?
- Is ▶ Reel the button you'd reach for first?

**Known limits.**
- Only analyzed videos (and only cards whose folder is set up — "needs setup" cards show nothing).
- The signal % and the ranking come from the AI's paragraph scores; they are judgements, not facts.
- ▶ Reel depends on the highlight-reel experiment (another agent's); without it the video just opens normally with
  `#labs=reel` in its URL.
- Narrow board columns wrap the stats line onto two lines.

Files: `meta.ts`, `renderer.tsx` (the card block), `main.ts` (IPC `card`), `digest.ts` (+ `digest.test.ts`): the
digest shared with **triage-queue** and **feed-triage**: keep this folder if you keep either of them.
