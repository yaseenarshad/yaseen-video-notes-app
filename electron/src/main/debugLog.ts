import { appendFile, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

/** Appends player events to a log file when --debug-log (or FOLLOW_ALONG_DEBUG_LOG) is set. */
export class DebugLog {
  private static path: string | null = null
  private static queue: Promise<void> = Promise.resolve()

  static start(path: string | null | undefined): void {
    if (!path) return
    const p = path.startsWith('~/') ? homedir() + path.slice(1) : path
    try { writeFileSync(p, '', { flag: 'a' }) } catch { return }
    DebugLog.path = p
  }

  static get on(): boolean { return DebugLog.path !== null }

  static log(line: string): void {
    const p = DebugLog.path
    if (!p) return
    const text = `${new Date().toISOString()} ${line}\n`
    DebugLog.queue = DebugLog.queue.then(() => new Promise((res) => appendFile(p, text, () => res())))
  }
}
