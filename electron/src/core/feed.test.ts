import { describe, expect, it } from 'vitest'
import {
  capShortsCache, channelFeedURL, channelURL, dayOf, decodeXML, DEFAULT_FEED_DIR, encodeHidden, expandHome, followInMarkdown, formatDuration,
  handleIn, hideVideo, isUpcoming, libraryIndex, linkSaysShort, liveLines, longFormFeedURL, longFormPlaylistID, MAX_HIDDEN, mergeVideos,
  needsShortsCheck, newCount, parseAgo, parseChannelInput, parseChannelPage, parseFeedXML, parseHidden, parseSubscriptions, parseVideosListing,
  parseVideosTab, parseWatchPageChannel, relativeDate, resolveBareLine, shortsVerdict, SUBSCRIPTIONS_TEMPLATE, subscriptionLine,
  unfollowInMarkdown, videosTabArgs, videosTabURL, visibleVideos, type FeedVideo,
} from './feed'
import { allInFeed, allInListing, peterDiamandisFeed, peterDiamandisVideosTab, subscriptionsMD } from './feedFixtures'

const PD = 'UCvxm0qTrGN_1LMYgUaftWyQ'
const ALLIN = 'UCESLZhusAkFfsNsApnjF_Cg'

const video = (id: string, published: string, extra: Partial<FeedVideo> = {}): FeedVideo => ({
  id, title: id, channelId: ALLIN, channelTitle: 'All-In Podcast', published, link: `https://www.youtube.com/watch?v=${id}`, views: 100, ...extra,
})

describe('RSS', () => {
  it('parses a real channel feed', () => {
    const f = parseFeedXML(allInFeed)!
    expect(f.title).toBe('All-In Podcast')
    expect(f.channelId).toBe(ALLIN)
    expect(f.videos.map((v) => v.id)).toEqual(['6czo-C3FU7I', 'yzk44lz-RGI', 'FiD_3GKKdUc'])
    expect(f.videos[0]).toEqual({
      id: '6czo-C3FU7I',
      title: 'AI Cyber Panic, Ken Griffin’s Bubble Warning, The Fall of France?',
      channelId: ALLIN,
      channelTitle: 'All-In Podcast',
      published: '2026-10-23T23:52:56+00:00',
      link: 'https://www.youtube.com/watch?v=6czo-C3FU7I',
      views: 42782,
    })
    expect(f.videos[1].title).toBe('Arvind Krishna & Nikesh Arora: Quantum Threat, Open vs Frontier AI, AI Cyber Warfare & SaaS Collapse')
  })

  it('decodes entities in titles', () => {
    const f = parseFeedXML(peterDiamandisFeed)!
    expect(f.videos[2].title).toBe('Google X has a project in the lab that "would be a problem for physics" if it\'s real.')
    expect(decodeXML('a &amp; b &#39;c&#39; &#x2019; &lt;x&gt;')).toBe("a & b 'c' ’ <x>")
  })

  it('is not fooled by YouTube’s HTML error page', () => {
    expect(parseFeedXML('<!DOCTYPE html><html><title>Error 404 (Not Found)!!1</title></html>')).toBeNull()
  })

  it('reads a playlist feed (the channel is the author, not the playlist title)', () => {
    const xml = allInFeed.replace('<title>All-In Podcast</title>\n <link rel="alternate" href="https://www.youtube.com/channel', '<title>Videos</title>\n <link rel="alternate" href="https://www.youtube.com/channel')
    expect(parseFeedXML(xml)!.title).toBe('All-In Podcast')
  })
})

describe('feed URLs', () => {
  it('maps UC… to the long-form uploads playlist UULF…', () => {
    expect(longFormPlaylistID(PD)).toBe('UULFvxm0qTrGN_1LMYgUaftWyQ')
    expect(longFormFeedURL(ALLIN)).toBe('https://www.youtube.com/feeds/videos.xml?playlist_id=UULFESLZhusAkFfsNsApnjF_Cg')
    expect(channelFeedURL(ALLIN)).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UCESLZhusAkFfsNsApnjF_Cg')
    expect(longFormPlaylistID('UUvxm0qTrGN_1LMYgUaftWyQ')).toBeNull()
    expect(longFormPlaylistID('UCshort')).toBeNull()
  })
})

