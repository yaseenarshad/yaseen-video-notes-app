// VENDORED from yaseen-docs-app client/src/editor/image/insertImage.ts @ 4608f7a8 (2026-10-26). ADAPTED for notes-view: imports point at ./shims (api.writeAsset = POST to the notes-view image route, paths helpers); IMAGES_DIR = notes-images (next to the notes file). Keep it diffable against the source.
/**
 * Pasted / dropped image bytes → a file in the vault → an image node in the note (YAZ-1656 /
 * YAZ-1662, 🔒 D6: BYTES WIN OVER MARKUP — when the clipboard carries both an image file and HTML,
 * the file is written and the HTML is ignored, so a screenshot never lands as a dead
 * `<img src="blob:…">`).
 *
 * The write goes through `api.writeAsset`, the same door `createDrawing` uses, into the images'
 * home under the vault (`IMAGES_DIR`, made on the way by writeAsset's own `mkdir -p`). The
 * constant lives HERE rather than beside `DRAWINGS_DIR` because each asset kind's directory sits
 * next to the one writer that uses it — `drawings/createDrawing.ts` owns drawings, this owns images.
 *
 * NEVER OVERWRITE (locked, same as drawings): every write is `create: true`; `ALREADY_EXISTS`
 * retries `-2`, `-3`, … (bounded by `MAX_ATTEMPTS`) and every OTHER failure — too large, an
 * extension main refuses, a dead bridge — goes to the host's passive notice and inserts nothing.
 *
 * The node is `schema.nodes.image` — the commonmark node the editor already has (🔒 D2), so the
 * markdown out is a plain `![name](assets/images/name.png)`. The src is written ROOT-RELATIVE,
 * which is what main resolves second after note-relative, and what Obsidian would resolve too.
 * The insert lands at the LIVE selection at the moment the write resolves (never one captured
 * across the await), carries `closeHistory` so undo removes exactly the paste, and the paste
 * metas the rest of the clipboard code uses so paste rules and listeners treat it alike. A
 * SELECTED IMAGE (a `NodeSelection`) is a point AFTER it, never a range to replace: pasting a
 * screenshot with the last one still selected adds a second image, it does not eat the first.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { api, BridgeRequestError } from './shims'
import { basename, stripExt } from './shims'
import type { ImageOptions } from './imageOptions'
import { formatAlt } from './imageSrc'

/** The images' home under the vault root (writeAsset creates it on first use). */
export const IMAGES_DIR = 'notes-images'

/** Collisions are same-second only; a bound keeps a permanently failing write from looping forever. */
const MAX_ATTEMPTS = 20

/** File extension per MIME type; anything unrecognised is written as `.png`, the clipboard's lingua franca. */
const EXT_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
}

export function extFor(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? 'png'
}

/**
 * The first image file a DataTransfer carries: `files` first (what Finder drops and most paste
 * sources fill), then `items` of kind `file` (what some browsers put a pasted bitmap in). Null when
 * there is none — the caller then leaves the event to the text paths. Several files → only the
 * FIRST image is taken: one paste is one image, and a multi-file drop is not a batch import.
 */
export function imageFile(dt: DataTransfer | null): File | null {
  if (dt === null) return null
  for (const file of Array.from(dt.files ?? [])) {
    if (file.type.startsWith('image/')) return file
  }
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file !== null) return file
  }
  return null
}

/**
 * `<note>-20260918-143005[-2].png` — local time, second-granular. Whitespace in the note's name
 * becomes `-`: remark writes a src with a space as `(<assets/images/My Note….png>)`, and while that
 * is valid CommonMark it is a form no other tool of ours produces; a space-free name keeps the
 * link a plain `(assets/images/My-Note….png)` and the src attr exactly the path on disk.
 */
export function imageName(noteBase: string, now: Date, ext: string, suffix = 0): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  const base = noteBase.trim().replace(/\s+/g, '-') || 'image'
  return `${base}-${stamp}${suffix === 0 ? '' : `-${suffix + 1}`}.${ext}`
}

/** Writes `bytes` under `IMAGES_DIR`, never overwriting; resolves the root-relative path written. */
export async function writeImage(root: string, noteBase: string, bytes: Uint8Array, ext: string, now: Date): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const path = `${IMAGES_DIR}/${imageName(noteBase, now, ext, attempt)}`
    try {
      await api.writeAsset({ root, path, content: bytes, create: true })
      return path
    } catch (err) {
      // Only a name clash is retryable — everything else is the caller's notice.
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  throw new Error(`${MAX_ATTEMPTS} names in ${IMAGES_DIR} are already taken`)
}

/**
 * The display width a pasted image starts at, in px. The FILE is always saved at full resolution
 * (`writeImage` never re-encodes); only the markdown carries `|W`, the same Obsidian syntax the
 * resize handle writes — so a screenshot lands at a manageable size instead of filling the column,
 * and double-click still shows every pixel. An image narrower than this keeps its natural size:
 * a 16px icon must not be blown up to 400.
 */
export const PASTED_IMAGE_WIDTH = 400

/** The bitmap's pixel width, or null when the bytes cannot be decoded (then no `|W` is written). */
async function naturalWidth(file: File): Promise<number | null> {
  try {
    const bmp = await createImageBitmap(file)
    const w = bmp.width
    bmp.close()
    return w
  } catch {
    return null
  }
}

/** Writes the file to the vault and inserts its image node at the live selection (see the module doc). */
export async function insertPastedImage(opts: ImageOptions, view: EditorView, file: File, now: Date = new Date()): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const width = await naturalWidth(file)
    const path = await writeImage(opts.root, stripExt(basename(opts.notePath)), bytes, extFor(file.type), now)
    const name = basename(path)
    const text = name.slice(0, name.lastIndexOf('.'))
    const alt = width !== null && width > PASTED_IMAGE_WIDTH ? formatAlt(text, PASTED_IMAGE_WIDTH) : text
    const node = view.state.schema.nodes.image.create({ src: path, alt })
    const tr = closeHistory(view.state.tr)
    // A selected image is a point after it, never a range to replace (module doc).
    if (tr.selection instanceof NodeSelection) tr.setSelection(TextSelection.create(tr.doc, tr.selection.to))
    view.dispatch(tr.replaceSelectionWith(node, false).setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
  } catch (err) {
    opts.onNotice?.(`Can't paste image: ${err instanceof Error ? err.message : String(err)}`)
  }
}
