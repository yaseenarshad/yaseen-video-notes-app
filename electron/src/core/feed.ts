// The 📺 Feed: the latest long-form videos of channels the user follows, kept apart from the Library.
// Pure logic only (no network, no Electron): RSS parsing, the long-form playlist id, merging, hiding,
// the Shorts decision, and the two small feed files. The network side is `feedFetch.ts`.

/**
 * The feed folder: in the user's synced skills repo, so the list follows them to every Mac. Stored with `~` and
 * resolved against the home folder (`expandHome`), never a fixed user name. Setting `feedDir`; env override
 * `VIDEO_NOTES_FEED_DIR` (tests).
 */
export const DEFAULT_FEED_DIR = '~/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app'
/** Followed channels: a markdown list the user can read and edit in the docs app. */
export const SUBSCRIPTIONS_FILE = 'subscriptions.md'
/** Hidden video ids (machine data, kept out of subscriptions.md). */
export const HIDDEN_FILE = 'feed-hidden.json'
/** At most this many hidden ids are kept (the oldest are dropped). */
export const MAX_HIDDEN = 2000
/** At most this many videos per channel are kept in the per-machine cache. */
export const MAX_PER_CHANNEL = 50

/** One followed channel: a `- [Title](url) · UC… · added YYYY-MM-DD` line of subscriptions.md. */
export interface FeedChannel {
  /** The channel id, `UC` + 22 characters. */
  id: string
  title: string
  /** The channel page: `https://www.youtube.com/@handle` (or `/channel/UC…` without a handle). */
  url: string
  /** The day it was followed, "YYYY-MM-DD" ('' when the line has none). */
  added: string
}

/** One video from a channel's RSS feed. */
export interface FeedVideo {
  id: string
  title: string
  channelId: string
  channelTitle: string
  /** ISO time. */
  published: string
  /** The `<link rel="alternate">` of the entry: `/shorts/<id>` for a Short, `/watch?v=<id>` otherwise. */
  link: string
  /** `media:statistics views`, or null when the feed has none. */
  views: number | null
  /** True when it came from a list without Shorts (the UULF feed, or the channel's Videos tab): no `/shorts/` check needed. */
  longForm?: boolean
  /** True when `published` is worked out from "2d ago" (the Videos tab), not an exact time. */
  approx?: boolean
  /** "2:25:00", when known (the Videos tab has it; the RSS feeds do not). */
  duration?: string
}

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
export const isChannelID = (s: string): boolean => CHANNEL_ID.test(s)

/** "~/x" → "<home>/x" (and "~" → home); other paths unchanged. */
export function expandHome(p: string, home: string): string {
  if (p === '~') return home
  return p.startsWith('~/') ? home.replace(/\/+$/, '') + p.slice(1) : p
}

