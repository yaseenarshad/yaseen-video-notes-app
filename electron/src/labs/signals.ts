import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findYTDLP, runYTDLP } from '../core/folderMaker'
import { whileDownloading } from '../core/ytdlpUpdate'
import { cacheDir, INFO_FILE, readJSON, SIGNALS_FILE, writeCache } from './store'

/**
 * Two signals from outside the transcript, fetched once per video and cached in Labs' userData
 * (`labs-cache/<id>/signals.json`):
 * - YouTube's **"most replayed" heatmap**: yt-dlp's `heatmap` field of the info json (≈100 points, value 0–1).
 *   One `yt-dlp --skip-download --write-info-json` run, through the app's yt-dlp lock (`whileDownloading`, so it
 *   never runs while yt-dlp updates). Not every video has one (new or little-watched videos): then `points` is null.
 * - **SponsorBlock** segments (sponsor, intro, outro, selfpromo, interaction) from the public API; 404 = none.
 * Refetched when older than 7 days (`maxAgeDays`), or with `force`.
 */
export interface HeatPoint { start: number; end: number; value: number }
export interface SponsorSegment { category: string; start: number; end: number; votes: number; uuid: string }
export interface Signals {
  videoId: string
  heatmap: { fetchedAt: string; points: HeatPoint[] | null; error?: string }
  sponsorblock: { fetchedAt: string; segments: SponsorSegment[]; error?: string }
}

export const SPONSOR_CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo', 'interaction']

export const sponsorBlockURL = (id: string): string =>
  `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(id)}&categories=${encodeURIComponent(JSON.stringify(SPONSOR_CATEGORIES))}`

/** The heatmap of a yt-dlp info json (null when it has none). */
export function parseHeatmap(info: unknown): HeatPoint[] | null {
  const h = (info as { heatmap?: unknown } | null)?.heatmap
  if (!Array.isArray(h) || !h.length) return null
  const pts = h.flatMap((x) => {
    const o = x as Record<string, unknown>
    return typeof o?.start_time === 'number' && typeof o?.end_time === 'number' && typeof o?.value === 'number'
      ? [{ start: o.start_time, end: o.end_time, value: Math.round(o.value * 1000) / 1000 }] : []
  })
  return pts.length ? pts.sort((a, b) => a.start - b.start) : null
}

/** SponsorBlock's answer → segments (sorted by start). */
export function parseSponsorBlock(json: unknown): SponsorSegment[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((x) => {
    const o = x as Record<string, unknown>
    const seg = o?.segment
    return Array.isArray(seg) && typeof seg[0] === 'number' && typeof seg[1] === 'number' && typeof o.category === 'string'
      ? [{ category: o.category, start: seg[0], end: seg[1], votes: typeof o.votes === 'number' ? o.votes : 0, uuid: typeof o.UUID === 'string' ? o.UUID : '' }] : []
  }).sort((a, b) => a.start - b.start)
}

/** The parts of a yt-dlp info json worth keeping for experiments (not the format lists). */
export function trimInfo(info: Record<string, unknown>): Record<string, unknown> {
  const keep = ['id', 'title', 'channel', 'uploader', 'channel_id', 'duration', 'view_count', 'like_count', 'comment_count', 'upload_date',
    'description', 'tags', 'categories', 'chapters', 'heatmap', 'thumbnail']
  const out: Record<string, unknown> = {}
  for (const k of keep) if (info[k] !== undefined) out[k] = info[k]
  return out
}

/** Runs yt-dlp once for the info json (metadata only, no captions, no video). */
export async function fetchInfo(videoId: string, log: (l: string) => void = () => {}): Promise<Record<string, unknown>> {
  const bin = findYTDLP()
  if (!bin) throw new Error('yt-dlp was not found')
  const tmp = join(tmpdir(), `vn-labs-${randomUUID()}`)
  mkdirSync(tmp, { recursive: true })
  try {
    await whileDownloading(() => runYTDLP(bin, ['--skip-download', '--no-playlist', '--newline', '--write-info-json',
      '--extractor-args', 'youtube:player_client=tv,web,android', '-o', join(tmp, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${videoId}`], log))
    const f = readdirSync(tmp).find((n) => n.endsWith('.info.json'))
    if (!f) throw new Error('yt-dlp wrote no info json')
    return JSON.parse(readFileSync(join(tmp, f), 'utf8')) as Record<string, unknown>
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export async function fetchSponsorBlock(videoId: string, fetchImpl: typeof fetch = fetch): Promise<SponsorSegment[]> {
  const r = await fetchImpl(sponsorBlockURL(videoId), { headers: { 'User-Agent': 'YaseenVideoNotesLabs/1' }, signal: AbortSignal.timeout(15_000) })
  if (r.status === 404) return []
  if (!r.ok) throw new Error(`SponsorBlock HTTP ${r.status}`)
  return parseSponsorBlock(await r.json())
}

export const readSignals = (userData: string, videoId: string): Signals | null => readJSON<Signals>(join(cacheDir(userData, videoId), SIGNALS_FILE))

const ageDays = (iso: string | undefined): number => (iso ? (Date.now() - Date.parse(iso)) / 86_400_000 : Infinity)

/**
 * The cached signals, fetching what is missing or older than `maxAgeDays` (a failed fetch is retried after 1 day).
 * Never throws: errors are kept in the file (`error`).
 */
export async function ensureSignals(userData: string, videoId: string, opts: { maxAgeDays?: number; force?: boolean; log?: (l: string) => void; fetchImpl?: typeof fetch } = {}): Promise<Signals> {
  const log = opts.log ?? (() => {})
  const max = opts.maxAgeDays ?? 7
  const old = readSignals(userData, videoId)
  const now = new Date().toISOString()
  const stale = (s: { fetchedAt: string; error?: string } | undefined) => opts.force || !s || ageDays(s.fetchedAt) > (s.error ? 1 : max)
  let heatmap = old?.heatmap, sponsorblock = old?.sponsorblock
  if (stale(heatmap)) {
    try {
      const info = await fetchInfo(videoId, (l) => log(`yt-dlp: ${l}`))
      heatmap = { fetchedAt: now, points: parseHeatmap(info) }
      writeCache(userData, videoId, INFO_FILE, JSON.stringify(trimInfo(info), null, 1))
      log(`heatmap: ${heatmap.points ? `${heatmap.points.length} points` : 'none for this video'}`)
    } catch (e) {
      heatmap = { fetchedAt: now, points: old?.heatmap?.points ?? null, error: e instanceof Error ? e.message.split('\n')[0] : String(e) }
      log(`heatmap failed: ${heatmap.error}`)
    }
  }
  if (stale(sponsorblock)) {
    try {
      sponsorblock = { fetchedAt: now, segments: await fetchSponsorBlock(videoId, opts.fetchImpl) }
      log(`sponsorblock: ${sponsorblock.segments.length} segment(s)`)
    } catch (e) {
      sponsorblock = { fetchedAt: now, segments: old?.sponsorblock?.segments ?? [], error: e instanceof Error ? e.message : String(e) }
      log(`sponsorblock failed: ${sponsorblock.error}`)
    }
  }
  const out: Signals = { videoId, heatmap: heatmap!, sponsorblock: sponsorblock! }
  if (JSON.stringify(out) !== JSON.stringify(old)) writeCache(userData, videoId, SIGNALS_FILE, JSON.stringify(out, null, 1))
  return out
}
