/**
 * The agent guide: a short, versioned HTML comment in each transcript .md, right after the header's
 * metadata list and before the `---` line that ends the header, so an agent editing the file by hand
 * follows the format. It is the only copy of this text in the code.
 *
 * Every parser skips HTML comment blocks in the file (`commentMask`): the example lines inside the
 * guide are never paragraphs, notes or chapters.
 *
 * It is written into new folders and "needs setup" conversions; an existing file gets it (or an
 * upgrade) only when the app writes that file anyway (a note change, a status write). Never a write
 * just for the guide.
 */

export const GUIDE_VERSION = 1

export const GUIDE = `<!-- follow-along guide v${GUIDE_VERSION} — rules for agents editing this file (the Follow Along app reads it)
- Paragraph lines start with [m:ss](youtube link). Never add, remove, merge, reorder or reword them.
- Notes go under their paragraph: > 💬 [m:ss](link&t=Ns) text
  Note on highlighted words: > 💬 [m:ss–m:ss](link&t=Ns) text, then a last line > “quote”
- Tags right after the time: #mochi = make a flashcard from this note; #resolved = done. No #resolved = open.
- Only work on notes WITHOUT #resolved. When done: add #resolved (keep other tags) and a line > ↳ resolved: what you did.
- Hand-typed notes: > 💬 text (no time) under the paragraph.
- Never delete the user's note text. Leave the header, ## chapter headings and frontmatter alone.
Full spec: docs/how-it-works.md in github.com/yaseenarshad/video-follow-along-app
-->`

const reGuideStart = /^<!--\s*follow-along guide v(\d+)\b/

/**
 * The HTML comment blocks that start at the beginning of a line (`<!--` … `-->`, possibly one line), as
 * [start, end) line ranges. A `<!--` that never closes is a block of its own line only.
 */
export function commentBlocks(ls: string[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < ls.length; i++) {
    const at = ls[i].trimStart().startsWith('<!--') ? ls[i].indexOf('<!--') : -1
    if (at < 0) continue
    let j = i
    while (j < ls.length && !ls[j].includes('-->', j === i ? at + 4 : 0)) j++
    if (j >= ls.length) { out.push([i, i + 1]); continue }
    out.push([i, j + 1])
    i = j
  }
  return out
}

/** For each line: true when it is inside an HTML comment block (never a paragraph, note or heading). */
export function commentMask(ls: string[]): boolean[] {
  const mask = new Array<boolean>(ls.length).fill(false)
  for (const [a, b] of commentBlocks(ls)) for (let k = a; k < b; k++) mask[k] = true
  return mask
}

/** The markdown without its comment blocks (for content checks such as "has notes"). */
export function withoutComments(md: string): string {
  const ls = md.replaceAll('\r\n', '\n').split('\n')
  const mask = commentMask(ls)
  return ls.filter((_, i) => !mask[i]).join('\n')
}

/** The guide blocks ([start, end) lines and version), in file order. */
export function findGuides(ls: string[]): { start: number; end: number; version: number }[] {
  return commentBlocks(ls).flatMap(([start, end]) => {
    const m = reGuideStart.exec(ls[start].trimStart())
    return m ? [{ start, end, version: Number(m[1]) }] : []
  })
}

/**
 * The markdown with exactly one current guide: an older (or different) guide block is replaced in
 * place; without one it goes before the `---` line that ends the header (after `# Title`). A file
 * without that header is returned unchanged. Idempotent.
 */
export function ensureGuide(md: string): string {
  const crlf = md.includes('\r\n')
  const ls = md.replaceAll('\r\n', '\n').split('\n')
  const found = findGuides(ls)
  const guide = GUIDE.split('\n')
  const g = found[0]
  if (g) {
    // never more than one: extra copies go (with the blank line after each)
    for (const x of found.slice(1).reverse()) ls.splice(x.start, x.end - x.start + (ls[x.end]?.trim() === '' ? 1 : 0))
    const same = g.end - g.start === guide.length && guide.every((l, k) => ls[g.start + k] === l)
    if (same && found.length === 1) return md
    if (!same) ls.splice(g.start, g.end - g.start, ...guide)
  } else {
    const title = ls.findIndex((l) => l.startsWith('# '))
    if (title < 0) return md
    let sep = -1
    for (let i = title + 1; i < ls.length; i++) if (ls[i].trim() === '---') { sep = i; break }
    if (sep < 0) return md
    // "- uploaded: …" / blank / guide / blank / "---"
    const before = sep > 0 && ls[sep - 1].trim() === '' ? [] : ['']
    ls.splice(sep, 0, ...before, ...guide, '')
  }
  const out = ls.join('\n')
  return crlf ? out.replaceAll('\n', '\r\n') : out
}
