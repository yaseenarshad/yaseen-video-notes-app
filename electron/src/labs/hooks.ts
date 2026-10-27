/**
 * Types for an experiment's optional main-process hooks: `src/labs/experiments/<id>/main.ts`
 * (`export default defineMainHooks({ … })`). Collected by src/main/labs/index.ts with import.meta.glob.
 *
 * - `route`: answers the player page's requests to `/labs/x/<id>/<path>` (GET or POST) for the open video —
 *   return JSON-able data (sent as JSON), a `{ status, type, body }` response, or undefined (404).
 * - `ipc`: methods the shell (New Tab / board experiments) calls with `window.fa.labsCall(id, method, ...args)`.
 * Write files only through `ctx.writeFile` / into `ctx.userData` (Labs' own data); the vault is read-only anyway.
 */
export interface LabsMainContext {
  /** Labs' userData folder (labs-cache/, labs-state.json, …). */
  userData: string
  log: (line: string) => void
}

export interface LabsVideoContext extends LabsMainContext {
  videoId: string
  title: string
  /** The video folder (in the vault: read-only). */
  folder: string
  markdown: string
  /** Path of the .follow-along.json (words + times). */
  sidecar: string
}

export interface LabsRequest { method: string; path: string; query: URLSearchParams; body: string }
export interface LabsRawResponse { status: number; type: string; body: string | Buffer }

export interface LabsMainHooks {
  route?: (req: LabsRequest, ctx: LabsVideoContext) => unknown | Promise<unknown>
  /** A video was opened in Labs, or just added to labs-library ("Add to Library") — e.g. to start background work. */
  onVideo?: (ctx: LabsVideoContext, why: 'opened' | 'added') => void
  ipc?: Record<string, (ctx: LabsMainContext, ...args: unknown[]) => unknown | Promise<unknown>>
}

export const defineMainHooks = (h: LabsMainHooks): LabsMainHooks => h
