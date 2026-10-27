// Labs experiment "slides": the extraction run (main process / CLI; plain Node, no Electron).
//
//   1. download  — the video-only stream, 720p at most (`136/247/398/bestvideo[height<=720]`; a slide talk's 720p H.264
//                  is small because slides barely move: 23 MB for 45 min), with yt-dlp under the app's yt-dlp lock,
//                  into Labs' own cache (`labs-cache/<id>/slides-tmp-…/`), never the vault; HTTP 429 is retried.
//   2. sample    — ffmpeg decodes it at 1 frame per second, 320×180, and frames.ts measures each frame.
//   3. choose    — deck.ts (plain code, no AI): changes, stability, slide vs camera, builds, repeats.
//   4. grab      — one full-resolution JPEG per slide from the downloaded video, at the settled moment.
//   5. delete    — the video is deleted (always, also after an error). Only the JPEGs and slides.json stay.
//   6. OCR       — macOS Vision reads each slide's text (optional: when it fails the slides still work).
//
// Output (Labs userData): labs-cache/<id>/slides.json + labs-cache/<id>/slides/slide-NNN.jpg. Cached: a second run
// returns the cached result unless `force`.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { findYTDLP, runYTDLP, YTDLP_MISSING } from '../../../core/folderMaker'
import { toolEnv, whileDownloading } from '../../../core/ytdlpUpdate'
import { cacheDir, readJSON, writeCache } from '../../store'
import { buildDeck, type DeckOptions, type DeckStats } from './deck'
import { frameStats, FH, FW, type FrameStats } from './frames'
import { ocrImages } from './ocr'

export const SLIDES_VERSION = 1
export const SLIDES_FILE = 'slides.json'
export const SLIDES_DIR = 'slides'
export const VIDEO_FORMAT = '136/247/398/bestvideo[height<=720]'

export interface SlideEntry {
  n: number
  /** When the slide is first on screen, and when the next one replaces it (seconds). */
  t0: number
  t1: number
  /** Relative to labs-cache/<id>/: slides/slide-001.jpg */
  file: string
  kind: 'slide'
  /** dHash of the slide (16 hex digits). */
  hash: string
  /** Build steps of this slide (parts appearing one by one): when each appeared. One entry = no build. */
  steps: { t0: number; t1: number }[]
  /** The same picture was already slide N earlier in the talk. */
  repeatOf?: number
  /** When the image was taken (seconds). */
  grab: number
  /** The text on the slide, read by macOS Vision (OCR) — absent when OCR did not run. */
  text?: string
}

export interface SlidesFile {
  version: number
  videoId: string
  title: string
  createdAt: string
  /** Total run time, and per phase (ms). */
  elapsedMs: number
  timings: { download: number; sample: number; grab: number; ocr: number }
  video: { format: string; bytes: number; deleted: boolean }
  noSlides: boolean
  reason?: string
  ocr: { state: 'ok' | 'failed' | 'off'; error?: string }
  stats: DeckStats
  slides: SlideEntry[]
}

export interface Progress { phase: 'download' | 'sample' | 'grab' | 'ocr' | 'done'; pct: number; line: string }

export const slidesPath = (userData: string, videoId: string): string => join(cacheDir(userData, videoId), SLIDES_FILE)
export function readSlides(userData: string, videoId: string): SlidesFile | null {
  const s = readJSON<SlidesFile>(slidesPath(userData, videoId))
  return s && s.version === SLIDES_VERSION && Array.isArray(s.slides) ? s : null
}

const FFMPEGS = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
export const findFFmpeg = (): string | null => FFMPEGS.find((p) => existsSync(p)) ?? null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TOO_MANY = /HTTP Error 429|Too Many Requests/i

/** yt-dlp's "[download]  45.3% of …" → 45.3 */
export function downloadPct(line: string): number | null {
  const m = /^\[download\]\s+([\d.]+)%/.exec(line.trim())
  return m ? Number(m[1]) : null
}

