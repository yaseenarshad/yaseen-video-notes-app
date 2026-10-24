// The network side of the 📺 Feed (yt-dlp on the Videos tab, else plain Node fetch; no API key, no login). Pure parsing is in feed.ts.
import { FollowAlongError } from './errors'
import {
  channelFeedURL, handleIn, isChannelID, longFormFeedURL, parseChannelInput, parseChannelPage, parseFeedXML, parseVideosListing, parseVideosTab,
  parseWatchPageChannel, shortsCheckURL, shortsVerdict, videosTabArgs, videosTabURL, watchURLFor, type FeedVideo, type ShortsVerdict,
} from './feed'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  // Skips the EU cookie-consent interstitial (consent.youtube.com) for page fetches.
  Cookie: 'SOCS=CAI',
}

export interface Got { status: number; text: string; location: string | null }

/** One GET. Throws only on network failure / timeout (offline). */
export async function get(url: string, opts: { redirect?: 'follow' | 'manual'; timeout?: number; body?: boolean } = {}): Promise<Got> {
  const r = await fetch(url, { headers: HEADERS, redirect: opts.redirect ?? 'follow', signal: AbortSignal.timeout(opts.timeout ?? 20_000) })
  const text = opts.body === false ? '' : await r.text()
  if (opts.body === false) await r.body?.cancel().catch(() => {})
  return { status: r.status, text, location: r.headers.get('location') }
}

const offline = (e: unknown): string => {
  const m = e instanceof Error ? ((e.cause as Error | undefined)?.message ?? e.message) : String(e)
  return /ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ECONNRESET|fetch failed|timed? ?out|aborted/i.test(m) ? 'offline or YouTube did not answer' : m
}

/**
 * Finds a channel's id and title, once per follow: a channel id needs only its page for the title; `@handle`,
 * `/c/…`, `/user/…` pages are fetched and their canonical link read; a video link goes through YouTube's oEmbed
 * (a small JSON with the channel's @handle link), falling back to the watch page.
 */
export async function resolveChannel(input: string): Promise<{ id: string; title: string; handle?: string }> {
  const what = parseChannelInput(input)
  if (!what) throw new FollowAlongError('That is not a YouTube channel or video link. Try @handle, a channel link, or a video link.')
  try {
    if (what.kind === 'id' || what.kind === 'page') {
      const url = what.kind === 'id' ? `https://www.youtube.com/channel/${what.id}` : what.url
      const r = await get(url)
      if (r.status === 404) throw new FollowAlongError('YouTube has no such channel.')
      const ch = r.status === 200 ? parseChannelPage(r.text) : null
      const typed = what.kind === 'page' ? handleIn(what.url) : undefined
      if (ch) return { ...ch, ...(!ch.handle && typed ? { handle: typed } : {}) }
      if (what.kind === 'id') return { id: what.id, title: what.id }
      throw new FollowAlongError(`Could not read the channel page (HTTP ${r.status}).`)
    }
    const o = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchURLFor(what.id))}`)
    if (o.status === 200) {
      try {
        const j = JSON.parse(o.text) as { author_url?: string }
        if (j.author_url) {
          const p = await get(j.author_url)
          const ch = p.status === 200 ? parseChannelPage(p.text) : null
          const h = handleIn(j.author_url)
          if (ch) return { ...ch, ...(!ch.handle && h ? { handle: h } : {}) }
        }
      } catch { /* fall back to the watch page */ }
    }
    const w = await get(watchURLFor(what.id))
    const ch = w.status === 200 ? parseWatchPageChannel(w.text) : null
    if (ch) return ch
    throw new FollowAlongError(o.status === 404 || o.status === 401 ? 'That video is private or does not exist.' : 'Could not find the channel of that video.')
  } catch (e) {
    if (e instanceof FollowAlongError) throw e
    throw new FollowAlongError(`Could not reach YouTube: ${offline(e)}.`)
  }
}

/** YouTube said "too many requests": stop for now, keep the cached videos, try again later. */
export class RateLimited extends FollowAlongError {
  constructor(message = 'YouTube is rate-limiting requests right now (HTTP 429); trying again later.') {
    super(message)
    this.name = 'RateLimited'
  }
}

export interface ChannelFetch {
  videos: FeedVideo[]
  /** Which list answered: yt-dlp on the Videos tab, the Videos tab page, or (last resort) an RSS feed. */
  source: 'ytdlp' | 'page' | 'longform' | 'channel'
}

/** Runs yt-dlp and returns its output lines (`runYTDLP` from folderMaker: Homebrew PATH, error tail on failure). */
export type YTDLPRunner = (args: string[]) => Promise<string[]>

/**
 * The latest long-form videos of a channel, in this order:
 * 1. yt-dlp listing the channel's Videos tab (`videosTabArgs`): one call, no Shorts (they have their own tab),
 *    a day for each video. Waits while yt-dlp is being updated (the caller wraps the runner).
 * 2. Without yt-dlp, or when it failed (not a 429): the Videos tab page itself (plain fetch of ytInitialData).
 * 3. Last resort: YouTube's RSS feeds, one try each — the long-form playlist (`UULF…`), then the channel feed
 *    (with Shorts: the caller drops them). As of 2026-10 these answer 404 for most channels most of the time.
 * A 429 throws `RateLimited` right away (no further requests).
 */
export async function fetchChannel(channelId: string, opts: { title?: string; ytdlp?: YTDLPRunner | null } = {}): Promise<ChannelFetch> {
  if (!isChannelID(channelId)) throw new FollowAlongError('Not a channel id.')
  const title = opts.title ?? ''
  let ytdlpError: string | null = null
  if (opts.ytdlp) {
    try {
      const lines = await opts.ytdlp(videosTabArgs(channelId))
      const videos = parseVideosListing(lines.join('\n'), channelId, title)
      if (videos.length) return { videos, source: 'ytdlp' }
      ytdlpError = 'yt-dlp listed no videos'
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (/HTTP Error 429|Too Many Requests/i.test(m)) throw new RateLimited()
      ytdlpError = m.split('\n').filter(Boolean).slice(-1)[0] ?? m
    }
  }
  try {
    const r = await get(videosTabURL(channelId))
    if (r.status === 429) throw new RateLimited()
    if (r.status === 200) {
      const videos = parseVideosTab(r.text, channelId, title || parseChannelPage(r.text)?.title || '')
      if (videos.length) return { videos, source: 'page' }
    }
    for (const [url, source] of [[longFormFeedURL(channelId)!, 'longform'], [channelFeedURL(channelId), 'channel']] as const) {
      const f = await get(url, { timeout: 15_000 })
      if (f.status === 429) throw new RateLimited()
      const feed = f.status === 200 ? parseFeedXML(f.text) : null
      if (feed && feed.videos.length) {
        return { videos: source === 'longform' ? feed.videos.map((v) => ({ ...v, longForm: true })) : feed.videos, source }
      }
    }
    throw new FollowAlongError(ytdlpError ? `Could not list the channel's videos: ${ytdlpError}` : `Could not list the channel's videos (HTTP ${r.status}).`)
  } catch (e) {
    if (e instanceof FollowAlongError) throw e
    throw new FollowAlongError(`Could not reach YouTube: ${offline(e)}.`)
  }
}

/** `GET /shorts/<id>` without following the redirect: 200 = a Short, a redirect to /watch = a regular video. */
export async function checkShort(videoId: string): Promise<ShortsVerdict> {
  try {
    const r = await get(shortsCheckURL(videoId), { redirect: 'manual', timeout: 15_000, body: false })
    return shortsVerdict(r.status, r.location)
  } catch {
    return 'unknown'
  }
}
