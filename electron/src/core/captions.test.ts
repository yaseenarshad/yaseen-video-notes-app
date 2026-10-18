// Port of Tests/FollowAlongKitTests/CaptionsTests.swift (CaptionsTests, TranscriptTests, SlugTests).
import { describe, expect, it } from 'vitest'
import { parseTime, parseVTT, word, type CaptionWord } from './captions'
import { format } from './folderMaker'
import { rollingVTT } from './fixtures'
import { isParagraph } from './notes'
import { clock, decodeSidecar, encodeSidecar, endsSentence, folderName, hms, paraStart, paragraphs, parseYouTubeID, slug, videoInfo } from './transcript'
import { commentMask } from './guide'

describe('CaptionsTests', () => {
  it('rolling captions keep every word once in order', () => {
    expect(parseVTT(rollingVTT).map((w) => w.text)).toEqual([
      'Last', 'night', 'in', 'Waco,', 'Texas,', 'it', 'is', 'street', 'legal.',
      'What', 'would', 'it', 'cost', 'for', 'that?', 'Yeah.', 'Yeah.',
    ])
  })

  it('word times come from tags', () => {
    const words = parseVTT(rollingVTT)
    expect(words[0].time).toBeCloseTo(0.48, 3) // first word = cue start
    expect(words[1].time).toBeCloseTo(0.88, 3)
    expect(words[5].time).toBeCloseTo(3.36, 3)
    expect(words[14].time).toBeCloseTo(13.519, 3) // untagged "that?" = its cue start
  })

  it('speaker markers become turns and are removed', () => {
    const words = parseVTT(rollingVTT)
    expect(words.some((w) => w.text.includes('>'))).toBe(false)
    expect(words.filter((w) => w.newTurn).map((w) => w.text)).toEqual(['What', 'Yeah.', 'Yeah.'])
  })

  it('manual captions spread the cue time across words', () => {
    const vtt = `WEBVTT

1
00:00:10.000 --> 00:00:14.000
<v Ann>Hello there big world</v>

2
00:00:14.000 --> 00:00:16.000
&gt;&gt; Second &amp; last`
    const words = parseVTT(vtt)
    expect(words.map((w) => w.text)).toEqual(['Hello', 'there', 'big', 'world', 'Second', '&', 'last'])
    expect(words.map((w) => w.time)).toEqual([10, 11, 12, 13, 14, 14 + 2.0 / 3, 14 + 4.0 / 3])
    expect(words[4].newTurn).toBe(true)
  })

  it('timestamp parsing', () => {
    expect(parseTime('00:01:02.500')).toBe(62.5)
    expect(parseTime('01:02.250')).toBe(62.25)
    expect(parseTime('1:00:00,000')).toBe(3600)
  })
})

