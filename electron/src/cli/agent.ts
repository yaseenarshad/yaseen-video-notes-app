import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve as resolvePath } from 'node:path'
import {
  AgentError, checkAgent, claimFile, releaseFile, resolveFile, statusOf, type AgentNote, type Outcome, type Status,
} from '../core/claims'
import { LockTimeout } from '../core/fileLock'
import { DEFAULT_LEASE_MIN, paragraphCount } from '../core/notes'

/**
 * The agent subcommands of the CLI (`video-notes claim | resolve | release | status`): several agents turn
 * `#mochi` notes into flashcards on one transcript at once. JSON on stdout by default, `--text` for people.
 * Exit codes: 0 ok, 2 bad usage, 3 not owner / note not found / changed, 4 lock timeout (file busy ~10 s).
 */

export const AGENT_COMMANDS = ['claim', 'resolve', 'release', 'status'] as const

export const AGENT_USAGE = `video-notes — lets several agents work on one transcript .md at once (the file is locked for every write)
  video-notes claim   <md> --agent <name> [--count 5] [--lease 30] [--all]
        Claims up to N open #mochi notes (--all: general notes too) and prints them as JSON with context
        (paragraph, the ones around it, chapter, video). Your own unexpired claims come first. [] = nothing left.
  video-notes resolve <md> --agent <name> --note <id> [--note <id>…] --done "what you did"
        Marks your claimed notes #resolved and adds "> ↳ resolved by <name>: what you did".
  video-notes release <md> --agent <name> [--note <id>…]
        Drops your claims (all of them without --note).
  video-notes status  <md> [--lease 30]
        Counts (open / claimed by whom / expired / resolved, by category) and the list.
Options: --text (human-readable output instead of JSON).  Names: 1–24 chars of a-z 0-9 -.
Exit codes: 0 ok · 2 bad usage · 3 not yours / note not found or changed · 4 file busy (lock timeout)`

const expand = (p: string): string => resolvePath(p.startsWith('~/') ? homedir() + p.slice(1) : p)

interface Parsed { cmd: string; file: string | null; flags: Map<string, string[]>; bools: Set<string> }

const VALUE_FLAGS = new Set(['--agent', '--count', '--lease', '--note', '--done'])
const BOOL_FLAGS = new Set(['--all', '--text', '--json'])

function parseArgs(args: string[]): Parsed {
  const [cmd, ...rest] = args
  const flags = new Map<string, string[]>(), bools = new Set<string>()
  let file: string | null = null
  for (let i = 0; i < rest.length; i++) {
    let a = rest[i], v: string | undefined
    const eq = a.startsWith('--') ? a.indexOf('=') : -1
    if (eq > 0) { v = a.slice(eq + 1); a = a.slice(0, eq) }
    if (VALUE_FLAGS.has(a)) {
      if (v === undefined) { if (i + 1 >= rest.length) throw new AgentError(`${a} needs a value`, 2); v = rest[++i] }
      flags.set(a, [...(flags.get(a) ?? []), v])
    } else if (BOOL_FLAGS.has(a)) {
      bools.add(a)
    } else if (a.startsWith('--')) {
      throw new AgentError(`unknown option ${a}`, 2)
    } else if (file === null) {
      file = a
    } else {
      throw new AgentError(`unexpected argument ${JSON.stringify(a)}`, 2)
    }
  }
  return { cmd, file, flags, bools }
}

const one = (p: Parsed, name: string): string | null => p.flags.get(name)?.at(-1) ?? null

function positiveNumber(p: Parsed, name: string, dflt: number, int: boolean): number {
  const s = one(p, name)
  if (s === null) return dflt
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0 || (int && !Number.isInteger(n))) throw new AgentError(`${name} must be a positive ${int ? 'whole ' : ''}number`, 2)
  return n
}

function transcript(p: Parsed): string {
  if (p.file === null) throw new AgentError(`${p.cmd} needs the transcript .md path`, 2)
  const f = expand(p.file)
  if (!existsSync(f) || !statSync(f).isFile()) throw new AgentError(`no such file: ${f}`, 2)
  if (paragraphCount(readFileSync(f, 'utf8')) === 0) throw new AgentError(`${f} is not a Yaseen Video Notes transcript (no [m:ss](link) paragraph lines)`, 2)
  return f
}

