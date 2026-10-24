// Labs experiment "triage-queue" (area 'newtab'): a 🎯 Triage bar above the New Tab's list with a counter, and a
// one-video-at-a-time queue of the un-started videos (Backlog / Todo / no status) with their verbatim pull quotes,
// or — not analyzed — their chapter titles + first sentences (no AI). Keys: → watch reel · ↓ skip for now ·
// D done · Enter open · ↑ previous · Esc close. Choices are Labs-local (labs-state.json), never the vault's status.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FolderEntry } from '../../../shared/api'
import type { LabsSlotProps } from '../../../renderer/labs'

type TriageState = 'reel' | 'skip' | 'done'
type States = Record<string, { state: TriageState; at: string }>
interface Digest {
  videoId: string; title: string; duration: number; analyzed: boolean
  highlights: number; highlightSeconds: number; signalPct: number | null
  quotes: { text: string; t0: number; t1: number }[]
  labels: { label: string; t0: number; score: number }[]
  openings: { title: string; t: number; text: string; truncated: boolean }[]
}

const CSS = `
.tq-bar { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; padding: 8px 12px; border-radius: 10px;
  background: var(--labs-soft); border: 1px solid color-mix(in srgb, var(--labs) 30%, transparent); font-size: 14px; }
.tq-bar__title { font-weight: 700; color: var(--labs); }
.tq-bar__count { font-weight: 600; font-variant-numeric: tabular-nums; }
.tq-bar__note { color: var(--muted); font-size: 12.5px; }
.tq-bar__go { margin-left: auto; padding: 4px 14px; border-radius: 999px; background: var(--labs); color: #fff; font-weight: 600; font-size: 13.5px; }
.tq-bar__go:disabled { opacity: .45; }
.tq-bar__link { color: var(--labs); font-size: 12.5px; text-decoration: underline; text-underline-offset: 2px; }
.tq-veil { position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, .38); display: grid; place-items: center; padding: 24px; }
.tq { width: min(940px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; border-radius: 14px; background: var(--panel);
  border: 1px solid var(--border); box-shadow: 0 20px 60px rgba(0, 0, 0, .3); overflow: hidden; }
.tq__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.tq__head h3 { margin: 0; font-size: 16px; color: var(--labs); }
.tq__count { font-weight: 600; font-variant-numeric: tabular-nums; }
.tq__x { margin-left: auto; font-size: 20px; line-height: 1; color: var(--muted); padding: 2px 8px; border-radius: 6px; }
.tq__x:hover { background: var(--hover); }
.tq__body { display: grid; grid-template-columns: 1fr 230px; min-height: 0; flex: 1; }
.tq__main { padding: 16px 18px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.tq__top { display: flex; gap: 14px; }
.tq__thumb { width: 168px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; flex: none; background: var(--hover); }
.tq__title { font-size: 19px; font-weight: 650; line-height: 1.25; }
.tq__sub { color: var(--muted); font-size: 13.5px; margin-top: 3px; }
.tq__stats { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 13.5px; margin-top: 7px; }
.tq__stats b { font-weight: 600; }
.tq__sect { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-top: 4px; }
.tq__q { margin: 0; padding: 3px 0 3px 11px; border-left: 3px solid color-mix(in srgb, var(--labs) 60%, transparent); font-size: 15px; line-height: 1.45; }
.tq__t { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; margin-right: 6px; }
.tq__labels { display: flex; flex-wrap: wrap; gap: 6px; }
.tq__label { font-size: 12px; color: var(--labs); border: 1px dashed color-mix(in srgb, var(--labs) 70%, transparent); border-radius: 5px; padding: 1px 6px; }
.tq__label::before { content: "AI label · "; opacity: .7; }
.tq__open { font-size: 14px; line-height: 1.4; }
.tq__open b { font-weight: 600; }
.tq__empty { padding: 40px 0; text-align: center; color: var(--muted); }
.tq__side { border-left: 1px solid var(--border); padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.tq__item { text-align: left; padding: 6px 8px; border-radius: 7px; font-size: 13px; line-height: 1.3; color: var(--fg); }
.tq__item:hover { background: var(--hover); }
.tq__item--on { background: var(--labs-soft); font-weight: 600; }
.tq__item--done { color: var(--muted); }
.tq__chip { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--hover); color: var(--muted); margin-left: 4px; white-space: nowrap; }
.tq__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
.tq__btn { padding: 6px 13px; border-radius: 8px; border: 1px solid var(--border); font-size: 13.5px; font-weight: 600; color: var(--fg); }
.tq__btn:hover { background: var(--hover); }
.tq__btn--main { background: var(--labs); border-color: var(--labs); color: #fff; }
.tq__btn--main:hover { background: var(--labs); filter: brightness(1.08); }
.tq__btn kbd { font: 600 11px ui-monospace, monospace; padding: 0 4px; margin-right: 5px; border-radius: 4px; background: color-mix(in srgb, currentColor 14%, transparent); }
.tq__ro { flex-basis: 100%; font-size: 12px; color: var(--muted); }
`
if (typeof document !== 'undefined' && !document.getElementById('labs-triage-queue')) {
  const s = document.createElement('style'); s.id = 'labs-triage-queue'; s.textContent = CSS; document.head.appendChild(s)
}

