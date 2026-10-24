import { commentMask } from './guide'
import {
  AGENT_RE, changeFile, claimExpired, claimStamp, DEFAULT_LEASE_MIN, isParagraph, lines, parse, resolveById, setClaimById,
  type Note, type NoteCategory,
} from './notes'
import { clock } from './transcript'

/**
 * Several AI agents working on one transcript .md at once (the `video-notes` CLI): each claims a few open
 * notes (`#claimed:<agent>@<time>`), works on them, and resolves them (`#resolved` + `> ↳ resolved by
 * <agent>: …`). Every change runs under the file lock (`changeFile` → `fileLock.ts`), reading the file fresh,
 * so two agents never get the same note and no writer erases another's change.
 *
 * The `…InText` functions are pure (text in, text out); the `…File` ones take the lock and write.
 */

/** A CLI failure with its exit code: 2 bad usage, 3 not owner / note not found / changed, 4 lock timeout. */
export class AgentError extends Error {
  constructor(message: string, readonly code: number) {
    super(message)
    this.name = 'AgentError'
  }
}

export interface ClaimOptions {
  /** How many notes at most (default 5). */
  count?: number
  /** Claim lease in minutes (default 30): an older claim is expired and claimable again. */
  leaseMin?: number
  /** Include general notes too (default: `#mochi` only). */
  all?: boolean
  now?: number
}

export function checkAgent(agent: string | null | undefined): string {
  const a = (agent ?? '').trim().toLowerCase()
  if (!AGENT_RE.test(a)) throw new AgentError(`--agent must be 1–24 chars of a-z, 0-9 and "-" (got ${JSON.stringify(agent ?? '')})`, 2)
  return a
}

/** Open for this agent: not resolved, and not validly claimed by another agent. */
const openFor = (n: Note, agent: string, now: number, lease: number): boolean =>
  !n.resolved && (n.claim === null || n.claim.agent === agent || claimExpired(n.claim, now, lease))

/**
 * Picks up to `count` notes for `agent` and stamps its claim on them: its own claims first (re-stamped), then
 * open notes in file order (`#mochi` only unless `all`). Returns the new text and the claimed ids.
 */
export function claimInText(md: string, agent: string, opts: ClaimOptions = {}): { md: string; ids: string[] } {
  const now = opts.now ?? Date.now(), lease = opts.leaseMin ?? DEFAULT_LEASE_MIN, count = opts.count ?? 5
  const notes = parse(md)
  const own = notes.filter((n) => !n.resolved && n.claim?.agent === agent)
  const free = notes.filter((n) => n.claim?.agent !== agent && openFor(n, agent, now, lease) && (opts.all || n.category === 'mochi'))
  const ids = [...own, ...free].slice(0, Math.max(0, count)).map((n) => n.id)
  const claim = { agent, at: claimStamp(now) }
  let out = md
  for (const id of ids) out = setClaimById(out, id, claim) ?? out
  return { md: out, ids }
}

export interface Outcome { id: string; ok: boolean; error?: string; already?: boolean }

const notFound = (id: string): string => `note ${id} not found (it was edited or deleted, or the id is wrong)`

/** Resolves the notes (each must be claimed by `agent`; an expired claim of its own is fine). */
export function resolveInText(md: string, agent: string, ids: string[], done: string): { md: string; results: Outcome[] } {
  let out = md
  const results: Outcome[] = []
  for (const id of ids) {
    const n = parse(out).find((x) => x.id === id)
    if (!n) { results.push({ id, ok: false, error: notFound(id) }); continue }
    if (n.resolved) {
      // resolving twice by the same agent (a retry) is fine; nothing is written
      if (n.resolvedBy === agent) results.push({ id, ok: true, already: true })
      else results.push({ id, ok: false, error: `note ${id} is already resolved${n.resolvedBy ? ` by ${n.resolvedBy}` : ''}` })
      continue
    }
    if (!n.claim) { results.push({ id, ok: false, error: `note ${id} is not claimed by ${agent} (claim it first)` }); continue }
    if (n.claim.agent !== agent) { results.push({ id, ok: false, error: `note ${id} is claimed by ${n.claim.agent}, not ${agent}` }); continue }
    out = resolveById(out, id, agent, done) ?? out
    results.push({ id, ok: true })
  }
  return { md: out, results }
}

/** Drops `agent`'s claims: on these notes, or all of them when `ids` is null. */
export function releaseInText(md: string, agent: string, ids: string[] | null): { md: string; results: Outcome[] } {
  let out = md
  const notes = parse(md)
  const want = ids ?? notes.filter((n) => n.claim?.agent === agent).map((n) => n.id)
  const results: Outcome[] = []
  for (const id of want) {
    const n = notes.find((x) => x.id === id)
    if (!n) { results.push({ id, ok: false, error: notFound(id) }); continue }
    if (n.claim?.agent !== agent) { results.push({ id, ok: false, error: `note ${id} is not claimed by ${agent}` }); continue }
    out = setClaimById(out, id, null) ?? out
    results.push({ id, ok: true })
  }
  return { md: out, results }
}

// ---------- context for writing a good card ----------

export interface VideoContext { title: string | null; channel: string | null; url: string | null }

export interface AgentNote {
  id: string
  /** Start time (s); null for a note typed by hand without a time. */
  time: number | null
  end: number | null
  /** "m:ss" or "m:ss–m:ss". */
  clock: string
  /** The YouTube link at the note's time. */
  link: string
  text: string
  quote: string | null
  category: NoteCategory
  claim: { agent: string; at: string } | null
  /** The full paragraph the note is under (without its time link), and the ones around it. */
  paragraph: string
  prevParagraph: string | null
  nextParagraph: string | null
  /** The chapter the paragraph is in, if the video has chapters. */
  chapter: string | null
  video: VideoContext
}

