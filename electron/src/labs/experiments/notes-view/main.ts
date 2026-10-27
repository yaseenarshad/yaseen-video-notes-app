import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { atomicWrite } from '../../../core/atomic'
import { loadWords } from '../../analysis/analyze'
import { ClaudeError, findClaude, runClaude } from '../../analysis/claude'
import type { Words } from '../../analysis/words'
import { defineMainHooks, type LabsVideoContext } from '../../hooks'
import { cacheDir, writeCache } from '../../store'
import { buildNotesPrompt, InvalidNotes, NOTES_SYSTEM, retryNotesPrompt, validateNotes, type NotesValidation } from './aiNotes'
import { aiOf, emptyDoc, ensureSections, setAiNotes, setYasin, slideSignature, specsSignature, yasinOf, type AiBullet, type NotesDoc } from './notesFile'
import { computeSections, timeBullets, type ViewSection } from './sections'
import { changeNotes, IMAGES_DIR, insideNotesDir, notesPath, paraTimeOf, readFormat, readNotes, readSlides, sectionSpecs } from './store'
import VIEW from './view/index.ts?iife'

/**
 * notes-view routes for the player page (`/labs/x/notes-view/<path>`):
 * - GET  view.js / view.css         the Notes view bundle (Milkdown Crepe + the vendored docs-app add-ons), loaded
 *                                    by player.js only when Notes is first shown
 * - GET  data                       sections + AI bullets (with times) + slides + the Yasin notes + the AI job
 * - POST yasin?t=<section>          body = the editor's markdown → the section's `Yasin:` subtree (locked write)
 * - POST image {path, data}         a pasted / dropped image → `notes-images/<name>` next to the notes file (409 = taken)
 * - GET  file/<rel>                 an image beside the notes file (notes-images/…, slides/…)
 * - POST generate?t=<s>[&force=1] | ?all=1   AI notes (`claude -p`, one section at a time); GET generate/status
 * Everything is written in Labs' userData (`labs-cache/<id>/`), never the vault.
 */

interface Job { state: 'idle' | 'running' | 'done' | 'failed'; current: number | null; done: number; total: number; error: string | null; loginNeeded: boolean; lines: string[]; queue: number[] }
const jobs = new Map<string, Job>()
const idle = (): Job => ({ state: 'idle', current: null, done: 0, total: 0, error: null, loginNeeded: false, lines: [], queue: [] })
const publicJob = (j: Job) => { const { queue: _q, ...rest } = j; return rest }

const place = (ctx: LabsVideoContext) => ({ userData: ctx.userData, videoId: ctx.videoId, markdown: ctx.markdown, folder: ctx.folder })

interface DNode { text: string; p: number; t: number; children: DNode[] }
type DItem = { kind: 'ai'; node: DNode } | { kind: 'slide'; n: number; alt: string; src: string; t: number | null } | { kind: 'other'; lines: string[] }

function timedTree(bullets: AiBullet[], w: Words): DNode[] {
  const flat = timeBullets(bullets, w)
  let k = 0
  const conv = (b: AiBullet): DNode => {
    const t = Math.round((flat[k++]?.t ?? 0) * 100) / 100
    return { text: b.text, p: b.p, t, children: b.children.map(conv) }
  }
  return bullets.map(conv)
}

const fileUrl = (rel: string): string => 'file/' + rel.split('/').map(encodeURIComponent).join('/')
const countAi = (bs: AiBullet[]): number => bs.reduce((n, b) => n + 1 + countAi(b.children), 0)

