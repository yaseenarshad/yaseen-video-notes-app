import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { atomicWrite } from '../../../core/atomic'
import { loadWords } from '../../analysis/analyze'
import { AIError, aiPaused, askAI, autoWriteOn, engineAvailable, engineLabel, explain, onPolicyChange, pauseAI, resumeAI } from '../../ai/engine'
import type { Words } from '../../analysis/words'
import { defineMainHooks, type LabsVideoContext } from '../../hooks'
import { cacheDir, writeCache } from '../../store'
import { buildNotesPrompt, InvalidNotes, NOTES_SYSTEM, retryNotesPrompt, validateNotes, type NotesValidation } from './aiNotes'
import { checkPart } from './checks'
import { normWord } from './noteTarget'
import { flatBullets, wasSpans, bulletsOf, editorPart, partLines, emptyDoc, emptyOriginals, ensureOriginals, ensureSections, findSection, markedOf, originalsFromSection, partSig, partTouched, setAiNotes, setPart, slideSignature, specsSignature, assignOriginals, type Bullet, type NotesDoc, type Originals } from './notesFile'
import { computeSections, timeBullets, type ViewSection } from './sections'
import { changeNotes, ensureInfo, paraAtOf, IMAGES_DIR, insideNotesDir, notesPath, paraTimeOf, promptContext, readInfo, readNotes, readOriginals, readSlides, sectionSpecs, slideTextMap } from './store'
import VIEW from './view/index.ts?iife'

/**
 * notes-view routes for the player page (`/labs/x/notes-view/<path>`):
 * - GET  view.js / view.css         the Notes view bundle (Milkdown Crepe + the vendored docs-app add-ons), loaded
 *                                    by player.js only when Notes is first shown
 * - GET  hints                      transcript hints: the captions' spellings of names the notes corrected (display only)
 * - GET  data                       the parts: each one's editor markdown (bullets with p / t / o markers, slides,
 *                                    Yasin's words), the AI originals, its signature, touched; the AI job
 * - POST part?t=<part>&sig=<sig>    body = the part's editor markdown → the part (locked write). 409 when the part
 *                                    changed since `sig` (the posted markdown is kept in labs-cache/<id>/notes-conflict-*.md)
 * - POST image {path, data}         a pasted / dropped image → `notes-images/<name>` next to the notes file (409 = taken)
 * - GET  file/<rel>                 an image beside the notes file (notes-images/…, slides/…)
 * - POST generate?t=<s> | ?all=1    AI notes (the Labs AI engine — Codex by default — one part at a time; all = the
 *                                    parts with no AI notes Yaseen has not touched); GET generate/status
 * - onVideo                          opening a video in Labs (or adding it): the missing parts, automatically
 * Everything is written in Labs' userData (`labs-cache/<id>/`), never the vault.
 */

/**
 * One AI-notes job per video (`queued` → `running` → done / failed / stopped), parts one after another; at most
 * MAX_VIDEOS videos write at the same time (a small global queue). An automatic job (opening a video with "Write AI
 * notes automatically" on) only fills parts with no AI notes that Yaseen has not touched — checked again right before
 * each part — and stops when the setting goes off or a usage limit pauses the engine. Restarting the app resumes:
 * the next open finds the parts still missing.
 */
interface Job {
  state: 'idle' | 'queued' | 'running' | 'done' | 'failed' | 'stopped'
  current: number | null; done: number; total: number; error: string | null; loginNeeded: boolean; usageLimit: boolean
  auto: boolean; lines: string[]; queue: number[]
  /** Per finished part: its start (t) and how long the model took (ms). */
  times: { t: number; ms: number }[]
}
const jobs = new Map<string, Job>()
const MAX_VIDEOS = 2
const waiting: { id: string; run: () => Promise<void> }[] = []
let active = 0
const idle = (): Job => ({ state: 'idle', current: null, done: 0, total: 0, error: null, loginNeeded: false, usageLimit: false, auto: false, lines: [], queue: [], times: [] })
const publicJob = (j: Job) => {
  const { queue, ...rest } = j
  return { ...rest, engine: engineLabel(), paused: aiPaused()?.reason ?? null, pending: j.state === 'running' || j.state === 'queued' ? [...(j.current !== null ? [j.current] : []), ...queue] : [] }
}
function pump(): void {
  while (active < MAX_VIDEOS && waiting.length) {
    const next = waiting.shift()!
    active++
    void next.run().finally(() => { active--; pump() })
  }
}
// "Write automatically" turned off, or a usage limit: automatic jobs stop (a part being written finishes)
onPolicyChange(() => {
  if (autoWriteOn() && !aiPaused()) return
  for (const [id, j] of jobs) {
    if (!j.auto || (j.state !== 'queued' && j.state !== 'running')) continue
    j.total -= j.queue.length
    j.queue = []
    if (j.state === 'queued') { j.state = 'stopped'; const k = waiting.findIndex((x) => x.id === id); if (k >= 0) waiting.splice(k, 1) }
  }
})

