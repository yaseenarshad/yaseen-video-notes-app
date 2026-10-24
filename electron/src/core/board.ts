/**
 * The Kanban board of a parent folder (New Tab → Board): one column per status option, and a manual order of
 * the cards within each column. The order lives in a small hidden file in the parent folder (synced with the
 * vault, so every Mac shows the same board):
 *
 *     <parent>/.video-notes-board.json   { "order": { "3-In-Progress": ["<videoId>", …], … } }
 *
 * Pure logic only (no fs: the shell renderer uses it too); reading / writing is in `boardFile.ts`.
 *
 * - A column shows the cards in its order list first (in that order), then the others newest first.
 * - Moving a card removes it from every list and inserts it at the drop spot in its new column. Dropping it
 *   below cards that are not in the list yet puts those cards in the list too (above it), so they stay put.
 * - Ids of cards that are gone, or that now have another status, are dropped on the next write.
 */
export const BOARD_FILE = '.video-notes-board.json'

/** Column (status value) → card ids, top first. */
export type BoardOrder = Record<string, string[]>

/** Where a card is dropped in a column: before a card, after a card, or at the top. Nothing given: end of the ordered part. */
export interface DropSpot { before?: string | null; after?: string | null; top?: boolean }

/** A card's id: the YouTube id, else the folder name. */
export function cardId(e: { videoId: string | null; folder: string }): string {
  return e.videoId ?? 'folder:' + (e.folder.split('/').filter(Boolean).pop() ?? e.folder)
}

/** Newest first: the folder's date, then the .md's modified time (the New Tab list order). */
export const newestFirst = (a: { date: number; modified: number }, b: { date: number; modified: number }): number =>
  a.date !== b.date ? b.date - a.date : b.modified - a.modified

/** The order from the file's text (anything unreadable: no order). Only lists of strings are kept, without repeats. */
export function parseBoard(text: string | null): BoardOrder {
  if (!text) return {}
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return {} }
  const order = (raw as { order?: unknown } | null)?.order
  if (!order || typeof order !== 'object' || Array.isArray(order)) return {}
  const out: BoardOrder = {}
  for (const [k, v] of Object.entries(order as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue
    const ids = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    if (ids.length) out[k] = ids
  }
  return out
}

/** The file's text: pretty JSON, empty lists left out, newline at the end. */
export function encodeBoard(order: BoardOrder): string {
  const o: BoardOrder = {}
  for (const [k, v] of Object.entries(order)) if (v.length) o[k] = v
  return JSON.stringify({ order: o }, null, 2) + '\n'
}

/** A column's cards in board order: the ones in `ids` first (in that order), then the rest by `fallback`. */
export function arrangeColumn<T>(cards: readonly T[], ids: readonly string[] | undefined, idOf: (c: T) => string, fallback: (a: T, b: T) => number): T[] {
  const byId = new Map(cards.map((c) => [idOf(c), c]))
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const id of ids ?? []) {
    const c = byId.get(id)
    if (c !== undefined && !seen.has(id)) { ordered.push(c); seen.add(id) }
  }
  const rest = cards.filter((c) => !seen.has(idOf(c))).sort(fallback)
  return [...ordered, ...rest]
}

/**
 * The order after moving card `id` into column `to` at `spot`. `arranged` is column `to` as shown (all its
 * cards in board order; the moved card may be among them when it stays in its column).
 */
export function moveCard(order: BoardOrder, id: string, to: string, arranged: readonly string[], spot: DropSpot): BoardOrder {
  const out: BoardOrder = {}
  for (const [k, v] of Object.entries(order)) out[k] = v.filter((x) => x !== id)
  const inList = new Set(out[to] ?? [])
  const list = arranged.filter((x) => x !== id)
  const orderedCount = list.filter((x) => inList.has(x)).length
  let at: number
  if (spot.top) at = 0
  else if (spot.before && list.includes(spot.before)) at = list.indexOf(spot.before)
  else if (spot.after && list.includes(spot.after)) at = list.indexOf(spot.after) + 1
  else at = orderedCount
  const head = list.slice(0, Math.max(at, orderedCount))
  head.splice(at, 0, id)
  out[to] = at <= orderedCount ? head : [...list.slice(0, at), id]
  return dropEmpty(out)
}

/** Keeps an id only in the list of the column its card is in now (`live`: id → status); drops repeats and empty lists. */
export function prune(order: BoardOrder, live: ReadonlyMap<string, string | null>): BoardOrder {
  const out: BoardOrder = {}
  for (const [k, v] of Object.entries(order)) out[k] = [...new Set(v)].filter((x) => live.get(x) === k)
  return dropEmpty(out)
}

function dropEmpty(o: BoardOrder): BoardOrder {
  const out: BoardOrder = {}
  for (const [k, v] of Object.entries(o)) if (v.length) out[k] = v
  return out
}

/** "3-In-Progress" → "In progress", "1 - Awaiting Outbound" → "Awaiting outbound". */
export function columnLabel(option: string): string {
  const s = option.replace(/^\s*\d+\s*[-.)]\s*/, '').replace(/[-_]+/g, ' ').trim()
  if (!s) return option
  const words = s.split(/\s+/)
  return words.map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join(' ')
}
