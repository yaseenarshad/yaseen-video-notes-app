import { join } from 'node:path'
import { loadWords } from '../../analysis/analyze'
import { AIError, askAI, engineAvailable, explain } from '../../ai/engine'
import { ASK_SCHEMA, dropNulls } from '../../ai/schemas'
import { chunks, retryPrompt } from '../../analysis/prompt'
import { InvalidAnswer, parseAnswer } from '../../analysis/validate'
import { defineMainHooks, type LabsVideoContext } from '../../hooks'
import { cacheDir, readJSON, writeCache } from '../../store'
import { askCacheName, askPrompt, ASK_SYSTEM, isLoginError, mergePassages, validatePassages, type AskPassage } from './ai'

/**
 * Routes for the player page (`/labs/x/ask-the-video/<path>`):
 * - GET  `status` → { available, reason }: can the AI engine be tried (the Labs engine's CLI found — Codex by
 *   default, ai/engine.ts — and not known to be logged out)
 * - POST `ask` { q, retry? } → { ok: true, engine: 'ai', passages, ms, cached } | { ok: false, loginNeeded, error }
 * Answers are cached in Labs' userData (`labs-cache/<videoId>/ask-<hash>.json`), never the vault.
 * After a login error the engine is skipped for 10 minutes (the page shows keyword matches) unless `retry`.
 */
export interface AskResult {
  ok: boolean
  engine: 'ai'
  passages?: AskPassage[]
  ms?: number
  cached?: boolean
  models?: string[]
  repairs?: string[]
  loginNeeded?: boolean
  error?: string
}

const BLOCK_MS = 10 * 60_000
let blocked: { until: number; reason: string } | null = null
const running = new Map<string, Promise<AskResult>>()

function status(): { available: boolean; reason: string | null } {
  const eng = engineAvailable()
  if (!eng.ok) return { available: false, reason: eng.reason }
  if (blocked && blocked.until > Date.now()) return { available: false, reason: blocked.reason }
  return { available: true, reason: null }
}

async function ask(ctx: LabsVideoContext, q: string, retry: boolean): Promise<AskResult> {
  const w = loadWords(ctx.sidecar)
  const name = askCacheName(w, q)
  const hit = readJSON<AskResult>(join(cacheDir(ctx.userData, ctx.videoId), name))
  if (hit && hit.ok) return { ...hit, cached: true }
  const st = status()
  if (!st.available && !retry) return { ok: false, engine: 'ai', loginNeeded: true, error: st.reason ?? 'unavailable' }
  const t0 = Date.now(), repairs: string[] = [], models = new Set<string>()
  const cs = chunks(w)
  const parts: AskPassage[][] = []
  try {
    for (let i = 0; i < cs.length; i++) {
      const prompt = askPrompt(w, q, cs[i], cs.length, i)
      const run = (p: string) => askAI(p, { system: ASK_SYSTEM, schema: ASK_SCHEMA, effort: 'low', timeoutMs: 5 * 60_000, log: (l) => ctx.log(`ask-the-video: ${l}`) })
      let res = await run(prompt)
      res.models.forEach((m) => models.add(m))
      let passages: AskPassage[]
      try { passages = validatePassages(w, parseAnswer(dropNulls(res.text)), repairs, cs[i]) } catch (e) {
        if (!(e instanceof InvalidAnswer)) throw e
        ctx.log(`ask-the-video: unusable answer (${e.message}); asking once more`)
        res = await run(retryPrompt(prompt, e.message))
        passages = validatePassages(w, parseAnswer(dropNulls(res.text)), repairs, cs[i])
      }
      parts.push(passages)
    }
  } catch (e) {
    const msg = explain(e)
    ctx.log(`ask-the-video: AI search failed: ${msg}`)
    if ((e instanceof AIError && (e.kind === 'login' || e.kind === 'usage_limit')) || isLoginError(msg)) { blocked = { until: Date.now() + BLOCK_MS, reason: msg }; return { ok: false, engine: 'ai', loginNeeded: true, error: msg } }
    return { ok: false, engine: 'ai', error: msg }
  }
  blocked = null
  const out: AskResult = { ok: true, engine: 'ai', passages: mergePassages(parts), ms: Date.now() - t0, models: [...models], repairs, cached: false }
  try { writeCache(ctx.userData, ctx.videoId, name, JSON.stringify({ ...out, question: q, createdAt: new Date().toISOString() }, null, 1)) } catch (e) { ctx.log(`ask-the-video: cache: ${e}`) }
  ctx.log(`ask-the-video: "${q.slice(0, 80)}" → ${out.passages!.length} passages in ${(out.ms! / 1000).toFixed(1)} s`)
  return out
}

export default defineMainHooks({
  route: async (req, ctx) => {
    if (req.path === 'status') return status()
    if (req.path === 'ask' && req.method === 'POST') {
      let body: { q?: unknown; retry?: unknown }
      try { body = JSON.parse(req.body || '{}') } catch { return { status: 400, type: 'application/json', body: JSON.stringify({ ok: false, error: 'bad body' }) } }
      const q = typeof body.q === 'string' ? body.q.replace(/\s+/g, ' ').trim() : ''
      if (q.length < 2 || q.length > 300) return { status: 400, type: 'application/json', body: JSON.stringify({ ok: false, error: 'the question must be 2–300 characters' }) }
      const key = `${ctx.videoId}\n${q.toLowerCase()}`
      let p = running.get(key)
      if (!p) { p = ask(ctx, q, body.retry === true).finally(() => running.delete(key)); running.set(key, p) }
      return p
    }
    return undefined
  },
})