export const channelURL = (id: string, handle?: string): string => (handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${id}`)
/** "YYYY-MM-DD" (UTC). */
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10)

const parseObject = (text: string): Record<string, unknown> | null => {
  try {
    const o = JSON.parse(text) as unknown
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null
  } catch { return null }
}

const titleOrder = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })

// ---------- subscriptions.md ----------
//
// # YouTube subscriptions
//
// Channels the Yaseen Video Notes Feed follows. … (intro: never rewritten)
//
// - [a16z](https://www.youtube.com/@a16z) · UC9cn0TuPq4dnbTY-CBsm8XA · added 2026-10-23
// - https://www.youtube.com/@someone          ← typed by the user: the app resolves it and rewrites that line only

/** Written only when the file does not exist yet. */
export const SUBSCRIPTIONS_TEMPLATE = `# YouTube subscriptions

Channels the Yaseen Video Notes Feed follows. To add one, put a new line with a dash and the channel's YouTube link (\`- https://www.youtube.com/@handle\`); the app fills in the name and ID. To remove one, delete its line.
`

const FULL_LINE = /^- \[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^)\s]+)\)\s*·\s*(UC[A-Za-z0-9_-]{22})(?:\s*·\s*added\s+(\d{4}-\d{2}-\d{2}))?\s*$/
const unescapeMD = (s: string): string => s.replace(/\\([\\[\]])/g, '$1')
const escapeMD = (s: string): string => s.replace(/[\\[\]]/g, (c) => '\\' + c).replace(/[\r\n]+/g, ' ')

/** A line the user typed (`- https://www.youtube.com/@handle`, a /channel/ or video link, `- @handle`) that is not resolved yet. */
export interface BareLine { line: number; text: string; input: string }

/**
 * Which lines count: false inside fenced code blocks (``` or ~~~) and HTML comments, so examples in the file's
 * "Format" section never become channels and are never rewritten.
 */
export function liveLines(lines: string[]): boolean[] {
  const out: boolean[] = []
  let fence: string | null = null
  let comment = false
  for (const raw of lines) {
    const l = raw.replace(/\r$/, '')
    if (fence) {
      out.push(false)
      if (l.trim().startsWith(fence)) fence = null
      continue
    }
    const f = /^\s{0,3}(```|~~~)/.exec(l)
    if (f && !comment) { fence = f[1]; out.push(false); continue }
    if (comment) {
      out.push(false)
      if (l.includes('-->')) comment = false
      continue
    }
    if (l.includes('<!--')) {
      out.push(false)
      comment = !l.slice(l.indexOf('<!--')).includes('-->')
      continue
    }
    out.push(true)
  }
  return out
}

/**
 * The link of a bare line: the whole rest of the line must be one link — a URL, `<url>`, `[text](url)`, or
 * `@handle` — so prose that merely mentions a link (like the Format notes) is never taken for a channel.
 */
function bareInput(rest: string): string | null {
  const r = rest.trim()
  const m = /^\[[^\]]*\]\((\S+)\)$/.exec(r) ?? /^<(\S+)>$/.exec(r) ?? /^(\S+)$/.exec(r)
  const link = m?.[1] ?? null
  return link && parseChannelInput(link) ? link : null
}

/**
 * Reads subscriptions.md: every `- ` line in the full form is a channel; a `- ` line that is just a YouTube link
 * (or an @handle) is a bare line to resolve. Everything else — the title, the intro, the Format section, code
 * blocks, HTML comments, the user's own lines — is ignored. A channel listed twice counts once.
 */
export function parseSubscriptions(md: string): { channels: FeedChannel[]; bare: BareLine[] } {
  const channels: FeedChannel[] = []
  const bare: BareLine[] = []
  const lines = md.split('\n')
  const live = liveLines(lines)
  lines.forEach((raw, i) => {
    const l = raw.replace(/\r$/, '')
    if (!live[i] || !l.startsWith('- ')) return
    const m = FULL_LINE.exec(l)
    if (m) {
      if (!channels.some((c) => c.id === m[3])) channels.push({ id: m[3], title: unescapeMD(m[1]).trim() || m[3], url: m[2], added: m[4] ?? '' })
      return
    }
    const input = bareInput(l.slice(2))
    if (input) bare.push({ line: i, text: raw, input })
  })
  return { channels, bare }
}

/** Indexes of the full-form channel lines (outside code blocks and comments) and their titles. */
function channelLines(lines: string[]): { i: number; title: string; id: string }[] {
  const live = liveLines(lines)
  return lines.flatMap((l, i) => {
    const m = live[i] ? FULL_LINE.exec(l.replace(/\r$/, '')) : null
    return m ? [{ i, title: unescapeMD(m[1]), id: m[3] }] : []
  })
}

/** `- [Title](url) · UC… · added YYYY-MM-DD` */
export const subscriptionLine = (c: FeedChannel): string => `- [${escapeMD(c.title)}](${c.url}) · ${c.id}${c.added ? ` · added ${c.added}` : ''}`

/**
 * Follows a channel: adds its full line among the channel lines, in title order (case-insensitive) — just before
 * the first channel line whose title sorts after it, else right after the last channel line. With no channel
 * lines yet: before the first `## ` heading (the Format section), else at the end. No other line moves or changes.
 * Already followed: the same text back (no write).
 */
export function followInMarkdown(md: string, c: FeedChannel): string {
  if (parseSubscriptions(md).channels.some((x) => x.id === c.id)) return md
  const lines = (md.trim() === '' ? SUBSCRIPTIONS_TEMPLATE : md).split('\n')
  const listed = channelLines(lines)
  const next = listed.find((x) => titleOrder(x.title, c.title) > 0)
  const line = subscriptionLine(c)
  if (next) lines.splice(next.i, 0, line)
  else if (listed.length) lines.splice(listed[listed.length - 1].i + 1, 0, line)
  else {
    const live = liveLines(lines)
    const heading = lines.findIndex((l, i) => live[i] && /^##\s/.test(l))
    if (heading >= 0) {
      // "…intro\n\n- line\n\n## Format": one blank line on each side
      let at = heading
      while (at > 0 && lines[at - 1].trim() === '') at--
      lines.splice(at, heading - at, '', line, '')
    } else {
      while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
      lines.push('', line, '')
    }
  }
  return lines.join('\n')
}

/** Unfollows: deletes the channel's line(s) (never inside code blocks / comments). Not listed: the same text back. */
export function unfollowInMarkdown(md: string, id: string): string {
  const lines = md.split('\n')
  const drop = new Set(channelLines(lines).filter((x) => x.id === id).map((x) => x.i))
  return drop.size ? lines.filter((_, i) => !drop.has(i)).join('\n') : md
}

/**
 * Rewrites one bare line the user typed into the full form — only when that line still reads `bare.text` (else the
 * same text back: the file changed, try again later). When the channel is already listed, the bare line is removed.
 */
export function resolveBareLine(md: string, bare: BareLine, c: FeedChannel): string {
  const lines = md.split('\n')
  if (lines[bare.line] !== bare.text) return md
  if (parseSubscriptions(md).channels.some((x) => x.id === c.id)) lines.splice(bare.line, 1)
  else lines[bare.line] = subscriptionLine(c) + (bare.text.endsWith('\r') ? '\r' : '')
  return lines.join('\n')
}

// ---------- feed-hidden.json ----------

/** Reads `feed-hidden.json` (`{ "hidden": [ ids, oldest first ] }`). */
export function parseHidden(text: string): string[] {
  const r = parseObject(text)
  const ids = (Array.isArray(r?.hidden) ? r.hidden : []).filter((h): h is string => typeof h === 'string' && VIDEO_ID.test(h))
  return [...new Set(ids)].slice(-MAX_HIDDEN)
}

export function encodeHidden(hidden: string[]): string {
  return JSON.stringify({ hidden: hidden.slice(-MAX_HIDDEN) }, null, 2) + '\n'
}

/** Hides a video for good. Keeps the newest MAX_HIDDEN ids. Already hidden (or not an id): the same array back. */
export function hideVideo(hidden: string[], id: string): string[] {
  if (!VIDEO_ID.test(id) || hidden.includes(id)) return hidden
  return [...hidden, id].slice(-MAX_HIDDEN)
}

// ---------- feed URLs ----------

/**
 * The playlist id of a channel's long-form uploads (no Shorts, no live streams): `UULF` + the id after `UC`.
 * (`UU` + rest is all uploads, `UUSH` Shorts only, `UULV` live streams.)
 */
export function longFormPlaylistID(channelId: string): string | null {
  return isChannelID(channelId) ? 'UULF' + channelId.slice(2) : null
}

export const longFormFeedURL = (channelId: string): string | null => {
  const p = longFormPlaylistID(channelId)
  return p ? `https://www.youtube.com/feeds/videos.xml?playlist_id=${p}` : null
}
export const channelFeedURL = (channelId: string): string => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
/** The channel's Videos tab: long-form uploads only (Shorts and live streams have their own tabs). */
export const videosTabURL = (channelId: string): string => `https://www.youtube.com/channel/${channelId}/videos`
export const shortsCheckURL = (videoId: string): string => `https://www.youtube.com/shorts/${videoId}`
export const watchURLFor = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`
/** A 16:9 thumbnail (320×180) from i.ytimg.com; the feed's own `hqdefault` is 4:3 with black bars. */
export const thumbnailURL = (videoId: string): string => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`

// ---------- RSS ----------

export function decodeXML(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e] ?? ''
  })
}

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? decodeXML(m[1].trim()) : null
}
const attr = (xml: string, element: string, name: string): string | null => {
  const m = new RegExp(`<${element}\\s[^>]*\\b${name}="([^"]*)"`).exec(xml)
  return m ? decodeXML(m[1]) : null
}

/**
 * Parses a YouTube Atom feed (`/feeds/videos.xml?channel_id=…` or `?playlist_id=…`). A small regex parse of
 * the few fields the Feed needs; unknown or broken entries are skipped. Returns null when it is not a feed
 * (e.g. YouTube's HTML error page).
 */
export function parseFeedXML(xml: string): { title: string; channelId: string | null; videos: FeedVideo[] } | null {
  if (!/<feed[\s>]/.test(xml)) return null
  const head = xml.split('<entry>')[0]
  const feedTitle = tag(head, 'title') ?? ''
  const headChannel = tag(head, 'yt:channelId')
  const authorBlock = tag(head, 'author') ?? ''
  const videos: FeedVideo[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]
    const id = tag(e, 'yt:videoId')
    if (!id || !VIDEO_ID.test(id)) continue
    const channelId = tag(e, 'yt:channelId') ?? ''
    const author = tag(e, 'author') ?? ''
    const views = attr(e, 'media:statistics', 'views')
    videos.push({
      id,
      title: tag(e, 'title') ?? tag(e, 'media:title') ?? id,
      channelId: isChannelID(channelId) ? channelId : headChannel && isChannelID('UC' + headChannel) ? 'UC' + headChannel : channelId,
      channelTitle: tag(author, 'name') ?? '',
      published: tag(e, 'published') ?? '',
      link: attr(e, 'link', 'href') ?? watchURLFor(id),
      views: views !== null && /^\d+$/.test(views) ? Number(views) : null,
    })
  }
  // A playlist feed's <title> is the playlist's ("Videos"); the author is the channel.
  const channelTitle = tag(authorBlock, 'name') ?? feedTitle
  const channelId = headChannel ? (isChannelID(headChannel) ? headChannel : isChannelID('UC' + headChannel) ? 'UC' + headChannel : null) : null
  return { title: channelTitle, channelId, videos }
}