/** Downloads the video-only stream into `dir` (429 retried after 5 s and 15 s); returns the file. */
async function download(videoId: string, dir: string, progress: (p: number, line: string) => void, log: (l: string) => void): Promise<string> {
  const bin = findYTDLP()
  if (!bin) throw new Error(YTDLP_MISSING)
  const args = ['--no-playlist', '--newline', '--no-part', '-f', VIDEO_FORMAT, '-o', join(dir, 'video-%(format_id)s.%(ext)s'), `https://www.youtube.com/watch?v=${videoId}`]
  const waits = [5000, 15000]
  for (let i = 0; ; i++) {
    try {
      await whileDownloading(() => runYTDLP(bin, args, (l) => { const p = downloadPct(l); if (p !== null) progress(p, l.trim()); else log(`yt-dlp: ${l}`) }))
      break
    } catch (e) {
      if (i >= waits.length || !(e instanceof Error) || !TOO_MANY.test(e.message)) throw e
      log(`YouTube said "too many requests"; trying again in ${waits[i] / 1000} s…`)
      await sleep(waits[i])
    }
  }
  const f = readdirSync(dir).find((n) => n.startsWith('video-'))
  if (!f) throw new Error('yt-dlp wrote no video file')
  return join(dir, f)
}

/** ffmpeg → 1 frame per second at 320×180 RGB → frameStats, streamed (memory stays small). */
export function sampleFrames(ffmpeg: string, video: string, onFrame?: (n: number) => void): Promise<FrameStats[]> {
  const size = FW * FH * 3
  const frames: FrameStats[] = []
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-i', video, '-an',
      '-vf', `fps=1:round=down,scale=${FW}:${FH}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { env: toolEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    const frame = new Uint8Array(size)
    let filled = 0, err = ''
    p.stdout.on('data', (c: Buffer) => {
      let off = 0
      while (off < c.length) {
        const n = Math.min(size - filled, c.length - off)
        frame.set(c.subarray(off, off + n), filled)
        filled += n; off += n
        if (filled === size) { frames.push(frameStats(frames.length, frame)); filled = 0; onFrame?.(frames.length) }
      }
    })
    p.stderr.on('data', (c: Buffer) => { err = (err + c.toString('utf8')).slice(-2000) })
    p.on('error', (e) => reject(new Error(`could not run ffmpeg: ${e.message}`)))
    p.on('close', (code) => (code === 0 ? resolve(frames) : reject(new Error(`ffmpeg failed (exit ${code}): ${err.trim().split('\n').slice(-2).join(' ')}`))))
  })
}

function ffmpegGrab(ffmpeg: string, video: string, t: number, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-q:v', '2', '-y', out], { env: toolEnv(), stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (c: Buffer) => { err += c.toString('utf8') })
    p.on('error', (e) => reject(e))
    p.on('close', (code) => (code === 0 && existsSync(out) ? resolve() : reject(new Error(`ffmpeg grab at ${t}s failed: ${err.trim()}`))))
  })
}

/** Runs `fn` over the items, `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i) } }))
}

export interface ExtractOptions {
  userData: string
  videoId: string
  title?: string
  /** Video length in seconds (the sidecar's); else the number of sampled frames. */
  duration?: number
  force?: boolean
  ocr?: boolean
  deck?: Partial<DeckOptions>
  log?: (line: string) => void
  progress?: (p: Progress) => void
}