const clock = (s: number): string => {
  const x = Math.max(0, Math.trunc(s)), h = Math.trunc(x / 3600), m = Math.trunc((x % 3600) / 60), r = x % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
const length = (s: number): string => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }
/** Not started: no status, Backlog or Todo (old values read as new ones by the app). */
export const unstarted = (r: FolderEntry): boolean => !r.status || /^(1|2)-/.test(r.status)
/** Opening a video in the app moves it to In progress, so also offered (a switch): In progress but < 10 % watched. */
export const barelyStarted = (r: FolderEntry): boolean => !!r.status && /^3-/.test(r.status) && !r.finished && r.fraction < 0.1
const BARELY_KEY = 'labs.triage-queue.barely'
const readBarely = (): boolean => { try { return localStorage.getItem(BARELY_KEY) === '1' } catch { return false } }
const keyOf = (r: FolderEntry): string => r.videoId ?? r.folder
const LABEL: Record<TriageState, string> = { reel: '→ reel', skip: 'skipped', done: 'done' }

const call = <T,>(method: string, ...args: unknown[]) => window.fa.labsCall('triage-queue', method, ...args) as Promise<T>

async function openFolder(folder: string, flag?: string): Promise<void> {
  const s = await window.fa.state()
  const tab = s.active ?? s.tabs.find((t) => t.kind === 'new')?.id
  if (tab) window.fa.openFolder(tab, folder, flag ? `labs=${flag}` : undefined)
}