// ---------- Shorts and upcoming videos ----------

/** What a feed entry is, before or after the `/shorts/<id>` check. */
export type ShortsVerdict = 'short' | 'video' | 'unknown'

/** The feed itself marks Shorts: their `<link rel="alternate">` is `/shorts/<id>` (regular videos: `/watch?v=`). */
export const linkSaysShort = (v: FeedVideo): boolean => /\/shorts\//.test(v.link)

/**
 * The answer of `GET https://www.youtube.com/shorts/<id>` without following redirects: 200 = a Short (the
 * Shorts player), a redirect to `/watch` = a regular video. Anything else (429, 5xx, offline, a consent page
 * redirect) is unknown: not cached, the video stays out of the Feed until a later check answers.
 */
export function shortsVerdict(status: number, location: string | null): ShortsVerdict {
  if (status === 200) return 'short'
  if (status >= 300 && status < 400 && location && /\/watch\?(?:.*&)?v=/.test(location)) return 'video'
  return 'unknown'
}

/**
 * Whether a video still needs the `/shorts/` check: not when the feed link already says Short, not when an
 * earlier check answered (`known`). Videos from the long-form (UULF) feed never need it.
 */
export function needsShortsCheck(v: FeedVideo, known: Record<string, boolean>): boolean {
  if (v.longForm || linkSaysShort(v)) return false
  return !(v.id in known)
}

