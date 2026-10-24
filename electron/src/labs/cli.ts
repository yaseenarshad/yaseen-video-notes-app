import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { labsUserDataDefault } from '../core/flavor'
import { SIDECAR_FILE } from '../core/transcript'
import { analyze, loadWords, prompts } from './analysis/analyze'
import { analysisPath } from './store'
import { ensureSignals } from './signals'
import { clock, spanText } from './analysis/words'

export const ANALYZE_USAGE = `  video-notes-labs analyze <video folder | .md | .follow-along.json> [options]
        Runs the Labs analysis (claude -p, extractive: spans of the transcript, never rewritten) and fetches the
        "most replayed" heatmap + SponsorBlock segments. Writes only into Labs' userData:
        labs-cache/<videoId>/{labs-analysis.json, signals.json, info.json, prompt-N.txt, response-N.txt}.
        --force               run again even when an analysis of this transcript exists
        --model <name>        claude model (default: claude's default)
        --signals-only        only the heatmap + SponsorBlock
        --no-signals          only the analysis
        --prompt-out <dir>    write the prompt(s) to <dir>/prompt-N.txt and stop (no model call)
        --response <file>     use a saved model answer instead of calling claude (once per part, in order)
        --user-data-dir <dir> Labs' userData (default ~/Library/Application Support/Yaseen Video Notes Labs;
                              also VIDEO_NOTES_USER_DATA)
        --json                print the analysis JSON instead of the summary`

const expand = (p: string): string => resolve(p.startsWith('~/') ? homedir() + p.slice(1) : p)

/** The sidecar of a folder / .md / sidecar path. */
export function sidecarFor(input: string): string {
  const p = expand(input)
  if (p.endsWith(SIDECAR_FILE)) return p
  const folder = existsSync(p) && statSync(p).isDirectory() ? p : extname(p) === '.md' ? dirname(p) : p
  return join(folder, SIDECAR_FILE)
}

const values = (args: string[], name: string): string[] => args.flatMap((a, i) => (a === name && i + 1 < args.length ? [args[i + 1]] : []))

/** `analyze …`: exit 0 ok · 1 failed · 2 bad usage. */
export async function analyzeCLI(args: string[], out: (s: string) => void, err: (s: string) => void): Promise<number> {
  const withValue = ['--model', '--prompt-out', '--response', '--user-data-dir']
  const positional = args.filter((a, i) => !a.startsWith('--') && !withValue.includes(args[i - 1]))
  if (positional.length !== 1 || args.includes('--help')) { err(ANALYZE_USAGE); return 2 }
  const sidecar = sidecarFor(positional[0])
  if (!existsSync(sidecar)) { err(`error: no ${SIDECAR_FILE} for ${positional[0]} (open the video once in the app to set it up)`); return 2 }
  const userData = expand(values(args, '--user-data-dir')[0] ?? process.env.VIDEO_NOTES_USER_DATA ?? labsUserDataDefault())
  const log = (l: string) => err(`  ${l}`)
  try {
    const w = loadWords(sidecar)
    const promptOut = values(args, '--prompt-out')[0]
    if (promptOut) {
      const dir = expand(promptOut)
      mkdirSync(dir, { recursive: true })
      prompts(w).forEach((p, i) => { writeFileSync(join(dir, `prompt-${i + 1}.txt`), p); out(join(dir, `prompt-${i + 1}.txt`)) })
      return 0
    }
    if (!args.includes('--no-signals')) {
      const t = Date.now()
      const s = await ensureSignals(userData, w.id, { force: args.includes('--force'), log })
      out(`signals:    heatmap ${s.heatmap.points ? `${s.heatmap.points.length} points` : 'none'}${s.heatmap.error ? ` (error: ${s.heatmap.error})` : ''}, sponsorblock ${s.sponsorblock.segments.length} segment(s)${s.sponsorblock.error ? ` (error: ${s.sponsorblock.error})` : ''} — ${((Date.now() - t) / 1000).toFixed(1)} s`)
    }
    if (args.includes('--signals-only')) return 0
    const responses = values(args, '--response').map(expand)
    const r = await analyze(sidecar, { userData, model: values(args, '--model')[0], force: args.includes('--force'), responses: responses.length ? responses : undefined, log })
    const a = r.analysis
    if (args.includes('--json')) { out(JSON.stringify(a, null, 1)); return 0 }
    out(`video:      ${a.title} (${a.videoId})`)
    out(`file:       ${analysisPath(userData, a.videoId)}`)
    out(`took:       ${r.reused ? 'cached' : `${(r.ms / 1000).toFixed(1)} s total, model ${(a.elapsedMs / 1000).toFixed(1)} s, ${a.chunks} call(s)`}`)
    out(`highlights: ${a.highlights.length} · pull quotes ${a.pullQuotes.length} · questions ${a.questions.length} · claims ${a.claims.length} · flashcards ${a.mochiCandidates.length} · repairs ${a.repairs.length}`)
    for (const h of a.highlights.slice(0, 5)) {
      const text = spanText(w, h)
      out(`  ${clock(h.t0)}–${clock(h.t1)} [${h.why} ${h.score}] label: ${h.label} — “${text.length > 110 ? text.slice(0, 108) + '…' : text}”`)
    }
    return 0
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
