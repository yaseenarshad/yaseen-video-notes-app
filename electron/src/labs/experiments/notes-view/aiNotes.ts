/**
 * notes-view: AI notes for one section — the `claude -p` prompt and the validator of its answer (pure; no fs).
 *
 * Prompt = the user's notes-format.md (read fresh by the caller every run) + the section's transcript paragraphs with
 * ids (`P41 [12:14] …words…`). Answer = bullet lines only, 3-space nesting, each ending in `<!-- p:N -->` (the same
 * syntax as the notes file, so a valid answer drops straight in). The validator checks the structure, the ids and the
 * format rules (no bold, no headers, no mochi tags) and repairs what it can; `violations` (format rules broken) make
 * the caller ask once more, then the sanitized bullets are used. Coverage = which paragraphs no bullet cites.
 */
import type { Words } from '../../analysis/words'
import { fmtTime, parseTree, textProblems, type AiBullet, type TreeNode } from './notesFile'
import type { ViewSection } from './sections'

export const NOTES_SYSTEM = `You take notes on spoken transcripts in the user's own note format. You keep the speaker's exact words and cover every sentence. You answer with the bullet lines only.`

export function paragraphText(w: Words, p: number): string {
  return `P${p} [${fmtTime(w.times[p]?.[0] ?? 0)}]${w.turns[p] && p > 0 ? ' (new speaker)' : ''} ${w.paras[p].join(' ')}`
}

export function buildNotesPrompt(format: string, w: Words, s: ViewSection): string {
  const ids = s.startPara === s.endPara ? `P${s.startPara}` : `P${s.startPara} to P${s.endPara}`
  const paras: string[] = []
  for (let p = s.startPara; p <= s.endPara; p++) paras.push(paragraphText(w, p))
  return [
    '# The note format (follow it exactly)',
    '',
    format.trim(),
    '',
    '# Your task',
    '',
    `Write the notes for ONE section of a video transcript, in the format above.`,
    '',
    `Video: ${w.title}${w.channel ? ` (${w.channel})` : ''}`,
    `Section: ${fmtTime(s.t)}–${fmtTime(s.end)} · ${s.title} · paragraphs ${ids}`,
    '',
    'Answer rules (the app reads your answer with a program):',
    '- Output ONLY the bullet lines. No code fence, no title, no section heading, no text before or after.',
    '- Every line is a bullet "* ", nested with exactly 3 spaces per level.',
    `- End EVERY bullet with the id of the paragraph its words come from, as an HTML comment: " <!-- p:${s.startPara} -->". Use only ${ids}.`,
    '- Walk the paragraphs in order, sentence by sentence, and cover every sentence to the last one.',
    "- Use the speaker's own words. No bold, no headers, no mochi tags.",
    '',
    '# The transcript of this section',
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

/** Validates (and sanitizes) the model's answer for section `s`. Throws InvalidNotes when nothing usable is in it. */
export function validateNotes(answer: string, s: ViewSection): NotesValidation {
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
      for (const re of ID_FORMS) {
        const m = re.exec(t)
        if (m) { p = Number(m[1]); t = t.slice(0, m.index).trim(); if (re !== ID_FORMS[0]) repairs.push(`id written as "${m[0].trim()}"`); break }
      }
      // a stray marker in the middle
      t = t.replace(/\s*<!--.*?-->\s*/g, ' ').trim()
      if (p === null) {
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
      cited.add(p)
      return { text: t, p, children: conv(n.children, p) }
    })
  const bullets = conv(tree, null).filter((b) => b.text || b.children.length)
  const uncovered: number[] = []
  for (let p = s.startPara; p <= s.endPara; p++) if (!cited.has(p)) uncovered.push(p)
  return { bullets, violations, repairs, uncovered, count }
}
