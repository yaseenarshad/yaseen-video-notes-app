// Port of Tests/FollowAlongKitTests/ChapterTests.swift.
import { describe, expect, it } from 'vitest'
import { parseVTT } from './captions'
import { format } from './folderMaker'
import { rollingVTT } from './fixtures'
import { insert, isHeading, isParagraph, note, paragraphCount, parse } from './notes'
import { chapter, decodeSidecar, paragraphs, parseInfoJSON, place, videoInfo } from './transcript'

describe('ChapterTests', () => {
  const info = videoInfo({
    id: 'abcdefghijk', title: 'T', channel: 'C', duration: 20, viewCount: 1, uploadDate: '20261017',
    chapters: [chapter(0, 11, 'Intro'), chapter(11.5, 14, 'The Question'), chapter(15.2, 20, 'Yeah #2')],
  })

  it('info.json chapters', () => {
    const json = '{"id":"abcdefghijk","title":"T","chapters":[{"start_time":0.0,"end_time":73.0,"title":"Episode Highlights"},{"start_time":73,"end_time":216,"title":" Welcome "}]}'
    expect(parseInfoJSON(json).chapters).toEqual([chapter(0, 73, 'Episode Highlights'), chapter(73, 216, 'Welcome')])
    expect(parseInfoJSON('{"id":"abcdefghijk"}').chapters).toEqual([])
  })

  it('chapters go above the nearest paragraph', () => {
    const paras = paragraphs(parseVTT(rollingVTT)) // starts 0.48, 11.92, 13.84, 15.01
    expect(place(info.chapters, paras).map((c) => c.para)).toEqual([0, 1, 3])
  })

  it('headings in the markdown do not change paragraphs, words or notes', () => {
    const made = format(info, rollingVTT)
    expect(made.markdown).toContain(`---

## 0:00 Intro

[0:00](https://www.youtube.com/watch?v=abcdefghijk&t=0s) Last night`)
    expect(made.markdown).toContain(`## 0:11 The Question

[0:11](https://www.youtube.com/watch?v=abcdefghijk&t=11s) — What would it cost for that?`)
    expect(made.markdown).toContain(`— Yeah.

## 0:15 Yeah #2

[0:15](https://www.youtube.com/watch?v=abcdefghijk&t=15s) — Yeah.`)
    expect(made.sidecar.chapters?.map((c) => c.para)).toEqual([0, 1, 3])
    expect(paragraphCount(made.markdown)).toBe(4)
    expect(isHeading('## 0:11 The Question')).toBe(true)
    expect(isHeading('#hashtag')).toBe(false)

    // Word-for-word: paragraph lines only; headings are ignored.
    const words: string[] = []
    for (const line of made.markdown.split('\n')) {
      if (!isParagraph(line)) continue
      let ws = line.split(' ').filter((x) => x).slice(1)
      if (ws[0] === '—') ws = ws.slice(1)
      words.push(...ws)
    }
    expect(words).toEqual(parseVTT(rollingVTT).map((w) => w.text))

    // A note on the paragraph before a heading goes above that heading.
    let md = insert(made.markdown, 0, 2, 'first')
    md = insert(md, 0, 3, 'second')
    expect(md).toContain(`street legal.

> 💬 [0:02](https://www.youtube.com/watch?v=abcdefghijk&t=2s) first

> 💬 [0:03](https://www.youtube.com/watch?v=abcdefghijk&t=3s) second

## 0:11 The Question`)
    md = insert(md, 1, 12, 'range', 13, 'would it cost')
    expect(parse(md)).toEqual([
      note(0, 2, 'first'),
      note(0, 3, 'second'),
      note(1, 12, 'range', 13, 'would it cost'),
    ])
  })

  it('old sidecars without chapters still load', () => {
    const json = '{"version":1,"id":"x","title":"t","channel":"c","duration":1,"paras":[{"turn":false,"w":["a"]}],"t":[[0]]}'
    expect(decodeSidecar(json).chapters).toBeUndefined()
  })
})