describe('Shorts', () => {
  it('the feed link marks Shorts', () => {
    const f = parseFeedXML(peterDiamandisFeed)!
    expect(f.videos.map(linkSaysShort)).toEqual([true, false, true])
  })

  it('reads the /shorts/ check: 200 = Short, redirect to /watch = video, else unknown', () => {
    expect(shortsVerdict(200, null)).toBe('short')
    expect(shortsVerdict(303, 'https://www.youtube.com/watch?v=LeSIe50WfLI')).toBe('video')
    expect(shortsVerdict(302, 'https://consent.youtube.com/m?continue=x')).toBe('unknown')
    expect(shortsVerdict(429, null)).toBe('unknown')
    expect(shortsVerdict(0, null)).toBe('unknown')
  })

  it('checks each regular-looking video once; never Shorts by link or long-form feed videos', () => {
    const v = video('LeSIe50WfLI', '2026-10-23T20:00:10+00:00')
    expect(needsShortsCheck(v, {})).toBe(true)
    expect(needsShortsCheck(v, { LeSIe50WfLI: false })).toBe(false)
    expect(needsShortsCheck({ ...v, link: 'https://www.youtube.com/shorts/LeSIe50WfLI' }, {})).toBe(false)
    expect(needsShortsCheck({ ...v, longForm: true }, {})).toBe(false)
  })

  it('caps the check cache, keeping the newest answers', () => {
    const c: Record<string, boolean> = {}
    for (let i = 0; i < 10; i++) c['v' + i] = i % 2 === 0
    expect(Object.keys(capShortsCache(c, 4))).toEqual(['v6', 'v7', 'v8', 'v9'])
  })
})

describe('upcoming premieres and live streams', () => {
  const now = Date.parse('2026-10-24T00:00:00Z')
  it('0 views or a time in the future is upcoming', () => {
    expect(isUpcoming(video('aaaaaaaaaaa', '2026-10-23T20:00:00+00:00', { views: 0 }), now)).toBe(true)
    expect(isUpcoming(video('aaaaaaaaaaa', '2026-10-25T20:00:00+00:00'), now)).toBe(true)
    expect(isUpcoming(video('aaaaaaaaaaa', '2026-10-23T20:00:00+00:00'), now)).toBe(false)
    expect(isUpcoming(video('aaaaaaaaaaa', '2026-10-23T20:00:00+00:00', { views: null }), now)).toBe(false)
  })
})

