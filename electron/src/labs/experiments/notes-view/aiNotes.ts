/**
 * notes-view: AI notes for one part — the `claude -p` prompt and the validator of its answer (pure; no fs).
 *
 * Prompt = the user's notes-format.md + the concise-writing paragraphs of the Mochi skill's principles.md (both read
 * fresh by the caller every run) + what helps structure and spell the notes: the part's slides (title = first OCR line,
 * the full OCR text, t0–t1) — or, with no slides (most podcasts), the YouTube chapters and the host's questions (from
 * the Labs analysis when there is one; otherwise the model finds them) — and the spelling sources (video title,
 * chapter titles, YouTube description) + the part's paragraphs with ids (`P41 [12:14] …words…`).
 * Answer = bullet lines only, 3-space nesting, each ending in `<!-- p:N -->` (the notes file's syntax, so a valid
 * answer drops straight in); a heading made from a slide's title adds `<!-- slide-title:N -->`, slide-only text ends
 * `(slide)` + `<!-- slide:N -->`. The validator checks structure, ids and format rules (no bold / headers / mochi
 * tags) and repairs what it can; `violations` make the caller ask once more, then the sanitized bullets are used.
 */
import type { Words } from '../../analysis/words'
import { fmtTime, parseTree, textProblems, type AiBullet, type TreeNode } from './notesFile'
import type { ViewSection } from './sections'

export const NOTES_SYSTEM = `You take notes on spoken transcripts in the user's own note format. You keep the speaker's exact words, cut instead of rewriting, and cover every sentence. You answer with the bullet lines only.`

export function paragraphText(w: Words, p: number): string {
  return `P${p} [${fmtTime(w.times[p]?.[0] ?? 0)}]${w.turns[p] && p > 0 ? ' (new speaker)' : ''} ${w.paras[p].join(' ')}`
}

/** A slide shown during the part (from the slides experiment's slides.json). */
export interface PromptSlide { n: number; t0: number; t1: number; title: string; text: string }
/** A question the host asks (from the Labs analysis). */
export interface PromptQuestion { p: number; t: number; text: string }

export interface NotesContext {
  /** notes-format.md, read fresh. */
  format: string
  /** The concise-writing paragraphs of the Mochi skill's principles.md, read fresh ('' when not found). */
  principles?: string
  /** Slides shown during this part ([] = none). */
  slides?: PromptSlide[]
  /** The host's questions in this part; null = no analysis (the model finds them). */
  questions?: PromptQuestion[] | null
  /** Spelling sources besides the title and chapters. */
  description?: string
}

/** The first non-empty OCR line of a slide = its title. */
export const slideTitleOf = (text: string): string => text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''

