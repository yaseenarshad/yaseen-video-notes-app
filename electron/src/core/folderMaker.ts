import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { parseVTT } from './captions'
import { atomicWrite } from './atomic'
import { isLockFile, withFileLock } from './fileLock'
import { FollowAlongError, YTDLPError } from './errors'
import { healAfterFailure, toolEnv, withSelfHeal } from './ytdlpUpdate'
import * as Notes from './notes'
import { fraction, finished, furthest, readProgress, type Progress } from './progress'
import { trimWS } from './text'
import { effectiveOptions, mapStatus, parentInfo, value as statusValue } from './status'
import { ensureGuide, withoutComments } from './guide'
import {
  body, decodeSidecar, encodeSidecar, folderName, header, makeSidecar, markdown, paragraphs, parseInfoJSON, parseYouTubeID, slug,
  SIDECAR_FILE, type Paragraph, type Sidecar, type VideoInfo,
} from './transcript'

/** A transcript folder the player can open. */
export interface TranscriptFolder {
  folder: string
  markdown: string
  sidecar: string
  /** True when the folder was there before. */
  reused: boolean
}

type ProgressFn = (line: string) => void

// ---------- yt-dlp ----------

const isExecutable = (p: string): boolean => { try { accessSync(p, constants.X_OK); return statSync(p).isFile() } catch { return false } }

export function findYTDLP(): string | null {
  const candidates = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp']
  const pyDir = join(homedir(), 'Library/Python')
  try {
    for (const v of readdirSync(pyDir).sort().reverse()) if (v.startsWith('3.')) candidates.push(join(pyDir, v, 'bin/yt-dlp'))
  } catch { /* none */ }
  candidates.push('/usr/bin/yt-dlp', join(homedir(), '.local/bin/yt-dlp'))
  return candidates.find(isExecutable) ?? null
}

export const YTDLP_MISSING = `yt-dlp was not found. Install it with "brew install yt-dlp" (or "pip3 install --user yt-dlp"), then try again.
Looked in /opt/homebrew/bin, ~/Library/Python/3.*/bin and /usr/local/bin.`

/** One caption track to download: a language code and whether it is YouTube's automatic captions. */
export interface CaptionTrack { lang: string; auto: boolean }

/**
 * Picks the ONE English caption track to download from the info json's `subtitles` (made by people) and
 * `automatic_captions` (speech recognition). Order: human English (en, en-US, en-GB, then any en-*), then the
 * original automatic English (`en-orig`), and only then automatic `en`. For many videos automatic `en` is a
 * machine translation of `en-orig` (same words), and YouTube rate-limits translations hard (HTTP 429), so
 * asking for it alongside `en-orig` made whole downloads fail.
 */