describe('merge and the visible list', () => {
  it('merges fresh videos into the cache, keeps older ones, newest first, capped', () => {
    const cached = [video('bbbbbbbbbbb', '2026-10-20T00:00:00Z', { title: 'old title' }), video('ccccccccccc', '2026-10-01T00:00:00Z')]
    const fresh = [video('aaaaaaaaaaa', '2026-10-22T00:00:00Z'), video('bbbbbbbbbbb', '2026-10-20T00:00:00Z', { title: 'new title' })]
    const m = mergeVideos(cached, fresh)
    expect(m.map((v) => v.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
    expect(m[1].title).toBe('new title')
    expect(mergeVideos(cached, fresh, 2).map((v) => v.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
  })

  it('shows followed channels only, newest first across channels, without Shorts, hidden, unchecked or upcoming videos', () => {
    const pd = parseFeedXML(peterDiamandisFeed)!.videos
    const ai = parseFeedXML(allInFeed)!.videos
    const now = Date.parse('2026-10-24T03:00:00Z')
    const shorts = { 'LeSIe50WfLI': false, '6czo-C3FU7I': false, 'yzk44lz-RGI': false }
    const all = visibleVideos({ [PD]: pd, [ALLIN]: ai }, { followed: [PD, ALLIN], hidden: [], shorts, now })
    expect(all.map((v) => v.id)).toEqual(['6czo-C3FU7I', 'LeSIe50WfLI', 'yzk44lz-RGI'])
    // hidden
    expect(visibleVideos({ [PD]: pd, [ALLIN]: ai }, { followed: [PD, ALLIN], hidden: ['LeSIe50WfLI'], shorts, now }).map((v) => v.id)).toEqual(['6czo-C3FU7I', 'yzk44lz-RGI'])
    // unfollowed channel
    expect(visibleVideos({ [PD]: pd, [ALLIN]: ai }, { followed: [ALLIN], hidden: [], shorts, now }).map((v) => v.id)).toEqual(['6czo-C3FU7I', 'yzk44lz-RGI'])
    // not checked yet: not shown (Shorts are never shown, even for a moment)
    expect(visibleVideos({ [ALLIN]: ai }, { followed: [ALLIN], hidden: [], shorts: {}, now })).toEqual([])
    // a video the check called a Short (even with a /watch link) is not shown
    expect(visibleVideos({ [ALLIN]: ai }, { followed: [ALLIN], hidden: [], shorts: { '6czo-C3FU7I': true, 'yzk44lz-RGI': false }, now }).map((v) => v.id)).toEqual(['yzk44lz-RGI'])
    // long-form feed videos need no check
    expect(visibleVideos({ [ALLIN]: ai.slice(0, 2).map((v) => ({ ...v, longForm: true })) }, { followed: [ALLIN], hidden: [], shorts: {}, now }).length).toBe(2)
    // upcoming
    expect(visibleVideos({ [ALLIN]: [{ ...ai[0], views: 0 }] }, { followed: [ALLIN], hidden: [], shorts, now })).toEqual([])
  })

  it('finds videos already in the Library', () => {
    const lib = libraryIndex([{ folder: '/a/10-23-x', id: '6czo-C3FU7I' }, { folder: '/b/no-id', id: null }, { folder: '/a/10-24-x', id: '6czo-C3FU7I' }])
    expect(lib.get('6czo-C3FU7I')).toBe('/a/10-23-x')
    expect(lib.size).toBe(1)
  })

  it('counts new videos since the Feed was last opened', () => {
    const vs = [video('aaaaaaaaaaa', '2026-10-22T00:00:00Z'), video('bbbbbbbbbbb', '2026-10-20T00:00:00Z'), video('ccccccccccc', '2026-10-23T00:00:00Z')]
    expect(newCount(vs, undefined)).toBe(0)
    expect(newCount(vs, '2026-10-21T00:00:00Z')).toBe(2)
    expect(newCount(vs, '2026-10-21T00:00:00Z', (id) => id === 'ccccccccccc')).toBe(1)
    expect(newCount(vs, '2026-10-24T00:00:00Z')).toBe(0)
  })

  it('says how long ago', () => {
    const now = Date.parse('2026-10-24T12:00:00Z')
    expect(relativeDate('2026-10-24T11:59:30Z', now)).toBe('just now')
    expect(relativeDate('2026-10-24T11:59:00Z', now)).toBe('1 minute ago')
    expect(relativeDate('2026-10-24T07:00:00Z', now)).toBe('5 hours ago')
    expect(relativeDate('2026-10-23T10:00:00Z', now)).toBe('yesterday')
    expect(relativeDate('2026-10-22T10:00:00Z', now)).toBe('2 days ago')
    expect(relativeDate('2026-10-10T10:00:00Z', now)).toBe('2 weeks ago')
    expect(relativeDate('2026-08-01T10:00:00Z', now)).toBe('2 months ago')
    expect(relativeDate('2024-10-01T10:00:00Z', now)).toBe('2 years ago')
    expect(relativeDate('nope', now)).toBe('')
  })
})

describe('the Videos tab (when the RSS feeds do not answer)', () => {
  const now = Date.parse('2026-10-24T03:00:00Z')
  it('reads "… ago"', () => {
    expect(parseAgo('7h ago', now)).toBe(now - 7 * 3_600_000)
    expect(parseAgo('2d ago', now)).toBe(now - 2 * 86_400_000)
    expect(parseAgo('3 weeks ago', now)).toBe(now - 21 * 86_400_000)
    expect(parseAgo('Streamed 1 month ago', now)).toBe(now - 30 * 86_400_000)
    expect(parseAgo('5 minutes ago', now)).toBe(now - 5 * 60_000)
    expect(parseAgo('1y ago', now)).toBe(now - 365 * 86_400_000)
    expect(parseAgo('79K', now)).toBeNull()
    expect(parseAgo('Scheduled for 10/25/26, 3:00 PM', now)).toBeNull()
  })

  it('reads the long-form videos of a real Videos tab, newest first, with durations', () => {
    expect(videosTabURL(PD)).toBe('https://www.youtube.com/channel/UCvxm0qTrGN_1LMYgUaftWyQ/videos')
    const vs = parseVideosTab(peterDiamandisVideosTab, PD, 'Peter H. Diamandis', now)
    expect(vs.map((v) => [v.id, v.duration])).toEqual([['LeSIe50WfLI', '2:25:00'], ['kAwG9E1W_ME', '2:01:16'], ['dthaDyttHns', '1:44:31']])
    expect(vs[0]).toMatchObject({ channelId: PD, channelTitle: 'Peter H. Diamandis', longForm: true, approx: true, views: null, link: 'https://www.youtube.com/watch?v=LeSIe50WfLI' })
    expect(vs[0].title).toBe('Elon’s $100B AI Bet, Anthropic’s Claude Duet, and the PHP Flaw Hiding in 70% of the Web | EP #305')
    expect(vs[0].published).toBe(new Date(now - 7 * 3_600_000).toISOString())
    expect(vs.map((v) => v.published)).toEqual([...vs.map((v) => v.published)].sort().reverse())
    // they need no Shorts check and show up
    expect(visibleVideos({ [PD]: vs }, { followed: [PD], hidden: [], shorts: {}, now }).length).toBe(3)
  })

  it('reads the older videoRenderer layout and leaves out upcoming videos', () => {
    const data = { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: [
      { richItemRenderer: { content: { videoRenderer: { videoId: 'aaaaaaaaaaa', title: { runs: [{ text: 'Episode 1' }] }, publishedTimeText: { simpleText: '2 days ago' }, lengthText: { simpleText: '1:02:03' } } } } },
      { richItemRenderer: { content: { videoRenderer: { videoId: 'bbbbbbbbbbb', title: { runs: [{ text: 'Premiere' }] }, upcomingEventData: { startTime: '1793000000' } } } } },
    ] } } } }] } } }
    const vs = parseVideosTab(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`, ALLIN, 'All-In Podcast', now)
    expect(vs.map((v) => [v.id, v.title, v.duration])).toEqual([['aaaaaaaaaaa', 'Episode 1', '1:02:03']])
  })

  it('is empty for a page without data', () => {
    expect(parseVideosTab('<html></html>', PD, '', now)).toEqual([])
  })

  it('an exact RSS time beats a worked-out one; long-form and duration stay known', () => {
    const rss = video('LeSIe50WfLI', '2026-10-23T20:00:10+00:00', { channelId: PD })
    const page = parseVideosTab(peterDiamandisVideosTab, PD, 'Peter H. Diamandis', now)
    const m = mergeVideos([rss], page).find((v) => v.id === 'LeSIe50WfLI')!
    expect(m.published).toBe('2026-10-23T20:00:10+00:00')
    expect(m.approx).toBeUndefined()
    expect(m.duration).toBe('2:25:00')
    const back = mergeVideos(page, [rss]).find((v) => v.id === 'LeSIe50WfLI')!
    expect(back).toMatchObject({ published: '2026-10-23T20:00:10+00:00', longForm: true, duration: '2:25:00' })
  })
})

describe('subscriptions.md', () => {
  const head = '# YouTube subscriptions\n\nIntro text.\n\n'
  const formatAt = (md: string) => md.slice(md.indexOf('## Format'))

  it('lives in the skills repo, relative to the home folder', () => {
    expect(DEFAULT_FEED_DIR).toBe('~/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app')
    expect(expandHome(DEFAULT_FEED_DIR, '/Users/someone')).toBe('/Users/someone/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app')
    expect(expandHome('~', '/Users/x')).toBe('/Users/x')
    expect(expandHome('/tmp/feed', '/Users/x')).toBe('/tmp/feed')
  })

  it('reads the real file: exactly the 8 channels, nothing from the Format section or its code block', () => {
    const { channels, bare } = parseSubscriptions(subscriptionsMD)
    expect(channels.map((c) => c.title)).toEqual(['a16z', 'AI Engineer', 'All-In Podcast', 'Big Technology', 'Dwarkesh Patel', 'Peter H. Diamandis', 'Sequoia Capital', 'Y Combinator'])
    expect(channels[2]).toEqual({ id: ALLIN, title: 'All-In Podcast', url: 'https://www.youtube.com/@allin', added: '2026-10-23' })
    expect(bare).toEqual([])
  })

  it('appending keeps the list sorted and the intro and Format section unchanged', () => {
    const c = { id: 'UCxxxxxxxxxxxxxxxxxxxxxx', title: 'Lex Fridman', url: 'https://www.youtube.com/@lexfridman', added: '2026-10-24' }
    const md = followInMarkdown(subscriptionsMD, c)
    expect(parseSubscriptions(md).channels.map((x) => x.title)).toEqual(['a16z', 'AI Engineer', 'All-In Podcast', 'Big Technology', 'Dwarkesh Patel', 'Lex Fridman', 'Peter H. Diamandis', 'Sequoia Capital', 'Y Combinator'])
    expect(formatAt(md)).toBe(formatAt(subscriptionsMD))
    expect(md.slice(0, md.indexOf('- [a16z]'))).toBe(subscriptionsMD.slice(0, subscriptionsMD.indexOf('- [a16z]')))
    expect(md.split('\n').length).toBe(subscriptionsMD.split('\n').length + 1)
    expect(md).toContain('- [Dwarkesh Patel](https://www.youtube.com/@DwarkeshPatel) · UCXl4i9dYBrFOabk0xGmbkRA · added 2026-10-23\n- [Lex Fridman](https://www.youtube.com/@lexfridman) · UCxxxxxxxxxxxxxxxxxxxxxx · added 2026-10-24\n- [Peter H. Diamandis]')
    // last by title: right after the last channel line, still above "## Format"
    const z = followInMarkdown(subscriptionsMD, { ...c, title: 'zzz' })
    expect(z).toContain('- [Y Combinator](https://www.youtube.com/@ycombinator) · UCcefcZRL2oaA_uBNeo5UOWg · added 2026-10-23\n- [zzz]')
    expect(formatAt(z)).toBe(formatAt(subscriptionsMD))
    // already followed: the same text (no write)
    expect(followInMarkdown(subscriptionsMD, { ...c, id: ALLIN })).toBe(subscriptionsMD)
  })

  it('unfollow deletes only that line', () => {
    const md = unfollowInMarkdown(subscriptionsMD, ALLIN)
    expect(md).toBe(subscriptionsMD.replace('- [All-In Podcast](https://www.youtube.com/@allin) · UCESLZhusAkFfsNsApnjF_Cg · added 2026-10-23\n', ''))
    expect(unfollowInMarkdown(subscriptionsMD, 'UCxxxxxxxxxxxxxxxxxxxxxx')).toBe(subscriptionsMD)
  })

  it('the first channel goes before the Format heading; a new file starts from the template', () => {
    const md = head + '## Format\n\n```\n- [X](https://www.youtube.com/@x) · UCxxxxxxxxxxxxxxxxxxxxxx · added 2026-01-01\n```\n'
    const c = { id: PD, title: 'Peter H. Diamandis', url: 'https://www.youtube.com/@peterdiamandis', added: '2026-10-24' }
    expect(followInMarkdown(md, c)).toBe(head + subscriptionLine(c) + '\n\n## Format\n\n```\n- [X](https://www.youtube.com/@x) · UCxxxxxxxxxxxxxxxxxxxxxx · added 2026-01-01\n```\n')
    expect(followInMarkdown('', c)).toBe(SUBSCRIPTIONS_TEMPLATE + '\n' + subscriptionLine(c) + '\n')
    expect(parseSubscriptions(followInMarkdown('', c)).channels).toEqual([c])
  })

  it('reads full, bare and invalid lines', () => {
    const md = [
      '# Subs', '',
      '- [All-In Podcast](https://www.youtube.com/@allin) · UCESLZhusAkFfsNsApnjF_Cg · added 2026-10-23',
      '- [No date](https://www.youtube.com/channel/UCvxm0qTrGN_1LMYgUaftWyQ) · UCvxm0qTrGN_1LMYgUaftWyQ',
      '- [All-In again](https://www.youtube.com/@allin) · UCESLZhusAkFfsNsApnjF_Cg · added 2026-10-24',
      '- https://www.youtube.com/@lexfridman',
      '- <https://youtu.be/6czo-C3FU7I>',
      '- [Some channel](https://www.youtube.com/@some)',
      '- @dwarkeshpatel',
      '- a note that mentions https://www.youtube.com/@allin in passing',
      '- [Bad id](https://www.youtube.com/@x) · UC123 · added 2026-10-23',
      '- just text', '* https://www.youtube.com/@starbullet', '-https://www.youtube.com/@nospace',
      '<!-- - https://www.youtube.com/@commented -->',
      '<!--', '- https://www.youtube.com/@commented2', '-->',
      '~~~', '- https://www.youtube.com/@fenced', '~~~',
    ].join('\n')
    const { channels, bare } = parseSubscriptions(md)
    expect(channels).toEqual([
      { id: ALLIN, title: 'All-In Podcast', url: 'https://www.youtube.com/@allin', added: '2026-10-23' },
      { id: PD, title: 'No date', url: 'https://www.youtube.com/channel/UCvxm0qTrGN_1LMYgUaftWyQ', added: '' },
    ])
    expect(bare.map((b) => [b.line, b.input])).toEqual([
      [5, 'https://www.youtube.com/@lexfridman'], [6, 'https://youtu.be/6czo-C3FU7I'], [7, 'https://www.youtube.com/@some'], [8, '@dwarkeshpatel'],
    ])
    expect(liveLines(md.split('\n')).filter((x) => !x).length).toBe(7)
  })

  it('rewrites only the bare line, and only while it still reads the same', () => {
    const md = head + '- [All-In Podcast](https://www.youtube.com/@allin) · UCESLZhusAkFfsNsApnjF_Cg · added 2026-10-23\n- https://www.youtube.com/@peterdiamandis\n\n## Format\n'
    const b = parseSubscriptions(md).bare[0]
    const c = { id: PD, title: 'Peter H. Diamandis', url: 'https://www.youtube.com/@peterdiamandis', added: '2026-10-24' }
    expect(resolveBareLine(md, b, c)).toBe(md.replace('- https://www.youtube.com/@peterdiamandis', subscriptionLine(c)))
    expect(resolveBareLine(md.replace('@peterdiamandis', '@other'), b, c)).toBe(md.replace('@peterdiamandis', '@other'))
    // already listed: the bare line goes away
    expect(resolveBareLine(md, b, { ...c, id: ALLIN })).toBe(md.replace('- https://www.youtube.com/@peterdiamandis\n', ''))
  })

  it('writes titles safely and links channels without a handle to /channel/UC…', () => {
    const c = { id: PD, title: 'A [weird] title', url: channelURL(PD), added: '2026-10-24' }
    expect(subscriptionLine(c)).toBe('- [A \\[weird\\] title](https://www.youtube.com/channel/UCvxm0qTrGN_1LMYgUaftWyQ) · UCvxm0qTrGN_1LMYgUaftWyQ · added 2026-10-24')
    expect(parseSubscriptions(subscriptionLine(c)).channels).toEqual([c])
    expect(channelURL(PD, '@x')).toBe('https://www.youtube.com/@x')
    expect(dayOf(new Date('2026-10-23T22:00:00Z'))).toBe('2026-10-23')
    expect(handleIn('https://www.youtube.com/@allin')).toBe('@allin')
    expect(handleIn('https://www.youtube.com/channel/UCx')).toBeUndefined()
  })
})

