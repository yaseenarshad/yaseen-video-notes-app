// Labs experiment "slides": what ONE sampled frame looks like (pure, no I/O — unit-tested in slides.test.ts).
//
// The extractor (extract.ts) has ffmpeg decode the video at 1 frame per second, scaled to 320×180 RGB, and calls
// `frameStats` on each frame. Only the small result is kept (a 80×45 grayscale thumbnail + a few numbers), so a 45-min
// talk needs ~10 MB of memory however big the video is.
//
// The numbers (all 0–1) and what they mean in plain words:
//   flat   — share of 8×8-pixel blocks that are one flat colour (slide backgrounds are; a camera image rarely is)
//   sharp  — share of pixels on a hard edge (the strokes of text and diagrams are hard edges; a camera image is soft)
//   top8   — share of pixels covered by the 8 most common colours (a slide uses a few colours; a camera image thousands)
//   soft   — share of 8×8 blocks with gentle shading (faces, skin, rooms, photos have lots; slides little)
// `classify` turns them into 'slide' | 'camera' | 'blank'. A slide with a small speaker camera in a corner (picture in
// picture) still reads as a slide: the corner is a small part of the frame.

export const FW = 320, FH = 180          // the sampled frame (ffmpeg scales to this)
export const SW = 80, SH = 45            // the kept grayscale thumbnail (4×4 averages)
export const GC = 16, GR = 9             // the comparison grid: 16×9 cells of 5×5 thumbnail pixels (20×20 frame pixels)

export type FrameKind = 'slide' | 'camera' | 'blank'

export interface FrameStats {
  /** Seconds into the video. */
  t: number
  /** 80×45 grayscale (0–255), row by row. */
  small: Uint8Array
  flat: number
  soft: number
  sharp: number
  top8: number
  kind: FrameKind
}

/** Luma of an RGB frame. */
export function toGray(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < g.length; i++, j += 3) g[i] = (rgb[j] * 299 + rgb[j + 1] * 587 + rgb[j + 2] * 114) / 1000
  return g
}

/** Box-average downscale of a grayscale image by an integer factor. */
export function shrink(g: Uint8Array, w: number, h: number, f: number): Uint8Array {
  const ow = Math.floor(w / f), oh = Math.floor(h / f), out = new Uint8Array(ow * oh)
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    let s = 0
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += g[(y * f + dy) * w + x * f + dx]
    out[y * ow + x] = Math.round(s / (f * f))
  }
  return out
}

export interface Thresholds {
  /** A block is "flat" when its pixels' standard deviation is below this (0–255 scale). */
  flatStd: number
  /** A pixel is on a "sharp" edge when it differs from its right or lower neighbour by more than this. */
  sharpEdge: number
  /** A block that is not flat is "soft" (shading, skin, a photo) when its standard deviation is below this. */
  softStd: number
}
export const FRAME_DEFAULTS: Thresholds = { flatStd: 3.5, sharpEdge: 60, softStd: 22 }

/** The features of one 320×180 RGB frame (see the top of this file). */
export function frameStats(t: number, rgb: Uint8Array, w = FW, h = FH, th: Thresholds = FRAME_DEFAULTS): FrameStats {
  const g = toGray(rgb, w, h)
  // flat 8×8 blocks
  let blocks = 0, flatBlocks = 0, softBlocks = 0
  for (let by = 0; by + 8 <= h; by += 8) for (let bx = 0; bx + 8 <= w; bx += 8) {
    let s = 0, s2 = 0
    for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) { const v = g[y * w + x]; s += v; s2 += v * v }
    const m = s / 64, sd = Math.sqrt(Math.max(0, s2 / 64 - m * m))
    blocks++
    if (sd < th.flatStd) flatBlocks++
    else if (sd < th.softStd) softBlocks++
  }
  // hard edges
  let sharp = 0
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const v = g[y * w + x]
    if (Math.abs(v - g[y * w + x + 1]) > th.sharpEdge || Math.abs(v - g[(y + 1) * w + x]) > th.sharpEdge) sharp++
  }
  // colour count: 3 bits per channel → 512 bins; share of the 8 biggest
  const bins = new Uint32Array(512)
  for (let j = 0; j < rgb.length; j += 3) bins[((rgb[j] >> 5) << 6) | ((rgb[j + 1] >> 5) << 3) | (rgb[j + 2] >> 5)]++
  const top = Array.from(bins).sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0)
  const st = { flat: flatBlocks / blocks, soft: softBlocks / blocks, sharp: sharp / ((w - 1) * (h - 1)), top8: top / (w * h) }
  return { t, small: shrink(g, w, h, w / SW), ...st, kind: classify(st) }
}

