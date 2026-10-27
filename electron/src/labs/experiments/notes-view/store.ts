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
import type { Words } from '../../analysis/words'
import { cacheDir, readJSON } from '../../store'
import { emptyDoc, emptyOriginals, ensureOriginals, ensureSections, parseNotes, serializeNotes, setSlides, slideSignature, specsSignature, videoUrl, type NotesDoc, type Originals, type SlideSpec } from './notesFile'
import { computeSections, type ViewSection } from './sections'

export const IMAGES_DIR = 'notes-images'
export const SLIDES_DIR = 'slides'
export const SLIDES_FILE = 'slides.json'

/** The user's note format (read fresh for every AI run). `VIDEO_NOTES_NOTES_FORMAT` overrides the path. */
export const NOTES_FORMAT_PATH = (): string =>
  process.env.VIDEO_NOTES_NOTES_FORMAT || join(homedir(), 'Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app/notes-format.md')

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