/** The parts with no AI notes that Yaseen has not touched (what "Write missing" and the automatic job write). */
function missingParts(ctx: LabsVideoContext, sections: ViewSection[]): number[] {
  const doc = readNotes(notesPath(place(ctx)))
  const orig = readOriginals(notesPath(place(ctx)))
  const skip = new Set((doc?.sections ?? []).filter((s) => markedOf(s).length || partTouched(s, orig?.parts[String(s.t)])).map((s) => s.t))
  return sections.filter((s) => !skip.has(s.t)).map((s) => s.t)
}

const place = (ctx: LabsVideoContext) => ({ userData: ctx.userData, videoId: ctx.videoId, markdown: ctx.markdown, folder: ctx.folder })

/** Each marked bullet's time (word match of its original text when it has one: Yasin's rewording may not match). */
function bulletTimes(bs: Bullet[], orig: ReturnType<typeof assignOriginals>, w: Words): Map<Bullet, number> {
  const marked: Bullet[] = []
  const walk = (b: Bullet) => { if (b.p !== null) marked.push(b); b.children.forEach(walk) }
  bs.forEach(walk)
  const flat = timeBullets(marked.map((b) => ({ text: orig.get(b)?.text ?? b.text, p: b.p, children: [] })), w)
  return new Map(marked.map((b, i) => [b, Math.round((flat[i]?.t ?? 0) * 100) / 100]))
}

/** The sidecar is missing a part that has AI bullets (files made before it) → it must be written once. */
const needsOriginals = (doc: NotesDoc, orig: Originals | null): boolean =>
  ensureOriginals({ ...doc, sections: doc.sections }, orig ? { version: 1, parts: { ...orig.parts } } : emptyOriginals())

function viewData(ctx: LabsVideoContext) {
  const w = loadWords(ctx.sidecar)
  const file = notesPath(place(ctx))
  const slides = readSlides(cacheDir(ctx.userData, ctx.videoId))
  let doc: NotesDoc | null = readNotes(file)
  let orig = readOriginals(file)
  const exists = doc !== null
  // slides.json is new or changed → refresh the slide bullets; an old file with no sidecar → write the sidecar
  if ((slides.length && (!doc || slideSignature(doc) !== specsSignature(slides))) || (doc && needsOriginals(doc, orig))) {
    doc = changeNotes(file, w, () => {}, slides)
    orig = readOriginals(file)
  }
  doc = doc ?? emptyDoc(`Notes — ${w.title}`)
  const computed = computeSections(w)
  ensureSections(doc, sectionSpecs(w, computed))
  const dur = Math.ceil(w.duration || 0)
  // "nothing lost" checks: sources for spelling fixes, slide texts
  const info = readInfo(ctx.userData, ctx.videoId)
  const sources = [w.title, ...(w.chapters ?? []).map((c) => c.title), info?.description ?? '']
  const slideText = slideTextMap(cacheDir(ctx.userData, ctx.videoId))
  const paras = w.paras.map((words, i) => ({ words, times: w.times[i] ?? [] }))
  // the previous notes (`<slug>.notes.v1.md`), for "Compare with previous notes"
  const v1file = file.replace(/\.notes\.md$/, '.notes.v1.md')
  const v1 = existsSync(v1file) ? readNotes(v1file) : null
  const sections = doc.sections.map((s, i) => {
    const po = orig?.parts[String(s.t)] ?? originalsFromSection(s)
    const times = bulletTimes(bulletsOf(s), assignOriginals(bulletsOf(s), po), w)
    const ed = editorPart(s, po, (b) => times.get(b) ?? null)
    const sec = computed.find((c) => c.t === s.t)
    const checks = sec && markedOf(s).length ? checkPart({ paras, startPara: sec.startPara, endPara: sec.endPara, bullets: bulletsOf(s), slideText, sources }) : null
    const old = v1?.sections.find((x) => x.t === s.t)
    return {
      t: s.t, end: doc!.sections[i + 1]?.t ?? Math.max(dur, s.t + 1), title: s.title,
      md: ed.md, orig: ed.orig, sig: partSig(s), touched: partTouched(s, po),
      aiCount: markedOf(s).length, slideCount: s.items.filter((x) => x.kind === 'slide').length,
      checks, v1: v1 ? (old ? partLines(old, 0).join('\n') : '') : null,
    }
  })
  const eng = engineAvailable()
  return { file, exists: exists || existsSync(file), sections, ai: { ok: eng.ok, label: eng.label, reason: eng.reason }, job: publicJob(jobs.get(ctx.videoId) ?? idle()), slides: slides.length }
}

