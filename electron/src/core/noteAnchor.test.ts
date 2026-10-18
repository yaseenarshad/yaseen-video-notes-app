import { describe, expect, it } from 'vitest'
import { noteAnchor } from './noteAnchor'

// Two paragraphs; one word per half second.
const p0 = 'So the thing is humans are generalized. We are not like labbotomized'.split(' ')
const p1 = 'and specialized. If you want to have humanoid type robots, the model is the product.'.split(' ')
const words = [p0, p1]
const times = [p0.map((_, j) => 10 + j * 0.5), p1.map((_, j) => 20 + j * 0.5)]
const text = (cover: [number, number][]): string => cover.map(([p, j]) => words[p][j]).join(' ')

describe('noteAnchor', () => {
  it('a note with no time stays at the bottom', () => {
    expect(noteAnchor(words, times, { para: 0, time: null })).toEqual({ anchor: -1, cover: [], mark: -1 })
    expect(noteAnchor(words, times, { para: 5, time: 3 })).toEqual({ anchor: -1, cover: [], mark: -1 })
  })

  it('a point note goes after the word spoken at its time, with a marker', () => {
    // 13 s → word 6 (10 + 6 × 0.5 = 13): "generalized."
    expect(noteAnchor(words, times, { para: 0, time: 13 })).toEqual({ anchor: 6, cover: [], mark: 6 })
    // a time before / after the paragraph is clamped to its first / last word
    expect(noteAnchor(words, times, { para: 1, time: 5 })).toEqual({ anchor: 0, cover: [], mark: 0 })
    expect(noteAnchor(words, times, { para: 0, time: 99 })).toEqual({ anchor: p0.length - 1, cover: [], mark: p0.length - 1 })
  })

  it('a range note uses the quote to pin the exact words', () => {
    const r = noteAnchor(words, times, { para: 0, time: 15, end: 15, quote: 'like labbotomized' })
    expect(text(r.cover)).toBe('like labbotomized')
    expect(r).toMatchObject({ anchor: p0.length - 1, mark: -1 })
    // a repeated word: the one at the note's time, not an earlier one
    const r2 = noteAnchor(words, times, { para: 1, time: 25, end: 25, quote: 'the' })
    expect(r2.cover).toEqual([[1, 10]])
    expect(r2.anchor).toBe(10)
  })

  it('the short form "first … last" covers everything between', () => {
    const r = noteAnchor(words, times, { para: 1, time: 20, end: 27, quote: 'and specialized. If you … is the product.' })
    expect(text(r.cover)).toBe(p1.join(' '))
    expect(r.anchor).toBe(p1.length - 1)
  })

  it('a highlight that starts or ends inside a word still matches', () => {
    const r = noteAnchor(words, times, { para: 0, time: 12, end: 13, quote: 'umans are general' })
    expect(text(r.cover)).toBe('humans are generalized.')
    expect(r.anchor).toBe(6)
  })

  it('a highlight across paragraphs covers both, anchored in the note paragraph', () => {
    const r = noteAnchor(words, times, { para: 1, time: 15, end: 20, quote: 'like labbotomized and specialized.' })
    expect(text(r.cover)).toBe('like labbotomized and specialized.')
    expect(r.anchor).toBe(1)
  })

  it('falls back to times when the quote does not match', () => {
    // 12–13 s: words at 12, 12.5, 13, 13.5 (end second inclusive)
    const r = noteAnchor(words, times, { para: 0, time: 12, end: 13, quote: 'something edited by hand' })
    expect(text(r.cover)).toBe('humans are generalized. We')
    expect(r.anchor).toBe(7)
    // no quote at all: times only
    expect(text(noteAnchor(words, times, { para: 0, time: 12, end: 13 }).cover)).toBe('humans are generalized. We')
  })

  it('a range past the end of its paragraph is clamped to its last word', () => {
    const r = noteAnchor(words, times, { para: 0, time: 40, end: 45 })
    expect(r).toEqual({ anchor: p0.length - 1, cover: [], mark: -1 })
  })

  it('is self-contained (served to the page as source)', () => {
    const fn = new Function('return (' + noteAnchor.toString() + ')')() as typeof noteAnchor
    expect(fn(words, times, { para: 0, time: 15, end: 15, quote: 'like labbotomized' }).anchor).toBe(p0.length - 1)
  })
})
