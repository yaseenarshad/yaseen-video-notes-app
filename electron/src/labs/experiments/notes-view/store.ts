/**
 * notes-view: where the notes file lives and the locked read-change-write of it (Node; no Electron), shared by
 * main.ts (the player page's routes, the AI job) and tool.ts (prompt dump / pre-generated answers).
 *
 * - Labs: `<Labs userData>/labs-cache/<videoId>/<slug>.notes.md` (Labs never writes to the vault).
 * - Designed so the real app could write it next to the transcript instead: `<video folder>/<slug>.notes.md`
 *   (`notesPath(…, { beside: true })`); images then go to `<video folder>/notes-images/`.
 * Every write: under `withFileLock(<notes.md>)` (the app's own lock helper), read fresh, change, `atomicWrite`.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, normalize, relative, sep } from 'node:path'
import { atomicWrite } from '../../../core/atomic'
import { withFileLock } from '../../../core/fileLock'
import { spanText, type Words } from '../../analysis/words'
import { fetchInfo, trimInfo } from '../../signals'
import { cacheDir, INFO_FILE, readAnalysis, readJSON, writeCache } from '../../store'
import { slideTitleOf, type NotesContext, type PromptQuestion, type PromptSlide } from './aiNotes'
import { emptyDoc, emptyOriginals, ensureOriginals, ensureSections, parseNotes, serializeNotes, setSlides, slideSignature, specsSignature, videoUrl, type NotesDoc, type Originals, type SlideSpec } from './notesFile'
import { computeSections, type ViewSection } from './sections'

export const IMAGES_DIR = 'notes-images'
export const SLIDES_DIR = 'slides'
export const SLIDES_FILE = 'slides.json'

/** The user's note format (read fresh for every AI run). `VIDEO_NOTES_NOTES_FORMAT` overrides the path. */
export const NOTES_FORMAT_PATH = (): string =>
  process.env.VIDEO_NOTES_NOTES_FORMAT || join(homedir(), 'Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app/notes-format.md')

/** The Mochi skill's principles.md (its concise-writing paragraphs go into every prompt). `VIDEO_NOTES_PRINCIPLES` overrides. */
export const PRINCIPLES_PATH = (): string =>
  process.env.VIDEO_NOTES_PRINCIPLES || join(homedir(), 'Documents/GitHub/skills-global-yaseen/mochi/card-making/principles.md')

/**
 * The "Aim for card prose…" and "Use direct verbs and short sentences…" paragraphs of principles.md, read fresh
 * (notes-format.md names them). Missing file → ''; paragraphs not found → the whole file.
 */
export function readPrinciples(): string {
  let text: string
  try { text = readFileSync(PRINCIPLES_PATH(), 'utf8') } catch { return '' }
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/)
  const want = paras.filter((p) => /^\s*(Aim for card prose|Use direct verbs and short sentences)/.test(p))
  return (want.length ? want : [text]).map((p) => p.trim()).join('\n\n')
}

export function readFormat(): string {
  const p = NOTES_FORMAT_PATH()
  try { return readFileSync(p, 'utf8') } catch { throw new Error(`notes-format.md not found at ${p}`) }
}

export const slugOf = (markdownPath: string): string => basename(markdownPath).replace(/\.md$/i, '')

export interface NotesPlace { userData: string; videoId: string; markdown: string; folder: string }

/** The notes file of a video: Labs cache (default) or beside the transcript. */
export function notesPath(v: NotesPlace, opts: { beside?: boolean } = {}): string {
  const name = `${slugOf(v.markdown)}.notes.md`
  return opts.beside ? join(v.folder, name) : join(cacheDir(v.userData, v.videoId), name)
}

/** A path inside the notes file's folder (images, slides), or null when `rel` leaves it. */
export function insideNotesDir(notesFile: string, rel: string): string | null {
  const dir = dirname(notesFile)
  const p = normalize(join(dir, rel))
  const r = relative(dir, p)
  if (!r || r.startsWith('..') || r.split(sep).includes('..')) return null
  return p
}