/**
 * True when a video should stay out of the Feed for now as an upcoming premiere or a live stream that has
 * not started: the feed lists those with 0 views (the cheap signal; a just-published video can also have 0
 * views for a minute, and it shows up at the next refresh). Published in the future also counts.
 */
export function isUpcoming(v: FeedVideo, now: number = Date.now()): boolean {
  if (v.views === 0) return true
  const t = Date.parse(v.published)
  return Number.isFinite(t) && t > now + 5 * 60_000
}

// ---------- merging and the list ----------

const time = (v: FeedVideo): number => { const t = Date.parse(v.published); return Number.isFinite(t) ? t : 0 }

/** Newest first; ties by id so the order is stable. */
export const newestFirst = (a: FeedVideo, b: FeedVideo): number => time(b) - time(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Merges freshly fetched videos into a channel's cached ones: fresh data wins (titles change, views grow),
 * older cached videos the feed no longer lists are kept (the channel feed only has the latest 15 uploads),
 * newest first, at most `max`.
 */
export function mergeVideos(cached: FeedVideo[], fresh: FeedVideo[], max = MAX_PER_CHANNEL): FeedVideo[] {
  const byId = new Map<string, FeedVideo>()
  for (const v of cached) byId.set(v.id, v)
  for (const v of fresh) {
    const old = byId.get(v.id)
    // an exact time (RSS) beats a worked-out one ("2d ago"); what is known stays known
    const m: FeedVideo = { ...v }
    if (old && v.approx) { m.published = old.published; if (old.approx) m.approx = true; else delete m.approx }
    if (old?.longForm) m.longForm = true
    const duration = v.duration ?? old?.duration
    if (duration) m.duration = duration
    byId.set(v.id, m)
  }
  return [...byId.values()].sort(newestFirst).slice(0, max)
}

/**
 * The videos the Feed shows: from followed channels, newest first, without hidden ones, Shorts (by the feed
 * link or the `/shorts/` check; unknown counts as not shown yet), or upcoming premieres / live streams.
 */
export function visibleVideos(
  byChannel: Record<string, FeedVideo[]>,
  opts: { followed: string[]; hidden: Iterable<string>; shorts: Record<string, boolean>; now?: number },
): FeedVideo[] {
  const hidden = new Set(opts.hidden)
  const seen = new Set<string>()
  const out: FeedVideo[] = []
  for (const ch of opts.followed) {
    for (const v of byChannel[ch] ?? []) {
      if (seen.has(v.id) || hidden.has(v.id) || linkSaysShort(v) || isUpcoming(v, opts.now)) continue
      if (!v.longForm && opts.shorts[v.id] !== false) continue // a Short, or not checked yet
      seen.add(v.id)
      out.push(v)
    }
  }
  return out.sort(newestFirst)
}

/** Video id → Library folder ("In Library" in the Feed). The first folder of a video wins. */
export function libraryIndex(folders: { folder: string; id: string | null }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const f of folders) if (f.id && !m.has(f.id)) m.set(f.id, f.folder)
  return m
}