/** The whole run (see the top of this file). The downloaded video is always deleted. */
export async function extractSlides(o: ExtractOptions): Promise<{ result: SlidesFile; reused: boolean; ms: number }> {
  const start = Date.now()
  const log = o.log ?? (() => {})
  const progress = (p: Progress) => { o.progress?.(p) }
  if (!o.force) {
    const cached = readSlides(o.userData, o.videoId)
    if (cached) return { result: cached, reused: true, ms: Date.now() - start }
  }
  const ffmpeg = findFFmpeg()
  if (!ffmpeg) throw new Error('ffmpeg was not found (brew install ffmpeg)')
  const dir = cacheDir(o.userData, o.videoId)
  const tmp = join(dir, `slides-tmp-${randomUUID().slice(0, 8)}`)
  mkdirSync(tmp, { recursive: true })
  const timings = { download: 0, sample: 0, grab: 0, ocr: 0 }
  let video = '', bytes = 0, format = ''
  try {
    // 1. download
    let t = Date.now()
    progress({ phase: 'download', pct: 0, line: 'Downloading the video (720p, video only)…' })
    video = await download(o.videoId, tmp, (p, line) => progress({ phase: 'download', pct: p, line }), log)
    bytes = statSync(video).size
    format = /video-([^.]+)\./.exec(video)?.[1] ?? ''
    timings.download = Date.now() - t
    log(`downloaded format ${format}: ${(bytes / 1e6).toFixed(1)} MB in ${(timings.download / 1000).toFixed(1)} s`)

    // 2. sample
    t = Date.now()
    const total = o.duration ?? 0
    progress({ phase: 'sample', pct: 0, line: 'Looking at every second of the video…' })
    const frames = await sampleFrames(ffmpeg, video, (n) => { if (n % 30 === 0) progress({ phase: 'sample', pct: total ? Math.min(100, (n / total) * 100) : 0, line: `Looked at ${n} s${total ? ` of ${Math.round(total)} s` : ''}` }) })
    timings.sample = Date.now() - t
    log(`sampled ${frames.length} frames in ${(timings.sample / 1000).toFixed(1)} s`)

    // 3. choose
    const deck = buildDeck(frames, o.duration ?? frames.length, o.deck)
    log(deck.noSlides ? `no slides found: ${deck.reason}` : `${deck.slides.length} slides (${deck.stats.builds} build steps grouped, ${deck.stats.repeats} repeats, ${deck.stats.maskedCells} camera cells masked)`)

    // 4. grab
    t = Date.now()
    const shots = join(tmp, SLIDES_DIR)
    mkdirSync(shots, { recursive: true })
    const name = (n: number) => `slide-${String(n).padStart(3, '0')}.jpg`
    let done = 0
    await pool(deck.slides, 4, async (s) => {
      await ffmpegGrab(ffmpeg, video, s.grab, join(shots, name(s.n)))
      done++
      progress({ phase: 'grab', pct: (done / deck.slides.length) * 100, line: `Saved slide ${done} of ${deck.slides.length}` })
    })
    timings.grab = Date.now() - t

    // 5. delete the video now (the images are all that is kept)
    rmSync(video, { force: true })

    const slides: SlideEntry[] = deck.slides.map((s) => {
      const e: SlideEntry = { n: s.n, t0: s.t0, t1: s.t1, file: `${SLIDES_DIR}/${name(s.n)}`, kind: 'slide', hash: s.hash, steps: s.steps, grab: s.grab }
      if (s.repeatOf) e.repeatOf = s.repeatOf
      return e
    })

    // 6. OCR (optional)
    t = Date.now()
    let ocr: SlidesFile['ocr'] = { state: 'off' }
    if (o.ocr !== false && slides.length) {
      progress({ phase: 'ocr', pct: 0, line: 'Reading the slide text (macOS Vision)…' })
      try {
        const r = await ocrImages(o.userData, slides.map((s) => join(shots, name(s.n))), log)
        if ('error' in r) ocr = { state: 'failed', error: r.error }
        else { r.texts.forEach((x, i) => { slides[i].text = x }); ocr = { state: 'ok' } }
      } catch (e) { ocr = { state: 'failed', error: e instanceof Error ? e.message : String(e) } }
      if (ocr.error) log(`OCR: ${ocr.error}`)
    }
    timings.ocr = Date.now() - t

    // move the images into place (replacing an older run's), then write slides.json
    const final = join(dir, SLIDES_DIR)
    rmSync(final, { recursive: true, force: true })
    renameSync(shots, final)
    const result: SlidesFile = {
      version: SLIDES_VERSION, videoId: o.videoId, title: o.title ?? '', createdAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      elapsedMs: Date.now() - start, timings, video: { format, bytes, deleted: !existsSync(video) },
      noSlides: deck.noSlides, ...(deck.reason ? { reason: deck.reason } : {}), ocr, stats: deck.stats, slides,
    }
    writeCache(o.userData, o.videoId, SLIDES_FILE, JSON.stringify(result, null, 1))
    progress({ phase: 'done', pct: 100, line: deck.noSlides ? 'No slides found' : `${slides.length} slides` })
    return { result, reused: false, ms: Date.now() - start }
  } finally {
    rmSync(tmp, { recursive: true, force: true })   // the video (and anything half-done) never stays
  }
}