describe('feed-hidden.json', () => {
  it('round-trips, skips bad ids, no-op when already hidden', () => {
    const h = hideVideo([], 'LeSIe50WfLI')
    expect(hideVideo(h, 'LeSIe50WfLI')).toBe(h)
    expect(hideVideo(h, 'not an id')).toBe(h)
    expect(encodeHidden(h)).toBe('{\n  "hidden": [\n    "LeSIe50WfLI"\n  ]\n}\n')
    expect(parseHidden(encodeHidden(h))).toEqual(h)
    expect(parseHidden(JSON.stringify({ hidden: ['LeSIe50WfLI', 7, 'x', 'LeSIe50WfLI'] }))).toEqual(['LeSIe50WfLI'])
    expect(parseHidden('oops')).toEqual([])
  })

  it('keeps at most MAX_HIDDEN hidden ids, dropping the oldest', () => {
    let h: string[] = []
    for (let i = 0; i < MAX_HIDDEN + 5; i++) h = hideVideo(h, String(i).padStart(11, '0'))
    expect(h.length).toBe(MAX_HIDDEN)
    expect(h[0]).toBe('00000000005')
  })
})

describe('yt-dlp listing of the Videos tab', () => {
  const now = Date.parse('2026-10-24T05:00:00Z')
  it('builds the one-call listing command', () => {
    expect(videosTabArgs(ALLIN)).toEqual(['--flat-playlist', '--playlist-items', '1:15', '--extractor-args', 'youtubetab:approximate_date',
      '--no-warnings', '--print', '%(id)s\t%(title)s\t%(duration)s\t%(upload_date)s\t%(timestamp)s\t%(live_status)s', 'https://www.youtube.com/channel/UCESLZhusAkFfsNsApnjF_Cg/videos'])
  })

  it('reads real output: ids, titles, durations, day times in page order', () => {
    const vs = parseVideosListing('WARNING: something\n' + allInListing, ALLIN, 'All-In Podcast', now)
    expect(vs.map((v) => v.id)).toEqual(['6czo-C3FU7I', 'yzk44lz-RGI', '2Zj6uMv3kTA', 'ZJKs08oU1zg', 'uzV45QvPKtU'])
    expect(vs[0]).toMatchObject({ title: 'AI Cyber Panic, Ken Griffin’s Bubble Warning, The Fall of France?', duration: '1:43:23', longForm: true, approx: true, channelTitle: 'All-In Podcast' })
    expect(vs[1].duration).toBe('40:00')
    expect(vs[1].published).toBe(new Date(1792627200 * 1000 - 1000).toISOString())
    // same day: page order kept
    expect(Date.parse(vs[3].published)).toBeGreaterThan(Date.parse(vs[4].published))
    expect(visibleVideos({ [ALLIN]: vs }, { followed: [ALLIN], hidden: [], shorts: {}, now }).map((v) => v.id)).toEqual(vs.map((v) => v.id))
  })

  it('leaves out upcoming and live videos; falls back to upload_date; skips junk', () => {
    const out = [
      'aaaaaaaaaaa\tPremiere\tNA\tNA\tNA\tis_upcoming',
      'bbbbbbbbbbb\tLive now\tNA\t20261024\tNA\tis_live',
      'ccccccccccc\tNo timestamp\t61\t20261020\tNA\tNA',
      'not a line', 'ddddddddddd\tNo date\t61\tNA\tNA\tNA',
    ].join('\n')
    const vs = parseVideosListing(out, ALLIN, 'All-In Podcast', now)
    expect(vs.map((v) => [v.id, v.published, v.duration])).toEqual([['ccccccccccc', '2026-10-20T12:00:00.000Z', '1:01']])
    expect(formatDuration(59)).toBe('0:59')
    expect(formatDuration(3600)).toBe('1:00:00')
  })
})

