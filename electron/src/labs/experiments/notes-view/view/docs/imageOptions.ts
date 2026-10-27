// VENDORED from yaseen-docs-app client/src/editor/image/imageOptions.ts @ 4608f7a8 (2026-10-26). ADAPTED for notes-view: GalleryImage / onOpenImage gain the optional `el` (see imageView.ts). Keep it diffable against the source.
/**
 * The host's side of first-class images (YAZ-1656): ONE options object, handed to `createCrepe`
 * as `opts.image`, that every image plugin in this folder reads from.
 *
 * Two consumers, two ways in:
 *  - `imageView.ts` captures it directly — `createImageView(opts)` is registered by createCrepe
 *    the way `createDrawingPreview(opts)` is.
 *  - `clipboardPaste.ts` cannot: it is a bare `$prose((ctx) => …)` with no options, and it must
 *    stay one (its paste-mode contract is the host's, not the image feature's). So createCrepe also
 *    INJECTS the options into the editor ctx under `imageOptionsCtx`, the same `Ctx` slice
 *    mechanism Milkdown's own features use for per-editor config (`imageAttr`, `editorViewOptionsCtx`).
 *    A null slice means "this editor has no image host" — paste falls through to text handling.
 */
import { createSlice, type Ctx } from '@milkdown/kit/ctx'

/** One image as the lightbox shows it: the RESOLVED src and the alt's text half. */
export interface GalleryImage {
  src: string
  alt: string
}

export interface ImageOptions {
  /** Vault root (absolute); with the note's directory it is what a relative `src` resolves against. */
  root: string
  /** ABSOLUTE path of the note this editor shows; its directory is the `from` of every relative src. */
  notePath: string
  /**
   * Double-click on a rendered image: every image on the page in document order plus the one
   * clicked (the lightbox pages through them). Absent → double-click is inert.
   */
  onOpenImage?: (gallery: { images: GalleryImage[]; index: number; el?: HTMLImageElement }) => void
  /** A paste/drop that could not be written: the passive in-window notice, never a dialog. */
  onNotice?: (message: string) => void
}

/** Per-editor image options for plugins that have no constructor of their own (see the module doc). */
export const imageOptionsCtx = createSlice<ImageOptions | null>(null, 'mdapp-image-options')

/** The injected options, or null when this editor has none (or was built without createCrepe). */
export function imageOptionsOf(ctx: Ctx): ImageOptions | null {
  return ctx.get(imageOptionsCtx)
}
