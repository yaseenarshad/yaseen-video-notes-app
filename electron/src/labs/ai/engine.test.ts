import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AIError, askAI, codexArgs, codexErrorKind, explain, readCodexEvents, setAskStub, setEngineConfig, DEFAULT_ENGINE, engineConfig } from './engine'
import { ANALYSIS_SCHEMA, ASK_SCHEMA, dropNulls } from './schemas'

/** A stand-in `codex` CLI: echoes what it got into last.txt, or fails like the real one. */
function fakeCodex(mode: 'ok' | 'usage' | 'login' | 'model'): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-codex-'))
  const bin = join(dir, 'codex')
  writeFileSync(bin, `#!/bin/sh
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
input=$(cat)
echo "noise on stderr" >&2
case "${mode}" in
  ok) printf '%s' "ARGS: $* | INPUT: $input" > "$out"
      echo '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":20,"output_tokens":7,"reasoning_output_tokens":3}}'; exit 0 ;;
  usage) echo '{"type":"turn.failed","error":{"message":"usage_limit_reached: try again in 3 hours"}}'; exit 1 ;;
  login) echo '{"type":"error","message":"unexpected status 401 Unauthorized"}'; exit 1 ;;
  model) echo '{"type":"turn.failed","error":{"message":"The model gpt-x is not supported when using Codex with a ChatGPT account."}}'; exit 1 ;;
esac
`)
  chmodSync(bin, 0o755)
  return bin
}

afterEach(() => { setAskStub(null); delete process.env.VIDEO_NOTES_CODEX; setEngineConfig(DEFAULT_ENGINE) })

describe('the Labs AI engine', () => {
  it('defaults to Codex with gpt-6.1-sol', () => {
    expect(engineConfig()).toMatchObject({ engine: 'codex', model: 'gpt-6.1-sol' })
  })

  it('builds the codex command: model, read-only sandbox, ephemeral, JSON events, -o, schema, prompt on stdin', () => {
    expect(codexArgs({ engine: 'codex', model: 'gpt-6.1-sol', effort: 'medium' }, '/tmp/x', 'low', '/tmp/x/schema.json')).toEqual([
      'exec', '-m', 'gpt-6.1-sol', '-s', 'read-only', '-C', '/tmp/x', '--skip-git-repo-check', '--ephemeral', '--json',
      '-c', 'model_reasoning_effort="low"', '-o', '/tmp/x/last.txt', '--output-schema', '/tmp/x/schema.json', '-',
    ])
  })

  it('reads usage and failures from the JSONL events; classifies the errors the UI explains', () => {
    const ev = readCodexEvents('{"type":"thread.started"}\nnot json\n{"type":"turn.completed","usage":{"input_tokens":24778,"cached_input_tokens":13184,"output_tokens":5,"reasoning_output_tokens":0}}\n')
    expect(ev).toEqual({ usage: { input: 24778, cached: 13184, output: 5, reasoning: 0 }, failure: null })
    expect(readCodexEvents('{"type":"turn.failed","error":{"message":"usage_limit_reached"}}').failure).toBe('usage_limit_reached')
    expect(codexErrorKind('usage_limit_reached')).toBe('usage_limit')
    expect(codexErrorKind('unexpected status 401 Unauthorized')).toBe('login')
    expect(codexErrorKind('The model gpt-x is not supported')).toBe('model')
    expect(codexErrorKind('stream disconnected')).toBe('failed')
    expect(explain(new AIError('x', 'login', 'codex'))).toContain('codex login')
  })

  it('runs a codex CLI end to end: system first, prompt on stdin, the answer from -o, usage; stderr noise ignored', async () => {
    process.env.VIDEO_NOTES_CODEX = fakeCodex('ok')
    setEngineConfig({ engine: 'codex', model: 'gpt-6.1-sol', effort: 'medium' })
    const r = await askAI('the prompt', { system: 'be brief', schema: ASK_SCHEMA })
    expect(r.engine).toBe('codex')
    expect(r.usage).toEqual({ input: 120, cached: 20, output: 7, reasoning: 3 })
    expect(r.text).toContain('-m gpt-6.1-sol -s read-only')
    expect(r.text).toContain('--output-schema')
    expect(r.text).toContain('INPUT: # Instructions\n\nbe brief\n\n# Task\n\nthe prompt')
  })

  it('a usage limit, a sign-in problem and an unsupported model become AIError kinds', async () => {
    setEngineConfig({ engine: 'codex', model: 'gpt-6.1-sol', effort: 'low' })
    for (const [mode, kind] of [['usage', 'usage_limit'], ['login', 'login'], ['model', 'model']] as const) {
      process.env.VIDEO_NOTES_CODEX = fakeCodex(mode)
      await expect(askAI('p')).rejects.toMatchObject({ kind, engine: 'codex' })
    }
  })

  it('the stub replaces the engine (tests of the callers)', async () => {
    setAskStub(async (p, o, c) => ({ text: `stub:${p}:${o.system ?? ''}:${c.model}`, ms: 1, engine: c.engine, model: c.model, usage: null, costUsd: null, models: [] }))
    expect((await askAI('x', { system: 's' })).text).toBe('stub:x:s:gpt-6.1-sol')
  })

  it('schemas are strict (closed objects, every key required); nulls of optional fields are dropped again', () => {
    const closed = (s: Record<string, unknown>): boolean => {
      if (s.type === 'object') {
        const props = s.properties as Record<string, Record<string, unknown>>
        return s.additionalProperties === false && JSON.stringify(Object.keys(props)) === JSON.stringify(s.required) && Object.values(props).every(closed)
      }
      if (s.items) return closed(s.items as Record<string, unknown>)
      return true
    }
    expect(closed(ANALYSIS_SCHEMA)).toBe(true)
    expect(closed(ASK_SCHEMA)).toBe(true)
    expect(dropNulls('{"questions":[{"q":[1,2,1,5],"a":null,"aFirst":null}]}')).toBe('{"questions":[{"q":[1,2,1,5]}]}')
    expect(dropNulls('not json')).toBe('not json')
  })
})
