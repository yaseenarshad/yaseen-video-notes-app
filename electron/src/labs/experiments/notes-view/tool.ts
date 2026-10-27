/**
 * notes-view tool (plain Node via vite-node; not part of the app):
 *
 *   npx vite-node src/labs/experiments/notes-view/tool.ts -- prompts <video folder> <out dir>
 *       writes section-<t>.txt = the exact prompt the app sends to `claude -p` for each section (notes-format.md read now)
 *   npx vite-node src/labs/experiments/notes-view/tool.ts -- apply <video folder> <answers dir> <userData dir>
 *       reads section-<t>.answer.md for every section that has one, runs it through the app's validator and writes the
 *       bullets into <userData>/labs-cache/<id>/<slug>.notes.md (the same locked write as the app; Yasin notes kept)
 *   npx vite-node src/labs/experiments/notes-view/tool.ts -- check <notes.md>
 *       parses a notes file and lists format problems (bold, headers, mochi tags) of its AI bullets
 *
 * Used to pre-generate AI notes while `claude` is logged out: the prompts are answered by hand (following
 * notes-format.md) and fed through the real validator.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadWords } from '../../analysis/analyze'
import { buildNotesPrompt, validateNotes } from './aiNotes'
import { formatProblems, parseNotes, setAiNotes, serializeNotes } from './notesFile'
import { computeSections } from './sections'
import { changeNotes, notesPath, paraTimeOf, readFormat, readSlides } from './store'
import { cacheDir } from '../../store'

function video(folder: string) {
  const sidecar = join(folder, '.follow-along.json')
  const md = readdirSync(folder).find((f) => f.endsWith('.md') && !f.endsWith('.original.md') && !f.endsWith('.notes.md') && !f.startsWith('.'))
  if (!existsSync(sidecar) || !md) throw new Error(`not a video folder: ${folder}`)
  const w = loadWords(sidecar)
  return { w, markdown: join(folder, md) }
}

const [cmd, a, b, c] = process.argv.slice(2).filter((x) => x !== '--')
if (cmd === 'prompts') {
  const { w } = video(a)
  mkdirSync(b, { recursive: true })
  const format = readFormat()
  for (const s of computeSections(w)) {
    writeFileSync(join(b, `section-${s.t}.txt`), buildNotesPrompt(format, w, s))
    console.log(`section-${s.t}.txt  ${s.title}  P${s.startPara}–P${s.endPara}  ${w.paras.slice(s.startPara, s.endPara + 1).reduce((n, p) => n + p.length, 0)} words`)
  }
} else if (cmd === 'apply') {
  const { w, markdown } = video(a)
  const userData = c
  const file = notesPath({ userData, videoId: w.id, markdown, folder: a })
  const slides = readSlides(cacheDir(userData, w.id))
  for (const s of computeSections(w)) {
    const ans = join(b, `section-${s.t}.answer.md`)
    if (!existsSync(ans)) { console.log(`${s.t}: no answer`); continue }
    const v = validateNotes(readFileSync(ans, 'utf8'), s)
    changeNotes(file, w, (doc) => setAiNotes(doc, s.t, v.bullets, paraTimeOf(w)), slides)
    console.log(`${s.t} ${s.title}: ${v.count} bullets · violations ${v.violations.length}${v.violations.length ? ' ' + JSON.stringify(v.violations.slice(0, 3)) : ''} · repairs ${v.repairs.length}${v.repairs.length ? ' ' + JSON.stringify(v.repairs.slice(0, 3)) : ''} · uncovered ${v.uncovered.join(',') || 'none'}`)
  }
  console.log(`→ ${file}`)
} else if (cmd === 'check') {
  const text = readFileSync(a, 'utf8')
  const doc = parseNotes(text)
  console.log(`${doc.sections.length} sections; round-trip ${serializeNotes(doc) === text ? 'byte-identical' : 'DIFFERS'}`)
  const probs = formatProblems(doc)
  console.log(probs.length ? probs.join('\n') : 'no format problems')
} else {
  console.log('usage: tool.ts prompts <folder> <out> | apply <folder> <answers> <userData> | check <notes.md>')
  process.exit(2)
}
