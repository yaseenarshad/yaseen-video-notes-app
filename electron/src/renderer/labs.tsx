/// <reference types="vite/client" />
import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import type { ExperimentArea } from '../labs/registry'
import type { FeedItem, FolderEntry, LabsInfo, Source } from '../shared/api'

/**
 * 🧪 Labs in the shell (renderer). Inert in the normal app: `labsInfo()` is null there, so nothing renders.
 * - `useLabs()`: the Labs state (experiments + switches), shared by every component.
 * - `<LabsPanel>`: the 🧪 Labs page (sidebar entry and Labs → Labs Experiments…): every experiment with its
 *   description, "How to try it" and an on/off switch.
 * - `<LabsSlot area=… />`: THE hook point for New Tab / board experiments. It renders, for every enabled experiment
 *   of that area, the default export of `src/labs/experiments/<id>/renderer.tsx` (collected at build time).
 *   Areas: 'newtab' (above the list of a New Tab; props: tabId, rows, source) and 'board' (inside each board card;
 *   props: row); 'feed' (inside each 📺 Feed row; props: feedItem — added by feed-triage).
 */
export interface LabsSlotProps {
  area: Exclude<ExperimentArea, 'player'>
  tabId?: string
  /** The board card's video ('board'). */
  row?: FolderEntry
  /** The rows the New Tab shows ('newtab'). */
  rows?: FolderEntry[]
  source?: Source | null
  /** The 📺 Feed row's video ('feed'). */ // added by feed-triage
  feedItem?: FeedItem
  labs: LabsInfo
}

const modules = import.meta.glob<{ default: ComponentType<LabsSlotProps> }>('../labs/experiments/*/renderer.tsx', { eager: true })
const COMPONENTS: Record<string, ComponentType<LabsSlotProps>> = Object.fromEntries(
  Object.entries(modules).map(([p, m]) => [p.split('/').slice(-2, -1)[0], m.default]))

// one shared store: loaded once, refreshed after a switch
let current: LabsInfo | null | undefined
const listeners = new Set<(i: LabsInfo | null) => void>()
let loading: Promise<void> | null = null
function load(): void {
  if (loading) return
  loading = window.fa.labsInfo().then((i) => { current = i; listeners.forEach((f) => f(i)) }).finally(() => { loading = null })
}

export function useLabs(): LabsInfo | null {
  const [info, setInfo] = useState<LabsInfo | null>(current ?? null)
  useEffect(() => {
    listeners.add(setInfo)
    if (current === undefined) load()
    else setInfo(current)
    return () => { listeners.delete(setInfo) }
  }, [])
  return info
}

export async function setExperiment(id: string, on: boolean): Promise<void> {
  const i = await window.fa.labsSetEnabled(id, on)
  current = i
  listeners.forEach((f) => f(i))
}

export async function setAi(v: Partial<LabsInfo['ai']>): Promise<void> {
  const i = await window.fa.labsSetAi(v)
  current = i
  listeners.forEach((f) => f(i))
}

/** The AI engine every Labs AI feature uses: Codex (the ChatGPT subscription, default) or Claude; model; auto-write. */
function AiSettings({ labs }: { labs: LabsInfo }) {
  const ai = labs.ai
  const [model, setModel] = useState(ai.model)
  useEffect(() => setModel(ai.model), [ai.model])
  return (
    <div className="labs__card labs__card--on labs__ai">
      <div className="labs__row"><div className="labs__title">🤖 AI engine<span className="labs__area">{ai.label}{ai.available ? '' : ' · not found'}</span></div></div>
      <div className="labs__desc">
        Every Labs AI feature (AI notes, the analysis, Ask the video, pull quotes) uses this engine. The checks and validators are the same for both.
      </div>
      <div className="labs__airow">
        <label><input type="radio" name="labs-engine" checked={ai.engine === 'codex'} onChange={() => void setAi({ engine: 'codex' })} /> Codex (ChatGPT)</label>
        <label><input type="radio" name="labs-engine" checked={ai.engine === 'claude'} onChange={() => void setAi({ engine: 'claude' })} /> Claude</label>
        {ai.engine === 'codex' && (
          <label title="The Codex model slug (`codex debug models` lists them)">Model{' '}
            <input className="labs__model" value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => { if (model.trim() && model !== ai.model) void setAi({ model }) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} spellCheck={false} />
          </label>
        )}
        {ai.engine === 'codex' && (
          <label>Effort{' '}
            <select value={ai.effort} onChange={(e) => void setAi({ effort: e.target.value as LabsInfo['ai']['effort'] })}>
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
            </select>
          </label>
        )}
      </div>
      <label className="labs__airow labs__auto">
        <input type="checkbox" checked={ai.autoWrite} onChange={(e) => void setAi({ autoWrite: e.target.checked })} /> Write AI notes automatically when I open a video
        <span className="labs__hint">(and the analysis; only parts with no notes; never slides)</span>
      </label>
      {ai.paused && <div className="labs__warn">Paused: {ai.paused}</div>}
    </div>
  )
}

/** One experiment's slot content; a crash only hides that experiment. */
class Guard extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.error(`labs experiment ${this.props.id}:`, e) }
  render() { return this.state.failed ? null : this.props.children }
}

export function LabsSlot(props: Omit<LabsSlotProps, 'labs'>) {
  const labs = useLabs()
  if (!labs) return null
  const on = labs.experiments.filter((e) => e.enabled && e.area === props.area && COMPONENTS[e.id])
  if (!on.length) return null
  return <>{on.map((e) => { const C = COMPONENTS[e.id]; return <Guard key={e.id} id={e.id}><C {...props} labs={labs} /></Guard> })}</>
}

const AREA: Record<ExperimentArea, string> = { player: 'Player', newtab: 'New Tab', board: 'Board', feed: 'Feed' } // feed: added by feed-triage

/** The 🧪 Labs page. */
export function LabsPanel() {
  const labs = useLabs()
  if (!labs) return null
  return (
    <div className="labs">
      <div className="labs__head">
        <h2 className="listheader__title">🧪 Labs</h2>
        <p className="labs__intro">
          Experiments to try on your real videos. Labs never writes to your vault — notes, status and progress are not saved
          there — so switch things on, try them, and keep what is useful. Player experiments apply to videos you open (or reload with ⌘R) after the switch.
        </p>
        <p className="labs__data">Labs data: <button className="labs__link" onClick={() => window.fa.showInFinder(labs.userData)}>{labs.userData}</button></p>
      </div>
      <div className="labs__list">
        {labs.ai && <AiSettings labs={labs} />}
        {labs.experiments.length === 0 && <div className="labs__empty">No experiments yet.</div>}
        {labs.experiments.map((e) => (
          <div key={e.id} className={'labs__card' + (e.enabled ? ' labs__card--on' : '')}>
            <div className="labs__row">
              <div className="labs__title">{e.title}<span className="labs__area">{AREA[e.area]}</span></div>
              <label className="labs__switch" title={e.enabled ? 'On — click to turn off' : 'Off — click to turn on'}>
                <input type="checkbox" checked={e.enabled} onChange={(ev) => void setExperiment(e.id, ev.target.checked)} aria-label={`${e.title} on/off`} />
                <span className="labs__knob" />
              </label>
            </div>
            <div className="labs__desc">{e.description}</div>
            <div className="labs__how"><b>How to try it:</b> {e.howTo}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
