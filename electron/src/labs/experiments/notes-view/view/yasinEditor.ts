/**
 * notes-view: the 🧑 Yasin editor of one section — Milkdown Crepe set up like the docs app's note editor
 * (yaseen-docs-app client/src/editor/createCrepe.ts + crepe.ts @ 4608f7a8):
 * - `CrepeBuilder` + only the features loaded here, in Crepe's own order: Cursor (`virtual: false`, the docs app's
 *   native caret), ListItem, LinkTooltip, Placeholder, Toolbar. Not loaded: BlockEdit (slash menu / drag handle),
 *   CodeMirror, Table, ImageBlock, Latex — the Notes view is bullets (the docs app disables ImageBlock and Latex too).
 * - list_item content widened to `block+` (as createCrepe does) so image bullets and `* - nested` round-trip.
 * - the docs app's own add-ons, vendored in ./docs: collapsible bullets (outlineFolding + guide lines), image node
 *   view (resize handles, fold chip, double-click → the page-wide lightbox), paste / drop of image bytes
 *   (insertImage, written next to the notes file), the outliner keymap (Tab / Shift-Tab / Enter / Backspace).
 */
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import { editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core'
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'
import { wrapInBulletListCommand } from '@milkdown/kit/preset/commonmark'
import { Selection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose, callCommand } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import { guideLines } from './docs/guideLines'
import type { ImageOptions } from './docs/imageOptions'
import { createImageView } from './docs/imageView'
import { imageFile, insertPastedImage } from './docs/insertImage'
import { outlinerKeymap } from './docs/listCommands'
import { createOutlineFolding } from './docs/outlineFolding'

export interface YasinEditorOptions {
  root: HTMLElement
  markdown: string
  image: ImageOptions
  onChange: (markdown: string) => void
  onFocus?: () => void
  onBlur?: () => void
}

export interface YasinEditor {
  crepe: CrepeBuilder
  view: () => EditorView
  markdown: () => string
  focus: () => void
  destroy: () => Promise<void>
}

/** Paste / drop of image bytes (the docs app's clipboardPaste.ts image branch, without its text paste modes). */
const imagePaste = (image: ImageOptions) =>
  $prose((ctx) => {
    ctx.update(editorViewOptionsCtx, (prev) => ({
      ...prev,
      handlePaste: (view, event, slice) => {
        if (!view.editable) return true
        const file = view.state.selection.$from.parent.type.spec.code ? null : imageFile(event.clipboardData)
        if (file !== null) { void insertPastedImage(image, view, file); return true }
        return prev.handlePaste?.(view, event, slice) ?? false
      },
      handleDrop: (view, event, slice, moved) => {
        const file = !moved && view.editable ? imageFile(event.dataTransfer) : null
        if (file === null) return prev.handleDrop?.(view, event, slice, moved) ?? false
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (at === null || view.state.doc.resolve(at.pos).parent.type.spec.code) return true
        view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at.pos))))
        void insertPastedImage(image, view, file)
        return true
      },
    }))
    return new Plugin({})
  })

export async function createYasinEditor(o: YasinEditorOptions): Promise<YasinEditor> {
  const crepe = new CrepeBuilder({ root: o.root, defaultValue: o.markdown })
    .addFeature(cursor, { virtual: false })
    .addFeature(listItem)
    .addFeature(linkTooltip)
    .addFeature(placeholder, { text: 'Your notes for this part…', mode: 'block' })
    .addFeature(toolbar)
  crepe.editor
    .use(extendListItemSchemaForTask.extendSchema((prev) => (ctx) => ({ ...prev(ctx), content: 'block+' })))
    .use(createOutlineFolding())
    .use(guideLines)
    .use(outlinerKeymap)
    .use(createImageView(o.image))
    .use(imagePaste(o.image))
  let last = o.markdown
  crepe.on((l) => {
    l.markdownUpdated((_ctx, md) => { if (md !== last) { last = md; o.onChange(md) } })
    if (o.onFocus) l.focus(() => o.onFocus?.())
    if (o.onBlur) l.blur(() => o.onBlur?.())
  })
  await crepe.create()
  const view = () => crepe.editor.ctx.get(editorViewCtx)
  // an empty editor starts as a bullet list: notes are bullets
  if (!o.markdown.trim()) crepe.editor.action(callCommand(wrapInBulletListCommand.key))
  return {
    crepe,
    view,
    markdown: () => crepe.getMarkdown(),
    focus: () => { const v = view(); v.focus(); if (!o.markdown.trim()) v.dispatch(v.state.tr.setSelection(Selection.atStart(v.state.doc))) },
    destroy: async () => { await crepe.destroy() },
  }
}
