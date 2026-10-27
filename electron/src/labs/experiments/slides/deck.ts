// Labs experiment "slides": from the sampled frames (1 per second, frames.ts) to the deck — plain code, no AI.
// Pure (no I/O), unit-tested in slides.test.ts. The rules, in plain words (also in GUIDE.md and docs/labs.md):
//
// 1. Change detection. Each frame is shrunk to 80×45 grey and cut into a 16×9 grid. Two frames "differ" when at least
//    `changeCells` of the grid cells changed (a cell changed = its pixels moved by more than `cellThreshold` on average).
//    That grid is a small perceptual hash: compression noise and tiny jitter do not count, a new slide or a new bullet does.
// 2. The speaker camera (picture in picture). Grid cells that change in more than `motionShare` of all consecutive slide
//    frames are the live camera box in a corner; they are masked out of every comparison, so a moving speaker never
//    looks like a new slide.
// 3. Stability. A picture counts only once it stays the same for `stableSeconds` (a "stable run"). Frames in between —
//    transitions, fades, an animation — are skipped. The grab time is taken inside the run, ~2 s after it settled.
// 4. Slide or camera. Each frame is classified (frames.ts: flat background, hard text edges, few colours, little soft
//    shading); a run is what most of its frames are. Camera and blank runs never become slides.
// 5. Builds. When the next slide is the previous one PLUS new content (every changed cell was empty background before)
//    it is a build step of the same slide: one deck entry, the image is the final (fullest) state, `steps` keeps when
//    each part appeared.
// 6. Same slide again. The same picture right after a camera cut continues the slide; the same picture later in the
//    talk (after other slides) is a new entry with `repeatOf` = the earlier slide's number.
// 7. Times. A slide starts when its first stable picture starts; it lasts until the next slide starts — unless the
//    video shows no slide for longer than `attachGap` seconds after it (Q&A on camera), then it ends with its picture.
// 8. No slides. When slides are on screen less than `minSlideShare` of the video, or there are fewer than `minSlides`,
//    the result is "no slides found" (an interview with a few photo inserts is not a deck).

import { cellContent, cellDiffs, changedCells, dHash, GC, GR, type FrameKind, type FrameStats } from './frames'

export interface DeckOptions {
  cellThreshold: number
  changeCells: number
  stableSeconds: number
  motionShare: number
  /** Two pictures are the same slide when fewer than this share of the (unmasked) cells differ. */
  sameCells: number
  /** A build step changes at most this share of the cells. */
  buildMaxCells: number
  /** A cell is empty background when its content (standard deviation, 0–255) is below this. */
  emptyContent: number
  /** A build may change this share of the earlier picture's content (a line moved down to make room for a new one). */
  buildSlack: number
  attachGap: number
  /** The camera mask may cover at most this share of the grid. */
  maxMask: number
  minSlideShare: number
  minSlides: number
}

export const DECK_DEFAULTS: DeckOptions = {
  cellThreshold: 6, changeCells: 0.012, stableSeconds: 2, motionShare: 0.2, sameCells: 0.012,
  buildMaxCells: 0.6, emptyContent: 5, buildSlack: 0.25, attachGap: 120, maxMask: 0.4, minSlideShare: 0.2, minSlides: 3,
}

export interface Run { a: number; b: number; kind: FrameKind; pick: number }
export interface Step { t0: number; t1: number }
export interface DeckSlide {
  n: number
  t0: number
  t1: number
  /** Seconds: when to take the full-resolution picture (inside the final state's longest stable run). */
  grab: number
  /** Each build state's first appearance (one entry = no build). */
  steps: Step[]
  repeatOf?: number
  /** dHash of the final state (thumbnail). */
  hash: string
}
export interface DeckStats {
  frames: number
  slideFrames: number
  cameraFrames: number
  blankFrames: number
  runs: number
  slideRuns: number
  maskedCells: number
  builds: number
  repeats: number
  merged: number
}
export interface Deck { slides: DeckSlide[]; noSlides: boolean; reason?: string; stats: DeckStats; mask: number[] }