/** How many of `videos` came out after the Feed was last opened (the sidebar badge). Never opened: 0. */
export function newCount(videos: FeedVideo[], lastOpened: string | undefined, inLibrary: (id: string) => boolean = () => false): number {
  if (!lastOpened) return 0
  const since = Date.parse(lastOpened)
  if (!Number.isFinite(since)) return 0
  return videos.filter((v) => time(v) > since && !inLibrary(v.id)).length
}

/** "just now", "5 minutes ago", "yesterday", "2 days ago", "3 weeks ago", "2 months ago", "1 year ago". */
export function relativeDate(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (now - t) / 1000)
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'} ago`
  if (s < 60) return 'just now'
  if (s < 3600) return n(Math.floor(s / 60), 'minute')
  if (s < 86400) return n(Math.floor(s / 3600), 'hour')
  const d = Math.floor(s / 86400)
  if (d === 1) return 'yesterday'
  if (d < 7) return n(d, 'day')
  if (d < 30) return n(Math.floor(d / 7), 'week')
  if (d < 365) return n(Math.floor(d / 30), 'month')
  return n(Math.floor(d / 365), 'year')
}

/** Keeps the `/shorts/` check cache small: the newest `max` answers (insertion order). */
export function capShortsCache(shorts: Record<string, boolean>, max = 5000): Record<string, boolean> {
  const keys = Object.keys(shorts)
  if (keys.length <= max) return shorts
  return Object.fromEntries(keys.slice(-max).map((k) => [k, shorts[k]]))
}