const reParaLine = /^\[(\d+(?::\d\d)+)\]\(([^)]*?)&t=(\d+)s\)\s?(.*)$/
const reChapter = /^##\s+\d+(?::\d\d)+\s+(.*)$/

interface Para { base: string; t: number; text: string; chapter: string | null }

/** The paragraphs (link base, start, text, chapter) and the video's header fields. */
export function transcriptContext(md: string): { paras: Para[]; video: VideoContext } {
  const ls = lines(md), mask = commentMask(ls)
  const paras: Para[] = []
  const video: VideoContext = { title: null, channel: null, url: null }
  let chapter: string | null = null
  for (let i = 0; i < ls.length; i++) {
    if (mask[i]) continue
    const l = ls[i]
    if (isParagraph(l)) {
      const m = reParaLine.exec(l)!
      paras.push({ base: m[2], t: Number(m[3]), text: m[4] ?? '', chapter })
      continue
    }
    if (paras.length === 0) {
      if (video.title === null && l.startsWith('# ')) video.title = l.slice(2).trim()
      else if (video.channel === null && l.startsWith('- channel:')) video.channel = l.slice(10).trim()
      else if (video.url === null && l.startsWith('- url:')) video.url = l.slice(6).trim()
    }
    const c = reChapter.exec(l)
    if (c) chapter = c[1].trim()
  }
  return { paras, video }
}

/** The notes with these ids, with the context an agent needs (in the order of `ids`). */
export function agentNotes(md: string, ids: string[]): AgentNote[] {
  const notes = parse(md)
  const { paras, video } = transcriptContext(md)
  return ids.flatMap((id) => {
    const n = notes.find((x) => x.id === id)
    if (!n) return []
    const p = paras[n.para]
    const t = n.time ?? p?.t ?? 0
    return [{
      id: n.id,
      time: n.time,
      end: n.end,
      clock: clock(t) + (n.end !== null && clock(n.end) !== clock(t) ? '–' + clock(n.end) : ''),
      link: `${p?.base ?? video.url ?? ''}&t=${Math.trunc(t)}s`,
      text: n.text,
      quote: n.quote,
      category: n.category,
      claim: n.claim,
      paragraph: p?.text ?? '',
      prevParagraph: paras[n.para - 1]?.text ?? null,
      nextParagraph: paras[n.para + 1]?.text ?? null,
      chapter: p?.chapter ?? null,
      video,
    }]
  })
}

// ---------- status ----------

export type NoteState = 'open' | 'claimed' | 'expired' | 'resolved'

export const stateOf = (n: Note, now: number, lease: number): NoteState =>
  n.resolved ? 'resolved' : n.claim === null ? 'open' : claimExpired(n.claim, now, lease) ? 'expired' : 'claimed'

type Counts = Record<NoteState, number>
const zero = (): Counts => ({ open: 0, claimed: 0, expired: 0, resolved: 0 })

export interface Status {
  total: number
  open: number
  claimed: number
  expired: number
  resolved: number
  /** Valid claims per agent. */
  claimedBy: Record<string, number>
  byCategory: Record<NoteCategory, Counts>
  notes: { id: string; state: NoteState; agent: string | null; category: NoteCategory; clock: string; text: string; resolvedBy: string | null }[]
}

/** Counts (open / claimed by whom / expired / resolved, by category) and the list. Expired claims are claimable. */
export function statusOf(md: string, now: number = Date.now(), leaseMin: number = DEFAULT_LEASE_MIN): Status {
  const notes = parse(md)
  const all = zero()
  const byCategory: Record<NoteCategory, Counts> = { mochi: zero(), general: zero() }
  const claimedBy: Record<string, number> = {}
  const list: Status['notes'] = []
  for (const n of notes) {
    const s = stateOf(n, now, leaseMin)
    all[s]++
    byCategory[n.category][s]++
    if (s === 'claimed') claimedBy[n.claim!.agent] = (claimedBy[n.claim!.agent] ?? 0) + 1
    const t = n.time
    list.push({ id: n.id, state: s, agent: n.claim?.agent ?? null, category: n.category,
      clock: t === null ? '' : clock(t) + (n.end !== null && clock(n.end) !== clock(t) ? '–' + clock(n.end) : ''),
      text: n.text, resolvedBy: n.resolvedBy })
  }
  return { total: notes.length, ...all, claimedBy, byCategory, notes: list }
}

// ---------- the file (locked) ----------

/** Claims under the file lock; returns the claimed notes with their context ([] when nothing is left). */
export function claimFile(path: string, agent: string, opts: ClaimOptions = {}): AgentNote[] {
  let ids: string[] = []
  const { after } = changeFile(path, (md) => { const r = claimInText(md, agent, opts); ids = r.ids; return r.md })
  return agentNotes(after, ids)
}

export function resolveFile(path: string, agent: string, ids: string[], done: string): Outcome[] {
  let results: Outcome[] = []
  changeFile(path, (md) => { const r = resolveInText(md, agent, ids, done); results = r.results; return r.md })
  return results
}

export function releaseFile(path: string, agent: string, ids: string[] | null): Outcome[] {
  let results: Outcome[] = []
  changeFile(path, (md) => { const r = releaseInText(md, agent, ids); results = r.results; return r.md })
  return results
}
