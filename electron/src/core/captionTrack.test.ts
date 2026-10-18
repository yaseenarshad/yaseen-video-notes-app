import { describe, expect, it } from 'vitest'
import { chooseCaptionTrack } from './folderMaker'

const t = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, [{ ext: 'vtt', url: 'x' }]]))

describe('chooseCaptionTrack', () => {
  it('prefers captions made by people', () => {
    expect(chooseCaptionTrack({ subtitles: t(['en']), automatic_captions: t(['en', 'en-orig']) })).toEqual({ lang: 'en', auto: false })
    expect(chooseCaptionTrack({ subtitles: t(['de', 'en-GB']), automatic_captions: t(['en-orig']) })).toEqual({ lang: 'en-GB', auto: false })
    expect(chooseCaptionTrack({ subtitles: t(['en-CA']), automatic_captions: {} })).toEqual({ lang: 'en-CA', auto: false })
  })

  it('takes the original automatic English before the (often translated, rate-limited) automatic en', () => {
    expect(chooseCaptionTrack({ subtitles: {}, automatic_captions: t(['en', 'en-orig', 'fr']) })).toEqual({ lang: 'en-orig', auto: true })
  })

  it('falls back to automatic en, and ignores live chat and non-English tracks', () => {
    expect(chooseCaptionTrack({ subtitles: t(['live_chat', 'fr']), automatic_captions: t(['en', 'fr']) })).toEqual({ lang: 'en', auto: true })
  })

  it('returns null when there is no English track', () => {
    expect(chooseCaptionTrack({ subtitles: t(['fr']), automatic_captions: t(['de-orig']) })).toBeNull()
    expect(chooseCaptionTrack({ subtitles: null, automatic_captions: null })).toBeNull()
  })
})
