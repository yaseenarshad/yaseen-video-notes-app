// The Labs registry (every experiment folder is complete), the signals parsers and the claude CLI wrapper.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeEnv, parseResult } from './analysis/claude'
import { EXPERIMENTS, registryProblems } from './registry'
import { parseHeatmap, parseSponsorBlock, sponsorBlockURL, trimInfo } from './signals'

describe('registry', () => {
  it('has no problems, and every experiment folder has the files its area needs', () => {
    expect(registryProblems()).toEqual([])
    const dir = join(__dirname, 'experiments')
    const folders = readdirSync(dir).filter((n) => !n.startsWith('.'))
    expect(EXPERIMENTS.map((e) => e.id).sort()).toEqual(folders.sort())
    for (const e of EXPERIMENTS) {
      const need = e.area === 'player' ? 'player.js' : 'renderer.tsx'
      expect(existsSync(join(dir, e.id, need)), `${e.id}/${need}`).toBe(true)
    }
  })
})

describe('signals', () => {
  it('reads the yt-dlp heatmap', () => {
    expect(parseHeatmap({})).toBeNull()
    expect(parseHeatmap({ heatmap: [{ start_time: 10, end_time: 20, value: 0.51234 }, { start_time: 0, end_time: 10, value: 1 }] }))
      .toEqual([{ start: 0, end: 10, value: 1 }, { start: 10, end: 20, value: 0.512 }])
  })

  it('reads SponsorBlock segments', () => {
    const json = [{ category: 'sponsor', actionType: 'skip', segment: [120.5, 180], UUID: 'u1', votes: 3 }, { category: 'intro', segment: [0, 12], UUID: 'u2', votes: 0 }, { bad: 1 }]
    expect(parseSponsorBlock(json)).toEqual([{ category: 'intro', start: 0, end: 12, votes: 0, uuid: 'u2' }, { category: 'sponsor', start: 120.5, end: 180, votes: 3, uuid: 'u1' }])
    expect(parseSponsorBlock({ message: 'Not Found' })).toEqual([])
    expect(sponsorBlockURL('abcDEF12345')).toBe('https://sponsor.ajay.app/api/skipSegments?videoID=abcDEF12345&categories=%5B%22sponsor%22%2C%22intro%22%2C%22outro%22%2C%22selfpromo%22%2C%22interaction%22%5D')
  })

  it('keeps only the useful parts of an info json', () => {
    expect(trimInfo({ id: 'x', formats: [1, 2], heatmap: [], description: 'd' })).toEqual({ id: 'x', heatmap: [], description: 'd' })
  })
})

describe('claude -p', () => {
  it('runs without tools, hooks or session files', () => {
    expect(claudeArgs({ system: 'S', model: 'm' })).toEqual(['-p', '--output-format', 'json', '--tools', '', '--safe-mode', '--no-session-persistence', '--disable-slash-commands', '--system-prompt', 'S', '--model', 'm'])
  })

  it('reads the JSON result and its errors', () => {
    expect(parseResult('{"type":"result","is_error":false,"result":"{\\"a\\":1}","total_cost_usd":0.12,"modelUsage":{"claude-x":{}}}'))
      .toEqual({ text: '{"a":1}', costUsd: 0.12, models: ['claude-x'], error: null })
    expect(parseResult('{"type":"result","is_error":true,"result":"Failed to authenticate: OAuth session expired"}').error).toMatch(/OAuth/)
    expect(parseResult('garbage').error).toMatch(/unexpected output/)
  })

  it('does not pass a parent Claude Code session to the child', () => {
    process.env.CLAUDECODE = '1'; process.env.CLAUDE_CODE_ENTRYPOINT = 'x'; process.env.CLAUDE_CODE_OAUTH_TOKEN = 't'
    const env = claudeEnv()
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('t')
    delete process.env.CLAUDECODE; delete process.env.CLAUDE_CODE_ENTRYPOINT; delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  })
})
