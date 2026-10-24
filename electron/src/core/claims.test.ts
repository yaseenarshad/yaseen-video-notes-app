// Several agents on one transcript: #claimed:<agent>@<time> tags, "> ↳ resolved by <agent>: …" lines,
// stable note ids, and the video-notes CLI (claim / resolve / release / status).
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runAgent } from '../cli/agent'
import { agentNotes, claimInText, releaseInText, resolveInText, statusOf, transcriptContext } from './claims'
import { lockPath } from './fileLock'
import { sampleMD } from './fixtures'
import {
  claimExpired, claimStamp, editNote, insert, note, noteId, noteJSON, parse, releaseClaimAt, setCategory, setResolved,
} from './notes'

const temps: string[] = []
afterEach(() => { while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true }) })

const L = 'https://www.youtube.com/watch?v=ID'
const T0 = Date.parse('2026-10-23T14:30:00Z')
const min = (n: number): number => T0 + n * 60_000

const md = `# Video Title

- channel: Chan
- url: ${L}

---

## 0:00 Intro

[0:00](${L}&t=0s) First paragraph.

> 💬 [0:01](${L}&t=1s) #mochi first card
> “First”

> 💬 [0:02](${L}&t=2s) #Mochi #CLAIMED:B2@2026-10-23T13:59Z claimed by b2 long ago

> 💬 [0:03](${L}&t=3s) general note

## 0:11 Second chapter

[0:11](${L}&t=11s) — Second.

> 💬 [0:12–0:14](${L}&t=12s) #mochi #claimed:b2@2026-10-23T14:25Z b2 is on it
> “Second.”

> 💬 [0:13](${L}&t=13s) #mochi #resolved done before
> ↳ resolved: old style line

[0:20](${L}&t=20s) Third.

> 💬 [0:21](${L}&t=21s) #mochi third card
`

describe('claim tags', () => {
  it('parse in any case; written lowercase as #mochi #claimed:… #resolved', () => {
    const n = parse(md)
    expect(n[1].claim).toEqual({ agent: 'b2', at: '2026-10-23T13:59Z' })
    expect(n[1].text).toBe('claimed by b2 long ago')
    expect(n[1].category).toBe('mochi')
    expect(n[3].claim).toEqual({ agent: 'b2', at: '2026-10-23T14:25Z' })
    expect(n[3].quote).toBe('Second.')
    expect(n[0].claim).toBeNull()
    const out = claimInText(md, 'a1', { now: min(0), count: 1 }).md
    expect(out).toContain(`&t=1s) #mochi #claimed:a1@2026-10-23T14:30Z first card\n> “First”`)
    // a malformed claim is note text, not a tag
    expect(parse(insert(sampleMD, 0, 1, '#claimed:Bad Name@x hi'))[0].text).toBe('#claimed:Bad Name@x hi')
  })

  it('a claim on a resolved note is ignored; resolving / the app toggles drop it, edits keep it', () => {
    const both = md.replace('#mochi #resolved done before', '#mochi #claimed:a1@2026-10-23T14:29Z #resolved done before')
    expect(parse(both)[4].claim).toBeNull()
    const n = parse(md)[3]
    const resolved = setResolved(md, 1, 0, n.text, 12, true)
    expect(resolved).toContain(`&t=12s) #mochi #resolved b2 is on it`)
    expect(setCategory(md, 1, 0, n.text, 12, 'general')).toContain(`&t=12s) #claimed:b2@2026-10-23T14:25Z b2 is on it`)
    expect(editNote(md, 1, 0, n.text, 12, 'new words')).toContain(`&t=12s) #mochi #claimed:b2@2026-10-23T14:25Z new words\n> “Second.”`)
    expect(releaseClaimAt(md, 1, 0, n.text, 12)).toBe(md.replace(' #claimed:b2@2026-10-23T14:25Z', ''))
  })

  it('lease: a claim older than the lease (30 min default) is expired', () => {
    const c = { agent: 'a1', at: claimStamp(T0) }
    expect(c.at).toBe('2026-10-23T14:30Z')
    expect(claimExpired(c, min(30))).toBe(false)
    expect(claimExpired(c, min(31))).toBe(true)
    expect(claimExpired(c, min(11), 10)).toBe(true)
    expect(claimExpired({ agent: 'a1', at: 'garbage' }, T0)).toBe(true)
    expect(noteJSON(parse(md)[3], min(0)).claim).toEqual({ agent: 'b2', at: '2026-10-23T14:25Z', expired: false })
    expect(noteJSON(parse(md)[3], min(26)).claim).toEqual({ agent: 'b2', at: '2026-10-23T14:25Z', expired: true })
  })
})

