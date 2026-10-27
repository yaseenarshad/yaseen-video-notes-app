// Labs experiment "slides": `video-notes-labs slides <folder>` (dispatched from src/cli/run.ts).
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { labsUserDataDefault } from '../../../core/flavor'
import { decodeSidecar, SIDECAR_FILE } from '../../../core/transcript'
import { sidecarFor } from '../../cli'
import { cacheDir } from '../../store'
import { extractSlides } from './extract'

export const SLIDES_USAGE = `  video-notes-labs slides <video folder | .md | .follow-along.json> [options]
        Finds the slides of a talk (plain code, no AI): downloads the 720p video-only stream into Labs' cache,
        looks at every second, keeps one image per slide (builds grouped, camera shots left out), deletes the video,
        then reads each slide's text with macOS Vision. Writes only into Labs' userData:
        labs-cache/<videoId>/slides.json + labs-cache/<videoId>/slides/slide-NNN.jpg. Cached unless --force.
        --force               run again
        --no-ocr              skip the slide text
        --user-data-dir <dir> Labs' userData (default ~/Library/Application Support/Yaseen Video Notes Labs)
        --json                print slides.json instead of the summary`

const expand = (p: string): string => resolve(p.startsWith('~/') ? homedir() + p.slice(1) : p)
const clock = (s: number): string => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}` }

/** `slides …`: exit 0 ok · 1 failed · 2 bad usage. */
export async function slidesCLI(args: string[], out: (s: string) => void, err: (s: string) => void): Promise<number> {
  const withValue = ['--user-data-dir']
  const positional = args.filter((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]))
  if (positional.length !== 1 || args.includes('--help')) { err(SLIDES_USAGE); return 2 }
  const sidecar = sidecarFor(positional[0])
  if (!existsSync(sidecar)) { err(`error: no ${SIDECAR_FILE} for ${positional[0]} (open the video once in the app to set it up)`); return 2 }
  const i = args.indexOf('--user-data-dir')
  const userData = expand(i >= 0 && args[i + 1] ? args[i + 1] : process.env.VIDEO_NOTES_USER_DATA ?? labsUserDataDefault())
  try {
    const s = decodeSidecar(readFileSync(sidecar, 'utf8'))
    let lastPhase = ''
    const r = await extractSlides({
      userData, videoId: s.id, title: s.title, duration: s.duration, force: args.includes('--force'), ocr: !args.includes('--no-ocr'),
      log: (l) => err(`  ${l}`),
      progress: (p) => { if (p.phase !== lastPhase || p.phase === 'grab') { lastPhase = p.phase; if (p.phase !== 'grab' || p.pct >= 100) err(`  ${p.line}`) } },
    })
    const x = r.result
    if (args.includes('--json')) { out(JSON.stringify(x, null, 1)); return 0 }
    out(`video:   ${x.title} (${x.videoId})`)
    out(`file:    ${join(cacheDir(userData, x.videoId), 'slides.json')}`)
    out(`took:    ${r.reused ? 'cached' : `${(r.ms / 1000).toFixed(1)} s (download ${(x.timings.download / 1000).toFixed(1)} s · look ${(x.timings.sample / 1000).toFixed(1)} s · grab ${(x.timings.grab / 1000).toFixed(1)} s · OCR ${(x.timings.ocr / 1000).toFixed(1)} s)`}`)
    out(`video:   format ${x.video.format}, ${(x.video.bytes / 1e6).toFixed(1)} MB, ${x.video.deleted ? 'deleted' : 'NOT deleted'}`)
    if (x.noSlides) { out(`slides:  none — ${x.reason}`); return 0 }
    out(`slides:  ${x.slides.length} (${x.stats.builds} build steps grouped, ${x.stats.repeats} repeats; ${x.stats.slideFrames} of ${x.stats.frames} s show a slide)`)
    out(`OCR:     ${x.ocr.state}${x.ocr.error ? ` — ${x.ocr.error}` : ''}`)
    for (const sl of x.slides) {
      const first = (sl.text ?? '').split('\n')[0] ?? ''
      out(`  ${String(sl.n).padStart(3)} ${clock(sl.t0)}–${clock(sl.t1)}${sl.steps.length > 1 ? ` (${sl.steps.length} builds)` : ''}${sl.repeatOf ? ` (= slide ${sl.repeatOf})` : ''}  ${first.slice(0, 70)}`)
    }
    return 0
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