// ---------- the Videos tab through yt-dlp (the main source) ----------

/** One field per line part, tab-separated. */
export const YTDLP_LIST_FORMAT = '%(id)s\t%(title)s\t%(duration)s\t%(upload_date)s\t%(timestamp)s\t%(live_status)s'

/**
 * yt-dlp arguments that list a channel's Videos tab (long-form uploads only: Shorts and live streams have their
 * own tabs) without opening each video: one request per channel. `approximate_date` gives each a day.
 */
export function videosTabArgs(channelId: string, count = 15): string[] {
  return ['--flat-playlist', '--playlist-items', `1:${count}`, '--extractor-args', 'youtubetab:approximate_date',
    '--no-warnings', '--print', YTDLP_LIST_FORMAT, videosTabURL(channelId)]
}

/** 6203 → "1:43:23", 2400 → "40:00". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

/**
 * Reads the `--print YTDLP_LIST_FORMAT` lines (other output lines are skipped), newest first in page order. Times
 * are a day (`timestamp`, else `upload_date`), so same-day videos keep the page order (a second apart). Upcoming
 * premieres and live streams (`live_status` is_upcoming / is_live) are left out.
 */
export function parseVideosListing(output: string, channelId: string, channelTitle: string, now: number = Date.now()): FeedVideo[] {
  const out: FeedVideo[] = []
  for (const line of output.split('\n')) {
    const f = line.replace(/\r$/, '').split('\t')
    if (f.length < 6 || !VIDEO_ID.test(f[0]) || out.some((v) => v.id === f[0])) continue
    const [id, title, dur, day, ts, live] = f
    if (live === 'is_upcoming' || live === 'is_live') continue
    let t = /^\d+$/.test(ts) ? Number(ts) * 1000 : NaN
    if (!Number.isFinite(t) && /^\d{8}$/.test(day)) t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)), 12)
    if (!Number.isFinite(t)) continue
    t = Math.min(t, now) - out.length * 1000
    const seconds = Number(dur)
    out.push({
      id, title: title && title !== 'NA' ? title : id, channelId, channelTitle, published: new Date(t).toISOString(), link: watchURLFor(id),
      views: null, longForm: true, approx: true, ...(Number.isFinite(seconds) && seconds > 0 ? { duration: formatDuration(seconds) } : {}),
    })
  }
  return out
}

// ---------- the Videos tab page (fallback without yt-dlp) ----------

