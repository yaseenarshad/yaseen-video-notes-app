// Real network checks of the Feed (read-only requests to youtube.com, and yt-dlp listings). Skipped unless
// VIDEO_NOTES_NETWORK_TESTS=1:   VIDEO_NOTES_NETWORK_TESTS=1 npx vitest run src/core/feedFetch.network.test.ts
import { describe, expect, it } from 'vitest'
import { newestFirst, parseVideosTab, videosTabURL, visibleVideos } from './feed'
import { checkShort, fetchChannel, get, resolveChannel, type YTDLPRunner } from './feedFetch'
import { findYTDLP, runYTDLP } from './folderMaker'

const run = process.env.VIDEO_NOTES_NETWORK_TESTS === '1' || process.env.FOLLOW_ALONG_NETWORK_TESTS === '1'
const bin = findYTDLP()
const ytdlp: YTDLPRunner | null = bin ? async (args) => { const lines: string[] = []; await runYTDLP(bin, args, (l) => lines.push(l)); return lines } : null

describe.skipIf(!run)('Feed against YouTube', () => {
  it('resolves @handles and video links to channel ids (no yt-dlp)', async () => {
    expect(await resolveChannel('@PeterDiamandis')).toMatchObject({ id: 'UCvxm0qTrGN_1LMYgUaftWyQ', title: 'Peter H. Diamandis' })
    expect(await resolveChannel('https://www.youtube.com/@allin')).toEqual({ id: 'UCESLZhusAkFfsNsApnjF_Cg', title: 'All-In Podcast', handle: '@allin' })
    expect((await resolveChannel('https://www.youtube.com/watch?v=6czo-C3FU7I')).id).toBe('UCESLZhusAkFfsNsApnjF_Cg')
  }, 60_000)

  for (const id of ['UCvxm0qTrGN_1LMYgUaftWyQ', 'UCESLZhusAkFfsNsApnjF_Cg']) {
    it(`lists ${id} with yt-dlp: no Shorts (checked with /shorts/), newest first`, async () => {
      const r = await fetchChannel(id, { ytdlp })
      console.log(`${id}: ${r.source}, ${r.videos.length} videos`)
      expect(r.source).toBe(ytdlp ? 'ytdlp' : 'page')
      const shown = visibleVideos({ [id]: r.videos }, { followed: [id], hidden: [], shorts: {} })
      console.log(shown.map((v) => `  ${v.published} ${v.duration ?? ''} ${v.id} ${v.title}`).join('\n'))
      expect(shown.length).toBeGreaterThan(5)
      expect([...shown].sort(newestFirst)).toEqual(shown)
      for (const v of shown.slice(0, 6)) expect(await checkShort(v.id)).not.toBe('short')
    }, 120_000)
  }

  it('reads a Videos tab page without yt-dlp: long-form only (spot-checked with /shorts/)', async () => {
    const r = await get(videosTabURL('UCvxm0qTrGN_1LMYgUaftWyQ'))
    expect(r.status).toBe(200)
    const vs = parseVideosTab(r.text, 'UCvxm0qTrGN_1LMYgUaftWyQ', 'Peter H. Diamandis')
    console.log(`Videos tab page: ${vs.length} videos; first: ${vs[0]?.title} (${vs[0]?.duration})`)
    expect(vs.length).toBeGreaterThan(10)
    for (const v of vs.slice(0, 5)) expect(await checkShort(v.id)).toBe('video')
  }, 60_000)
})