describe('"+ Follow channel" input', () => {
  it('understands handles, channel links, and video links', () => {
    expect(parseChannelInput('@PeterDiamandis')).toEqual({ kind: 'page', url: 'https://www.youtube.com/@PeterDiamandis' })
    expect(parseChannelInput('https://www.youtube.com/@allin/videos')).toEqual({ kind: 'page', url: 'https://www.youtube.com/@allin' })
    expect(parseChannelInput('youtube.com/@allin')).toEqual({ kind: 'page', url: 'https://www.youtube.com/@allin' })
    expect(parseChannelInput(`https://www.youtube.com/channel/${PD}`)).toEqual({ kind: 'id', id: PD })
    expect(parseChannelInput(PD)).toEqual({ kind: 'id', id: PD })
    expect(parseChannelInput('https://www.youtube.com/c/SomeName')).toEqual({ kind: 'page', url: 'https://www.youtube.com/c/SomeName' })
    expect(parseChannelInput('https://www.youtube.com/user/SomeName')).toEqual({ kind: 'page', url: 'https://www.youtube.com/user/SomeName' })
    expect(parseChannelInput('https://www.youtube.com/watch?v=6czo-C3FU7I&t=10s')).toEqual({ kind: 'video', id: '6czo-C3FU7I' })
    expect(parseChannelInput('https://youtu.be/6czo-C3FU7I?si=x')).toEqual({ kind: 'video', id: '6czo-C3FU7I' })
    expect(parseChannelInput('https://m.youtube.com/shorts/k7epZLD77rw')).toEqual({ kind: 'video', id: 'k7epZLD77rw' })
    expect(parseChannelInput(`https://www.youtube.com/feeds/videos.xml?channel_id=${PD}`)).toEqual({ kind: 'id', id: PD })
  })

  it('rejects other things', () => {
    expect(parseChannelInput('')).toBeNull()
    expect(parseChannelInput('hello world')).toBeNull()
    expect(parseChannelInput('https://vimeo.com/123')).toBeNull()
    expect(parseChannelInput('https://www.youtube.com/watch?v=short')).toBeNull()
  })

  it('reads the channel id and title from a channel page', () => {
    const html = '<html><link rel="canonical" href="https://www.youtube.com/channel/UCvxm0qTrGN_1LMYgUaftWyQ"><meta property="og:title" content="Peter H. Diamandis">'
    expect(parseChannelPage(html)).toEqual({ id: PD, title: 'Peter H. Diamandis' })
    expect(parseChannelPage('<link rel="alternate" type="application/rss+xml" title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=UCESLZhusAkFfsNsApnjF_Cg"><meta property="og:title" content="All-In &amp; Friends">'))
      .toEqual({ id: ALLIN, title: 'All-In & Friends' })
    expect(parseChannelPage('<html>nothing</html>')).toBeNull()
  })

  it('reads the channel from a watch page', () => {
    const html = '..."videoDetails":{"videoId":"6czo-C3FU7I","title":"AI Cyber Panic","lengthSeconds":"6000","channelId":"UCESLZhusAkFfsNsApnjF_Cg","isOwnerViewing":false},..."ownerChannelName":"All-In Podcast \\u0026 Co"'
    expect(parseWatchPageChannel(html)).toEqual({ id: ALLIN, title: 'All-In Podcast & Co' })
  })
})