/** Builds the prompt for part `s`. (Old call shape `buildNotesPrompt(format, w, s)` still works.) */
export function buildNotesPrompt(ctxOrFormat: NotesContext | string, w: Words, s: ViewSection): string {
  const ctx: NotesContext = typeof ctxOrFormat === 'string' ? { format: ctxOrFormat } : ctxOrFormat
  const ids = s.startPara === s.endPara ? `P${s.startPara}` : `P${s.startPara} to P${s.endPara}`
  const paras: string[] = []
  for (let p = s.startPara; p <= s.endPara; p++) paras.push(paragraphText(w, p))
  const slides = ctx.slides ?? []
  const chapters = (w.chapters ?? []).map((c) => `- ${fmtTime(c.start)} ${c.title}`)
  const desc = (ctx.description ?? '').trim()
  const outline: string[] = []
  if (slides.length) {
    outline.push(
      '# The slides shown during this part',
      '',
      'Use each slide\'s title as a heading bullet at the moment the slide appears (the paragraph being said then), and nest what was said while it was up under it. Add ` <!-- slide-title:N -->` after that heading\'s paragraph id. When a slide lists items, use the slide\'s own words as the labels and put the speaker\'s points under each one. Slide text the speaker never said may be used: end it with ` (slide)` and add ` <!-- slide:N -->` after its paragraph id (the paragraph being said while the slide is up).',
      '',
      ...slides.flatMap((sl) => [`S${sl.n} [${fmtTime(sl.t0)}–${fmtTime(sl.t1)}] title: ${sl.title}`, ...sl.text.split('\n').filter((l) => l.trim()).map((l) => `   | ${l.trim()}`)]),
      '',
    )
  } else {
    const qs = ctx.questions
    outline.push(
      '# The outline of this part (no slides)',
      '',
      `This part is ${s.kind === 'chapter' ? `the YouTube chapter "${s.title}"` : `the window ${s.title} (the video has no chapters)`}.`,
      qs === null || qs === undefined
        ? 'Make the host\'s questions in this part the heading bullets, in their own words, trimmed of filler (find them in the transcript: questions the host or interviewer asks, not rhetorical ones inside an answer).'
        : qs.length
          ? 'Make the host\'s questions the heading bullets, in their own words, trimmed of filler. The questions asked in this part:'
          : 'The host asks no questions in this part.',
      ...(qs ?? []).map((q) => `- P${q.p} [${fmtTime(q.t)}] ${q.text}`),
      'Where there are few questions, start a new heading bullet where the topic clearly shifts, named with the speaker\'s own key phrase.',
      '',
    )
  }
  return [
    '# The note format (follow it exactly)',
    '',
    ctx.format.trim(),
    '',
    ...(ctx.principles?.trim() ? ['# Concise writing (from the Mochi skill\'s principles.md — apply it to notes, not cards)', '', ctx.principles.trim(), ''] : []),
    '# Your task',
    '',
    `Write the notes for ONE part of a video transcript, in the format above.`,
    '',
    `Video: ${w.title}${w.channel ? ` (${w.channel})` : ''}`,
    `Part: ${fmtTime(s.t)}–${fmtTime(s.end)} · ${s.title} · paragraphs ${ids}`,
    '',
    '# Spelling sources (fix names and terms of the transcript to these spellings)',
    '',
    `- Video title: ${w.title}`,
    ...(chapters.length ? ['- Chapter titles:', ...chapters.map((c) => `  ${c}`)] : []),
    ...(desc ? ['- YouTube description:', ...desc.slice(0, 3000).split('\n').filter((l) => l.trim()).map((l) => `  ${l.trim()}`)] : []),
    ...(slides.length ? ['- The slides below'] : []),
    '',
    ...outline,
    'Answer rules (the app reads your answer with a program):',
    '- Output ONLY the bullet lines. No code fence, no title, no section heading, no text before or after.',
    '- Every line is a bullet "* ", nested with exactly 3 spaces per level.',
    `- End EVERY bullet with the id of the paragraph its words come from, as an HTML comment: " <!-- p:${s.startPara} -->". Use only ${ids}.`,
    ...(slides.length ? ['- A heading from a slide title: " <!-- p:N --> <!-- slide-title:S -->". Slide-only text: "… (slide) <!-- p:N --> <!-- slide:S -->". S = the slide number above.'] : []),
    '- Walk the paragraphs in order, sentence by sentence, and cover every paragraph with real content to the last one.',
    '- Keep every number and every person, company, product or book name.',
    "- Cut, don't rewrite: the speaker's own words, filler removed. No bold, no headers, no mochi tags.",
    '',
    '# The transcript of this part',
    '',
    ...paras,
    '',
  ].join('\n')
}

export function retryNotesPrompt(original: string, problems: string[]): string {
  return `${original}\n# Your previous answer had problems\n\n${problems.slice(0, 20).map((p) => `- ${p}`).join('\n')}\n\nAnswer again, following the format and the answer rules exactly.\n`
}

export interface NotesValidation {
  bullets: AiBullet[]
  /** Format rules broken (bold, headers, mochi tags, non-bullet lines) — the bullets are already sanitized. */
  violations: string[]
  /** What was fixed quietly (missing / out-of-range ids). */
  repairs: string[]
  /** Paragraphs of the section no bullet cites. */
  uncovered: number[]
  count: number
}

export class InvalidNotes extends Error {}

const ID_FORMS: RegExp[] = [
  /\s*<!--\s*p\s*:?\s*(\d+)\s*-->\s*$/i,
  /\s*[([{]\s*P\s*(\d+)\s*[)\]}]\s*$/i,
  /\s*\{\s*p\s*:\s*(\d+)\s*\}\s*$/i,
]

export interface ValidateOptions {
  /** The part's slides (slide markers are checked against them). */
  slides?: PromptSlide[]
  /** The paragraph being said at a time (a slide bullet without an id gets the one at its slide's start). */
  paraAt?: (t: number) => number
}