/** "7h ago", "2d ago", "3 weeks ago", "Streamed 1 month ago" → a time that long before `now`; null if it is not that. */
export function parseAgo(text: string, now: number = Date.now()): number | null {
  const m = /(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\s+ago/i.exec(text)
  if (!m) return null
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  const ms = unit.startsWith('s') ? 1000 : unit === 'm' || unit.startsWith('min') ? 60_000 : unit.startsWith('h') ? 3_600_000
    : unit.startsWith('d') ? 86_400_000 : unit.startsWith('w') ? 7 * 86_400_000 : unit.startsWith('mo') ? 30 * 86_400_000 : 365 * 86_400_000
  return now - n * ms
}

/** The `ytInitialData` object of a YouTube page, or null. */
export function initialData(html: string): unknown {
  const m = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html) ?? /window\["ytInitialData"\] = (\{[\s\S]*?\});/.exec(html)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

/**
 * The videos on a channel's Videos tab (`/channel/UC…/videos`), newest first: the same long-form list the
 * channel page shows (no Shorts: they have their own tab). Times are worked out from "2d ago" (`approx`), kept
 * in page order. Upcoming premieres / live streams (no "… ago") are left out. Reads both the current
 * `lockupViewModel` layout and the older `videoRenderer`.
 */
export function parseVideosTab(html: string, channelId: string, channelTitle: string, now: number = Date.now()): FeedVideo[] {
  const data = initialData(html)
  if (!data) return []
  const out: FeedVideo[] = []
  const text = (o: unknown): string => {
    if (!o || typeof o !== 'object') return ''
    const r = o as Record<string, unknown>
    if (typeof r.content === 'string') return r.content
    if (typeof r.simpleText === 'string') return r.simpleText
    if (Array.isArray(r.runs)) return r.runs.map((x) => (x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string' ? (x as { text: string }).text : '')).join('')
    return ''
  }
  const push = (id: string, title: string, meta: string[], duration: string | undefined) => {
    if (!VIDEO_ID.test(id) || out.some((v) => v.id === id)) return
    const t = meta.map((x) => parseAgo(x, now)).find((x) => x !== null)
    if (t === undefined || t === null) return // upcoming / live / unknown: not shown
    out.push({
      id, title: title || id, channelId, channelTitle, published: new Date(t - out.length * 1000).toISOString(),
      link: watchURLFor(id), views: null, longForm: true, approx: true, ...(duration ? { duration } : {}),
    })
  }
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { for (const x of o) walk(x); return }
    const r = o as Record<string, unknown>
    const lv = r.lockupViewModel as Record<string, unknown> | undefined
    if (lv && typeof lv.contentId === 'string' && lv.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const md = (lv.metadata as Record<string, Record<string, unknown>> | undefined)?.lockupMetadataViewModel ?? {}
      const rows = ((md.metadata as Record<string, Record<string, unknown>> | undefined)?.contentMetadataViewModel?.metadataRows ?? []) as { metadataParts?: { text?: unknown }[] }[]
      const parts = rows.flatMap((row) => (row.metadataParts ?? []).map((p) => text(p.text)))
      const badges: string[] = []
      const findBadges = (x: unknown): void => {
        if (!x || typeof x !== 'object') return
        if (Array.isArray(x)) { x.forEach(findBadges); return }
        const xr = x as Record<string, unknown>
        const b = xr.thumbnailBadgeViewModel as Record<string, unknown> | undefined
        if (b && typeof b.text === 'string') badges.push(b.text)
        for (const v of Object.values(xr)) findBadges(v)
      }
      findBadges(lv.contentImage)
      push(lv.contentId, text(md.title), parts, badges.find((b) => /^\d+(:\d\d){1,2}$/.test(b)))
      return
    }
    const vr = r.videoRenderer as Record<string, unknown> | undefined
    if (vr && typeof vr.videoId === 'string') {
      if (vr.upcomingEventData) return
      push(vr.videoId, text(vr.title), [text(vr.publishedTimeText)], text(vr.lengthText) || undefined)
      return
    }
    for (const v of Object.values(r)) walk(v)
  }
  // only the selected tab (the Videos tab), not the header or other tabs
  const tabs = (((data as Record<string, Record<string, Record<string, unknown>>>).contents?.twoColumnBrowseResultsRenderer?.tabs) ?? []) as { tabRenderer?: { selected?: boolean; content?: unknown } }[]
  const selected = tabs.find((t) => t.tabRenderer?.selected)?.tabRenderer?.content
  walk(selected ?? data)
  return out
}

// ---------- "+ Follow channel": what the user typed ----------

export type ChannelInput =
  | { kind: 'id'; id: string }
  | { kind: 'page'; url: string }
  | { kind: 'video'; id: string }

/**
 * What "+ Follow channel" was given: a channel id or `/channel/UC…` URL (no lookup of the id needed), an
 * `@handle` / `youtube.com/@handle` / `/c/name` / `/user/name` page (the page's canonical link has the id),
 * or any video link (follow its channel). Null when it is none of these.
 */
export function parseChannelInput(input: string): ChannelInput | null {
  const s = input.trim()
  if (!s) return null
  if (isChannelID(s)) return { kind: 'id', id: s }
  if (/^@[\w.\-·]{2,100}$/u.test(s)) return { kind: 'page', url: `https://www.youtube.com/${encodeURI(s)}` }
  let u: URL
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s) } catch { return null }
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0]
    return VIDEO_ID.test(id) ? { kind: 'video', id } : null
  }
  if (host !== 'youtube.com') return null
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] === 'channel' && parts[1] && isChannelID(parts[1])) return { kind: 'id', id: parts[1] }
  if (parts[0] === 'watch') {
    const id = u.searchParams.get('v') ?? ''
    return VIDEO_ID.test(id) ? { kind: 'video', id } : null
  }
  if ((parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed') && parts[1] && VIDEO_ID.test(parts[1])) return { kind: 'video', id: parts[1] }
  if (parts[0]?.startsWith('@')) return { kind: 'page', url: `https://www.youtube.com/${parts[0]}` }
  if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) return { kind: 'page', url: `https://www.youtube.com/${parts[0]}/${parts[1]}` }
  if (parts[0] === 'feeds' && u.searchParams.get('channel_id') && isChannelID(u.searchParams.get('channel_id')!)) return { kind: 'id', id: u.searchParams.get('channel_id')! }
  return null
}

