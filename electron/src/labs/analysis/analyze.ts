import { readFileSync } from 'node:fs'
import { decodeSidecar } from '../../core/transcript'
import { readAnalysis, writeAnalysis, writeCache } from '../store'
import { runClaude, type ClaudeOptions } from './claude'
import { buildPrompt, chunks, retryPrompt, SYSTEM_PROMPT } from './prompt'
import type { LabsAnalysis } from './schema'
import { finalize, InvalidAnswer, matchesTranscript, parseAnswer, validateChunk, type ChunkResult } from './validate'
import { wordsOf, type Words } from './words'

/**
 * The analysis engine: transcript (sidecar) → prompt(s) → `claude -p` → validated, repaired, merged →
 * `labs-cache/<videoId>/labs-analysis.json` in Labs' userData. Used by the CLI (`analyze`) and the Labs player's
 * "Analyze this video" button. An answer that is not usable (not JSON / wrong shape / spans that point nowhere)
 * is asked for once more with the error message; item-level problems are repaired or dropped and noted in
 * `repairs`.
 */
export interface AnalyzeOptions {
  /** Labs' userData (where the cache lives). */
  userData: string
  model?: string
  claudeBin?: string
  timeoutMs?: number
  /** Re-run even when an analysis of the same transcript exists. */
  force?: boolean
  /** Saved model answers to use instead of calling claude (one per chunk, in order). */
  responses?: string[]
  log?: (line: string) => void
  /** For tests: replaces the claude call. */
  ask?: (prompt: string, opts: ClaudeOptions) => Promise<{ text: string; ms: number }>
}

export interface AnalyzeResult { analysis: LabsAnalysis; file: string; reused: boolean; ms: number }

export function loadWords(sidecarPath: string): Words {
  return wordsOf(decodeSidecar(readFileSync(sidecarPath, 'utf8')))
}

/** The prompts for a transcript, without calling anything (`analyze --prompt-out`). */
export function prompts(w: Words): string[] {
  const cs = chunks(w)
  return cs.map((c, i) => buildPrompt(w, c, cs.length, i))
}

export async function analyze(sidecarPath: string, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const log = opts.log ?? (() => {})
  const w = loadWords(sidecarPath)
  const t0 = Date.now()
  if (!opts.force && !opts.responses) {
    const old = readAnalysis(opts.userData, w.id)
    if (old && matchesTranscript(old, w)) {
      log(`already analyzed (${old.createdAt}); --force to run again`)
      return { analysis: old, file: '', reused: true, ms: 0 }
    }
  }
  const cs = chunks(w)
  log(`${w.title}: ${w.paras.length} paragraphs, ${w.total} words, ${w.chapters.length} chapters → ${cs.length} call(s)`)
  const repairs: string[] = []
  const parts: ChunkResult[] = []
  let modelMs = 0
  const ask = opts.ask ?? (async (prompt: string, o: ClaudeOptions) => runClaude(prompt, o))
  const claudeOpts: ClaudeOptions = { bin: opts.claudeBin, model: opts.model, system: SYSTEM_PROMPT, timeoutMs: opts.timeoutMs, log }
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    const prompt = buildPrompt(w, c, cs.length, i)
    writeCache(opts.userData, w.id, `prompt-${i + 1}.txt`, prompt)
    const tag = cs.length > 1 ? `part ${i + 1}/${cs.length}: ` : ''
    const chunkRepairs: string[] = []
    let text: string
    if (opts.responses) {
      if (!opts.responses[i]) throw new Error(`no response file for part ${i + 1} of ${cs.length}`)
      text = readFileSync(opts.responses[i], 'utf8')
      log(`${tag}using the saved answer ${opts.responses[i]}`)
    } else {
      log(`${tag}asking claude (P${c.first}–P${c.last}, ${c.words} words, ~${Math.round(prompt.length / 4 / 1000)}k tokens)…`)
      const r = await ask(prompt, claudeOpts)
      modelMs += r.ms
      text = r.text
    }
    writeCache(opts.userData, w.id, `response-${i + 1}.txt`, text)
    try {
      parts.push(validateChunk(w, parseAnswer(text), c, chunkRepairs))
    } catch (e) {
      if (!(e instanceof InvalidAnswer) || opts.responses) throw e
      log(`${tag}answer rejected (${e.message}); asking once more`)
      chunkRepairs.length = 0
      const r = await ask(retryPrompt(prompt, e.message), claudeOpts)
      modelMs += r.ms
      writeCache(opts.userData, w.id, `response-${i + 1}-retry.txt`, r.text)
      parts.push(validateChunk(w, parseAnswer(r.text), c, chunkRepairs)) // a second failure is the error
    }
    repairs.push(...chunkRepairs.map((x) => tag + x))
  }
  const source = opts.responses ? 'saved response' : `claude -p${opts.model ? ` --model ${opts.model}` : ''}`
  const analysis = finalize(w, parts, { createdAt: new Date().toISOString(), source, elapsedMs: modelMs, repairs })
  const file = writeAnalysis(opts.userData, analysis)
  const ms = Date.now() - t0
  log(`done in ${(ms / 1000).toFixed(1)} s: ${analysis.highlights.length} highlights, ${analysis.pullQuotes.length} pull quotes, ${analysis.questions.length} questions, ${analysis.claims.length} claims, ${analysis.mochiCandidates.length} flashcard candidates, ${analysis.repairs.length} repair note(s)`)
  return { analysis, file, reused: false, ms }
}