/** Validates (and sanitizes) the model's answer for part `s`. Throws InvalidNotes when nothing usable is in it. */
export function validateNotes(answer: string, s: ViewSection, opts: ValidateOptions = {}): NotesValidation {
  const slideNs = new Map((opts.slides ?? []).map((sl) => [sl.n, sl]))
  const violations: string[] = []
  const repairs: string[] = []
  let text = answer.replace(/\r/g, '').trim()
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text)
  if (fence) { text = fence[1]; repairs.push('code fence removed') }
  const lines = text.split('\n')
  const kept: string[] = []
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '')
    if (!l.trim()) continue
    const body = l.trim()
    if (/^#{1,6}\s/.test(body)) {
      violations.push(`header line: "${body.slice(0, 60)}"`)
      // a header becomes a bullet at the indentation it had (its text stays)
      kept.push(l.replace(/^(\s*)#{1,6}\s+/, '$1* '))
      continue
    }
    if (!/^([*+-]|\d{1,3}[.)])\s/.test(body) && /^\S/.test(l)) violations.push(`not a bullet: "${body.slice(0, 60)}"`)
    kept.push(l)
  }
  const tree = parseTree(kept)
  if (!tree.length) throw new InvalidNotes('the answer has no bullets')
  let count = 0
  const cited = new Set<number>()
  const conv = (nodes: TreeNode[], inherit: number | null): AiBullet[] =>
    nodes.map((n) => {
      count++
      let t = n.text.replace(/\s*\n\s*/g, ' ').trim()
      let p: number | null = null
      // slide markers first (they may follow the paragraph id)
      let slideTitle: number | undefined, slide: number | undefined
      t = t.replace(/\s*<!--\s*slide-title:\s*(\d+)\s*-->/gi, (_m, k: string) => { slideTitle = Number(k); return '' })
      t = t.replace(/\s*<!--\s*slide:\s*(\d+)\s*-->/gi, (_m, k: string) => { slide = Number(k); return '' }).trim()
      for (const [kind, k] of [['slide-title', slideTitle], ['slide', slide]] as const) {
        if (k !== undefined && !slideNs.has(k)) { repairs.push(`${kind}:${k} is not a slide of this part → dropped`); if (kind === 'slide') slide = undefined; else slideTitle = undefined }
      }
      for (const re of ID_FORMS) {
        const m = re.exec(t)
        if (m) { p = Number(m[1]); t = t.slice(0, m.index).trim(); if (re !== ID_FORMS[0]) repairs.push(`id written as "${m[0].trim()}"`); break }
      }
      // a stray marker in the middle
      t = t.replace(/\s*<!--.*?-->\s*/g, ' ').trim()
      const sl = slideNs.get(slide ?? slideTitle ?? -1)
      if (p === null && sl && opts.paraAt) {
        p = Math.max(s.startPara, Math.min(s.endPara, opts.paraAt(sl.t0)))
        repairs.push(`no id on slide bullet "${t.slice(0, 40)}" → P${p} (the slide's start)`)
      } else if (p === null) {
        p = inherit ?? s.startPara
        repairs.push(`no id on "${t.slice(0, 40)}" → P${p}`)
      } else if (p < s.startPara || p > s.endPara) {
        const q = Math.max(s.startPara, Math.min(s.endPara, p))
        repairs.push(`id P${p} is outside the section → P${q}`)
        p = q
      }
      for (const prob of textProblems(t)) violations.push(`${prob}: "${t.slice(0, 60)}"`)
      // `==` would read as Yasin's words (the notes file's `==…==`): an AI text never has them
      t = t.replace(/=(?==)|(?<==)=/g, '\\=')
      t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\[\[\s*mochi[^\]]*\]\]/gi, '').replace(/#mochi\b/gi, '').replace(/\s{2,}/g, ' ').trim()
      if (slide !== undefined && !/\(slide\)$/i.test(t)) { t = `${t} (slide)`; repairs.push(`slide-only text without "(slide)": "${t.slice(0, 40)}"`) }
      cited.add(p)
      const b: AiBullet = { text: t, p, children: conv(n.children, p) }
      if (slideTitle !== undefined) b.slideTitle = slideTitle
      if (slide !== undefined) b.slide = slide
      return b
    })
  const bullets = conv(tree, null).filter((b) => b.text || b.children.length)
  const uncovered: number[] = []
  for (let p = s.startPara; p <= s.endPara; p++) if (!cited.has(p)) uncovered.push(p)
  return { bullets, violations, repairs, uncovered, count }
}
