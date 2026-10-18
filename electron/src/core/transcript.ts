import type { CaptionWord } from './captions'
import { FollowAlongError } from './errors'
import { graphemes, pad2, trimWSNL } from './text'
import { GUIDE } from './guide'

/** A paragraph of the formatted transcript. */
export interface Paragraph {
  turn: boolean
  words: string[]
  times: number[]
}

export const paraStart = (p: Paragraph): number => p.times[0] ?? 0

/** A YouTube chapter. `para` is the paragraph its heading stands above. */
export interface Chapter {
  start: number
  end: number
  title: string
  para: number
}

export const chapter = (start: number, end: number, title: string, para = 0): Chapter => ({ start, end, title, para })

/** Metadata of a video, from the yt-dlp `.info.json`. */
export interface VideoInfo {
  id: string
  title: string
  channel: string
  duration: number
  viewCount: number
  uploadDate: string
  /** YouTube chapters (empty when the video has none). `para` is not set yet. */
  chapters: Chapter[]
}

export function videoInfo(v: Omit<VideoInfo, 'chapters'> & { chapters?: Chapter[] }): VideoInfo {
  return { ...v, chapters: v.chapters ?? [] }
}

/** Reads the fields the header needs from a yt-dlp `.info.json`. */
export function parseInfoJSON(text: string): VideoInfo {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    throw new FollowAlongError('The video metadata from yt-dlp is not a JSON object.')
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new FollowAlongError('The video metadata from yt-dlp is not a JSON object.')
  const o = obj as Record<string, unknown>
  const num = (k: string): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? Math.trunc(o[k] as number) : 0)
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null)
  const id = str('id')
  if (id === null) throw new FollowAlongError('The video metadata has no id.')
  const chapters: Chapter[] = []
  if (Array.isArray(o.chapters)) {
    for (const c of o.chapters as unknown[]) {
      if (!c || typeof c !== 'object') continue
      const cc = c as Record<string, unknown>
      if (typeof cc.start_time !== 'number') continue
      const start = cc.start_time
      const end = typeof cc.end_time === 'number' ? cc.end_time : start
      const title = trimWSNL(typeof cc.title === 'string' ? cc.title : '')
      chapters.push(chapter(start, end, title === '' ? 'Chapter' : title))
    }
  }
  return {
    id,
    title: str('title') ?? id,
    channel: str('channel') ?? str('uploader') ?? '',
    duration: num('duration'),
    viewCount: num('view_count'),
    uploadDate: str('upload_date') ?? '',
    chapters,
  }
}

export const watchURL = (info: { id: string }): string => `https://www.youtube.com/watch?v=${info.id}`

/**
 * Groups words into paragraphs: a new paragraph on every speaker change, and a long turn breaks
 * after `maxWords` words at the next sentence end. Captions without punctuation (some auto-captions
 * have none) would make one endless paragraph, so after 1.5 × `maxWords` a pause of 0.6 s also
 * breaks, and 2 × `maxWords` always does.
 */
export function paragraphs(words: CaptionWord[], maxWords = 110): Paragraph[] {
  const paras: Paragraph[] = []
  let split = false
  words.forEach((w, i) => {
    if (paras.length === 0 || w.newTurn || split) {
      paras.push({ turn: w.newTurn, words: [], times: [] })
      split = false
    }
    const p = paras[paras.length - 1]
    p.words.push(w.text)
    p.times.push(w.time)
    const n = p.words.length
    const pause = i + 1 < words.length ? words[i + 1].time - w.time : 0
    if (n >= maxWords && endsSentence(w.text)) split = true
    else if (n >= Math.trunc((maxWords * 3) / 2) && pause >= 0.6) split = true
    else if (n >= maxWords * 2) split = true
  })
  return paras
}

/** Same rule as the prototype: `[.?!]["')]?$`. */
export function endsSentence(w: string): boolean {
  const chars = graphemes(w)
  const last = chars[chars.length - 1]
  if (last !== undefined && `"')`.includes(last) && last.length === 1) chars.pop()
  const l = chars[chars.length - 1]
  if (l === undefined) return false
  return l.length === 1 && '.?!'.includes(l)
}

/** "1:02:03" with hours, "2:03" without. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds))
  const h = Math.trunc(s / 3600), m = Math.trunc((s % 3600) / 60), x = s % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`
}

/** Always "h:mm:ss" (the header's duration field). */
export function hms(seconds: number): string {
  const s = Math.trunc(seconds)
  return `${Math.trunc(s / 3600)}:${pad2(Math.trunc((s % 3600) / 60))}:${pad2(s % 60)}`
}

export function header(info: VideoInfo): string {
  return `# ${info.title}

- channel: ${info.channel}
- url: ${watchURL(info)}
- duration: ${hms(info.duration)}
- views: ${info.viewCount}
- uploaded: ${info.uploadDate}

${GUIDE}

---
`
}

export function paragraphLine(p: Paragraph, videoID: string): string {
  const t = Math.trunc(paraStart(p))
  return `[${clock(paraStart(p))}](https://www.youtube.com/watch?v=${videoID}&t=${t}s) ` + (p.turn ? '— ' : '') + p.words.join(' ')
}

