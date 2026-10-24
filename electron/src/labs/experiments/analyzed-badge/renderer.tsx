// Labs experiment "analyzed-badge" (area 'board'): the example of a shell experiment. The default export is
// rendered by <LabsSlot area="board" row={…} /> inside every board card while the experiment is on.
import { useEffect, useState } from 'react'
import type { LabsSlotProps } from '../../../renderer/labs'

type Index = Record<string, { createdAt: string; highlights: number }>
// one fetch for all cards, refreshed at most every 10 s
let cache: { at: number; p: Promise<Index> } | null = null
const index = (): Promise<Index> => {
  if (!cache || Date.now() - cache.at > 10_000) cache = { at: Date.now(), p: window.fa.labsAnalyzed() }
  return cache.p
}

export default function AnalyzedBadge({ row, labs }: LabsSlotProps) {
  const [info, setInfo] = useState<{ createdAt: string; highlights: number } | null>(null)
  useEffect(() => {
    let live = true
    if (row?.videoId) void index().then((i) => { if (live) setInfo(i[row.videoId!] ?? null) })
    return () => { live = false }
  }, [row?.videoId])
  if (!info) return null
  // the Triage cards experiment shows the same count ("🎬 18 highlights · 24 min") on cards it can open: no second chip
  if (row?.ready && labs.experiments.some((e) => e.id === 'triage-cards' && e.enabled)) return null
  return (
    <div className="bcard__meta" title={`Labs analysis from ${new Date(info.createdAt).toLocaleString()}`}>
      <span className="labs-chip">🧪 {info.highlights} highlights</span>
    </div>
  )
}
