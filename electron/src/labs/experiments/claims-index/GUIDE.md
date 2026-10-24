# 📌 Claims index

**What it does.** A 📌 Claims tab beside Chapters / Notes: the analysis's `claims` grouped by type — 🔢 numbers &
stats, 👤 people, 🏢 companies & products, 📚 books, 💥 bold claims — with counts, each line in the speakers' exact
words (`LABS.transcript.text(span)`). People, companies and books are merged by their text (case, punctuation, a
possessive 's and a leading "the" ignored) and **every other place the transcript says the same words** is added, so
a name shows once with **×3** and one clickable time chip per mention, plus a few words of context around the first.

**How to try it.**
1. 🧪 Labs → switch on "Claims index"; open (or ⌘R) an analyzed video.
2. Click the **📌 Claims** tab. Click a type chip at the top (e.g. **👤 People 14**) to jump to that group; click a
   group header to fold it.
3. Click any line to play from there; hover to see its words marked in the transcript.
4. On a repeated name, click a time chip (hover it first: it shows the words around that mention and whether the
   analysis marked it or it was found by searching the transcript).
5. Type in the filter (e.g. `tesla`, `%`, `billion`) to narrow every group.

**Judge it on.** After a long episode, is this the list you'd want for "who/what was that again?" and for checking
a number? Are the bold claims really bold, and the stats real numbers? Does "×3" help you find the place you
remember?

**Known limits.**
- The analysis picks the claims; it misses some and its types are sometimes off (a book title marked as a claim).
- Merging is by exact words: "Elon" and "Elon Musk" stay separate rows; auto-caption misspellings ("Ilia Sutska")
  only match the same misspelling.
- The extra mentions come from a plain word search, so a common one-word name ("Sam") can pick up other people.
