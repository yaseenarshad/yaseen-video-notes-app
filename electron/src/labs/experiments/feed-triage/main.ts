// Labs experiment "feed-triage": main-process side. On an explicit click per Feed video ("Preview pull quotes"):
//   1. the captions — the app's own caption fetch (yt-dlp, one track, under the yt-dlp lock) — into Labs' own cache:
//      labs-cache/<id>/feed-preview.follow-along.json (a Library video already in a folder is read from there instead);
//   2. at once: the chapter titles + each chapter's first sentence, verbatim (no AI);
//   3. then the Labs analysis (the Labs AI engine — Codex by default — same cache as 🧪 Analyze); when it works,
//      the pull quotes (verbatim, AI-picked). When the engine is unavailable the preview stays on step 2 and says why.
// Never automatic, never the vault. One preview runs at a time.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchCaptions, findYTDLP, format, pickVTT, YTDLP_MISSING } from '../../../core/folderMaker'
import { encodeSidecar, parseInfoJSON, SIDECAR_FILE } from '../../../core/transcript'
import { whileDownloading } from '../../../core/ytdlpUpdate'
import { analyze } from '../../analysis/analyze'
import { engineLabel } from '../../ai/engine'
import { defineMainHooks, type LabsMainContext } from '../../hooks'
import { cacheDir, writeCache } from '../../store'
import { digestOfSidecar, type Digest } from '../triage-cards/digest'

export const PREVIEW_FILE = 'feed-preview.follow-along.json'

interface Job {
  state: 'idle' | 'captions' | 'analyzing' | 'done' | 'failed'
  line: string
  error?: string
  /** Why there are no AI pull quotes (claude unavailable / failed). */
  aiError?: string
  digest?: Digest | null
}

const jobs = new Map<string, Job>()
let queue: Promise<unknown> = Promise.resolve()
/** claude -p failed recently: don't try again for 10 min (each try costs a few seconds). */
let claudeDown: { at: number; error: string } | null = null

const okId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(id)

/** The preview's sidecar: the Library folder's when the video is in the Library, else Labs' cached copy. */
function sidecarFor(ctx: LabsMainContext, id: string, folder: unknown): string {
  if (typeof folder === 'string' && folder && existsSync(join(folder, SIDECAR_FILE))) return join(folder, SIDECAR_FILE)
  return join(cacheDir(ctx.userData, id), PREVIEW_FILE)
}

async function fetchPreview(ctx: LabsMainContext, id: string, set: (line: string) => void): Promise<string> {
  const bin = findYTDLP()
  if (!bin) throw new Error(YTDLP_MISSING)
  const tmp = join(tmpdir(), `vn-labs-feed-${randomUUID()}`)
  mkdirSync(tmp, { recursive: true })
  try {
    await whileDownloading(() => fetchCaptions(`https://www.youtube.com/watch?v=${id}`, tmp, bin, (l) => set(l)))
    const info = parseInfoJSON(readFileSync(join(tmp, `${id}.info.json`), 'utf8'))
    const vtt = pickVTT(tmp, id)
    if (!vtt) throw new Error('This video has no English captions.')
    const { sidecar } = format(info, readFileSync(vtt, 'utf8'))
    return writeCache(ctx.userData, id, PREVIEW_FILE, encodeSidecar(sidecar))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function start(ctx: LabsMainContext, id: string, folder: unknown, withAI: boolean): Job {
  const cur = jobs.get(id)
  if (cur && (cur.state === 'captions' || cur.state === 'analyzing')) return cur
  const j: Job = { state: 'captions', line: 'Waiting for another preview…' }
  jobs.set(id, j)
  const set = (line: string) => { j.line = line; ctx.log(`feed-triage ${id}: ${line}`) }
  queue = queue.then(async () => {
    try {
      let sidecar = sidecarFor(ctx, id, folder)
      if (!existsSync(sidecar)) { set('Getting the captions…'); sidecar = await fetchPreview(ctx, id, set) }
      j.digest = digestOfSidecar(ctx.userData, sidecar, id)
      if (!j.digest) throw new Error('Could not read the captions.')
      if (j.digest.analyzed || !withAI) { j.state = 'done'; return }
      if (claudeDown && Date.now() - claudeDown.at < 10 * 60_000) { j.aiError = claudeDown.error; j.state = 'done'; return }
      j.state = 'analyzing'
      set(`Asking ${engineLabel()} for pull quotes (a minute or two)…`)
      try {
        await analyze(sidecar, { userData: ctx.userData, log: set })
        claudeDown = null
        j.digest = digestOfSidecar(ctx.userData, sidecar, id)
      } catch (e) {
        j.aiError = e instanceof Error ? e.message : String(e)
        if (/claude|logged|auth|OAuth|not found/i.test(j.aiError)) claudeDown = { at: Date.now(), error: j.aiError }
        set(`no AI pull quotes: ${j.aiError}`)
      }
      j.state = 'done'
    } catch (e) {
      j.state = 'failed'
      j.error = e instanceof Error ? e.message : String(e)
      set(`failed: ${j.error}`)
    }
  })
  return j
}

const view = (j: Job | undefined) => {
  if (!j) return { state: 'idle', line: '' }
  const d = j.digest
  return {
    state: j.state, line: j.line, error: j.error, aiError: j.aiError,
    digest: d ? { ...d, quotes: d.quotes.slice(0, 6), openings: d.openings.slice(0, 40), labels: d.labels.slice(0, 4) } : null,
  }
}

export default defineMainHooks({
  ipc: {
    /** Starts a preview (explicit click): captions → chapter openings → AI pull quotes when claude works. */
    start: (ctx, id, folder, withAI) => { if (!okId(id)) throw new Error('not a video id'); return view(start(ctx, id, folder, withAI !== false)) },
    status: (_ctx, id) => (okId(id) ? view(jobs.get(id)) : view(undefined)),
  },
})
