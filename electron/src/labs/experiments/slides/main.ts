// Labs experiment "slides": main-process routes for the player page (`/labs/x/slides/<path>`).
//   GET  slides.json           → the extracted slides (404 { error } when not extracted yet)
//   POST extract[?force=1]     → starts the extraction (one at a time in the app); returns the job
//   GET  status                → the job: { state: idle|running|done|failed, phase, pct, line, error, ms }
//   GET  img/slide-NNN.jpg     → a slide image from Labs' cache
// Everything is read from / written to Labs' userData (labs-cache/<id>/); never the vault.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeSidecar } from '../../../core/transcript'
import { defineMainHooks, type LabsVideoContext } from '../../hooks'
import { cacheDir } from '../../store'
import { extractSlides, readSlides, SLIDES_DIR, type Progress } from './extract'

interface Job { state: 'idle' | 'running' | 'done' | 'failed'; phase: Progress['phase'] | ''; pct: number; line: string; error?: string; startedAt?: string; finishedAt?: string; ms?: number }
const jobs = new Map<string, Job>()
let queue: Promise<unknown> = Promise.resolve()

function start(ctx: LabsVideoContext, force: boolean): Job {
  const cur = jobs.get(ctx.videoId)
  if (cur?.state === 'running') return cur
  const j: Job = { state: 'running', phase: '', pct: 0, line: 'Waiting for another extraction…', startedAt: new Date().toISOString() }
  jobs.set(ctx.videoId, j)
  const t0 = Date.now()
  queue = queue.then(async () => {
    try {
      let duration: number | undefined
      try { duration = decodeSidecar(readFileSync(ctx.sidecar, 'utf8')).duration || undefined } catch { /* the frame count then */ }
      const r = await extractSlides({
        userData: ctx.userData, videoId: ctx.videoId, title: ctx.title, duration, force,
        log: (l) => ctx.log(`slides ${ctx.videoId}: ${l}`),
        progress: (p) => { j.phase = p.phase; j.pct = Math.round(p.pct); j.line = p.line },
      })
      j.state = 'done'
      j.line = r.reused ? 'cached' : r.result.noSlides ? 'No slides found' : `${r.result.slides.length} slides`
      ctx.log(`slides ${ctx.videoId}: ${j.line} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    } catch (e) {
      j.state = 'failed'
      j.error = e instanceof Error ? e.message.split('\n')[0] : String(e)
      ctx.log(`slides ${ctx.videoId}: failed: ${j.error}`)
    } finally {
      j.finishedAt = new Date().toISOString()
      j.ms = Date.now() - t0
    }
  })
  return j
}

export default defineMainHooks({
  route: (req, ctx) => {
    if (req.path === 'slides.json') {
      const s = readSlides(ctx.userData, ctx.videoId)
      return s ?? { status: 404, type: 'application/json', body: JSON.stringify({ error: 'not extracted' }) }
    }
    if (req.path === 'extract' && req.method === 'POST') return start(ctx, req.query.get('force') === '1')
    if (req.path === 'status') return jobs.get(ctx.videoId) ?? { state: 'idle', phase: '', pct: 0, line: '' }
    const img = /^img\/(slide-\d{3}\.jpg)$/.exec(req.path)
    if (img) {
      const f = join(cacheDir(ctx.userData, ctx.videoId), SLIDES_DIR, img[1])
      return existsSync(f) ? { status: 200, type: 'image/jpeg', body: readFileSync(f) } : undefined
    }
    return undefined
  },
})
