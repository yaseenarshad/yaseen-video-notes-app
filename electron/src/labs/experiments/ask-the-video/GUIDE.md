# 🔎 Ask the video

**What it does.** A 🔎 Ask tab beside Chapters / Notes: ask "where do they talk about X?" and get passages of the
transcript, word for word, with their times; click = play from there. It works **without an analysis**. Two engines,
chosen automatically, and the tab always says which one answered:

- **⚡ Keyword search (local, instant, as you type).** Searches the paragraphs with light stemming (robots → robot,
  making → make), synonym groups (jobs ↔ work / employment, money ↔ wealth / dollars, AI ↔ AGI / LLM …), longer forms
  (robot → robotic, workers → work) and typo tolerance (only for words that are not in the video: "simulaton" →
  simulation). Ranked with BM25 plus bonuses for paragraphs that have every query word and have them close together;
  filler ("where do they talk about", "the part where") is ignored; `"quoted phrases"` must appear as written. The top
  8 are shown (one per stretch of talk), each as the best ~40-word window of its paragraph out to sentence ends, with
  the matching words marked. A strip shows where in the video they are; 🔎 marks them in the time column.
- **🤖 AI (Enter or "Ask AI").** The question and the numbered transcript go to `claude -p` (main.ts → ai.ts); the
  answer may only be paragraph/word spans with anchor words, validated like the analysis (numbers moved to their
  anchors, unverifiable or out-of-range spans dropped, overlaps resolved, ≤ 150 words, ≤ 8). Only the transcript's
  words are shown. Answers are cached in Labs' userData (`labs-cache/<id>/ask-<hash>.json`), so asking again is
  instant. AI passages show above the keyword matches.
- When `claude` is logged out (now: "OAuth session expired") the tab says **"AI search needs `claude` login — showing
  keyword matches"** and keeps the ⚡ results; after such an error the AI is skipped for 10 minutes ("try again"
  forces it).

**How to try it.**
1. 🧪 Labs → switch on "Ask the video"; open (or ⌘R) any video.
2. Press **/** (after clicking the transcript) or click the **🔎 Ask** tab. Type e.g. `universal income`,
   `why robots get cheaper`, `kids`, `"end of work"`. Results update as you type.
3. Press **Enter** to also ask Claude (needs `claude` logged in: run `claude` in a terminal and `/login`).
4. Click a passage to play it; hover to see it in the transcript; click the strip to jump. Esc clears.
5. "Searching for: …" under the box shows what was searched; hover it to see every related form used.

**Judge it on.** Do you find "that part about X" faster than scrubbing or ⌃F? Are the top 3 keyword results the
right places? When Claude is logged in: does the AI find the places where the topic is discussed without the word
being said, and is it worth the wait (≈ 30–90 s for a 2 h video, then cached)?

**Known limits.**
- The keyword engine is lexical: it can't find a topic that is never named with any of the words or synonyms (that
  is what the AI engine is for). Synonym groups are a small hand-made list.
- Stemming is approximate (English only); over-eager matches are possible ("universal" also finds "universe", a
  shorter form, at a lower weight).
- The AI engine sends the whole transcript per question (one call up to ~45k words, more calls above).
- Tested end to end with the real `claude` (logged out → the message) and with a stand-in `claude` script
  (`VIDEO_NOTES_CLAUDE=…`) for the success path; not yet with a logged-in Claude.
