// VENDORED from yaseen-docs-app client/src/editor/outline/foldCarry.ts @ 4608f7a8 (2026-10-26). Unchanged. Keep it diffable against the source.
/**
 * Carrying a fold plugin's DecorationSet through a doc edit instead of rebuilding it (YAZ-2131 5C).
 * Each check answers "does the mapped decoration land exactly where a rebuild puts it?" with the
 * rule ProseMirror itself applies when it maps that kind of decoration.
 */
import type { Mappable } from '@milkdown/kit/prose/transform'

/** The folded positions as one comparable string: half of a fold plugin's decoration cache key. */
export const collapsedKey = (positions: ReadonlySet<number>): string => [...positions].sort((a, b) => a - b).join(',')

/** A side-0 widget at `from` survives the mapping and lands on `to`. */
export const widgetLands = (mapping: Mappable, from: number, to: number): boolean => {
  const mapped = mapping.mapResult(from, 1)
  return !mapped.deleted && mapped.pos === to
}

/** Node decorations over `before` survive the mapping and cover exactly `after`, one for one. */
export const nodeRangesLand = (
  mapping: Mappable,
  before: readonly { from: number; to: number }[],
  after: readonly { from: number; to: number }[],
): boolean =>
  before.length === after.length &&
  before.every(({ from, to }, i) => {
    const start = mapping.mapResult(from, 1)
    const end = mapping.mapResult(to, -1)
    return !start.deleted && !end.deleted && start.pos === after[i].from && end.pos === after[i].to
  })
