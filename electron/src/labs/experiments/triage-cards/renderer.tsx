// Labs experiment "triage-cards" (area 'board'): on each analyzed video's board card, "🎬 N highlights · M min",
// a signal %, the top 2 pull quotes (verbatim, 2 lines each, click to expand) and a ▶ Reel button that opens the
// video with the launch flag #labs=reel (read by player experiments through LABS.launch).
import { useEffect, useState, type MouseEvent } from 'react'
import type { LabsSlotProps } from '../../../renderer/labs'

interface Card { highlights: number; highlightSeconds: number; signalPct: number | null; quotes: { text: string; t0: number; t1: number }[] }

const CSS = `
.tc { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; padding-top: 7px; border-top: 1px dashed color-mix(in srgb, var(--labs) 35%, transparent); }
.tc__row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 13px; color: var(--muted); }
.tc__stat { font-weight: 600; color: var(--fg); white-space: nowrap; }
.tc__sig { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.tc__sigbar { width: 34px; height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 22%, transparent); overflow: hidden; }
.tc__sigfill { display: block; height: 100%; background: var(--labs); }
.tc__q { position: relative; margin: 0; padding: 2px 0 2px 9px; border-left: 2px solid color-mix(in srgb, var(--labs) 55%, transparent);
  font-size: 13.5px; line-height: 1.38; color: var(--fg); cursor: zoom-in; text-align: left; background: none; }
.tc__q--clamp { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.tc__q--open { cursor: zoom-out; }
.tc__t { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; margin-right: 4px; }
.tc__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.tc__hint { font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.tc__reel { margin-left: auto; padding: 3px 10px; border-radius: 999px; background: var(--labs); color: #fff; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.tc__reel:hover { filter: brightness(1.08); }
`
if (typeof document !== 'undefined' && !document.getElementById('labs-triage-cards')) {
  const s = document.createElement('style'); s.id = 'labs-triage-cards'; s.textContent = CSS; document.head.appendChild(s)
}

// one analyzed-index fetch for all cards (refreshed at most every 10 s)
let index: { at: number; p: Promise<Record<string, unknown>> } | null = null
const analyzed = (): Promise<Record<string, unknown>> => {
  if (!index || Date.now() - index.at > 10_000) index = { at: Date.now(), p: window.fa.labsAnalyzed() }
  return index.p
}

export const clock = (s: number): string => {
  const x = Math.max(0, Math.trunc(s)), h = Math.trunc(x / 3600), m = Math.trunc((x % 3600) / 60), r = x % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** Opens a video in the visible New Tab with the Labs launch flag (`#labs=reel`). */
export async function openWithFlag(folder: string, flag: string): Promise<void> {
  const s = await window.fa.state()
  const tab = s.active ?? s.tabs.find((t) => t.kind === 'new')?.id
  if (tab) window.fa.openFolder(tab, folder, `labs=${flag}`)
}

const stop = (e: MouseEvent) => { e.stopPropagation() }

export default function TriageCard({ row }: LabsSlotProps) {
  const [card, setCard] = useState<Card | null>(null)
  const [open, setOpen] = useState<Set<number>>(new Set())
  useEffect(() => {
    let live = true
    const id = row?.videoId
    if (!id || !row?.ready) { setCard(null); return }
    void analyzed().then((i) => {
      if (!i[id]) return null
      return window.fa.labsCall('triage-cards', 'card', row.folder, id) as Promise<Card | null>
    }).then((c) => { if (live) setCard(c ?? null) }).catch(() => { if (live) setCard(null) })
    return () => { live = false }
  }, [row?.folder, row?.videoId, row?.ready])
  if (!card || !row) return null
  const mins = Math.max(1, Math.round(card.highlightSeconds / 60))
  return (
    <div className="tc" onDoubleClick={stop}>
      <div className="tc__row">
        <span className="tc__stat" title="Highlights the Labs analysis picked (AI-picked spans of the transcript) and their total length">🎬 {card.highlights} highlights · {mins} min</span>
        {card.signalPct !== null && (
          <span className="tc__sig" title="Signal: the share of paragraphs the AI analysis scored substantive (2) or dense (3)">
            <span className="tc__sigbar"><span className="tc__sigfill" style={{ width: `${card.signalPct}%` }} /></span>
            signal {card.signalPct}%
          </span>
        )}
      </div>
      {card.quotes.map((q, i) => (
        <button key={i} className={'tc__q' + (open.has(i) ? ' tc__q--open' : ' tc__q--clamp')} title={open.has(i) ? 'Click to fold' : 'Verbatim from the transcript — click to read all of it'}
          onMouseDown={stop} onClick={(e) => { e.stopPropagation(); setOpen((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n }) }}>
          <span className="tc__t">{clock(q.t0)}</span>“{q.text}”
        </button>
      ))}
      <div className="tc__foot">
        <span className="tc__hint" title="Quotes are the speakers' exact words; the AI only chose which ones">verbatim · AI-picked</span>
        <button className="tc__reel" title="Open the video straight into its highlight reel (#labs=reel)" onMouseDown={stop}
          onClick={(e) => { e.stopPropagation(); void openWithFlag(row.folder, 'reel') }}>▶ Reel</button>
      </div>
    </div>
  )
}