/** Cells that change in more than `motionShare` of the consecutive slide-frame pairs (+ their moving neighbours). */
export function motionMask(frames: FrameStats[], o: DeckOptions = DECK_DEFAULTS): Uint8Array {
  const count = new Float32Array(GC * GR)
  let pairs = 0
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].kind !== 'slide' || frames[i - 1].kind !== 'slide') continue
    pairs++
    changedCells(cellDiffs(frames[i - 1].small, frames[i].small), null, o.cellThreshold).forEach((c) => count[c]++)
  }
  const mask = new Uint8Array(GC * GR)
  if (pairs < 10) return mask
  for (let c = 0; c < mask.length; c++) if (count[c] / pairs > o.motionShare) mask[c] = 1
  // grow by one cell where the neighbour moves often too (the edge of the camera box)
  const grown = mask.slice()
  for (let c = 0; c < mask.length; c++) {
    if (mask[c]) continue
    const x = c % GC, y = Math.floor(c / GC)
    const near = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => nx >= 0 && nx < GC && ny >= 0 && ny < GR && mask[ny * GC + nx])
    if (near && count[c] / pairs > o.motionShare / 4) grown[c] = 1
  }
  // a camera box covers a corner, not most of the frame: a mask that big means "everything moves" — no mask then
  return grown.reduce((a, b) => a + b, 0) > grown.length * o.maxMask ? new Uint8Array(GC * GR) : grown
}

const unmasked = (mask: Uint8Array): number => Math.max(1, mask.length - mask.reduce((a, b) => a + b, 0))

/** The share of unmasked cells that differ between two thumbnails. */
export function differShare(a: Uint8Array, b: Uint8Array, mask: Uint8Array, o: DeckOptions = DECK_DEFAULTS): number {
  return changedCells(cellDiffs(a, b), mask, o.cellThreshold).length / unmasked(mask)
}

/** Stable runs: stretches of ≥ stableSeconds frames where each frame looks like the one before. */
export function stableRuns(frames: FrameStats[], mask: Uint8Array, o: DeckOptions = DECK_DEFAULTS): Run[] {
  const runs: Run[] = []
  let a = 0
  const close = (b: number) => {
    if (b - a + 1 >= o.stableSeconds) {
      const votes: Record<FrameKind, number> = { slide: 0, camera: 0, blank: 0 }
      for (let i = a; i <= b; i++) votes[frames[i].kind]++
      const kind = (Object.keys(votes) as FrameKind[]).sort((x, y) => votes[y] - votes[x])[0]
      runs.push({ a, b, kind, pick: a + Math.min(2, b - a) })
    }
  }
  for (let i = 1; i <= frames.length; i++) {
    if (i === frames.length || differShare(frames[i - 1].small, frames[i].small, mask, o) >= o.changeCells) { close(i - 1); a = i }
  }
  return runs
}

/**
 * 'same' when (almost) nothing changed; 'build' when `b` is `a` plus new content: something was added where `a` was
 * empty background, the title band (top two grid rows) did not change, and at most `buildSlack` of `a`'s content (at
 * least 2 cells) changed (a line that moved down to make room); else 'different'.
 */
export function compare(a: Uint8Array, b: Uint8Array, mask: Uint8Array, o: DeckOptions = DECK_DEFAULTS): 'same' | 'build' | 'different' {
  const changed = changedCells(cellDiffs(a, b), mask, o.cellThreshold)
  const share = changed.length / unmasked(mask)
  if (share < o.sameCells) return 'same'
  if (share > o.buildMaxCells) return 'different'
  const ca = cellContent(a), cb = cellContent(b)
  const added = changed.filter((c) => ca[c] < o.emptyContent && cb[c] >= o.emptyContent).length
  const lost = changed.filter((c) => ca[c] >= o.emptyContent)
  let content = 0
  for (let c = 0; c < ca.length; c++) if (!mask[c] && ca[c] >= o.emptyContent) content++
  const titleTouched = changed.some((c) => c < 2 * GC)
  return added > 0 && !titleTouched && lost.length <= Math.max(2, Math.floor(content * o.buildSlack)) ? 'build' : 'different'
}