export function chooseCaptionTrack(info: { subtitles?: Record<string, unknown> | null; automatic_captions?: Record<string, unknown> | null }): CaptionTrack | null {
  const human = Object.keys(info.subtitles ?? {}).filter((k) => k !== 'live_chat')
  for (const k of ['en', 'en-US', 'en-GB']) if (human.includes(k)) return { lang: k, auto: false }
  const otherEn = human.filter((k) => /^en(-|$)/.test(k)).sort()[0]
  if (otherEn) return { lang: otherEn, auto: false }
  const auto = Object.keys(info.automatic_captions ?? {})
  for (const k of ['en-orig', 'en', 'en-US']) if (auto.includes(k)) return { lang: k, auto: true }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TOO_MANY = /HTTP Error 429|Too Many Requests/i

/**
 * Downloads metadata and ONE English caption track (no video) into `dir`: first the info json, then just the
 * best track (`chooseCaptionTrack`) from that saved info. A "429 Too Many Requests" is retried twice, after a
 * short wait.
 */
export async function fetchCaptions(url: string, dir: string, binary: string, progress: ProgressFn): Promise<void> {
  const out = join(dir, '%(id)s.%(ext)s')
  const common = ['--skip-download', '--no-playlist', '--newline', '--extractor-args', 'youtube:player_client=tv,web,android', '-o', out]
  await retry429(() => runYTDLP(binary, [...common, '--write-info-json', url], progress), progress)
  const infoFile = readdirSync(dir).find((n) => n.endsWith('.info.json'))
  if (!infoFile) throw new YTDLPError('yt-dlp did not write the video metadata.')
  const infoPath = join(dir, infoFile)
  const track = chooseCaptionTrack(JSON.parse(readFileSync(infoPath, 'utf8')))
  if (!track) throw new FollowAlongError('This video has no English captions.')
  progress(`Downloading ${track.auto ? 'automatic captions' : 'captions'} (${track.lang})…`)
  const subArgs = [track.auto ? '--write-auto-subs' : '--write-subs', '--sub-lang', track.lang, '--sub-format', 'vtt']
  await retry429(() => runYTDLP(binary, [...common, ...subArgs, '--load-info-json', infoPath], progress), progress)
}

async function retry429(run: () => Promise<void>, progress: ProgressFn): Promise<void> {
  const waits = [5000, 15000]
  for (let i = 0; ; i++) {
    try { return await run() } catch (e) {
      if (i >= waits.length || !(e instanceof Error) || !TOO_MANY.test(e.message)) {
        if (e instanceof Error && TOO_MANY.test(e.message)) {
          throw new YTDLPError(`YouTube is rate-limiting caption downloads right now (HTTP 429). Wait a few minutes and try again; "brew upgrade yt-dlp" can help too.\n\n${e.message}`)
        }
        throw e
      }
      progress(`YouTube said "too many requests"; trying again in ${waits[i] / 1000} s…`)
      await sleep(waits[i])
    }
  }
}

export function runYTDLP(binary: string, args: string[], progress: ProgressFn): Promise<void> {
  // Homebrew and deno on PATH; plain Node inside Electron's helper environment too.
  const env = toolEnv()
  return new Promise((resolve, reject) => {
    const p = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail: string[] = []
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const parts = buffer.split(/[\r\n]/)
      buffer = parts.pop() ?? ''
      const ls = parts.filter((l) => l.trim() !== '')
      tail = [...tail, ...ls].slice(-30)
      ls.forEach(progress)
    }
    p.stdout.on('data', onData)
    p.stderr.on('data', onData)
    p.on('error', (e) => reject(new YTDLPError(`Could not run yt-dlp: ${e.message}`)))
    p.on('close', (code) => {
      if (code === 0) return resolve()
      const errs = tail.filter((l) => l.includes('ERROR'))
      reject(new YTDLPError(`yt-dlp failed (exit ${code}).\n` + (errs.length ? errs.slice(-5) : tail.slice(-5)).join('\n')))
    })
  })
}

// ---------- making folders ----------

/** Builds the markdown and the sidecar from yt-dlp output. */
export function format(info: VideoInfo, vtt: string): { markdown: string; sidecar: Sidecar; paragraphs: Paragraph[] } {
  const paras = paragraphs(parseVTT(vtt))
  return { markdown: markdown(info, paras), sidecar: makeSidecar(info, paras), paragraphs: paras }
}

const list = (dir: string): string[] => { try { return readdirSync(dir).sort().map((n) => join(dir, n)) } catch { return [] } }
const isDir = (p: string): boolean => { try { return statSync(p).isDirectory() } catch { return false } }

/** Picks the English caption file: en, en-US, en-orig, then any .vtt. */
export function pickVTT(dir: string, id: string): string | null {
  const files = list(dir)
  for (const lang of ['en', 'en-US', 'en-orig']) {
    const f = files.find((x) => basename(x) === `${id}.${lang}.vtt`)
    if (f) return f
  }
  return files.filter((f) => extname(f) === '.vtt').sort()[0] ?? null
}

/** The transcript .md in a folder: the one named like the folder, else the first .md with a YouTube "- url:" header line. */
export function markdownFile(folder: string): string | null {
  const files = list(folder).filter((f) => {
    const n = basename(f)
    // never a lock file (`<md>.lock`, held while a writer changes the .md)
    return extname(f) === '.md' && !n.startsWith('.') && !n.endsWith('.original.md') && !isLockFile(n) && !isDir(f)
  })
  const name = basename(folder)
  const s = name.length > 6 && /^\d\d-\d\d-/.test(name) ? name.slice(6) : name
  return files.find((f) => basename(f, '.md') === s) ?? files.find((f) => videoIDInMarkdown(f) !== null) ?? null
}