/**
 * Transcript hints (display only): every place in the transcript where the captions' spelling of a name the notes
 * corrected (`<!-- was: … -->`) occurs → a span + the corrected name. The transcript and its .md never change.
 */
const stem = (x: string): string => normWord(x).replace(/'s$/, '')   // "Lindberg's" is the captions' "Lindberg" too

function wasHints(ctx: LabsVideoContext) {
  const doc = readNotes(notesPath(place(ctx)))
  if (!doc) return { hints: [] }
  const w = loadWords(ctx.sidecar)
  const pairs = new Map<string, { was: string; name: string }>()
  for (const s of doc.sections) for (const b of flatBullets(bulletsOf(s))) for (const x of wasSpans(b.text)) {
    const key = x.was.split(/\s+/).map(stem).filter(Boolean).join(' ')
    if (key && !pairs.has(key)) pairs.set(key, { was: x.was, name: x.name.replace(/[,.;:!?)]+$/, '') })
  }
  const hints: { span: { startPara: number; startWord: number; endPara: number; endWord: number }; name: string; was: string }[] = []
  for (const [key, pr] of pairs) {
    const want = key.split(' ')
    for (let p = 0; p < w.paras.length; p++) {
      const ws = w.paras[p].map(stem)
      for (let i = 0; i + want.length <= ws.length; i++) {
        if (want.every((x, k) => ws[i + k] === x)) hints.push({ span: { startPara: p, startWord: i, endPara: p, endWord: i + want.length - 1 }, ...pr })
      }
    }
  }
  return { hints }
}

// ---------- AI notes: one section at a time, queued per video ----------

async function notesFor(ctx: LabsVideoContext, w: Words, sec: ViewSection, log: (l: string) => void): Promise<NotesValidation & { ms: number }> {
  await ensureInfo(ctx.userData, ctx.videoId, log)   // the YouTube description (spelling source), fetched once
  const pc = promptContext(ctx.userData, ctx.videoId, w, sec)   // notes-format.md + principles.md read fresh every run
  const prompt = buildNotesPrompt(pc, w, sec)
  const vopts = { slides: pc.slides, paraAt: paraAtOf(w) }
  writeCache(ctx.userData, ctx.videoId, `notes-prompt-${sec.t}.txt`, prompt)
  let ms = 0
  const ask = async (p: string, tag: string) => {
    const r = await askAI(p, { system: NOTES_SYSTEM, log })   // the Labs engine (Codex by default); bullet text, no schema
    ms += r.ms
    writeCache(ctx.userData, ctx.videoId, `notes-response-${sec.t}${tag}.txt`, r.text)
    return r.text
  }
  let v: NotesValidation | null = null
  let problems: string[] = []
  try { v = validateNotes(await ask(prompt, ''), sec, vopts); problems = v.violations } catch (e) { if (!(e instanceof InvalidNotes)) throw e; problems = [e.message] }
  if (problems.length) {
    log(`section ${sec.t}: asking again (${problems.slice(0, 3).join('; ')})`)
    try { v = validateNotes(await ask(retryNotesPrompt(prompt, problems), '-retry'), sec, vopts) } catch (e) { if (!(e instanceof InvalidNotes) || !v) throw e }
  }
  if (!v) throw new Error('no usable notes')
  log(`section ${sec.t}: ${v.count} bullets in ${(ms / 1000).toFixed(1)} s, ${v.violations.length} sanitized, ${v.repairs.length} repairs, uncovered ${v.uncovered.join(',') || 'none'}`)
  return { ...v, ms }
}

