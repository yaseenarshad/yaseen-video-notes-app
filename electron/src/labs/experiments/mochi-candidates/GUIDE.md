# 🃏 Mochi candidates

**What it does.** A 🃏 Cards tab beside Chapters / Notes listing the analysis's `mochiCandidates` — spans worth a
flashcard. Each card shows its type (term, concept, quote, person, book, stat), the AI's label (dashed "AI label ·"
box — the only AI-written text), and the exact words (`LABS.transcript.text(span)`). **Preview as note** shows the
exact lines the app would write for it as a #mochi range note (CLAUDE.md rule 3; byte-identical to `block()` in
core/notes.ts, unit-tested):

```
> 💬 [0:16–0:21](https://www.youtube.com/watch?v=AQnwQHMnCrE&t=16s) #mochi Reality as an irony maximizer
> “because reality is not just an interestingness max- maximizer, but also an irony maximizer.”
```

Labs is read-only, so it **never writes**: **Copy note line** / **Copy all** put the lines on the clipboard (the app's
own copy, like right-click → Copy note) to paste under the paragraph in the `.md` (or in Obsidian). Cards whose time
overlaps a note you already have are marked **✓ you already noted this** (and "(🃏 mochi)" when that note is a #mochi
one; hover to see your note). Copy all skips those.

**How to try it.**
1. 🧪 Labs → switch on "Mochi candidates"; open (or ⌘R) an analyzed video that has some of your notes.
2. Click the **🃏 Cards** tab. Filter by type with the chips (All · term · concept · …).
3. Click a card to play it; hover to see the words in the transcript.
4. **Preview as note** → read the exact lines; **Copy note line** → paste somewhere; **Copy all** → every shown card
   not yet noted, separated by blank lines.

**Judge it on.** Would you have made cards from these? Are the AI labels useful as the card's front? Would pasting
the copied lines (then your normal Mochi flow) save time compared to selecting the words yourself and pressing N?

**Known limits.**
- The label becomes the note text; edit it after pasting if you want your own words.
- The times are the first and last word's start (what the app writes for a highlight); manual-caption videos have
  approximate word times.
- "Already noted" is a time overlap (a point note within 2 s; a note without a time covers its paragraph), not a
  word-for-word check.
- Pasting goes under the paragraph the preview names (the app would put it after that paragraph's notes).
