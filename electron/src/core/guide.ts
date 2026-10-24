/**
 * The agent guide: a short, versioned HTML comment in each transcript .md, right after the header's
 * metadata list and before the `---` line that ends the header. Since v3 it only points agents to the skill
 * file with the full rules (`SKILL_PATH`). It is the only copy of this text in the code.
 *
 * Every parser skips HTML comment blocks in the file (`commentMask`): the example lines inside the
 * guide are never paragraphs, notes or chapters.
 *
 * It is written into new folders and "needs setup" conversions; an existing file gets it (or an
 * upgrade) only when the app writes that file anyway (a note change, a status write). Never a write
 * just for the guide.
 */

export const GUIDE_VERSION = 3

/** Where the full agent rules live (a skill file kept by the user; not in each .md, so files never need a backfill). */
export const SKILL_PATH = '/Users/yasin/Documents/GitHub/skills-global-yaseen/yaseen-video-notes-app/SKILL.md'

/**
 * Since v3 the guide is a one-line pointer: agent rules change in the skill file, never in each .md. The
 * `follow-along guide vN` marker stays, so older guides (v1, v2: the full rules) are found and replaced in place.
 */
export const GUIDE = `<!-- follow-along guide v${GUIDE_VERSION} — this file is managed by the Yaseen Video Notes app. Agents: before editing it, read ${SKILL_PATH} — and read it again fresh if some time has passed since you last read it, because it changes; don't rely on a remembered copy. -->`

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