const first = (s: string, n = 90): string => { const l = s.split('\n')[0]; return l.length > n ? l.slice(0, n - 1) + '…' : l }

function claimText(items: AgentNote[]): string {
  if (!items.length) return 'Nothing left to claim.'
  return items.map((n) => [
    `${n.id}  ${n.clock}  ${n.category === 'mochi' ? '#mochi  ' : ''}${first(n.text, 120)}`,
    ...(n.quote ? [`    “${n.quote}”`] : []),
    `    ${n.link}${n.chapter ? `  (chapter: ${n.chapter})` : ''}`,
    `    paragraph: ${first(n.paragraph, 160)}`,
  ].join('\n')).join('\n')
}

function statusText(s: Status): string {
  const who = Object.entries(s.claimedBy).map(([a, n]) => `${a} ${n}`).join(', ')
  const cat = (k: 'mochi' | 'general'): string => {
    const c = s.byCategory[k]
    return `${k}: ${c.open} open, ${c.claimed} claimed, ${c.expired} expired, ${c.resolved} resolved`
  }
  return [
    `${s.total} notes: ${s.open} open, ${s.claimed} claimed${who ? ` (${who})` : ''}, ${s.expired} expired claims, ${s.resolved} resolved`,
    cat('mochi'), cat('general'), '',
    ...s.notes.map((n) => `${n.id}  ${n.state.padEnd(8)} ${(n.agent ?? n.resolvedBy ?? '').padEnd(10)} ${(n.clock || '-').padEnd(11)} ${n.category === 'mochi' ? '#mochi ' : ''}${first(n.text, 70)}`),
  ].join('\n')
}

function outcomes(key: string, results: Outcome[], text: boolean, out: (s: string) => void, err: (s: string) => void): number {
  const ok = results.filter((r) => r.ok), failed = results.filter((r) => !r.ok)
  for (const f of failed) err(`error: ${f.error}`)
  if (text) out(ok.length ? `${key} ${ok.map((r) => r.id + (r.already ? ' (already)' : '')).join(', ')}` : `${key} nothing`)
  else out(JSON.stringify({ [key]: ok.map((r) => r.id), failed: failed.map((f) => ({ id: f.id, error: f.error })) }, null, 2))
  return failed.length ? 3 : 0
}

/** Runs `claim | resolve | release | status`; returns the exit code. */
export function runAgent(args: string[], out: (s: string) => void, err: (s: string) => void): number {
  try {
    const p = parseArgs(args)
    const text = p.bools.has('--text')
    const lease = positiveNumber(p, '--lease', DEFAULT_LEASE_MIN, false)
    switch (p.cmd) {
      case 'claim': {
        const file = transcript(p), agent = checkAgent(one(p, '--agent'))
        const items = claimFile(file, agent, { count: positiveNumber(p, '--count', 5, true), leaseMin: lease, all: p.bools.has('--all') })
        out(text ? claimText(items) : JSON.stringify(items, null, 2))
        return 0
      }
      case 'resolve': {
        const file = transcript(p), agent = checkAgent(one(p, '--agent'))
        const ids = p.flags.get('--note') ?? []
        const done = (one(p, '--done') ?? '').trim()
        if (!ids.length) throw new AgentError('resolve needs --note <id> (one or more)', 2)
        if (!done) throw new AgentError('resolve needs --done "what you did"', 2)
        return outcomes('resolved', resolveFile(file, agent, ids, done), text, out, err)
      }
      case 'release': {
        const file = transcript(p), agent = checkAgent(one(p, '--agent'))
        const ids = p.flags.get('--note') ?? null
        return outcomes('released', releaseFile(file, agent, ids), text, out, err)
      }
      case 'status': {
        const file = transcript(p)
        const s = statusOf(readFileSync(file, 'utf8'), Date.now(), lease)
        out(text ? statusText(s) : JSON.stringify(s, null, 2))
        return 0
      }
      default:
        err(AGENT_USAGE)
        return 2
    }
  } catch (e) {
    if (e instanceof AgentError) { err(`error: ${e.message}`); if (e.code === 2) err('(video-notes --help for usage)'); return e.code }
    if (e instanceof LockTimeout) { err(`error: ${e.message}`); return 4 }
    err(`error: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