export interface ClassifyRules {
  /** blank: nearly everything flat and (almost) no edges — a black / white screen, a fade. */
  blankFlat: number; blankSharp: number
  /** slide: enough flat background, few colours, some hard edges (text / lines), not much soft shading (faces, photos). */
  slideFlat: number; slideTop8: number; slideSharp: number; slideSoftMax: number
}
export const CLASSIFY_DEFAULTS: ClassifyRules = { blankFlat: 0.97, blankSharp: 0.002, slideFlat: 0.3, slideTop8: 0.7, slideSharp: 0.015, slideSoftMax: 0.4 }

/** Slide, camera, or blank, from the four numbers. */
export function classify(s: { flat: number; soft: number; sharp: number; top8: number }, r: ClassifyRules = CLASSIFY_DEFAULTS): FrameKind {
  if (s.flat >= r.blankFlat && s.sharp < r.blankSharp) return 'blank'
  if (s.flat >= r.slideFlat && s.top8 >= r.slideTop8 && s.sharp >= r.slideSharp && s.soft <= r.slideSoftMax) return 'slide'
  return 'camera'
}

// ---------- comparing frames ----------

/** Per grid cell: the mean absolute difference of two thumbnails (16×9 values, 0–255). */
export function cellDiffs(a: Uint8Array, b: Uint8Array): Float32Array {
  const out = new Float32Array(GC * GR), cw = SW / GC, ch = SH / GR
  for (let cy = 0; cy < GR; cy++) for (let cx = 0; cx < GC; cx++) {
    let s = 0
    for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) s += Math.abs(a[y * SW + x] - b[y * SW + x])
    out[cy * GC + cx] = s / (cw * ch)
  }
  return out
}

/** Per grid cell: the standard deviation inside it (≈ 0 = empty background, higher = something drawn there). */
export function cellContent(a: Uint8Array): Float32Array {
  const out = new Float32Array(GC * GR), cw = SW / GC, ch = SH / GR, n = cw * ch
  for (let cy = 0; cy < GR; cy++) for (let cx = 0; cx < GC; cx++) {
    let s = 0, s2 = 0
    for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) { const v = a[y * SW + x]; s += v; s2 += v * v }
    const m = s / n
    out[cy * GC + cx] = Math.sqrt(Math.max(0, s2 / n - m * m))
  }
  return out
}

/** The cells (of those not masked) whose difference is above `cellThreshold`. */
export function changedCells(d: Float32Array, mask: Uint8Array | null, cellThreshold: number): number[] {
  const out: number[] = []
  for (let i = 0; i < d.length; i++) if (!(mask && mask[i]) && d[i] > cellThreshold) out.push(i)
  return out
}

/** 64-bit difference hash (dHash) of a thumbnail as 16 hex digits: 9×8 box averages, each bit = left < right. */
export function dHash(small: Uint8Array, w = SW, h = SH): string {
  const v: number[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
    const x0 = Math.floor(x * w / 9), x1 = Math.floor((x + 1) * w / 9), y0 = Math.floor(y * h / 8), y1 = Math.floor((y + 1) * h / 8)
    let s = 0, n = 0
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += small[yy * w + xx]; n++ }
    v.push(s / Math.max(1, n))
  }
  let hex = ''
  for (let y = 0; y < 8; y++) {
    let byte = 0
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (v[y * 9 + x] < v[y * 9 + x + 1] ? 1 : 0)
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/** Hamming distance of two dHash hex strings. */
export function hamming(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}