describe('TranscriptTests', () => {
  it('paragraph count follows turns', () => {
    const paras = paragraphs(parseVTT(rollingVTT))
    // One paragraph before the first ">>", then one per ">>".
    expect(paras.length).toBe(4)
    expect(paras.map((p) => p.turn)).toEqual([false, true, true, true])
    expect(paras[1].words.join(' ')).toBe('What would it cost for that?')
  })

  it('a long turn breaks after 110 words at a sentence end', () => {
    const words: CaptionWord[] = []
    for (let i = 0; i < 300; i++) words.push(word(i % 10 === 9 ? `end${i}.` : `w${i}`, i))
    const paras = paragraphs(words)
    expect(paras.map((p) => p.words.length)).toEqual([110, 110, 80])
    expect(paraStart(paras[1])).toBe(110)
    expect(paras[1].turn).toBe(false)
    expect(endsSentence('done."')).toBe(true)
    expect(endsSentence('why?)')).toBe(true)
    expect(endsSentence('Mr')).toBe(false)
  })

  it('captions without punctuation still break', () => {
    // 500 words, no punctuation, a 1 s pause after word 200
    const words = Array.from({ length: 500 }, (_, i) => word(`w${i}`, i * 0.3 + (i > 200 ? 1 : 0)))
    const paras = paragraphs(words)
    expect(paras.map((p) => p.words.length)).toEqual([201, 220, 79])
    expect(paras.flatMap((p) => p.words)).toEqual(words.map((w) => w.text))
  })

  it('markdown preserves every word and has the header', () => {
    const info = videoInfo({ id: 'dthaDyttHns', title: 'A Title: With Stuff', channel: 'Chan', duration: 6271, viewCount: 31804, uploadDate: '20261017' })
    const made = format(info, rollingVTT)
    expect(made.markdown.startsWith(`# A Title: With Stuff

- channel: Chan
- url: https://www.youtube.com/watch?v=dthaDyttHns
- duration: 1:44:31
- views: 31804
- uploaded: 20261017

<!-- follow-along guide v1 — rules for agents editing this file (the Follow Along app reads it)
- Paragraph lines start with [m:ss](youtube link). Never add, remove, merge, reorder or reword them.
- Notes go under their paragraph: > 💬 [m:ss](link&t=Ns) text
  Note on highlighted words: > 💬 [m:ss–m:ss](link&t=Ns) text, then a last line > “quote”
- Tags right after the time: #mochi = make a flashcard from this note; #resolved = done. No #resolved = open.
- Only work on notes WITHOUT #resolved. When done: add #resolved (keep other tags) and a line > ↳ resolved: what you did.
- Hand-typed notes: > 💬 text (no time) under the paragraph.
- Never delete the user's note text. Leave the header, ## chapter headings and frontmatter alone.
Full spec: docs/how-it-works.md in github.com/yaseenarshad/video-follow-along-app
-->

---

[0:00](https://www.youtube.com/watch?v=dthaDyttHns&t=0s) Last night in Waco, Texas, it is street legal.

[0:11](https://www.youtube.com/watch?v=dthaDyttHns&t=11s) — What would it cost for that?
`)).toBe(true)
    // Words in the .md (without links and dashes) == caption words, in order.
    const mdWords: string[] = []
    const mdLines = made.markdown.split('\n'), inComment = commentMask(mdLines)
    for (const [i, line] of mdLines.entries()) {
      if (inComment[i] || !isParagraph(line)) continue
      let ws = line.split(' ').filter((x) => x).slice(1)
      if (ws[0] === '—') ws = ws.slice(1)
      mdWords.push(...ws)
    }
    expect(mdWords).toEqual(parseVTT(rollingVTT).map((w) => w.text))
    expect(made.sidecar.paras.flatMap((p) => p.w)).toEqual(mdWords)
    expect(made.sidecar.t.map((t) => t.length)).toEqual(made.sidecar.paras.map((p) => p.w.length))
    expect(made.markdown.endsWith('— Yeah.\n')).toBe(true)
  })

  it('clock formats', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(62.9)).toBe('1:02')
    expect(clock(3725)).toBe('1:02:05')
    expect(hms(6271)).toBe('1:44:31')
    expect(hms(330)).toBe('0:05:30')
  })

  it('sidecar round trip', () => {
    const info = videoInfo({ id: 'abcdefghijk', title: 'T', channel: 'C', duration: 1, viewCount: 2, uploadDate: '20260101' })
    const made = format(info, rollingVTT)
    const back = decodeSidecar(encodeSidecar(made.sidecar))
    expect(back).toEqual(made.sidecar)
    expect(back.t[0][1]).toBe(0.88)
  })
})

describe('SlugTests', () => {
  it('slug matches the vault folders', () => {
    const title = 'Flying Tesla Car, Robot Brains Halving in Cost Every 3 Weeks, and Why Incentives Decide AI Alignment'
    expect(slug(title)).toBe('flying-tesla-car-robot-brains-halving-in-cost-every-3-weeks-and-why-incentives-d')
    expect(slug("We're Already Inside the Singularity | Dr. Alex Wissner-Gross")).toBe('we-re-already-inside-the-singularity-dr-alex-wissner-gross')
    expect(slug('  --Hello,   World!!  ')).toBe('hello-world')
    expect(slug('🔥🔥')).toBe('video')
  })

  it('truncation drops a trailing dash', () => {
    expect(slug('a'.repeat(79) + ' bcd')).toBe('a'.repeat(79))
  })

  it('folder name', () => {
    expect(folderName('Hi There', new Date(2026, 9, 7))).toBe('10-07-hi-there')
  })

  it('YouTube ids', () => {
    expect(parseYouTubeID('https://www.youtube.com/watch?v=dthaDyttHns')).toBe('dthaDyttHns')
    expect(parseYouTubeID('https://www.youtube.com/watch?list=x&v=dthaDyttHns&t=10s')).toBe('dthaDyttHns')
    expect(parseYouTubeID('https://youtu.be/dthaDyttHns?si=abc')).toBe('dthaDyttHns')
    expect(parseYouTubeID('https://www.youtube.com/shorts/dthaDyttHns')).toBe('dthaDyttHns')
    expect(parseYouTubeID('dthaDyttHns')).toBe('dthaDyttHns')
    expect(parseYouTubeID('https://example.com/')).toBeNull()
  })
})