function startJob(ctx: LabsVideoContext, targets: number[], auto = false): Job {
  let j = jobs.get(ctx.videoId)
  if (j && (j.state === 'running' || j.state === 'queued')) {
    for (const t of targets) if (!j.queue.includes(t) && j.current !== t) { j.queue.push(t); j.total++ }
    if (!auto) j.auto = false   // a run by hand is not stopped by the auto setting
    return j
  }
  j = { ...idle(), state: 'queued', queue: [...targets], total: targets.length, auto }
  jobs.set(ctx.videoId, j)
  const job = j
  const log = (l: string) => { job.lines = [...job.lines, l].slice(-30); ctx.log(`notes-view ${ctx.videoId}: ${l}`) }
  log(`${auto ? 'automatic' : 'requested'}: ${targets.length} part(s) with ${engineLabel()}${active >= MAX_VIDEOS ? ' (waiting for another video)' : ''}`)
  waiting.push({ id: ctx.videoId, run: async () => {
    if (job.state !== 'queued') return
    job.state = 'running'
    const w = loadWords(ctx.sidecar)
    const sections = computeSections(w)
    const file = notesPath(place(ctx))
    const t0 = Date.now()
    try {
      while (job.queue.length) {
        if (job.auto && (!autoWriteOn() || aiPaused())) { log('stopped: automatic writing is off or paused'); job.state = 'stopped'; break }
        const t = job.queue.shift()!
        const sec = sections.find((s) => s.t === t)
        // an automatic job never writes a part that has notes or that Yaseen touched meanwhile
        if (!sec || (job.auto && !missingParts(ctx, [sec]).length)) { job.done++; continue }
        job.current = t
        const v = await notesFor(ctx, w, sec, log)
        changeNotes(file, w, (doc, orig) => {
          // keeps every bullet Yaseen touched; the part's originals = the new AI texts + the kept bullets' originals
          orig.parts[String(sec.t)] = setAiNotes(doc, sec.t, v.bullets, paraTimeOf(w), orig.parts[String(sec.t)])
        }, readSlides(cacheDir(ctx.userData, ctx.videoId)))
        job.times.push({ t, ms: v.ms })
        job.done++
      }
      if (job.state === 'running') job.state = 'done'
      log(`finished ${job.done}/${job.total} part(s) in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
    } catch (e) {
      const m = explain(e)
      job.state = 'failed'
      job.error = m
      job.loginNeeded = e instanceof AIError && (e.kind === 'login' || e.kind === 'missing')
      job.usageLimit = e instanceof AIError && e.kind === 'usage_limit'
      if (job.usageLimit) pauseAI(m)   // every automatic job stops; the page says so once
      log(`failed: ${m}`)
    } finally {
      job.current = null
      job.queue = []
    }
  } })
  pump()
  return job
}

/** Opening a video (or adding it to labs-library): write the missing AI notes in the background. */
function autoNotes(ctx: LabsVideoContext): void {
  if (!autoWriteOn() || aiPaused() || !engineAvailable().ok) return
  const cur = jobs.get(ctx.videoId)
  if (cur && (cur.state === 'running' || cur.state === 'queued')) return
  let targets: number[]
  try { targets = missingParts(ctx, computeSections(loadWords(ctx.sidecar))) } catch (e) { ctx.log(`notes-view: auto: ${e}`); return }
  if (targets.length) startJob(ctx, targets, true)
}

// ---------- images ----------

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
}
const MAX_IMAGE = 30 * 1024 * 1024

export default defineMainHooks({
  onVideo: (ctx) => autoNotes(ctx),
  route: async (req, ctx) => {
    const path = req.path
    if (path === 'view.js') return { status: 200, type: 'text/javascript; charset=utf-8', body: VIEW.js }
    if (path === 'view.css') return { status: 200, type: 'text/css; charset=utf-8', body: VIEW.css }
    if (path === 'data') return viewData(ctx)
    if (path === 'hints') return wasHints(ctx)
    if (path === 'generate/status') return publicJob(jobs.get(ctx.videoId) ?? idle())
    if (path === 'generate' && req.method === 'POST') {
      const eng = engineAvailable()
      if (!eng.ok) return { status: 503, type: 'application/json', body: JSON.stringify({ error: eng.reason }) }
      resumeAI()   // a run by hand lifts a usage-limit pause
      const w = loadWords(ctx.sidecar)
      const sections = computeSections(w)
      let targets: number[]
      if (req.query.get('all') === '1') {
        targets = missingParts(ctx, sections)   // "Write missing": no AI notes, not touched
      } else {
        const t = Number(req.query.get('t'))
        if (!sections.some((s) => s.t === t)) return { status: 400, type: 'application/json', body: JSON.stringify({ error: `no section at ${t}` }) }
        targets = [t]
      }
      return publicJob(startJob(ctx, targets))
    }
    if (path === 'part' && req.method === 'POST') {
      const t = Number(req.query.get('t'))
      const base = req.query.get('sig') ?? ''
      const w = loadWords(ctx.sidecar)
      const file = notesPath(place(ctx))
      let conflict = false
      const doc = changeNotes(file, w, (d) => {
        const s = findSection(d, t)
        if (!s) throw new Error(`no part at ${t}`)
        if (partSig(s) !== base) { conflict = true; return }
        setPart(d, t, req.body)
      }, readSlides(cacheDir(ctx.userData, ctx.videoId)))
      if (conflict) {
        // never lose typing: the editor's version is kept beside the notes file, then the page reloads the part
        const name = `notes-conflict-${Math.floor(t)}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`
        writeCache(ctx.userData, ctx.videoId, name, req.body)
        ctx.log(`notes-view ${ctx.videoId}: part ${t} changed underneath; editor version kept as ${name}`)
        return { status: 409, type: 'application/json', body: JSON.stringify({ error: 'the part changed (AI notes were rewritten)', kept: name }) }
      }
      const s = findSection(doc, t)!
      const orig = readOriginals(file)
      return { ok: true, sig: partSig(s), touched: partTouched(s, orig?.parts[String(s.t)]), aiCount: markedOf(s).length }
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