export const sectionSpecs = (w: Words, sections: ViewSection[]) => sections.map((s) => ({ t: s.t, title: s.title, url: videoUrl(w.id, s.t) }))

/** The paragraph being said at time t (the last one starting at or before it). */
export const paraAtOf = (w: Words) => (t: number): number => {
  let p = 0
  for (let i = 0; i < w.paras.length; i++) if ((w.times[i]?.[0] ?? 0) <= t + 0.01) p = i; else break
  return p
}

export const paraTimeOf = (w: Words) => (p: number): number => w.times[Math.max(0, Math.min(w.paras.length - 1, p))]?.[0] ?? 0

export function readNotes(file: string): NotesDoc | null {
  try { return parseNotes(readFileSync(file, 'utf8')) } catch { return null }
}

/** The AI's originals of a notes file: `<slug>.notes-ai.json` beside it (never in the .md). */
export const originalsPath = (notesFile: string): string => notesFile.replace(/\.notes\.md$/, '') + '.notes-ai.json'

export function readOriginals(notesFile: string): Originals | null {
  try {
    const o = JSON.parse(readFileSync(originalsPath(notesFile), 'utf8')) as Originals
    return o && typeof o === 'object' && o.parts && typeof o.parts === 'object' ? { version: 1, parts: o.parts } : null
  } catch { return null }
}

/**
 * Read fresh → change → write, under the notes file's lock (the sidecar is read and written under the same lock).
 * `change` gets a doc with every part present and the originals (a part with none yet gets them from its current
 * bullets: files made before the sidecar); both files are written only when they changed.
 */
export function changeNotes(file: string, w: Words, change: (doc: NotesDoc, orig: Originals) => NotesDoc | void, slides?: SlideSpec[] | null): NotesDoc {
  mkdirSync(dirname(file), { recursive: true })
  return withFileLock(file, () => {
    const before = existsSync(file) ? readFileSync(file, 'utf8') : null
    let doc = before !== null ? parseNotes(before) : emptyDoc(`Notes — ${w.title}`)
    ensureSections(doc, sectionSpecs(w, computeSections(w)))
    const orig = readOriginals(file) ?? emptyOriginals()
    const origBefore = JSON.stringify(orig)
    ensureOriginals(doc, orig)   // before any change: the originals are the file as it was
    if (slides && slideSignature(doc) !== specsSignature(slides)) setSlides(doc, slides, paraTimeOf(w))
    doc = change(doc, orig) ?? doc
    const after = serializeNotes(doc)
    if (after !== before) atomicWrite(file, after)
    const origAfter = JSON.stringify(orig)
    if (origAfter !== origBefore) atomicWrite(originalsPath(file), JSON.stringify(orig, null, 1) + '\n')
    return doc
  })
}

// ---------- what the prompt gets besides the transcript ----------

interface Info { title?: string; description?: string; chapters?: { start_time: number; title: string }[] }

/** `labs-cache/<id>/info.json` (a trimmed yt-dlp info json), or null. */
export const readInfo = (userData: string, videoId: string): Info | null => readJSON<Info>(join(cacheDir(userData, videoId), INFO_FILE))