/** The channel id, title and @handle from a channel page's HTML (canonical link / RSS link, `og:title`, `vanityChannelUrl`). */
export function parseChannelPage(html: string): { id: string; title: string; handle?: string } | null {
  const id = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/.exec(html)?.[1]
    ?? /feeds\/videos\.xml\?channel_id=(UC[A-Za-z0-9_-]{22})/.exec(html)?.[1]
    ?? /"externalId":"(UC[A-Za-z0-9_-]{22})"/.exec(html)?.[1]
  if (!id) return null
  const title = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1]
  const handle = /"vanityChannelUrl":"https?:\/\/(?:www\.)?youtube\.com\/(@[^"/?]+)"/.exec(html)?.[1]
  return { id, title: title ? decodeXML(title) : id, ...(handle ? { handle: decodeURIComponent(handle) } : {}) }
}

/** The @handle in a channel link ("https://www.youtube.com/@allin" → "@allin"), or undefined. */
export const handleIn = (url: string): string | undefined => /youtube\.com\/(@[^/?#"]+)/.exec(url)?.[1]

/** The channel of a video from its watch page's HTML (`videoDetails`), as a fallback when oEmbed has no author link. */
export function parseWatchPageChannel(html: string): { id: string; title: string } | null {
  const id = /"videoDetails":\{[^}]*?"channelId":"(UC[A-Za-z0-9_-]{22})"/.exec(html)?.[1] ?? /<meta itemprop="channelId" content="(UC[A-Za-z0-9_-]{22})"/.exec(html)?.[1]
  if (!id) return null
  const title = /"ownerChannelName":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1]
  let t = id
  if (title) { try { t = JSON.parse(`"${title}"`) } catch { t = title } }
  return { id, title: t }
}
