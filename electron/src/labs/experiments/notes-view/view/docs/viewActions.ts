// VENDORED from yaseen-docs-app client/src/editor/outline/viewActions.ts @ 4608f7a8 (2026-10-26). Unchanged. Keep it diffable against the source.
/**
 * Shared marker for VIEW-state transactions (GRO-2091 B). Folds (outlineFolding.ts) and zooms
 * (zoom.ts) are metadata-only transactions that never touch the document, so ProseMirror history
 * ignores them; each plugin instead keeps a one-step "panic undo" for its own latest action
 * (GRO-2075). The locked rule is that ⌘Z reverts the single LATEST view action, fold OR zoom —
 * so every fold/zoom transaction carries this meta and each plugin drops its pending undo when it
 * sees a foreign kind. `document-fold` is the deliberate exception: one transaction changes both
 * fold plugins and keeps both halves eligible for one atomic undo. A plain meta key (rather than
 * cross-importing the plugin keys) keeps the state plugins free of an import cycle.
 */
export const VIEW_ACTION_META = 'mdapp-view-action'

export type ViewAction = 'fold' | 'zoom' | 'heading-fold' | 'document-fold'
