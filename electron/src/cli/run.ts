import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { format, make } from '../core/folderMaker'
import * as Notes from '../core/notes'
import { migrateFolder, migrationText } from '../core/statusMigrate'
import { decodeSidecar, folderName, parseInfoJSON, wordCount } from '../core/transcript'
import { AGENT_COMMANDS, AGENT_USAGE, runAgent } from './agent'

export const MIGRATE_USAGE = `  video-notes migrate-status <folder> [--dry-run]
        Moves a folder of video folders (like learning-log) from the old statuses (1-To-Watch, 2-Watching,
        3-Watched, 4-Carded) to yaseen-docs-app's (1-Backlog, 2-Todo, 3-In-Progress, 4-Done): the .folder.md
        options (only when exactly the old set) and each transcript's value. Prints what changed. Safe to rerun.`

export const USAGE = `USAGE:
  Yaseen Video Notes                                   Open the app.
  Yaseen Video Notes --open <folder or .md>            Open the app with that transcript (test mode: tabs / Recent untouched).
  Yaseen Video Notes --make <youtube url> --out <dir>  Make the transcript folder (no UI) and print a summary.
  Yaseen Video Notes --format <file.vtt> --info <file.info.json> [--md <out.md>]
                                                       Format captions offline and print a summary.
  npm run cli -- <same flags>                          The same CLI as plain Node (from electron/).
OPTIONS:
  --debug-log <path>   Write player events (time, rate, quality, keys, notes) to <path>.
                       Same as the VIDEO_NOTES_DEBUG_LOG environment variable.

AGENTS (the \`video-notes\` command runs this CLI without the app's window):
${AGENT_USAGE.split('\n').slice(1).join('\n')}

STATUS MIGRATION:
${MIGRATE_USAGE}`

const expand = (p: string): string => resolve(p.startsWith('~/') ? homedir() + p.slice(1) : p)
/** Like Swift's `standardizedFileURL`: /private/tmp → /tmp (only the printed paths). */
const shown = (p: string): string => p.replace(/^\/private\/(tmp|var|etc)\//, '/$1/')

export function flag(args: string[], name: string): string | null {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null
}

/** True when the args ask for a CLI mode (no UI). */
export const isCLI = (args: string[]): boolean =>
  (AGENT_COMMANDS as readonly string[]).includes(args[0] ?? '') || args[0] === 'migrate-status' || args.includes('--help') || args.includes('-h') || flag(args, '--make') !== null || flag(args, '--format') !== null

/** Runs a CLI mode and returns the exit code. */
export async function runCLI(args: string[], out: (s: string) => void = (s) => process.stdout.write(s + '\n'),
  err: (s: string) => void = (s) => process.stderr.write(s + '\n')): Promise<number> {
  if ((AGENT_COMMANDS as readonly string[]).includes(args[0] ?? '')) return runAgent(args, out, err)
  if (args[0] === 'migrate-status') return migrateCLI(args.slice(1), out, err)
  if (args.includes('--help') || args.includes('-h')) { out(USAGE); return 0 }
  const url = flag(args, '--make')
  if (url !== null) {
    const dir = flag(args, '--out')
    if (dir === null) { err('error: --make needs --out <dir>'); return 2 }
    try {
      const r = await make(url, expand(dir), { progress: (l) => err(`  ${l}`) })
      const md = readFileSync(r.markdown, 'utf8')
      const side = decodeSidecar(readFileSync(r.sidecar, 'utf8'))
      out(`folder:     ${shown(r.folder)}`)
      out(`markdown:   ${shown(r.markdown)}`)
      out(`sidecar:    ${shown(r.sidecar)}`)
      out(`reused:     ${r.reused}`)
      out(`paragraphs: ${Notes.paragraphCount(md)}`)
      out(`words:      ${wordCount(side)}`)
      out(`turns:      ${side.paras.filter((p) => p.turn).length}`)
      out(`notes:      ${Notes.parse(md).length}`)
      return 0
    } catch (e) {
      err(`error: ${e instanceof Error ? e.message : String(e)}`)
      return 1
    }
  }
  const vtt = flag(args, '--format')
  if (vtt !== null) {
    const info = flag(args, '--info')
    if (info === null) { err('error: --format needs --info <file.info.json>'); return 2 }
    try {
      const i = parseInfoJSON(readFileSync(expand(info), 'utf8'))
      const made = format(i, readFileSync(expand(vtt), 'utf8'))
      const mdOut = flag(args, '--md')
      if (mdOut !== null) writeFileSync(expand(mdOut), made.markdown)
      out(`title:      ${i.title}`)
      out(`folder:     ${folderName(i.title)}`)
      out(`paragraphs: ${made.paragraphs.length}`)
      out(`words:      ${wordCount(made.sidecar)}`)
      out(`turns:      ${made.paragraphs.filter((p) => p.turn).length}`)
      return 0
    } catch (e) {
      err(`error: ${e instanceof Error ? e.message : String(e)}`)
      return 1
    }
  }
  out(USAGE)
  return 2
}

/** `migrate-status <folder> [--dry-run]`: exit 0 ok, 1 some file could not be changed, 2 bad usage. */
function migrateCLI(args: string[], out: (s: string) => void, err: (s: string) => void): number {
  const dryRun = args.includes('--dry-run') || args.includes('-n')
  const rest = args.filter((a) => a !== '--dry-run' && a !== '-n')
  const bad = rest.find((a) => a.startsWith('-'))
  if (bad || rest.length !== 1) { err(bad ? `error: unknown option ${bad}` : 'error: migrate-status needs one <folder>'); err(MIGRATE_USAGE); return 2 }
  const folder = expand(rest[0])
  if (!existsSync(folder) || !statSync(folder).isDirectory()) { err(`error: not a folder: ${folder}`); return 2 }
  try {
    const m = migrateFolder(folder, dryRun)
    out(migrationText(m))
    return m.errors.length ? 1 : 0
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
