import { useEffect, useState } from 'react'
import type { ShellState, WorkEvent } from '../shared/api'
import { NewTab } from './NewTab'
import { TabBar } from './TabBar'

/** The shell: the tab strip, and the New Tab pages (a video tab's view lies over this page's body). */
export function App() {
  const [state, setState] = useState<ShellState>({ tabs: [], active: null, scale: 1 })
  const [work, setWork] = useState<Record<string, WorkEvent>>({})
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    void window.fa.state().then((s) => s && setState(s))
    const offState = window.fa.onState(setState)
    const offWork = window.fa.onWork((e) => setWork((w) => ({ ...w, [e.tabId]: e.step === 'working' && !e.line && w[e.tabId]?.step === 'working' ? w[e.tabId] : e })))
    let t: ReturnType<typeof setTimeout> | undefined
    const offCmd = window.fa.onCommand((c) => {
      if (c.kind === 'toast') { setToast(c.text); clearTimeout(t); t = setTimeout(() => setToast(null), c.ms ?? 1200) }
    })
    return () => { offState(); offWork(); offCmd() }
  }, [])

  const newTabs = state.tabs.filter((t) => t.kind === 'new')
  return (
    <div className="shell">
      <TabBar state={state} />
      <div className="stack">
        {newTabs.map((t) => (
          <div key={t.id} className={'layer' + (t.id === state.active ? '' : ' layer--hidden')}>
            <NewTab tabId={t.id} active={t.id === state.active} work={work[t.id] ?? null}
              clearWork={() => setWork((w) => { const n = { ...w }; delete n[t.id]; return n })} />
          </div>
        ))}
      </div>
      {toast && <div className="zoomtoast">{toast}</div>}
    </div>
  )
}