export default function TriageQueue({ rows, source }: LabsSlotProps) {
  const [states, setStates] = useState<States>({})
  const [open, setOpen] = useState(false)
  const [showTriaged, setShowTriaged] = useState(false)
  const [cur, setCur] = useState<string | null>(null)
  const [digests, setDigests] = useState<Record<string, Digest | null>>({})
  const [analyzed, setAnalyzed] = useState<Record<string, unknown>>({})
  const [barely, setBarely] = useState(readBarely)
  const toggleBarely = (on: boolean) => { setBarely(on); try { localStorage.setItem(BARELY_KEY, on ? '1' : '0') } catch { /* fine */ } }

  useEffect(() => { void call<States>('states').then(setStates).catch(() => {}) }, [])
  useEffect(() => { void window.fa.labsAnalyzed().then(setAnalyzed).catch(() => {}) }, [rows])

  const candidates = useMemo(() => (rows ?? []).filter((r) => r.ready && (unstarted(r) || (barely && barelyStarted(r))))
    .sort((a, b) => (analyzed[b.videoId ?? ''] ? 1 : 0) - (analyzed[a.videoId ?? ''] ? 1 : 0) || b.date - a.date), [rows, analyzed, barely])
  const todo = candidates.filter((r) => !states[keyOf(r)])
  const triaged = candidates.filter((r) => states[keyOf(r)])
  const list = showTriaged ? [...todo, ...triaged] : todo
  const current = list.find((r) => r.folder === cur) ?? list[0] ?? null

  // load the digest of the current video and the next two (cached per folder)
  useEffect(() => {
    if (!open || !current) return
    const i = list.indexOf(current)
    for (const r of list.slice(i, i + 3)) {
      if (r.folder in digests) continue
      setDigests((d) => ({ ...d, [r.folder]: null }))
      void call<Digest | null>('digest', r.folder, r.videoId).then((x) => setDigests((d) => ({ ...d, [r.folder]: x }))).catch(() => {})
    }
  }, [open, current?.folder, list.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback(async (r: FolderEntry, s: TriageState | null) => {
    const i = list.indexOf(r)
    const next = list[i + 1] ?? list[i - 1] ?? null
    setStates(await call<States>('setState', keyOf(r), s))
    if (s && !showTriaged) setCur(next?.folder ?? null)
  }, [list, showTriaged])

  const act = useCallback((what: 'reel' | 'skip' | 'done' | 'open' | 'prev' | 'next' | 'close') => {
    if (what === 'close') { setOpen(false); return }
    if (!current) return
    const i = list.indexOf(current)
    if (what === 'prev') { if (i > 0) setCur(list[i - 1].folder); return }
    if (what === 'next') { if (i + 1 < list.length) setCur(list[i + 1].folder); return }
    if (what === 'open') { setOpen(false); void openFolder(current.folder); return }
    if (what === 'reel') {
      const d = digests[current.folder]
      void set(current, 'reel').then(() => { setOpen(false); void openFolder(current.folder, d?.analyzed !== false && analyzed[current.videoId ?? ''] ? 'reel' : undefined) })
      return
    }
    void set(current, what)
  }, [current, list, digests, analyzed, set])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key
      const what = k === 'ArrowRight' ? 'reel' : k === 'ArrowDown' ? 'skip' : (k === 'd' || k === 'D') ? 'done' : k === 'Enter' ? 'open'
        : k === 'ArrowUp' ? 'prev' : k === 'Escape' ? 'close' : null
      if (!what) return
      e.preventDefault(); e.stopPropagation()
      act(what)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, act])

  if (!rows) return null
  const barelyCount = (rows ?? []).filter((r) => r.ready && barelyStarted(r)).length
  const where = source?.kind === 'folder' ? source.path.split('/').pop() : source?.kind === 'recent' ? 'Recent' : 'In progress'
  const d = current ? digests[current.folder] : undefined
  return (
    <>
      <div className="tq-bar">
        <span className="tq-bar__title">🎯 Triage</span>
        <span className="tq-bar__count">{todo.length} to triage</span>
        <span className="tq-bar__note">un-started videos in {where}{triaged.length ? ` · ${triaged.length} triaged in Labs` : ''}</span>
        {barelyCount > 0 && <label className="tq-bar__note" title="Opening a video in the app sets it to In progress; these were opened but are less than 10 % watched">
          <input type="checkbox" checked={barely} onChange={(e) => toggleBarely(e.target.checked)} /> + {barelyCount} barely started</label>}
        {triaged.length > 0 && <button className="tq-bar__link" onClick={() => { setShowTriaged(true); setOpen(true) }}>review</button>}
        <button className="tq-bar__go" disabled={!candidates.length} onClick={() => { setShowTriaged(false); setCur(null); setOpen(true) }}>Start triage ▸</button>
      </div>
      {open && (
        <div className="tq-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="tq" role="dialog" aria-label="Triage">
            <div className="tq__head">
              <h3>🎯 Triage</h3>
              <span className="tq__count">{todo.length} to triage</span>
              <span className="tq-bar__note">{where}</span>
              <label className="tq-bar__note"><input type="checkbox" checked={showTriaged} onChange={(e) => setShowTriaged(e.target.checked)} /> show triaged ({triaged.length})</label>
              <button className="tq__x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="tq__body">
              <div className="tq__main">
                {!current ? <div className="tq__empty">Nothing left to triage here. 🎉<br />Videos with status Backlog, Todo or none show up here{barely ? ', and In progress ones less than 10 % watched' : ''}.</div> : (<>
                  <div className="tq__top">
                    {current.videoId && <img className="tq__thumb" src={`https://i.ytimg.com/vi/${current.videoId}/mqdefault.jpg`} alt="" />}
                    <div>
                      <div className="tq__title">{current.title}</div>
                      <div className="tq__sub">{current.channel ?? ''}{current.status ? ` · ${current.status.replace(/^\d-/, '')}` : ' · no status'}{d ? ` · ${length(d.duration)}` : ''}
                        {states[keyOf(current)] && <span className="tq__chip">{LABEL[states[keyOf(current)].state]}</span>}</div>
                      {d?.analyzed && (
                        <div className="tq__stats">
                          <span title="AI-picked spans of the transcript">🎬 <b>{d.highlights} highlights</b> · {length(d.highlightSeconds)}</span>
                          {d.signalPct !== null && <span title="Share of paragraphs the AI analysis scored substantive or dense">signal <b>{d.signalPct}%</b></span>}
                        </div>
                      )}
                    </div>
                  </div>
                  {d === undefined || d === null ? <div className="tq-bar__note">Loading…</div> : d.analyzed ? (<>
                    <div className="tq__sect">Pull quotes · verbatim, AI-picked</div>
                    {d.quotes.map((q, i) => <p key={i} className="tq__q"><span className="tq__t">{clock(q.t0)}</span>“{q.text}”</p>)}
                    {d.labels.length > 0 && <>
                      <div className="tq__sect">Top highlights</div>
                      <div className="tq__labels">{d.labels.map((l, i) => <span key={i} className="tq__label" title={`${clock(l.t0)} · score ${l.score}/5 — written by the AI as a pointer, not a quote`}>{l.label}</span>)}</div>
                    </>}
                  </>) : (<>
                    <div className="tq__sect">Not analyzed — chapter openings · verbatim, no AI</div>
                    {d.openings.length === 0 && <div className="tq-bar__note">No transcript words.</div>}
                    {d.openings.map((o, i) => <div key={i} className="tq__open"><span className="tq__t">{clock(o.t)}</span><b>{o.title}</b> — “{o.text}{o.truncated ? ' …' : ''}”</div>)}
                  </>)}
                </>)}
              </div>
              <div className="tq__side">
                <div className="tq__sect">Queue</div>
                {list.map((r) => (
                  <button key={r.folder} className={'tq__item' + (r === current ? ' tq__item--on' : '') + (states[keyOf(r)] ? ' tq__item--done' : '')} onClick={() => setCur(r.folder)}>
                    {analyzed[r.videoId ?? ''] ? '🎬 ' : ''}{r.title}
                    {states[keyOf(r)] && <span className="tq__chip">{LABEL[states[keyOf(r)].state]}</span>}
                    {states[keyOf(r)] && <span className="tq__chip" role="button" title="Undo: back to the queue" onClick={(e) => { e.stopPropagation(); void set(r, null) }}>undo</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="tq__foot">
              <button className="tq__btn tq__btn--main" disabled={!current} onClick={() => act('reel')}><kbd>→</kbd>{current && analyzed[current.videoId ?? ''] ? 'Watch reel' : 'Watch'}</button>
              <button className="tq__btn" disabled={!current} onClick={() => act('skip')}><kbd>↓</kbd>Skip for now</button>
              <button className="tq__btn" disabled={!current} onClick={() => act('done')}><kbd>D</kbd>Mark done</button>
              <button className="tq__btn" disabled={!current} onClick={() => act('open')}><kbd>⏎</kbd>Open normally</button>
              <span className="tq-bar__note"><kbd>↑</kbd> previous · <kbd>Esc</kbd> close</span>
              <div className="tq__ro">Triage choices are kept in Labs only (labs-state.json in Labs' data folder). Your vault's status is not changed — Labs is read-only. “Mark done” here means “done triaging”, not 4-Done.</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