interface Group { runs: Run[]; states: { runs: Run[] }[]; repeatOf?: number }

/** The deck: see the rules at the top of this file. `duration` = the video's length in seconds. */
export function buildDeck(frames: FrameStats[], duration: number, opts: Partial<DeckOptions> = {}): Deck {
  const o = { ...DECK_DEFAULTS, ...opts }
  const mask = motionMask(frames, o)
  const runs = stableRuns(frames, mask, o)
  const t = (i: number) => frames[Math.min(i, frames.length - 1)].t
  const small = (r: Run) => frames[r.pick].small
  const stats: DeckStats = {
    frames: frames.length,
    slideFrames: frames.filter((f) => f.kind === 'slide').length,
    cameraFrames: frames.filter((f) => f.kind === 'camera').length,
    blankFrames: frames.filter((f) => f.kind === 'blank').length,
    runs: runs.length, slideRuns: runs.filter((r) => r.kind === 'slide').length,
    maskedCells: mask.reduce((a, b) => a + b, 0), builds: 0, repeats: 0, merged: 0,
  }
  const groups: Group[] = []
  for (const r of runs) {
    if (r.kind !== 'slide') continue
    const g = groups[groups.length - 1]
    if (g) {
      const last = g.states[g.states.length - 1]
      const rel = compare(small(last.runs[last.runs.length - 1]), small(r), mask, o)
      if (rel === 'same') { last.runs.push(r); g.runs.push(r); stats.merged++; continue }
      if (rel === 'build' && !g.repeatOf) { g.states.push({ runs: [r] }); g.runs.push(r); stats.builds++; continue }
    }
    const ng: Group = { runs: [r], states: [{ runs: [r] }] }
    // the same picture earlier in the talk (any state of an earlier slide)?
    for (let k = 0; k < groups.length && ng.repeatOf === undefined; k++) {
      if (groups[k].states.some((s) => compare(small(s.runs[0]), small(r), mask, o) === 'same')) ng.repeatOf = k + 1
    }
    if (ng.repeatOf) stats.repeats++
    groups.push(ng)
  }
  const slideSeconds = groups.reduce((s, g) => s + g.runs.reduce((x, r) => x + (r.b - r.a + 1), 0), 0)
  const share = frames.length ? slideSeconds / frames.length : 0
  if (groups.length < o.minSlides || share < o.minSlideShare) {
    const reason = !frames.length ? 'no frames' : `slides are on screen ${Math.round(share * 100)}% of the video (${groups.length} distinct picture${groups.length === 1 ? '' : 's'}); the rest is camera`
    return { slides: [], noSlides: true, reason, stats, mask: Array.from(mask) }
  }
  const slides: DeckSlide[] = groups.map((g, i) => {
    const first = g.runs[0], lastRun = g.runs[g.runs.length - 1]
    const finalState = g.states[g.states.length - 1]
    const best = finalState.runs.reduce((x, r) => (r.b - r.a > x.b - x.a ? r : x))
    const next = groups[i + 1]?.runs[0]
    const end = t(lastRun.b) + 1
    const nextStart = next ? t(next.a) : duration
    const t1 = nextStart - end <= o.attachGap ? nextStart : end
    const s: DeckSlide = {
      n: i + 1, t0: t(first.a), t1: Math.max(t1, end), grab: t(best.pick),
      steps: g.states.map((st) => ({ t0: t(st.runs[0].a), t1: t(st.runs[st.runs.length - 1].b) + 1 })),
      hash: dHash(frames[best.pick].small),
    }
    if (g.repeatOf) s.repeatOf = g.repeatOf
    return s
  })
  return { slides, noSlides: false, stats, mask: Array.from(mask) }
}
