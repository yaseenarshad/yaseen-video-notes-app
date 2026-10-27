// Labs experiment "slides": the frame measures, the slide-vs-camera classifier, the deck rules (changes, camera mask,
// stability, builds, repeats, no-slides), OCR reading order and the yt-dlp progress parser — on synthetic frames.
import { describe, expect, it } from 'vitest'
import { buildDeck, compare, motionMask, stableRuns, DECK_DEFAULTS } from './deck'
import { classify, dHash, frameStats, FH, FW, GC, hamming, SH, SW, type FrameKind, type FrameStats } from './frames'
import { downloadPct } from './extract'
import { ocrText } from './ocr'

// ---------- synthetic pictures ----------
/** A 320×180 RGB frame filled with one colour. */
function rgbFrame(r: number, g: number, b: number): Uint8Array {
  const f = new Uint8Array(FW * FH * 3)
  for (let i = 0; i < f.length; i += 3) { f[i] = r; f[i + 1] = g; f[i + 2] = b }
  return f
}
/** "Text": black/white stripes (hard edges) in a box. */
function textBox(f: Uint8Array, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const v = (x + Math.floor(y / 3)) % 4 < 2 ? 20 : 240, i = (y * FW + x) * 3
    f[i] = f[i + 1] = f[i + 2] = v
  }
}
/** Seeded noise (a camera image: soft shading everywhere, thousands of colours). */
function noise(seed: number): () => number { let s = seed; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) }
function cameraFrame(seed: number): Uint8Array {
  const f = new Uint8Array(FW * FH * 3), rnd = noise(seed)
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const i = (y * FW + x) * 3, base = 90 + 60 * Math.sin(x / 23 + seed) + 40 * Math.cos(y / 17)
    f[i] = base + rnd() * 30; f[i + 1] = base * 0.8 + rnd() * 30; f[i + 2] = base * 0.6 + rnd() * 30
  }
  return f
}

/** An 80×45 thumbnail: background 235, "text" rows drawn with stripes (content), optional noisy corner (a speaker cam). */
function thumb(rows: { x: number; y: number; w: number; h?: number }[], camSeed?: number): Uint8Array {
  const a = new Uint8Array(SW * SH).fill(235)
  for (const r of rows) for (let y = r.y; y < r.y + (r.h ?? 3); y++) for (let x = r.x; x < r.x + r.w; x++) a[y * SW + x] = x % 2 ? 30 : 220
  if (camSeed !== undefined) {
    const rnd = noise(camSeed)
    for (let y = 30; y < SH; y++) for (let x = 70; x < SW; x++) a[y * SW + x] = 60 + rnd() * 150
  }
  return a
}
const fr = (t: number, small: Uint8Array, kind: FrameKind = 'slide'): FrameStats => ({ t, small, kind, flat: 0, soft: 0, sharp: 0, top8: 0 })
function seq(start: number, n: number, make: (t: number) => FrameStats): FrameStats[] { return Array.from({ length: n }, (_, i) => make(start + i)) }

const TITLE_A = { x: 5, y: 2, w: 40 }, TITLE_B = { x: 5, y: 2, w: 55 }
const BULLET1 = { x: 8, y: 14, w: 50 }, BULLET2 = { x: 8, y: 22, w: 45 }

describe('one frame', () => {
  it('tells a slide, a camera image and a blank screen apart', () => {
    const slide = rgbFrame(250, 250, 250)
    textBox(slide, 20, 10, 260, 22); textBox(slide, 30, 60, 200, 10); textBox(slide, 30, 90, 180, 10)
    const s = frameStats(0, slide)
    expect(s.kind).toBe('slide')
    expect(s.flat).toBeGreaterThan(0.4)
    expect(s.sharp).toBeGreaterThan(0.015)
    expect(frameStats(1, cameraFrame(3)).kind).toBe('camera')
    expect(frameStats(2, rgbFrame(0, 0, 0)).kind).toBe('blank')
    expect(s.small.length).toBe(SW * SH)
  })

  it('a slide with a speaker camera in a corner (picture in picture) is still a slide', () => {
    const f = rgbFrame(250, 250, 250)
    textBox(f, 20, 10, 260, 22); textBox(f, 30, 60, 160, 10); textBox(f, 30, 90, 150, 10)
    const cam = cameraFrame(9)
    for (let y = 120; y < FH; y++) for (let x = 250; x < FW; x++) for (let k = 0; k < 3; k++) f[(y * FW + x) * 3 + k] = cam[(y * FW + x) * 3 + k]
    expect(frameStats(0, f).kind).toBe('slide')
  })

  it('classify rules', () => {
    expect(classify({ flat: 0.5, soft: 0.1, sharp: 0.06, top8: 0.95 })).toBe('slide')
    expect(classify({ flat: 0.36, soft: 0.59, sharp: 0.005, top8: 0.86 })).toBe('camera')   // a dark interview shot
    expect(classify({ flat: 0.26, soft: 0.38, sharp: 0.05, top8: 0.76 })).toBe('camera')    // a patterned wall
    expect(classify({ flat: 0.99, soft: 0, sharp: 0, top8: 1 })).toBe('blank')
  })

  it('dHash: same picture → distance 0, different picture → far', () => {
    const a = thumb([TITLE_A, BULLET1]), b = thumb([{ x: 40, y: 30, w: 35, h: 10 }])
    expect(dHash(a)).toMatch(/^[0-9a-f]{16}$/)
    expect(hamming(dHash(a), dHash(a))).toBe(0)
    expect(hamming(dHash(a), dHash(b))).toBeGreaterThan(8)
  })
})