function viewData(ctx: LabsVideoContext) {
  const w = loadWords(ctx.sidecar)
  const file = notesPath(place(ctx))
  const slides = readSlides(cacheDir(ctx.userData, ctx.videoId))
  let doc: NotesDoc | null = readNotes(file)
  const exists = doc !== null
  // slides.json is new or changed → refresh the slide bullets in the file (Yasin notes untouched)
  if (slides.length && (!doc || slideSignature(doc) !== specsSignature(slides))) doc = changeNotes(file, w, () => {}, slides)
  doc = doc ?? emptyDoc(`Notes — ${w.title}`)
  ensureSections(doc, sectionSpecs(w, computeSections(w)))
  const dur = Math.ceil(w.duration || 0)
  const sections = doc.sections.map((s, i) => {
    const ai = aiOf(s)
    const nodes = timedTree(ai, w)
    let k = 0
    const items = s.items.flatMap((it): DItem[] => {
      if (it.kind === 'ai') return [{ kind: 'ai' as const, node: nodes[k++] }]
      if (it.kind === 'slide') return [{ kind: 'slide' as const, n: it.n, alt: it.alt, src: `/labs/x/notes-view/${fileUrl(it.src)}`, t: it.t }]
      if (it.kind === 'other') return [{ kind: 'other' as const, lines: it.lines }]
      return []
    })
    return { t: s.t, end: doc!.sections[i + 1]?.t ?? Math.max(dur, s.t + 1), title: s.title, aiCount: countAi(ai), items, yasin: yasinOf(s) }
  })
  return { file, exists: exists || existsSync(file), sections, claude: !!findClaude(), job: publicJob(jobs.get(ctx.videoId) ?? idle()), slides: slides.length }
}

// ---------- AI notes: one section at a time, queued per video ----------

const isLogin = (m: string): boolean => /log ?in|logged out|auth|oauth|credential/i.test(m)

async function notesFor(ctx: LabsVideoContext, w: Words, sec: ViewSection, log: (l: string) => void): Promise<NotesValidation> {
  const prompt = buildNotesPrompt(readFormat(), w, sec)   // notes-format.md read fresh every run
  writeCache(ctx.userData, ctx.videoId, `notes-prompt-${sec.t}.txt`, prompt)
  const ask = async (p: string, tag: string) => {
    const r = await runClaude(p, { system: NOTES_SYSTEM, log })
    writeCache(ctx.userData, ctx.videoId, `notes-response-${sec.t}${tag}.txt`, r.text)
    return r.text
  }
  let v: NotesValidation | null = null
  let problems: string[] = []
  try { v = validateNotes(await ask(prompt, ''), sec); problems = v.violations } catch (e) { if (!(e instanceof InvalidNotes)) throw e; problems = [e.message] }
  if (problems.length) {
    log(`section ${sec.t}: asking again (${problems.slice(0, 3).join('; ')})`)
    try { v = validateNotes(await ask(retryNotesPrompt(prompt, problems), '-retry'), sec) } catch (e) { if (!(e instanceof InvalidNotes) || !v) throw e }
  }
  if (!v) throw new Error('no usable notes')
  log(`section ${sec.t}: ${v.count} bullets, ${v.violations.length} sanitized, ${v.repairs.length} repairs, uncovered ${v.uncovered.join(',') || 'none'}`)
  return v
}

function startJob(ctx: LabsVideoContext, targets: number[]): Job {
  let j = jobs.get(ctx.videoId)
  if (j?.state === 'running') {
    for (const t of targets) if (!j.queue.includes(t) && j.current !== t) { j.queue.push(t); j.total++ }
    return j
  }
  j = { ...idle(), state: 'running', queue: [...targets], total: targets.length }
  jobs.set(ctx.videoId, j)
  const job = j
  const log = (l: string) => { job.lines = [...job.lines, l].slice(-30); ctx.log(`notes-view ${ctx.videoId}: ${l}`) }
  void (async () => {
    const w = loadWords(ctx.sidecar)
    const sections = computeSections(w)
    const file = notesPath(place(ctx))
    try {
      while (job.queue.length) {
        const t = job.queue.shift()!
        const sec = sections.find((s) => s.t === t)
        if (!sec) { job.done++; continue }
        job.current = t
        const v = await notesFor(ctx, w, sec, log)
        changeNotes(file, w, (doc) => setAiNotes(doc, sec.t, v.bullets, paraTimeOf(w)), readSlides(cacheDir(ctx.userData, ctx.videoId)))
        job.done++
      }
      job.state = 'done'
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      job.state = 'failed'
      job.error = m
      job.loginNeeded = e instanceof ClaudeError && isLogin(m)
      log(`failed: ${m}`)
    } finally {
      job.current = null
      job.queue = []
    }
  })()
  return job
}

