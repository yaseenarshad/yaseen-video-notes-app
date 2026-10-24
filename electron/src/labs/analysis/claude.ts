import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { toolEnv } from '../../core/ytdlpUpdate'

/**
 * Runs the Claude Code CLI non-interactively: `claude -p --output-format json --tools "" --safe-mode
 * --no-session-persistence --system-prompt …`, the prompt on stdin (a 2 h transcript is too big for argv).
 * - `--tools ""`: no tools at all (it only reads the prompt and answers).
 * - `--safe-mode`: none of the user's hooks, plugins, MCP servers or CLAUDE.md (fast, and nothing else runs).
 * - default model unless `model` is given.
 * The JSON result's `result` is the model's text; `is_error` (e.g. "Not logged in", "OAuth session expired")
 * becomes a ClaudeError with that message.
 */
export class ClaudeError extends Error {
  constructor(message: string) { super(message); this.name = 'ClaudeError' }
}

export interface ClaudeOptions {
  bin?: string
  model?: string
  system?: string
  timeoutMs?: number
  log?: (line: string) => void
}

export interface ClaudeResult { text: string; ms: number; costUsd: number | null; models: string[] }

const isExec = (p: string): boolean => { try { accessSync(p, constants.X_OK); return statSync(p).isFile() } catch { return false } }

/** `VIDEO_NOTES_CLAUDE`, else ~/.local/bin/claude, /opt/homebrew/bin/claude, /usr/local/bin/claude. */
export function findClaude(): string | null {
  const env = process.env.VIDEO_NOTES_CLAUDE
  if (env && isExec(env)) return env
  return [join(homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(isExec) ?? null
}

/** The environment for the child: PATH with Homebrew; no variables of a Claude Code session we may run inside. */
export function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...toolEnv() }
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || (k.startsWith('CLAUDE_CODE_') && k !== 'CLAUDE_CODE_OAUTH_TOKEN' && k !== 'CLAUDE_CODE_USE_BEDROCK' && k !== 'CLAUDE_CODE_USE_VERTEX')) delete env[k]
  }
  return env
}

export const claudeArgs = (o: ClaudeOptions): string[] => [
  '-p', '--output-format', 'json', '--tools', '', '--safe-mode', '--no-session-persistence', '--disable-slash-commands',
  ...(o.system ? ['--system-prompt', o.system] : []),
  ...(o.model ? ['--model', o.model] : []),
]

/** Reads the CLI's `--output-format json` result. */
export function parseResult(stdout: string): { text: string; costUsd: number | null; models: string[]; error: string | null } {
  let o: Record<string, unknown>
  try { o = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '') } catch {
    return { text: '', costUsd: null, models: [], error: `unexpected output from claude: ${stdout.slice(0, 300)}` }
  }
  const text = typeof o.result === 'string' ? o.result : ''
  const models = o.modelUsage && typeof o.modelUsage === 'object' ? Object.keys(o.modelUsage) : []
  const costUsd = typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null
  return { text, costUsd, models, error: o.is_error === true ? (text || String(o.subtype ?? 'error')) : null }
}

export function runClaude(prompt: string, opts: ClaudeOptions = {}): Promise<ClaudeResult> {
  const bin = opts.bin ?? findClaude()
  if (!bin) return Promise.reject(new ClaudeError('The claude command was not found (looked in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin; VIDEO_NOTES_CLAUDE overrides).'))
  const log = opts.log ?? (() => {})
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const p = spawn(bin, claudeArgs(opts), { env: claudeEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new ClaudeError(`claude took longer than ${Math.round(timeoutMs / 60_000)} min; stopped`)) }, timeoutMs)
    p.stdout.on('data', (c: Buffer) => { out += c.toString('utf8') })
    p.stderr.on('data', (c: Buffer) => { err += c.toString('utf8') })
    p.on('error', (e) => { clearTimeout(timer); reject(new ClaudeError(`Could not run claude: ${e.message}`)) })
    p.on('close', (code) => {
      clearTimeout(timer)
      const ms = Date.now() - t0
      const r = parseResult(out)
      log(`claude exit ${code} after ${(ms / 1000).toFixed(1)} s${r.costUsd !== null ? `, $${r.costUsd.toFixed(3)}` : ''}${r.models.length ? `, ${r.models.join('+')}` : ''}`)
      if (r.error) {
        const hint = /log ?in|auth|oauth|credential/i.test(r.error) ? ' — run `claude` in a terminal and /login, then try again' : ''
        return reject(new ClaudeError(`claude: ${r.error}${hint}`))
      }
      if (code !== 0 && !r.text) return reject(new ClaudeError(`claude exited ${code}: ${(err || out).trim().slice(0, 500)}`))
      resolve({ text: r.text, ms, costUsd: r.costUsd, models: r.models })
    })
    p.stdin.on('error', () => { /* the process ended early: reported on close */ })
    p.stdin.end(prompt)
  })
}
