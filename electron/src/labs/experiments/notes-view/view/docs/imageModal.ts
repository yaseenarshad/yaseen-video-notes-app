// PORTED from yaseen-docs-app client/src/editor/image/ImageModal.tsx @ 4608f7a8 (2026-10-26): the same lightbox
// (classes, imageModal.css, keys, clamped ← / → gallery, "n / m", focus handed back on close), as plain DOM — the
// player page has no React. ADAPTED: `onIndex` reports the cursor (the Notes view seeks to a slide's time from it).
import type { GalleryImage } from './imageOptions'
import './imageModal.css'

export interface ImageModalOptions {
  images: (GalleryImage & { caption?: string })[]
  index: number
  onClose?: () => void
}

let open: (() => void) | null = null

/** Opens the lightbox over the page; returns its close function. One at a time (a second open replaces the first). */
export function openImageModal({ images, index, onClose }: ImageModalOptions): () => void {
  open?.()
  const opener = document.activeElement
  let current = Math.max(0, Math.min(images.length - 1, index))
  const count = images.length

  const overlay = document.createElement('div')
  overlay.className = 'image-modal-overlay'
  overlay.tabIndex = -1
  const figure = document.createElement('figure')
  figure.className = 'image-modal'
  figure.setAttribute('role', 'dialog')
  figure.setAttribute('aria-modal', 'true')
  const img = document.createElement('img')
  img.className = 'image-modal__img'
  const caption = document.createElement('figcaption')
  caption.className = 'image-modal__caption'
  figure.append(img, caption)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'image-modal__close'
  close.setAttribute('aria-label', 'Close image')
  close.textContent = '✕'
  overlay.append(figure, close)

  let prevBtn: HTMLButtonElement | null = null, nextBtn: HTMLButtonElement | null = null, counter: HTMLSpanElement | null = null
  if (count > 1) {
    const nav = document.createElement('div')
    nav.className = 'image-modal__nav'
    prevBtn = document.createElement('button')
    prevBtn.type = 'button'; prevBtn.className = 'image-modal__arrow'; prevBtn.setAttribute('aria-label', 'Previous image'); prevBtn.textContent = '‹'
    counter = document.createElement('span'); counter.className = 'image-modal__count'
    nextBtn = document.createElement('button')
    nextBtn.type = 'button'; nextBtn.className = 'image-modal__arrow'; nextBtn.setAttribute('aria-label', 'Next image'); nextBtn.textContent = '›'
    nav.append(prevBtn, counter, nextBtn)
    nav.addEventListener('mousedown', (e) => e.stopPropagation())
    prevBtn.onclick = () => go(-1)
    nextBtn.onclick = () => go(1)
    overlay.append(nav)
  }

  function render(): void {
    const image = images[current]
    img.src = image.src
    img.alt = image.alt
    const text = image.caption ?? image.alt
    caption.textContent = text
    caption.style.display = text ? '' : 'none'
    figure.setAttribute('aria-label', image.alt || 'Image')
    if (counter) counter.textContent = `${current + 1} / ${count}`
    if (prevBtn) prevBtn.disabled = current <= 0
    if (nextBtn) nextBtn.disabled = current >= count - 1
  }
  // Clamped, never wrapped: the ends are where the cursor stops.
  function go(d: number): void { current = Math.max(0, Math.min(count - 1, current + d)); render() }

  function shut(): void {
    if (!overlay.isConnected) return
    overlay.remove()
    open = null
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    onClose?.()
  }

  figure.addEventListener('mousedown', (e) => e.stopPropagation())
  close.addEventListener('mousedown', (e) => e.stopPropagation())
  close.onclick = shut
  overlay.addEventListener('mousedown', shut)
  // Keys are the overlay's, never window's — and they never reach the player's own keys (Space, ←, → …).
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shut()
    else if (e.key === 'ArrowLeft') go(-1)
    else if (e.key === 'ArrowRight') go(1)
    else { e.stopPropagation(); return }
    e.preventDefault()
    e.stopPropagation()
  })
  render()
  document.body.appendChild(overlay)
  overlay.focus()
  open = shut
  return shut
}