// ---------- images ----------

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
}
const MAX_IMAGE = 30 * 1024 * 1024

export default defineMainHooks({
  route: async (req, ctx) => {
    const path = req.path
    if (path === 'view.js') return { status: 200, type: 'text/javascript; charset=utf-8', body: VIEW.js }
    if (path === 'view.css') return { status: 200, type: 'text/css; charset=utf-8', body: VIEW.css }
    if (path === 'data') return viewData(ctx)
    if (path === 'generate/status') return publicJob(jobs.get(ctx.videoId) ?? idle())
    if (path === 'generate' && req.method === 'POST') {
      if (!findClaude()) return { status: 503, type: 'application/json', body: JSON.stringify({ error: 'the claude command was not found' }) }
      const w = loadWords(ctx.sidecar)
      const sections = computeSections(w)
      let targets: number[]
      if (req.query.get('all') === '1') {
        const doc = readNotes(notesPath(place(ctx)))
        const has = new Set((doc?.sections ?? []).filter((s) => aiOf(s).length).map((s) => s.t))
        targets = sections.filter((s) => req.query.get('force') === '1' || !has.has(s.t)).map((s) => s.t)
      } else {
        const t = Number(req.query.get('t'))
        if (!sections.some((s) => s.t === t)) return { status: 400, type: 'application/json', body: JSON.stringify({ error: `no section at ${t}` }) }
        targets = [t]
      }
      return publicJob(startJob(ctx, targets))
    }
    if (path === 'yasin' && req.method === 'POST') {
      const t = Number(req.query.get('t'))
      const w = loadWords(ctx.sidecar)
      const file = notesPath(place(ctx))
      const doc = changeNotes(file, w, (d) => setYasin(d, t, req.body), readSlides(cacheDir(ctx.userData, ctx.videoId)))
      const s = doc.sections.find((x) => x.t === Math.floor(t))
      return { ok: true, md: s ? yasinOf(s) : '' }
    }
    if (path === 'image' && req.method === 'POST') {
      let o: { path?: unknown; data?: unknown }
      try { o = JSON.parse(req.body) } catch { return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'bad body' }) } }
      const rel = String(o.path ?? '')
      if (!new RegExp(`^${IMAGES_DIR}/[A-Za-z0-9._-]{1,120}$`).test(rel) || !IMAGE_TYPES[extname(rel).toLowerCase()]) return { status: 400, type: 'application/json', body: JSON.stringify({ error: `not an image path: ${rel}` }) }
      const abs = insideNotesDir(notesPath(place(ctx)), rel)
      if (!abs) return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'outside the notes folder' }) }
      if (existsSync(abs)) return { status: 409, type: 'application/json', body: JSON.stringify({ error: 'exists' }) }
      const bytes = Buffer.from(String(o.data ?? ''), 'base64')
      if (!bytes.length || bytes.length > MAX_IMAGE) return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'empty or too large (30 MB max)' }) }
      mkdirSync(dirname(abs), { recursive: true })
      if (!atomicWrite(abs, bytes)) return { status: 403, type: 'application/json', body: JSON.stringify({ error: 'read-only' }) }
      ctx.log(`notes-view: image ${rel} (${bytes.length} bytes)`)
      return { ok: true, path: rel }
    }
    if (path.startsWith('file/')) {
      const rel = path.slice(5).split('/').map((s) => { try { return decodeURIComponent(s) } catch { return s } }).join('/')
      const type = IMAGE_TYPES[extname(rel).toLowerCase()]
      const abs = type ? insideNotesDir(notesPath(place(ctx)), rel) : null
      if (!abs || !existsSync(abs)) return { status: 404, type: 'text/plain', body: 'not found' }
      return { status: 200, type, body: readFileSync(abs) }
    }
    return undefined
  },
})