describe('note ids', () => {
  it('are short, stable across claim → resolve, and change when the text is edited', () => {
    const ids = parse(md).map((n) => n.id)
    expect(ids.every((id) => /^[0-9a-z]{7}$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe(noteId(0, 1, 'first card'))
    const claimed = claimInText(md, 'a1', { now: min(0) })
    expect(parse(claimed.md).map((n) => n.id)).toEqual(ids)
    const resolved = resolveInText(claimed.md, 'a1', claimed.ids, 'made card "x" in deck Y').md
    expect(parse(resolved).map((n) => n.id)).toEqual(ids)
    const edited = editNote(md, 0, 0, 'first card', 1, 'first card, edited')
    expect(parse(edited)[0].id).not.toBe(ids[0])
    expect(parse(edited).slice(1).map((n) => n.id)).toEqual(ids.slice(1))
  })

  it('two identical notes get different ids', () => {
    const twice = insert(insert(sampleMD, 0, 1, 'same'), 0, 1, 'same')
    const [a, b] = parse(twice)
    expect(a.id).not.toBe(b.id)
    expect(a).toEqual({ ...note(0, 1, 'same') })
  })
})

describe('resolution lines', () => {
  it('reads the old "> ↳ resolved:" and the new "> ↳ resolved by <agent>:" form', () => {
    const n = parse(md)[4]
    expect(n.resolution).toBe('old style line')
    expect(n.resolvedBy).toBeNull()
    const both = md.replace('> ↳ resolved: old style line', '> ↳ resolved: old style line\n> ↳ Resolved by A-7: newer line')
    expect(parse(both)[4].resolution).toBe('old style line\nnewer line')
    expect(parse(both)[4].resolvedBy).toBe('a-7')
    expect(parse(both)[4].resolutionBy).toEqual([null, 'a-7'])
    expect(noteJSON(parse(both)[4])).toMatchObject({ resolution: 'old style line\nnewer line', resolvedBy: 'a-7', resolutionBy: [null, 'a-7'] })
    expect(parse(md)[4].resolutionBy).toBeNull()
    expect(parse(both)[4].text).toBe('done before')
    // edit keeps both kinds of line
    expect(editNote(both, 1, 1, 'done before', 13, 'changed')).toContain('changed\n> ↳ resolved: old style line\n> ↳ Resolved by A-7: newer line\n')
  })
})

describe('claim / resolve / release (text)', () => {
  it('claim: #mochi only, in file order, expired claims of others are free, valid ones are not', () => {
    const r = claimInText(md, 'a1', { now: min(0), count: 5 })
    const n = parse(md)
    // n[1] is b2's expired claim (30 min old), n[3] b2's valid one, n[2] general, n[4] resolved
    expect(r.ids).toEqual([n[0].id, n[1].id, n[5].id])
    const after = parse(r.md)
    for (const k of [0, 1, 5]) expect(after[k].claim).toEqual({ agent: 'a1', at: '2026-10-23T14:30Z' })
    expect(after[3].claim?.agent).toBe('b2')
    // --all takes general notes too; nothing left → []
    const all = claimInText(r.md, 'c3', { now: min(1), all: true })
    expect(all.ids).toEqual([n[2].id])
    expect(claimInText(all.md, 'd4', { now: min(1), all: true }).ids).toEqual([])
  })

  it('own claims come first and are re-stamped; count limits', () => {
    const one = claimInText(md, 'a1', { now: min(0), count: 1 })
    const again = claimInText(one.md, 'a1', { now: min(10), count: 2 })
    expect(again.ids[0]).toBe(one.ids[0])
    expect(again.ids.length).toBe(2)
    expect(parse(again.md).find((x) => x.id === one.ids[0])!.claim!.at).toBe('2026-10-23T14:40Z')
  })

  it('two agents never get the same note', () => {
    const a = claimInText(md, 'a1', { now: min(0), count: 2 })
    const b = claimInText(a.md, 'b2', { now: min(0), count: 5 })
    expect(b.ids.filter((id) => a.ids.includes(id))).toEqual([])
  })

  it('resolve: only by the owner; drops the claim, adds #resolved and "> ↳ resolved by" before the quote', () => {
    const c = claimInText(md, 'a1', { now: min(0), count: 1 })
    const id = c.ids[0]
    const bad = resolveInText(c.md, 'b2', [id], 'nope')
    expect(bad.md).toBe(c.md)
    expect(bad.results).toEqual([{ id, ok: false, error: `note ${id} is claimed by a1, not b2` }])
    const ok = resolveInText(c.md, 'a1', [id], 'made card "First?" in deck Talks')
    expect(ok.results).toEqual([{ id, ok: true }])
    expect(ok.md).toContain(`&t=1s) #mochi #resolved first card\n> ↳ resolved by a1: made card "First?" in deck Talks\n> “First”\n`)
    const n = parse(ok.md)[0]
    expect([n.resolved, n.claim, n.resolvedBy, n.resolution, n.quote]).toEqual([true, null, 'a1', 'made card "First?" in deck Talks', 'First'])
    // a retry by the same agent is fine (nothing written); anyone else: rejected
    expect(resolveInText(ok.md, 'a1', [id], 'again')).toEqual({ md: ok.md, results: [{ id, ok: true, already: true }] })
    expect(resolveInText(ok.md, 'b2', [id], 'x').results[0].ok).toBe(false)
    // unclaimed, unknown
    const free = parse(md)[5].id
    expect(resolveInText(md, 'a1', [free], 'x').results[0].error).toContain('not claimed by a1')
    expect(resolveInText(md, 'a1', ['zzzzzzz'], 'x').results[0].error).toContain('not found')
  })

  it('resolve: an expired claim of your own is fine; several notes at once; a note without a quote gets the line last', () => {
    const c = claimInText(md, 'a1', { now: min(-60), count: 3 })
    const r = resolveInText(c.md, 'a1', c.ids, 'two\nlines')
    expect(c.ids.length).toBe(2)   // b2's claim from 13:59 was still valid at 13:30
    expect(r.results.map((x) => x.ok)).toEqual([true, true])
    expect(r.md).toContain(`&t=21s) #mochi #resolved third card\n> ↳ resolved by a1: two lines`)
  })

  it('release: own claims only (all, or the given notes)', () => {
    const c = claimInText(md, 'a1', { now: min(0), count: 3 })
    const one = releaseInText(c.md, 'a1', [c.ids[1]])
    expect(parse(one.md).filter((n) => n.claim?.agent === 'a1').map((n) => n.id)).toEqual([c.ids[0], c.ids[2]])
    const all = releaseInText(c.md, 'a1', null)
    expect(all.md).toBe(md.replace('#Mochi #CLAIMED:B2@2026-10-23T13:59Z', '#mochi'))   // b2's expired claim was taken over, then released
    const theirs = parse(md)[3].id
    expect(releaseInText(md, 'a1', [theirs]).results[0]).toEqual({ id: theirs, ok: false, error: `note ${theirs} is not claimed by a1` })
  })

  it('context: paragraph, the ones around it, chapter, video, link', () => {
    const n = parse(md)
    const [item] = agentNotes(md, [n[3].id])
    expect(item).toMatchObject({
      id: n[3].id, time: 12, end: 14, clock: '0:12–0:14', link: `${L}&t=12s`, text: 'b2 is on it', quote: 'Second.', category: 'mochi',
      paragraph: '— Second.', prevParagraph: 'First paragraph.', nextParagraph: 'Third.', chapter: 'Second chapter',
      video: { title: 'Video Title', channel: 'Chan', url: L },
    })
    expect(agentNotes(md, [n[5].id])[0]).toMatchObject({ nextParagraph: null, chapter: 'Second chapter' })
    expect(transcriptContext(sampleMD).paras.map((p) => p.chapter)).toEqual([null, null, null])
  })

  it('status: counts by state, agent and category', () => {
    const s = statusOf(md, min(0))
    expect([s.total, s.open, s.claimed, s.expired, s.resolved]).toEqual([6, 3, 1, 1, 1])
    expect(s.claimedBy).toEqual({ b2: 1 })
    expect(s.byCategory.mochi).toEqual({ open: 2, claimed: 1, expired: 1, resolved: 1 })
    expect(s.byCategory.general).toEqual({ open: 1, claimed: 0, expired: 0, resolved: 0 })
  })
})

describe('video-notes CLI', () => {
  const run = (args: string[]): { code: number; out: string; err: string } => {
    let out = '', err = ''
    const code = runAgent(args, (s) => { out += s + '\n' }, (s) => { err += s + '\n' })
    return { code, out, err }
  }
  const file = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'fa-agents-')); temps.push(d)
    const f = join(d, 'v.md'); writeFileSync(f, md); return f
  }

  it('claim → resolve → status, JSON on stdout, no lock left', () => {
    const f = file()
    const c = run(['claim', f, '--agent', 'a1', '--count', '2'])
    expect(c.code).toBe(0)
    const items = JSON.parse(c.out) as { id: string; paragraph: string }[]
    expect(items.length).toBe(2)
    expect(items[0].paragraph).toBe('First paragraph.')
    const r = run(['resolve', f, '--agent', 'a1', '--note', items[0].id, '--note', items[1].id, '--done', 'made 2 cards'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toEqual({ resolved: [items[0].id, items[1].id], failed: [] })
    const s = JSON.parse(run(['status', f]).out)
    expect(s.resolved).toBe(3)
    expect(run(['status', f, '--text']).out).toContain('6 notes:')
    expect(existsSync(lockPath(f))).toBe(false)
    // the file got the current agent guide with the write? (no header "---" after a list here → unchanged rule)
    expect(readFileSync(f, 'utf8')).toContain('> ↳ resolved by a1: made 2 cards')
  })

  it('exit codes: 2 bad usage, 3 not owner / not found, 4 file busy', () => {
    const f = file()
    expect(run(['claim', f]).code).toBe(2)                                  // no --agent
    expect(run(['claim', f, '--agent', 'Bad Name']).code).toBe(2)
    expect(run(['claim', f, '--agent', 'a1', '--count', '0']).code).toBe(2)
    expect(run(['claim', '/nonexistent.md', '--agent', 'a1']).code).toBe(2)
    expect(run(['claim', f, '--agent', 'a1', '--bogus']).code).toBe(2)
    expect(run(['resolve', f, '--agent', 'a1', '--note', 'x']).code).toBe(2)    // no --done
    const theirs = parse(md)[3].id
    const r = run(['resolve', f, '--agent', 'a1', '--note', theirs, '--done', 'x'])
    expect(r.code).toBe(3)
    expect(r.err).toContain('claimed by b2')
    expect(run(['release', f, '--agent', 'a1', '--note', 'zzzzzzz']).code).toBe(3)
    expect(run(['release', f, '--agent', 'a1']).out).toContain('"released": []')
    writeFileSync(lockPath(f), JSON.stringify({ pid: 1, host: 'x', time: Date.now(), token: 't' }))
    process.env.VIDEO_NOTES_LOCK_WAIT_MS = '100'
    try {
      const b = run(['claim', f, '--agent', 'a1'])
      expect(b.code).toBe(4)
      expect(b.err).toContain('busy')
    } finally { delete process.env.VIDEO_NOTES_LOCK_WAIT_MS }
  })
})