describe('the deck', () => {
  it('compare: same / build (content added below, title kept) / different (new title)', () => {
    const mask = new Uint8Array(GC * 9)
    const a = thumb([TITLE_A, BULLET1])
    expect(compare(a, thumb([TITLE_A, BULLET1]), mask)).toBe('same')
    expect(compare(a, thumb([TITLE_A, BULLET1, BULLET2]), mask)).toBe('build')
    expect(compare(a, thumb([TITLE_B, BULLET1]), mask)).toBe('different')
    expect(compare(thumb([TITLE_A, BULLET1, BULLET2]), a, mask)).toBe('different')   // removing is not a build
  })

  it('masks the moving speaker camera, groups builds, skips transitions and camera shots, finds repeats', () => {
    let seed = 1
    const A = () => thumb([TITLE_A, BULLET1], seed++)
    const A2 = () => thumb([TITLE_A, BULLET1, BULLET2], seed++)
    const B = () => thumb([TITLE_B, { x: 10, y: 18, w: 60, h: 8 }], seed++)
    const frames = [
      ...seq(0, 20, (t) => fr(t, A())),
      fr(20, thumb([TITLE_A, BULLET1, { x: 8, y: 22, w: 20 }], seed++)),   // mid-transition (half the bullet)
      ...seq(21, 15, (t) => fr(t, A2())),                                   // build: + a bullet
      ...seq(36, 20, (t) => fr(t, B())),
      ...seq(56, 10, (t) => fr(t, thumb([{ x: 0, y: 0, w: 80, h: 45 }], 100 + t), 'camera')),
      ...seq(66, 12, (t) => fr(t, A2())),                                   // slide A again later
      ...seq(78, 10, (t) => fr(t, B())),
    ]
    const mask = motionMask(frames)
    expect(mask.reduce((x, y) => x + y, 0)).toBeGreaterThan(0)
    expect(mask[GC * 8 + 15]).toBe(1)   // the bottom-right corner
    expect(mask[0]).toBe(0)
    const runs = stableRuns(frames, mask)
    expect(runs.every((r) => r.b - r.a + 1 >= DECK_DEFAULTS.stableSeconds)).toBe(true)
    const deck = buildDeck(frames, 88, { minSlideShare: 0.1, minSlides: 2 })
    expect(deck.noSlides).toBe(false)
    expect(deck.slides.map((s) => [s.n, s.t0, s.steps.length, s.repeatOf ?? 0])).toEqual([[1, 0, 2, 0], [2, 36, 1, 0], [3, 66, 1, 1], [4, 78, 1, 2]])
    const [s1, s2] = deck.slides
    expect(s1.steps).toEqual([{ t0: 0, t1: 20 }, { t0: 21, t1: 36 }])
    expect(s1.grab).toBeGreaterThanOrEqual(21)   // the final (fullest) state, never the transition frame
    expect(s1.grab).not.toBe(20)
    expect(s1.t1).toBe(36)
    expect(s2.t1).toBe(66)                       // a short camera shot stays part of the slide before it
    expect(deck.stats.builds).toBe(1)
    expect(deck.stats.repeats).toBe(2)
  })

  it('a long camera stretch ends the slide; a picture shown < stableSeconds is skipped', () => {
    const frames = [
      ...seq(0, 30, (t) => fr(t, thumb([TITLE_A, BULLET1]))),
      fr(30, thumb([TITLE_B])),                                                        // 1 s flash: not a slide
      ...seq(31, 200, (t) => fr(t, thumb([{ x: 0, y: 0, w: 80, h: 45 }], t), 'camera')),
      ...seq(231, 30, (t) => fr(t, thumb([TITLE_B, BULLET2]))),
      ...seq(261, 60, (t) => fr(t, thumb([{ x: 20, y: 10, w: 30, h: 20 }]))),
    ]
    const deck = buildDeck(frames, 321, { minSlideShare: 0.1 })
    expect(deck.slides.map((s) => [s.t0, s.t1])).toEqual([[0, 30], [231, 261], [261, 321]])
  })

  it('an interview (camera all the time, a few photo inserts) → no slides found', () => {
    const frames = [
      ...seq(0, 300, (t) => fr(t, thumb([{ x: 0, y: 0, w: 80, h: 45 }], t), 'camera')),
      ...seq(300, 5, (t) => fr(t, thumb([TITLE_A]))),
      ...seq(305, 300, (t) => fr(t, thumb([{ x: 0, y: 0, w: 80, h: 45 }], t), 'camera')),
      ...seq(605, 5, (t) => fr(t, thumb([TITLE_B]))),
    ]
    const deck = buildDeck(frames, 610)
    expect(deck.noSlides).toBe(true)
    expect(deck.slides).toEqual([])
    expect(deck.reason).toMatch(/^slides are on screen 2% of the video/)
  })
})

describe('helpers', () => {
  it('OCR text in reading order: rows top to bottom, left to right; low confidence dropped', () => {
    expect(ocrText([
      { text: 'right', conf: 0.9, x: 0.6, y: 0.3, h: 0.04 },
      { text: 'Title', conf: 0.99, x: 0.05, y: 0.05, h: 0.08 },
      { text: 'left', conf: 0.9, x: 0.1, y: 0.31, h: 0.04 },
      { text: 'noise', conf: 0.1, x: 0.5, y: 0.9, h: 0.02 },
    ])).toBe('Title\nleft   right')
  })

  it('reads the yt-dlp download progress', () => {
    expect(downloadPct('[download]  45.3% of   23.04MiB at    5.23MiB/s ETA 00:00')).toBe(45.3)
    expect(downloadPct('[download] Destination: x.mp4')).toBeNull()
  })
})