/**
 * Sets each chapter's `para`: the paragraph whose start is nearest the chapter start (the one it
 * falls in, or the next one if that starts closer).
 */
export function place(chapters: Chapter[], paras: Paragraph[]): Chapter[] {
  if (paras.length === 0) return []
  const starts = paras.map(paraStart)
  return [...chapters].sort((a, b) => a.start - b.start).map((c) => {
    let i = 0
    for (let k = starts.length - 1; k >= 0; k--) if (starts[k] <= c.start + 0.001) { i = k; break }
    if (i + 1 < starts.length && starts[i + 1] - c.start < c.start - starts[i]) i += 1
    return { ...c, para: i }
  })
}

/** "## 3:36 The Origins of the Ansari XPRIZE" */
export const chapterHeading = (c: Chapter): string => `## ${clock(c.start)} ${c.title}`

/** Paragraph lines with a blank line between them, and a chapter heading above the paragraph where each chapter starts. */
export function body(paras: Paragraph[], videoID: string, chapters: Chapter[] = []): string {
  const byPara = new Map<number, Chapter[]>()
  for (const c of chapters) byPara.set(c.para, [...(byPara.get(c.para) ?? []), c])
  const blocks: string[] = []
  paras.forEach((p, i) => {
    for (const c of byPara.get(i) ?? []) blocks.push(chapterHeading(c) + '\n')
    blocks.push(paragraphLine(p, videoID) + '\n')
  })
  return blocks.join('\n')
}

export function markdown(info: VideoInfo, paras: Paragraph[]): string {
  return header(info) + '\n' + body(paras, info.id, place(info.chapters, paras))
}

// ---------- the word-timing sidecar (.follow-along.json) ----------

export interface SidecarPara {
  turn: boolean
  w: string[]
}

export interface Sidecar {
  version: number
  id: string
  title: string
  channel: string
  duration: number
  paras: SidecarPara[]
  t: number[][]
  /** Chapters with the paragraph each heading stands above (absent in sidecars from before chapters). */
  chapters?: Chapter[]
}

export const SIDECAR_FILE = '.follow-along.json'

export function makeSidecar(info: VideoInfo, paras: Paragraph[]): Sidecar {
  return {
    version: 1,
    id: info.id,
    title: info.title,
    channel: info.channel,
    duration: info.duration,
    paras: paras.map((p) => ({ turn: p.turn, w: p.words })),
    t: paras.map((p) => p.times.map((x) => Math.round(x * 100) / 100)),
    chapters: place(info.chapters, paras),
  }
}

/**
 * The sidecar as JSON: compact, slashes not escaped (Swift `.withoutEscapingSlashes`). Keys in
 * declaration order. (The Swift app's JSONEncoder writes the same keys and values in a random,
 * per-process hash order; every reader parses JSON, so the order does not matter.)
 */
export function encodeSidecar(s: Sidecar): string {
  const ordered: Record<string, unknown> = {
    version: s.version, id: s.id, title: s.title, channel: s.channel, duration: s.duration,
    paras: s.paras.map((p) => ({ turn: p.turn, w: p.w })), t: s.t,
  }
  if (s.chapters !== undefined) ordered.chapters = s.chapters.map((c) => ({ start: c.start, end: c.end, title: c.title, para: c.para }))
  return swiftJSON(ordered)
}

export function decodeSidecar(text: string): Sidecar {
  const o = JSON.parse(text) as Sidecar
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !Array.isArray(o.paras) || !Array.isArray(o.t)) {
    throw new FollowAlongError('Not a Yaseen Video Notes sidecar.')
  }
  return o
}

export const wordCount = (s: Sidecar): number => s.paras.reduce((n, p) => n + p.w.length, 0)

/**
 * JSON like Swift's JSONEncoder / JSONSerialization: no spaces, non-ASCII as is, control characters
 * escaped, "/" not escaped. (JSON.stringify already matches for the values this app writes.)
 */
export function swiftJSON(v: unknown): string {
  return JSON.stringify(v)
}

// ---------- slugs, folder names, YouTube ids ----------

/** Title → lowercase, non-alphanumerics → "-", collapsed, trimmed, at most 80 characters. */
export function slug(title: string, maxLength = 80): string {
  let out = ''
  let dash = false
  for (const ch of graphemes(title.toLowerCase())) {
    if (ch.length === 1 && /[a-z0-9]/.test(ch)) {
      out += ch
      dash = false
    } else if (!dash) {
      out += '-'
      dash = true
    }
  }
  let s = out.replace(/^-+|-+$/g, '')
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/^-+|-+$/g, '')
  return s === '' ? 'video' : s
}

/** "MM-DD-<slug>" (local date). */
export function folderName(title: string, date: Date = new Date()): string {
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-` + slug(title)
}

/** Finds the 11-character video id in a YouTube link (or a bare id). */
export function parseYouTubeID(input: string): string | null {
  const s = trimWSNL(input)
  const id = '[A-Za-z0-9_-]{11}'
  if (new RegExp(`^${id}$`).test(s)) return s
  for (const p of [`[?&]v=(${id})`, `youtu\\.be/(${id})`, `/(?:embed|shorts|live|v)/(${id})`]) {
    const m = new RegExp(p).exec(s)
    if (m) return m[1]
  }
  return null
}