/** The info json, fetched once with yt-dlp (and cached) when it is missing — for the YouTube description. */
export async function ensureInfo(userData: string, videoId: string, log: (l: string) => void = () => {}): Promise<Info | null> {
  const have = readInfo(userData, videoId)
  if (have) return have
  try {
    const info = trimInfo(await fetchInfo(videoId, log))
    writeCache(userData, videoId, INFO_FILE, JSON.stringify(info, null, 1))
    return info as Info
  } catch (e) {
    log(`info.json: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

/** slides.json's real slides with their OCR text (camera / blank frames left out). */
export function readSlideTexts(cache: string): PromptSlide[] {
  const raw = readJSON<{ slides?: unknown[]; noSlides?: boolean } | unknown[]>(join(cache, SLIDES_FILE))
  const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.slides) && !raw.noSlides ? raw.slides : []
  const out: PromptSlide[] = []
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (typeof o.kind === 'string' && o.kind !== 'slide') continue
    const n = Number(o.n), t0 = Number(o.t0), t1 = Number(o.t1 ?? o.t0)
    const text = typeof o.text === 'string' ? o.text : ''
    if (!Number.isFinite(n) || !Number.isFinite(t0)) continue
    out.push({ n, t0, t1: Number.isFinite(t1) ? t1 : t0, title: slideTitleOf(text), text })
  }
  return out.sort((a, b) => a.t0 - b.t0)
}

/** The host's questions from the Labs analysis (null = the video was not analyzed, or for another transcript). */
export function readQuestions(userData: string, videoId: string, w: Words): PromptQuestion[] | null {
  const a = readAnalysis(userData, videoId)
  if (!a || !Array.isArray(a.questions) || a.transcript?.paras !== w.paras.length) return null
  return a.questions.map((q) => ({ p: q.question.startPara, t: q.question.t0, text: spanText(w, q.question) }))
}

/** Everything the prompt of part `sec` gets (format, principles, slides or chapters + questions, description). */
export function promptContext(userData: string, videoId: string, w: Words, sec: ViewSection, info: Info | null = readInfo(userData, videoId)): NotesContext {
  const slides = readSlideTexts(cacheDir(userData, videoId)).filter((sl) => sl.t0 >= sec.t && sl.t0 < sec.end)
  const qs = readQuestions(userData, videoId, w)
  return {
    format: readFormat(),
    principles: readPrinciples(),
    slides,
    questions: qs === null ? null : qs.filter((q) => q.p >= sec.startPara && q.p <= sec.endPara),
    description: info?.description ?? '',
  }
}

/** Every slide's OCR text by number (for the checks). */
export const slideTextMap = (cache: string): Record<number, string> => Object.fromEntries(readSlideTexts(cache).map((sl) => [sl.n, sl.text]))

// ---------- slides (made by the `slides` experiment) ----------

/**
 * `labs-cache/<id>/slides.json` → slide specs with srcs relative to the notes file. Read defensively: an array or
 * `{ slides: [...] }`; number from n | index | i | slide (else position + 1); time from t0 | start | t | time | ts;
 * file from file | path | image | src | name (a bare name is looked up in `slides/`). Missing → [].
 */
export function readSlides(cache: string): SlideSpec[] {
  const raw = readJSON<unknown>(join(cache, SLIDES_FILE))
  const arr: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { slides?: unknown }).slides) ? (raw as { slides: unknown[] }).slides : []
  const num = (o: Record<string, unknown>, keys: string[]): number | null => {
    for (const k of keys) { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) return v; if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v) }
    return null
  }
  const out: SlideSpec[] = []
  arr.forEach((x, i) => {
    if (!x || typeof x !== 'object') return
    const o = x as Record<string, unknown>
    if (typeof o.kind === 'string' && /camera|blank|face|speaker/i.test(o.kind)) return   // only slides
    const t = num(o, ['t0', 'start', 't', 'time', 'ts', 'seconds'])
    const fileKey = ['file', 'path', 'image', 'src', 'name'].map((k) => o[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined
    if (t === null || !fileKey) return
    let rel = fileKey.replace(/^\/+/, '')
    if (rel.startsWith(cache)) rel = relative(cache, rel)
    if (!rel.includes('/')) rel = `${SLIDES_DIR}/${rel}`
    if (!existsSync(join(cache, rel))) return
    out.push({ n: num(o, ['n', 'index', 'i', 'slide', 'num']) ?? i + 1, t, src: rel })
  })
  return out.sort((a, b) => a.t - b.t || a.n - b.n)
}
