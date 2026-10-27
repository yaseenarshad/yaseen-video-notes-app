/**
 * notes-view tool (plain Node via vite-node; not part of the app):
 *
 *   npx vite-node src/labs/experiments/notes-view/tool.ts -- prompts <video folder> <out dir> <userData dir>
 *       writes section-<t>.txt = the exact prompt the app sends to `claude -p` for each part (notes-format.md and
 *       principles.md read now; slides / chapters + questions / description from <userData>/labs-cache/<id>/)
 *   npx vite-node src/labs/experiments/notes-view/tool.ts -- apply <video folder> <answers dir> <userData dir> [--keep-v1]
 *       reads section-<t>.answer.md for every part that has one, runs it through the app's validator and writes the
 *       bullets into <userData>/labs-cache/<id>/<slug>.notes.md + the originals into <slug>.notes-ai.json (the same
 *       locked write as the app; bullets Yasin touched are kept). --keep-v1: first copy the current notes file to
 *       <slug>.notes.v1.md (once), for "Compare with previous notes".
 *   npx vite-node src/labs/experiments/notes-view/tool.ts -- try <video folder> <answers dir> <userData dir> <part t>
 *       validates section-<t>.answer.md and runs the "nothing lost" checks on it — writes nothing (for whoever answers)
 *   npx vite-node src/labs/experiments/notes-view/tool.ts -- check <notes.md> [<video folder> <userData dir>]
 *       format problems; with the video: the "nothing lost" checks of every part
 *   npx vite-node src/labs/experiments/notes-view/tool.ts -- compare <old notes.md> <new notes.md> <video folder> <userData dir>
 *       bullets, words per bullet, coverage, missing numbers / names, "may be reworded" — old vs new
 *
 * Used to pre-generate AI notes while `claude` is logged out: the prompts are answered by hand (following
 * notes-format.md) and fed through the real validator.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadWords } from '../../analysis/analyze'
import type { Words } from '../../analysis/words'
import { buildNotesPrompt, validateNotes } from './aiNotes'
import { checkPart, type PartChecks } from './checks'
import { bulletsOf, flatBullets, formatProblems, markedOf, parseNotes, serializeNotes, setAiNotes, type NotesDoc } from './notesFile'
import { computeSections } from './sections'
import { changeNotes, notesPath, paraAtOf, paraTimeOf, promptContext, readInfo, readSlides, slideTextMap } from './store'
import { cacheDir } from '../../store'

function video(folder: string) {
  const sidecar = join(folder, '.follow-along.json')
  const md = readdirSync(folder).find((f) => f.endsWith('.md') && !f.endsWith('.original.md') && !f.endsWith('.notes.md') && !f.startsWith('.'))
  if (!existsSync(sidecar) || !md) throw new Error(`not a video folder: ${folder}`)
  const w = loadWords(sidecar)
  return { w, markdown: join(folder, md) }
}

function checksOf(doc: NotesDoc, w: Words, userData: string): { t: number; title: string; c: PartChecks }[] {
  const info = readInfo(userData, w.id)
  const sources = [w.title, ...(w.chapters ?? []).map((x) => x.title), info?.description ?? '']
  const slideText = slideTextMap(cacheDir(userData, w.id))
  const paras = w.paras.map((words, i) => ({ words, times: w.times[i] ?? [] }))
  return computeSections(w).flatMap((sec) => {
    const s = doc.sections.find((x) => x.t === sec.t)
    if (!s || !markedOf(s).length) return []
    return [{ t: sec.t, title: sec.title, c: checkPart({ paras, startPara: sec.startPara, endPara: sec.endPara, bullets: bulletsOf(s), slideText, sources }) }]
  })
}

function stats(doc: NotesDoc, w: Words, userData: string) {
  const all = doc.sections.flatMap((s) => flatBullets(bulletsOf(s)))
  const marked = all.filter((b) => b.p !== null)
  const words = marked.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0)
  const ck = checksOf(doc, w, userData)
  const content = ck.reduce((n, x) => n + x.c.contentParas, 0), unc = ck.reduce((n, x) => n + x.c.uncovered.length, 0)
  return {
    bullets: marked.length,
    wordsPerBullet: Math.round((words / Math.max(1, marked.length)) * 10) / 10,
    coverage: content ? Math.round(((content - unc) / content) * 1000) / 10 : 100,
    uncovered: unc,
    missing: ck.flatMap((x) => x.c.missing),
    reworded: ck.reduce((n, x) => n + x.c.reworded.length, 0),
    format: ck.reduce((n, x) => n + x.c.format.length, 0),
    slideTitles: marked.filter((b) => b.slideTitle !== undefined).length,
    slideText: marked.filter((b) => b.slide !== undefined).length,
  }
}

const [cmd, a, b, c] = process.argv.slice(2).filter((x) => x !== '--')
if (cmd === 'prompts') {
  const { w } = video(a)
  const userData = c
  mkdirSync(b, { recursive: true })
  for (const sec of computeSections(w)) {
    const pc = promptContext(userData, w.id, w, sec)
    writeFileSync(join(b, `section-${sec.t}.txt`), buildNotesPrompt(pc, w, sec))
    console.log(`section-${sec.t}.txt  ${sec.title}  P${sec.startPara}–P${sec.endPara}  ${w.paras.slice(sec.startPara, sec.endPara + 1).reduce((n, p) => n + p.length, 0)} words  slides ${pc.slides?.length ?? 0}  questions ${pc.questions === null ? 'n/a' : pc.questions?.length}`)
  }
} else if (cmd === 'apply') {
  const { w, markdown } = video(a)
  const userData = c
  const file = notesPath({ userData, videoId: w.id, markdown, folder: a })
  if (process.argv.includes('--keep-v1')) {
    const v1 = file.replace(/\.notes\.md$/, '.notes.v1.md')
    if (existsSync(file) && !existsSync(v1)) { copyFileSync(file, v1); console.log(`kept the previous notes as ${v1}`) }
  }
  const slides = readSlides(cacheDir(userData, w.id))
  for (const sec of computeSections(w)) {
    const ans = join(b, `section-${sec.t}.answer.md`)
    if (!existsSync(ans)) { console.log(`${sec.t}: no answer`); continue }
    const pc = promptContext(userData, w.id, w, sec)
    const v = validateNotes(readFileSync(ans, 'utf8'), sec, { slides: pc.slides, paraAt: paraAtOf(w) })
    changeNotes(file, w, (doc, orig) => { orig.parts[String(sec.t)] = setAiNotes(doc, sec.t, v.bullets, paraTimeOf(w), orig.parts[String(sec.t)]) }, slides)
    console.log(`${sec.t} ${sec.title}: ${v.count} bullets · violations ${v.violations.length}${v.violations.length ? ' ' + JSON.stringify(v.violations.slice(0, 3)) : ''} · repairs ${v.repairs.length}${v.repairs.length ? ' ' + JSON.stringify(v.repairs.slice(0, 3)) : ''} · uncovered ${v.uncovered.join(',') || 'none'}`)
  }
  console.log(`→ ${file}`)
} else if (cmd === 'try') {
  const { w } = video(a)
  const userData = c
  const t = Number(process.argv.slice(2).filter((x) => x !== '--')[4])
  const sec = computeSections(w).find((x) => x.t === t)
  if (!sec) { console.log(`no part at ${t}; parts: ${computeSections(w).map((x) => x.t).join(', ')}`); process.exit(2) }
  const pc = promptContext(userData, w.id, w, sec)
  const v = validateNotes(readFileSync(join(b, `section-${t}.answer.md`), 'utf8'), sec, { slides: pc.slides, paraAt: paraAtOf(w) })
  const info = readInfo(userData, w.id)
  const k = checkPart({
    paras: w.paras.map((words, i) => ({ words, times: w.times[i] ?? [] })), startPara: sec.startPara, endPara: sec.endPara, bullets: v.bullets,
    slideText: slideTextMap(cacheDir(userData, w.id)), sources: [w.title, ...(w.chapters ?? []).map((x) => x.title), info?.description ?? ''],
  })
  const all = flatBullets(v.bullets)
  console.log(JSON.stringify({
    bullets: all.length, wordsPerBullet: Math.round((all.reduce((n, x) => n + x.text.split(/\s+/).length, 0) / Math.max(1, all.length)) * 10) / 10,
    violations: v.violations, repairs: v.repairs,
    uncoveredParagraphs: k.uncovered.map((u) => `P${u.p}`), coverage: `${k.contentParas - k.uncovered.length}/${k.contentParas}`,
    missingNumbersAndNames: k.missing, format: k.format, mayBeReworded: k.reworded.map((r) => `${Math.round(r.share * 100)}% P${r.p}: ${r.text}`),
  }, null, 1))
} else if (cmd === 'check') {
  const text = readFileSync(a, 'utf8')
  const doc = parseNotes(text)
  console.log(`${doc.sections.length} parts; round-trip ${serializeNotes(doc) === text ? 'byte-identical' : 'DIFFERS'}`)
  const probs = formatProblems(doc)
  console.log(probs.length ? probs.join('\n') : 'no format problems')
  if (b && c) {
    const { w } = video(b)
    for (const x of checksOf(doc, w, c)) {
      const k = x.c
      console.log(`${x.t} ${x.title}: uncovered ${k.uncovered.map((u) => `P${u.p}`).join(',') || '-'} · missing ${k.missing.join(' | ') || '-'} · reworded ${k.reworded.length}${k.reworded.length ? ' ' + JSON.stringify(k.reworded.slice(0, 2).map((r) => `${r.share} ${r.text.slice(0, 50)}`)) : ''}`)
    }
  }
} else if (cmd === 'compare') {
  const { w } = video(c)
  const userData = process.argv.slice(2).filter((x) => x !== '--')[4]
  const before = stats(parseNotes(readFileSync(a, 'utf8')), w, userData)
  const after = stats(parseNotes(readFileSync(b, 'utf8')), w, userData)
  console.log(JSON.stringify({ old: { ...before, missing: before.missing.length, missingList: before.missing }, new: { ...after, missing: after.missing.length, missingList: after.missing } }, null, 1))
} else {
  console.log('usage: tool.ts prompts <folder> <out> <userData> | apply <folder> <answers> <userData> [--keep-v1] | check <notes.md> [<folder> <userData>] | compare <old.md> <new.md> <folder> <userData>')
  process.exit(2)
}
