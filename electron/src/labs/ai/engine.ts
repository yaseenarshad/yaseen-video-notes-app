/**
 * Labs' ONE AI engine: every Labs AI feature (the analysis, notes-view's AI notes, ask-the-video, feed-triage's pull
 * quotes through the analysis) asks through `askAI(prompt, opts)` and gets the model's text back. Validators and checks
 * stay with the callers, whatever the engine.
 *
 * Engines (Labs setting `labsAi.engine`, default Codex; `VIDEO_NOTES_AI_ENGINE` / `_MODEL` / `_EFFORT` override for
 * the CLI and tools):
 * - **codex** (default; the user's ChatGPT subscription, model `gpt-6.1-sol`):
 *     codex exec -m <model> -s read-only -C <tmp> --skip-git-repo-check --ephemeral --json \
 *       -c model_reasoning_effort="<effort>" -o <tmp>/last.txt [--output-schema <tmp>/schema.json] -  < prompt
 *   the prompt (system text first) on stdin; the answer = last.txt; events.jsonl (stdout) gives `turn.completed`
 *   usage and `turn.failed` / `error` messages; stderr is noise when the exit code is 0. `-s read-only` and `-m` always;
 *   `~/.codex/config.toml` is never touched. `--output-schema` (strict JSON schema) where the answer is JSON.
 * - **claude**: `claude -p` exactly as before (analysis/claude.ts), for when the user logs in.
 *
 * Errors are AIError with a kind the UI can explain: usage_limit (pause auto jobs), login ("run `codex login`" /
 * "`claude` → /login"), model (not supported), missing (CLI not found), timeout, failed.
 */
import { spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { toolEnv } from '../../core/ytdlpUpdate'
import { ClaudeError, findClaude, runClaude } from '../analysis/claude'

export type EngineName = 'codex' | 'claude'
export type Effort = 'low' | 'medium' | 'high'
export interface EngineConfig { engine: EngineName; model: string; effort: Effort }
export const DEFAULT_ENGINE: EngineConfig = { engine: 'codex', model: 'gpt-6.1-sol', effort: 'medium' }

export interface AskOptions {
  /** System instructions (claude: --system-prompt; codex: put first in the prompt). */
  system?: string
  /** A strict JSON schema of the answer (codex: --output-schema; claude: ignored — its prompt says the shape). */
  schema?: Record<string, unknown>
  timeoutMs?: number
  effort?: Effort
  log?: (line: string) => void
}

export interface AIUsage { input: number; cached: number; output: number; reasoning: number }
export interface AIResult { text: string; ms: number; engine: EngineName; model: string; usage: AIUsage | null; costUsd: number | null; models: string[] }

export type AIErrorKind = 'usage_limit' | 'login' | 'model' | 'missing' | 'timeout' | 'failed'
export class AIError extends Error {
  constructor(message: string, readonly kind: AIErrorKind, readonly engine: EngineName) { super(message); this.name = 'AIError' }
}

// ---------- configuration ----------

const envConfig = (): Partial<EngineConfig> => {
  const e = process.env.VIDEO_NOTES_AI_ENGINE, m = process.env.VIDEO_NOTES_AI_MODEL, f = process.env.VIDEO_NOTES_AI_EFFORT
  return {
    ...(e === 'codex' || e === 'claude' ? { engine: e } : {}),
    ...(m ? { model: m } : {}),
    ...(f === 'low' || f === 'medium' || f === 'high' ? { effort: f } : {}),
  }
}
let config: EngineConfig = { ...DEFAULT_ENGINE, ...envConfig() }

/** The app sets this from Labs' settings (start + every change); the environment wins (tests, tools). */
export function setEngineConfig(c: Partial<EngineConfig>): EngineConfig {
  config = { ...DEFAULT_ENGINE, ...c, ...envConfig() }
  if (!config.model.trim()) config.model = DEFAULT_ENGINE.model
  return config
}
export const engineConfig = (): EngineConfig => ({ ...config })

/** "Codex · gpt-6.1-sol" / "Claude" — for chips and logs. */
export const engineLabel = (c: EngineConfig = config): string => (c.engine === 'codex' ? `Codex · ${c.model}` : 'Claude')

const isExec = (p: string): boolean => { try { accessSync(p, constants.X_OK); return statSync(p).isFile() } catch { return false } }

/** `VIDEO_NOTES_CODEX`, else ~/.local/bin, /opt/homebrew/bin, /usr/local/bin. */
export function findCodex(): string | null {
  const env = process.env.VIDEO_NOTES_CODEX
  if (env && isExec(env)) return env
  return [join(homedir(), '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex'].find(isExec) ?? null
}

/** Whether the configured engine's CLI exists (logged in or not is only known by trying). */
export function engineAvailable(c: EngineConfig = config): { ok: boolean; reason: string | null; label: string } {
  if (stub) return { ok: true, reason: null, label: 'stub' }
  const found = c.engine === 'codex' ? findCodex() : findClaude()
  return found ? { ok: true, reason: null, label: engineLabel(c) } : { ok: false, reason: `the ${c.engine} command was not found`, label: engineLabel(c) }
}

/** The message the UI shows for an AIError. */
export function explain(e: unknown): string {
  if (!(e instanceof AIError)) return e instanceof Error ? e.message : String(e)
  const cli = e.engine === 'codex' ? 'Codex' : 'Claude'
  switch (e.kind) {
    case 'usage_limit': return `${cli} usage limit reached — AI jobs are paused. ${e.message}`
    case 'login': return e.engine === 'codex' ? 'Codex is not signed in — run `codex login` in a terminal, then try again.' : 'Claude is not logged in — run `claude` in a terminal and /login, then try again.'
    case 'model': return `${cli}: the model "${config.model}" is not supported — pick another one in 🧪 Labs. (${e.message})`
    case 'missing': return `The ${e.engine} command was not found.`
    default: return `${cli}: ${e.message}`
  }
}

// ---------- AI jobs policy: write automatically, paused after a usage limit ----------

let autoWrite = true
let paused: { reason: string; at: number } | null = null
const policyListeners = new Set<() => void>()
const notify = () => policyListeners.forEach((f) => { try { f() } catch { /* a listener */ } })

/** Labs setting "Write AI notes automatically when I open a video" (default on); the app sets it. */
export function setAutoWrite(on: boolean): void { if (autoWrite !== on) { autoWrite = on; notify() } }
export const autoWriteOn = (): boolean => autoWrite
/** After a usage limit every automatic job stops until the user starts one by hand (or the app restarts). */
export function pauseAI(reason: string): void { if (!paused) { paused = { reason, at: Date.now() }; notify() } }
export function resumeAI(): void { if (paused) { paused = null; notify() } }
export const aiPaused = (): { reason: string; at: number } | null => paused
/** Called when the policy changes (auto off, paused, resumed). → unsubscribe */
export function onPolicyChange(fn: () => void): () => void { policyListeners.add(fn); return () => { policyListeners.delete(fn) } }

// ---------- the one entry point ----------

type AskImpl = (prompt: string, opts: AskOptions, c: EngineConfig) => Promise<AIResult>
let stub: AskImpl | null = null
/** Tests: replace the engine (null = the real one). */
export function setAskStub(fn: AskImpl | null): void { stub = fn }

export async function askAI(prompt: string, opts: AskOptions = {}): Promise<AIResult> {
  const c = engineConfig()
  if (stub) return stub(prompt, opts, c)
  return c.engine === 'codex' ? runCodex(prompt, opts, c) : runClaudeEngine(prompt, opts, c)
}

async function runClaudeEngine(prompt: string, opts: AskOptions, c: EngineConfig): Promise<AIResult> {
  try {
    const r = await runClaude(prompt, { system: opts.system, timeoutMs: opts.timeoutMs, log: opts.log })
    return { text: r.text, ms: r.ms, engine: 'claude', model: r.models.join('+') || 'claude', usage: null, costUsd: r.costUsd, models: r.models }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (!(e instanceof ClaudeError)) throw e
    throw new AIError(m, /not found/i.test(m) ? 'missing' : /log ?in|logged out|auth|oauth|credential/i.test(m) ? 'login' : /usage limit|rate limit/i.test(m) ? 'usage_limit' : /took longer/i.test(m) ? 'timeout' : 'failed', 'claude')
  }
}

/** codex exec's JSONL events → usage, failure message. */
export function readCodexEvents(jsonl: string): { usage: AIUsage | null; failure: string | null } {
  let usage: AIUsage | null = null, failure: string | null = null
  for (const line of jsonl.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let ev: { type?: string; usage?: Record<string, number>; error?: { message?: string } | string; message?: string }
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type === 'turn.completed' && ev.usage) {
      const u = ev.usage
      usage = { input: u.input_tokens ?? 0, cached: u.cached_input_tokens ?? 0, output: u.output_tokens ?? 0, reasoning: u.reasoning_output_tokens ?? 0 }
    }
    if (ev.type === 'turn.failed' || ev.type === 'error') {
      const m = typeof ev.error === 'string' ? ev.error : ev.error?.message ?? ev.message
      if (m) failure = m
    }
  }
  return { usage, failure }
}

/** A codex failure message → the kind the UI explains. */
export function codexErrorKind(message: string): AIErrorKind {
  if (/usage_limit_reached|usage limit|hit your usage/i.test(message)) return 'usage_limit'
  if (/\b401\b|unauthori[sz]ed|not signed in|sign in|log ?in|login|expired.*token|refresh token/i.test(message)) return 'login'
  if (/model.*(not supported|unsupported|does not exist|not found|not available)/i.test(message)) return 'model'
  return 'failed'
}

export const codexArgs = (c: EngineConfig, dir: string, effort: Effort, schemaFile: string | null): string[] => [
  'exec', '-m', c.model, '-s', 'read-only', '-C', dir, '--skip-git-repo-check', '--ephemeral', '--json',
  '-c', `model_reasoning_effort="${effort}"`, '-o', join(dir, 'last.txt'),
  ...(schemaFile ? ['--output-schema', schemaFile] : []),
  '-',
]

function runCodex(prompt: string, opts: AskOptions, c: EngineConfig): Promise<AIResult> {
  const bin = findCodex()
  if (!bin) return Promise.reject(new AIError('The codex command was not found (looked in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin; VIDEO_NOTES_CODEX overrides).', 'missing', 'codex'))
  const log = opts.log ?? (() => {})
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000
  const dir = mkdtempSync(join(tmpdir(), 'vn-codex-'))
  let schemaFile: string | null = null
  if (opts.schema) { schemaFile = join(dir, 'schema.json'); writeFileSync(schemaFile, JSON.stringify(opts.schema)) }
  const full = opts.system ? `# Instructions\n\n${opts.system}\n\n# Task\n\n${prompt}` : prompt
  const t0 = Date.now()
  return new Promise<AIResult>((resolve, reject) => {
    const p = spawn(bin, codexArgs(c, dir, opts.effort ?? c.effort, schemaFile), { env: toolEnv(), cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    const done = (f: () => void) => { clearTimeout(timer); f(); try { rmSync(dir, { recursive: true, force: true }) } catch { /* tmp */ } }
    const timer = setTimeout(() => { p.kill('SIGTERM'); done(() => reject(new AIError(`codex took longer than ${Math.round(timeoutMs / 60_000)} min; stopped`, 'timeout', 'codex'))) }, timeoutMs)
    p.stdout.on('data', (b: Buffer) => { out += b.toString('utf8') })
    p.stderr.on('data', (b: Buffer) => { err += b.toString('utf8') })
    p.on('error', (e) => done(() => reject(new AIError(`Could not run codex: ${e.message}`, 'failed', 'codex'))))
    p.on('close', (code) => {
      const ms = Date.now() - t0
      const ev = readCodexEvents(out)
      let text = ''
      try { text = readFileSync(join(dir, 'last.txt'), 'utf8') } catch { /* no answer */ }
      const u = ev.usage
      log(`codex ${c.model} exit ${code} after ${(ms / 1000).toFixed(1)} s${u ? `, tokens in ${u.input} (cached ${u.cached}) out ${u.output} (reasoning ${u.reasoning})` : ''}`)
      if (code === 0 && text.trim()) return done(() => resolve({ text, ms, engine: 'codex', model: c.model, usage: u, costUsd: null, models: [c.model] }))
      const msg = ev.failure ?? (err.split('\n').filter((l) => /error|usage|limit|401|login|model/i.test(l) && !/failed to load skill|rmcp::/i.test(l)).slice(-3).join(' ') || `codex exited ${code}`)
      done(() => reject(new AIError(msg.slice(0, 600), codexErrorKind(msg), 'codex')))
    })
    p.stdin.on('error', () => { /* ended early: reported on close */ })
    p.stdin.end(full)
  })
}
