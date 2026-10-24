// Labs experiment "feed-triage" (area 'feed'): in each 📺 Feed row, a "Preview pull quotes" button. Nothing is
// fetched until it is clicked. Shows the chapter openings (verbatim, no AI) as soon as the captions are in, and the
// AI-picked pull quotes (verbatim) when the Labs analysis is available.
import { useEffect, useRef, useState } from 'react'
import type { LabsSlotProps } from '../../../renderer/labs'

interface View {
  state: 'idle' | 'captions' | 'analyzing' | 'done' | 'failed'
  line: string
  error?: string
  aiError?: string
  digest: null | {
    analyzed: boolean; duration: number; highlights: number; highlightSeconds: number; signalPct: number | null
    quotes: { text: string; t0: number }[]
    openings: { title: string; t: number; text: string; truncated: boolean }[]
  }
}

const CSS = `
.ft { margin-top: 6px; }
.ft__btn { padding: 2px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--labs) 60%, transparent); color: var(--labs); font-size: 12.5px; font-weight: 600; background: none; }
.ft__btn:hover { background: var(--labs-soft); }
.ft__box { margin-top: 8px; padding: 10px 12px; border-radius: 9px; background: var(--labs-soft); display: flex; flex-direction: column; gap: 6px; max-height: 420px; overflow: auto; }
.ft__sect { font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.ft__q { margin: 0; padding-left: 9px; border-left: 3px solid color-mix(in srgb, var(--labs) 60%, transparent); font-size: 14px; line-height: 1.42; }
.ft__o { font-size: 13.5px; line-height: 1.4; }
.ft__o b { font-weight: 600; }
.ft__t { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; margin-right: 6px; }
.ft__note { font-size: 12.5px; color: var(--muted); }
.ft__err { font-size: 12.5px; color: #c0392b; white-space: pre-wrap; }
`
if (typeof document !== 'undefined' && !document.getElementById('labs-feed-triage')) {
  const s = document.createElement('style'); s.id = 'labs-feed-triage'; s.textContent = CSS; document.head.appendChild(s)
}

const clock = (s: number): string => {
  const x = Math.max(0, Math.trunc(s)), h = Math.trunc(x / 3600), m = Math.trunc((x % 3600) / 60), r = x % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
const call = (method: string, ...args: unknown[]) => window.fa.labsCall('feed-triage', method, ...args) as Promise<View>

export default function FeedTriage({ feedItem }: LabsSlotProps) {
  const [shown, setShown] = useState(false)
  const [v, setV] = useState<View | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const id = feedItem?.id
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])
  if (!feedItem || !id) return null

  const poll = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => {
      void call('status', id).then((x) => {
        setV(x)
        if (x.state === 'done' || x.state === 'failed' || x.state === 'idle') { clearInterval(timer.current!); timer.current = null }
      }).catch(() => {})
    }, 1200)
  }
  const click = () => {
    if (shown) { setShown(false); return }
    setShown(true)
    if (v && (v.state === 'done' && !v.aiError)) return
    void call('start', id, feedItem.folder, true).then((x) => { setV(x); if (x.state !== 'done' && x.state !== 'failed') poll() })
      .catch((e) => setV({ state: 'failed', line: '', error: String(e), digest: null }))
  }

  const d = v?.digest
  const busy = v && (v.state === 'captions' || v.state === 'analyzing')
  return (
    <div className="ft" onDoubleClick={(e) => e.stopPropagation()}>
      <button className="ft__btn" title="Fetches this video's captions into Labs' own cache (only when you click), then shows its quotes word for word"
        onClick={click}>{shown ? 'Hide preview' : 'Preview pull quotes'}</button>
      {shown && v && (
        <div className="ft__box">
          {v.state === 'failed' && <div className="ft__err">{v.error}</div>}
          {busy && <div className="ft__note">⏳ {v.line || 'Working…'}</div>}
          {d?.analyzed && d.quotes.length > 0 && <>
            <div className="ft__sect">Pull quotes · verbatim, AI-picked{d.signalPct !== null ? ` · signal ${d.signalPct}%` : ''}</div>
            {d.quotes.map((q, i) => <p key={i} className="ft__q"><span className="ft__t">{clock(q.t0)}</span>“{q.text}”</p>)}
          </>}
          {d && !d.analyzed && <>
            {v.aiError && <div className="ft__note" title={v.aiError}>No AI pull quotes ({/logged|auth|OAuth/i.test(v.aiError) ? 'claude -p is not logged in' : 'claude -p unavailable'}) — chapter openings instead, verbatim, no AI:</div>}
            {!v.aiError && <div className="ft__sect">Chapter openings · verbatim, no AI</div>}
            {d.openings.map((o, i) => <div key={i} className="ft__o"><span className="ft__t">{clock(o.t)}</span><b>{o.title}</b> — “{o.text}{o.truncated ? ' …' : ''}”</div>)}
            {d.openings.length === 0 && <div className="ft__note">No transcript words.</div>}
          </>}
        </div>
      )}
    </div>
  )
}
