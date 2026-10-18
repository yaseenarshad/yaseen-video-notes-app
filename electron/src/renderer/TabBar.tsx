import type { ShellState } from '../shared/api'

/** The tab strip: the look of the Yaseen Docs tab bar (pills on a 44 px row, "+" after the tabs). */
export function TabBar({ state }: { state: ShellState }) {
  return (
    <div className="tabbar-row" role="presentation">
      <div className="tabbar" role="tablist">
        {state.tabs.map((t) => {
          const active = t.id === state.active
          return (
            <div key={t.id} className={'tabbar__tab' + (active ? ' tabbar__tab--active' : '')} title={t.tooltip}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); window.fa.closeTab(t.id) } }}
              onContextMenu={(e) => { e.preventDefault(); window.fa.tabMenu(t.id) }}>
              <button className="tabbar__btn" role="tab" aria-selected={active} onClick={() => window.fa.selectTab(t.id)}>
                <span className="tabbar__label">{t.title}</span>
              </button>
              <button className="tabbar__close" title="Close tab (⌘W)" aria-label="Close tab"
                onClick={(e) => { e.stopPropagation(); window.fa.closeTab(t.id) }}>✕</button>
            </div>
          )
        })}
        <button className="tabbar__new" title="New tab (⌘T)" aria-label="New tab" onClick={() => window.fa.newTab()}>
          <svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="tabbar-tail" />
    </div>
  )
}