/** The video id from the "- url: ..." header line (first 4 KB). */
export function videoIDInMarkdown(path: string): string | null {
  let head = ''
  try {
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(4096)
      const n = readSync(fd, buf, 0, 4096, 0)
      head = new TextDecoder('utf-8').decode(buf.subarray(0, n))
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
  for (const line of head.split('\n')) if (line.startsWith('- url:')) return parseYouTubeID(line.slice(6))
  return null
}

/** The title from the first "# " line (frontmatter above it is fine). */
export function titleInMarkdown(md: string): string | null {
  const l = md.split('\n').find((x) => x.startsWith('# '))
  return l === undefined ? null : l.slice(2)
}

function loadSidecar(path: string): Sidecar | null {
  try { return decodeSidecar(readFileSync(path, 'utf8')) } catch { return null }
}

/** A subfolder of `parent` (or one of `more`, e.g. every video folder of the library) that already has this video. */
export function existingFolder(id: string, parent: string, more: readonly string[] = []): string | null {
  const dirs = [...list(parent).filter(isDir), ...more.filter((d) => dirname(d) !== parent && isDir(d))]
  for (const d of dirs) if (loadSidecar(join(d, SIDECAR_FILE))?.id === id) return d
  for (const d of dirs) {
    const md = markdownFile(d)
    if (md && videoIDInMarkdown(md) === id) return d
  }
  return null
}

/** Thrown by `ensure(allowFormat: false)` when the .md is a plain transcript from another tool: formatting it rewrites the file, so ask first. */
export class NeedsFormatting extends Error {
  constructor(public folder: string, public markdown: string, public backup: string) {
    super(`${basename(markdown)} is not formatted for Yaseen Video Notes yet.`)
    this.name = 'NeedsFormatting'
  }
}

/** Where the original of a reformatted .md is kept: "<slug>.original.md". */
export const backupPath = (md: string): string => md.replace(/\.md$/, '') + '.original.md'

/**
 * Makes (or reuses) the folder for a video in `parent`. `existingIn`: more video folders where an existing folder of
 * the same video counts (the whole library, when `parent` is one of its topics), so a video is never made twice.
 */
export async function make(input: string, parent: string, opts: { date?: Date; allowFormat?: boolean; progress?: ProgressFn; existingIn?: readonly string[] } = {}): Promise<TranscriptFolder> {
  const progress = opts.progress ?? (() => {})
  const id = parseYouTubeID(input)
  if (!id) throw new FollowAlongError(`That does not look like a YouTube link: ${input}`)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
  else if (!isDir(parent)) throw new FollowAlongError(`${parent} is not a folder.`)
  const existing = existingFolder(id, parent, opts.existingIn ?? [])
  if (existing) {
    progress(`Found an existing folder: ${basename(existing)}`)
    return ensure(existing, { allowFormat: opts.allowFormat ?? true, progress })
  }
  const { info, vtt } = await download(id, progress)
  const made = format(info, vtt)
  const date = opts.date ?? new Date()
  let name = folderName(info.title, date)
  let n = 2
  while (existsSync(join(parent, name))) {
    name = folderName(info.title, date) + `-${n}`
    n += 1
  }
  const folder = join(parent, name)
  mkdirSync(folder, { recursive: true })
  const md = join(folder, slug(info.title) + '.md')
  withFileLock(md, () => atomicWrite(md, made.markdown))
  const side = join(folder, SIDECAR_FILE)
  atomicWrite(side, encodeSidecar(made.sidecar))
  progress(`Created ${name} (${made.paragraphs.length} paragraphs)`)
  return { folder, markdown: md, sidecar: side, reused: false }
}

/**
 * Makes sure an existing folder has a formatted .md and a sidecar. Never removes notes: a formatted
 * .md is left alone. A plain (unformatted, note-free) transcript body is replaced only with
 * `allowFormat`, and the original is kept as "<slug>.original.md".
 */
export async function ensure(path: string, opts: { allowFormat?: boolean; progress?: ProgressFn } = {}): Promise<TranscriptFolder> {
  const progress = opts.progress ?? (() => {})
  const allowFormat = opts.allowFormat ?? true
  const folder = extname(path) === '.md' ? dirname(path) : path
  const mdPath = markdownFile(folder)
  if (!mdPath) throw new FollowAlongError(`No transcript .md in ${folder}.`)
  const side = join(folder, SIDECAR_FILE)
  const md = readFileSync(mdPath, 'utf8')
  const count = Notes.paragraphCount(md)
  if (count > 0) {
    const s = loadSidecar(side)
    if (s && s.paras.length === count) return { folder, markdown: mdPath, sidecar: side, reused: true }
  }
  const id = videoIDInMarkdown(mdPath)
  if (!id) throw new FollowAlongError(`${basename(mdPath)} has no "- url:" line with a YouTube link.`)
  if (count === 0 && withoutComments(md).includes('💬')) throw new FollowAlongError(`${basename(mdPath)} has notes but no timestamped paragraphs, so it was not changed.`)
  if (count === 0 && !allowFormat) throw new NeedsFormatting(folder, mdPath, backupPath(mdPath))
  const { info, vtt } = await download(id, progress)
  const made = format(info, vtt)
  if (count === 0) {
    // Under the file lock, and only if the file did not change during the download.
    withFileLock(mdPath, () => {
      if (readFileSync(mdPath, 'utf8') !== md) throw new FollowAlongError(`${basename(mdPath)} changed while the captions were downloading; try again.`)
      // Keep the original next to it (never overwrite an earlier backup).
      const backup = backupPath(mdPath)
      if (!existsSync(backup)) copyFileSync(mdPath, backup)
      // Keep everything above the header's "---" (frontmatter, title, fields); replace the plain body.
      const head = headPart(md) ?? header(info)
      atomicWrite(mdPath, ensureGuide(head + '\n' + body(made.paragraphs, info.id, made.sidecar.chapters ?? [])))
    })
    progress(`Formatted the transcript in ${basename(mdPath)}`)
  } else if (count !== made.paragraphs.length) {
    throw new FollowAlongError(`${basename(mdPath)} has ${count} paragraphs but the captions make ${made.paragraphs.length}, so the word timing would not line up.`)
  }
  atomicWrite(side, encodeSidecar(made.sidecar))
  return { folder, markdown: mdPath, sidecar: side, reused: true }
}

/** Everything up to and including the "---" line that ends the header (after "# Title"). */
export function headPart(md: string): string | null {
  const ls = md.split('\n')
  const title = ls.findIndex((l) => l.startsWith('# '))
  if (title < 0) return null
  let sep = -1
  for (let i = title + 1; i < ls.length; i++) if (trimWS(ls[i]) === '---') { sep = i; break }
  if (sep < 0) return null
  return ls.slice(0, sep + 1).join('\n') + '\n'
}

/**
 * Downloads a video's metadata and captions. Waits while yt-dlp is being updated. When yt-dlp fails and it is
 * more than a week old, it is updated and the download is tried once more (`ytdlpUpdate.ts`).
 */
async function download(id: string, progress: ProgressFn): Promise<{ info: VideoInfo; vtt: string }> {
  const bin = findYTDLP()
  if (!bin) throw new FollowAlongError(YTDLP_MISSING)
  return withSelfHeal(() => downloadOnce(id, bin, progress), () => healAfterFailure(bin, progress))
}

async function downloadOnce(id: string, bin: string, progress: ProgressFn): Promise<{ info: VideoInfo; vtt: string }> {
  const tmp = join(tmpdir(), `follow-along-${randomUUID().toUpperCase()}`)
  mkdirSync(tmp, { recursive: true })
  try {
    progress('Running yt-dlp…')
    await fetchCaptions(`https://www.youtube.com/watch?v=${id}`, tmp, bin, progress)
    const infoPath = join(tmp, `${id}.info.json`)
    if (!existsSync(infoPath)) throw new YTDLPError('yt-dlp did not write the video metadata.')
    const info = parseInfoJSON(readFileSync(infoPath, 'utf8'))
    const vttPath = pickVTT(tmp, id)
    if (!vttPath) throw new FollowAlongError('This video has no English captions.')
    progress(`Formatting ${basename(vttPath)}…`)
    return { info, vtt: readFileSync(vttPath, 'utf8') }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- the New Tab browser ----------

/** A video folder, for the New Tab browser. */
export interface FolderEntry {
  folder: string
  title: string
  /** "10-17" from the folder name, if it has one. */
  datePrefix: string | null
  /** The .md's modified time (ms). */
  modified: number
  /** The folder's date (ms): MM-DD from its name (this year, or last year if that is in the future), else `modified`. */
  date: number
  /** False for a folder another tool made: no sidecar yet (opening it sets it up). */
  ready: boolean
  /** True when the .md is a plain transcript that must be reformatted (asks first). */
  needsFormat: boolean
  progress: Progress | null
  finished: boolean
  fraction: number
  notes: number
  /** Open (not #resolved) #mochi notes. */
  mochiOpen: number
  /** The YouTube id (from the .md's "- url:" line, else the sidecar's), or null. */
  videoId: string | null
  /** The channel from the .md's header list ("- channel: …"), or null. */
  channel: string | null
  /** As the app shows it: an old value (`2-Watching`…) reads as its new one (`3-In-Progress`…). */
  status: string | null
  /** The status folder's options (an old app-written list reads as the new defaults). */
  statusOptions: string[]
  /** In a library listing: the topic folder it is in, relative to the listed folder ("AI agents/Evals"); null / missing: right in it. */
  topic?: string | null
}

/** The channel from a transcript's header list: "- channel: X" (also "* channel:", "* **Channel:** X"). */
export function channelInMarkdown(md: string): string | null {
  const ls = md.split('\n')
  const title = ls.findIndex((l) => l.startsWith('# '))
  if (title < 0) return null
  for (let i = title + 1; i < Math.min(ls.length, title + 40); i++) {
    const l = ls[i]
    if (trimWS(l) === '---' || trimWS(l) === '***' || /^\[\d+:\d\d/.test(l)) break
    const m = /^\s*[-*]\s+(?:\*\*)?channel:?(?:\*\*)?:?\s*(.+)$/i.exec(l)
    if (m) return trimWS(m[1]) || null
  }
  return null
}

export function folderDate(datePrefix: string | null, modified: number, now: Date = new Date()): number {
  if (!datePrefix) return modified
  const m = parseInt(datePrefix.slice(0, 2), 10), d = parseInt(datePrefix.slice(-2), 10)
  if (!Number.isFinite(m) || !Number.isFinite(d)) return modified
  let date = new Date(now.getFullYear(), m - 1, d, 12)
  if (date.getTime() > now.getTime() + 86_400_000) date = new Date(now.getFullYear() - 1, m - 1, d, 12)
  return date.getTime()
}

/** One video folder (a sidecar, or a .md with a YouTube "- url:" line), or null. */
export function entry(d: string): FolderEntry | null {
  const hasSidecar = existsSync(join(d, SIDECAR_FILE))
  const md = markdownFile(d)
  if (!md || !(hasSidecar || videoIDInMarkdown(md) !== null)) return null
  let text = ''
  try { text = readFileSync(md, 'utf8') } catch { /* empty */ }
  const formatted = Notes.paragraphCount(text) > 0
  const name = basename(d)
  const prefix = /^\d\d-\d\d/.exec(name)?.[0] ?? null
  let modified = 0
  try { modified = statSync(md).mtimeMs } catch { /* 0 */ }
  const parent = parentInfo(d).info
  const options = effectiveOptions(parent.options)
  const progress = readProgress(d)
  const notes = formatted ? Notes.parse(text) : []
  let videoId = videoIDInMarkdown(md)
  if (videoId === null && hasSidecar) videoId = loadSidecar(join(d, SIDECAR_FILE))?.id ?? null
  return {
    folder: d,
    title: titleInMarkdown(text) ?? name,
    datePrefix: prefix,
    modified,
    date: folderDate(prefix, modified),
    ready: hasSidecar && formatted,
    needsFormat: !formatted,
    progress,
    finished: progress ? finished(progress) : false,
    fraction: progress ? fraction(progress) : 0,
    notes: notes.length,
    mochiOpen: notes.filter((n) => n.category === 'mochi' && !n.resolved).length,
    videoId,
    channel: channelInMarkdown(text),
    status: mapStatus(statusValue(text, parent.id), options),
    statusOptions: options,
  }
}

/** The video folders in `parent`, newest first. */
export function listFolders(parent: string): FolderEntry[] {
  return list(parent)
    .filter((d) => isDir(d) && !basename(d).startsWith('.') && !isLockFile(basename(d)))
    .map(entry)
    .filter((e): e is FolderEntry => e !== null)
    .sort((a, b) => (a.date !== b.date ? b.date - a.date : b.modified - a.modified))
}

export const started = (e: FolderEntry): boolean => (e.progress ? furthest(e.progress) : 0) > 5
export const inProgress = (e: FolderEntry): boolean => e.ready && started(e) && e.progress !== null && !e.finished
