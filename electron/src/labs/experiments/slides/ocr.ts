// Labs experiment "slides": OCR of the slide images with macOS Vision (ocr.swift), optional — slides work without it.
// The Swift source is compiled ONCE with `swiftc -O` into Labs' userData (`labs-tools/slides-ocr-<hash of the source>`);
// when swiftc is missing or fails, `swift ocr.swift …` (the interpreter, slower) is tried; when that fails too, OCR is off
// and says why. The text is what Vision read on the slide — extracted, not written by an AI.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toolEnv } from '../../../core/ytdlpUpdate'
import OCR_SWIFT from './ocr.swift?raw'

export interface OcrLine { text: string; conf: number; x: number; y: number; h: number }

/** Reading order: rows top to bottom (lines whose tops are within half a line height are one row), left to right. */
export function ocrText(lines: OcrLine[], minConf = 0.3): string {
  const ls = lines.filter((l) => l.conf >= minConf && l.text.trim()).sort((a, b) => a.y - b.y)
  const rows: OcrLine[][] = []
  for (const l of ls) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(row[0].y - l.y) < Math.max(row[0].h, l.h) / 2) row.push(l)
    else rows.push([l])
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x).map((l) => l.text.trim()).join('   ')).join('\n')
}

interface Run { code: number | null; out: string; err: string }
function run(file: string, args: string[], timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    let out = '', err = ''
    let p: ReturnType<typeof spawn>
    try { p = spawn(file, args, { env: toolEnv(), stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { resolve({ code: null, out, err: String(e) }); return }
    const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs)
    p.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8') })
    p.stderr?.on('data', (c: Buffer) => { err += c.toString('utf8') })
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: null, out, err: err + e.message }) })
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }) })
  })
}

const SWIFTC = ['/usr/bin/swiftc'], SWIFT = ['/usr/bin/swift']
const firstExisting = (l: string[]): string | null => l.find((p) => existsSync(p)) ?? null

/** The compiled OCR tool (compiling it the first time), or the interpreter command; null + why when neither works. */
export async function ocrTool(userData: string, log: (l: string) => void): Promise<{ cmd: string; pre: string[] } | { error: string }> {
  const dir = join(userData, 'labs-tools')
  mkdirSync(dir, { recursive: true })
  const hash = createHash('sha1').update(OCR_SWIFT).digest('hex').slice(0, 10)
  const bin = join(dir, `slides-ocr-${hash}`), src = join(dir, `slides-ocr-${hash}.swift`)
  if (existsSync(bin)) return { cmd: bin, pre: [] }
  writeFileSync(src, OCR_SWIFT)
  const swiftc = firstExisting(SWIFTC)
  if (swiftc) {
    log('compiling the OCR tool (once, ~30 s)…')
    const r = await run(swiftc, ['-O', '-o', bin, src], 300_000)
    if (r.code === 0 && existsSync(bin)) return { cmd: bin, pre: [] }
    log(`swiftc failed: ${(r.err || r.out).trim().split('\n').slice(-2).join(' ')}`)
  }
  const swift = firstExisting(SWIFT)
  if (swift) return { cmd: swift, pre: [src] }
  return { error: 'Swift is not installed (xcode-select --install), so slide text (OCR) is off' }
}

/** OCR of the images (in order): text per image ('' when nothing was read), or an error for the whole run. */
export async function ocrImages(userData: string, files: string[], log: (l: string) => void): Promise<{ texts: string[] } | { error: string }> {
  if (!files.length) return { texts: [] }
  const tool = await ocrTool(userData, log)
  if ('error' in tool) return tool
  const r = await run(tool.cmd, [...tool.pre, ...files], 600_000)
  const byFile = new Map<string, string>()
  for (const line of r.out.split('\n')) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line) as { file: string; lines?: OcrLine[]; error?: string }
      byFile.set(o.file, o.lines ? ocrText(o.lines) : '')
    } catch { /* not a result line */ }
  }
  if (!byFile.size) return { error: `OCR failed: ${(r.err || `exit ${r.code}`).trim().split('\n').slice(-2).join(' ')}` }
  return { texts: files.map((f) => byFile.get(f) ?? '') }
}
