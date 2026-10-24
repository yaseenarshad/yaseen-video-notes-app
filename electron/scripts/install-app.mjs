#!/usr/bin/env node
// USAGE: npm run install-app
// Ships a change to the user: packages the app (scripts/package.mjs → electron/dist/Yaseen Video Notes.app),
// quits the running copy if any (it saves its tabs and positions on quit), replaces
// /Applications/Yaseen Video Notes.app with the fresh build (a real copy made with ditto, not a symlink)
// and opens it. It also installs the `video-notes` command (build/video-notes: the agents' CLI, run with the
// app's Electron as plain Node, no window) as /opt/homebrew/bin/video-notes and ~/.local/bin/video-notes;
// a location that is not writable is skipped quietly. Re-installed every time (idempotent).
// `npm run install-app -- --cli-only` installs only the command.
//
// The first time (no settings under the new name yet) it also quits a running "Follow Along" (the app's
// old name, bundle id com.yaseen.followalong) first, so its open tabs are saved before the new app copies
// its settings on first launch.
//
// `npm run install-app:labs` (--labs) does the same for the 🧪 Labs app (docs/labs.md): packages
// "Yaseen Video Notes Labs", quits only a running Labs (com.yaseen.videonotes.labs — never the normal app),
// replaces /Applications/Yaseen Video Notes Labs.app and opens it. It does NOT install the `video-notes` command;
// it installs `video-notes-labs` (build/video-notes-labs: `video-notes-labs analyze …`) into ~/.local/bin only.
import { execFileSync } from 'node:child_process'
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LABS = process.argv.includes('--labs')
const NAME = LABS ? 'Yaseen Video Notes Labs' : 'Yaseen Video Notes'
const BUNDLE_ID = LABS ? 'com.yaseen.videonotes.labs' : 'com.yaseen.videonotes'
const OLD_BUNDLE_ID = 'com.yaseen.followalong'
const SHIM = LABS ? 'video-notes-labs' : 'video-notes'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = join(root, `dist/${NAME}.app`)
const target = `/Applications/${NAME}.app`

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
const osa = (script) => execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
/** True while an app with this bundle id runs (asking does not launch it; an unknown id is "not running"). */
const running = (id) => { try { return osa(`application id "${id}" is running`) === 'true' } catch { return false } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function quit(id) {
  if (!running(id)) return
  console.log(`Quitting ${id} …`)
  try { osa(`tell application id "${id}" to quit`) } catch { /* checked below */ }
  for (let i = 0; i < 80 && running(id); i++) await sleep(250)
  if (running(id)) throw new Error(`${id} is still running after 20 s; quit it by hand and run this again.`)
}

/** Copies the video-notes shim into each bin folder (atomic: temp file + rename); skips unwritable ones quietly. */
function installCommand() {
  const shim = join(root, `build/${SHIM}`)
  const dirs = process.env.VIDEO_NOTES_SHIM_DIRS ? process.env.VIDEO_NOTES_SHIM_DIRS.split(':')
    : LABS ? [join(homedir(), '.local/bin')] : ['/opt/homebrew/bin', join(homedir(), '.local/bin')]
  for (const dir of dirs) {
    try {
      if (dir.startsWith(homedir())) mkdirSync(dir, { recursive: true })
      accessSync(dir, constants.W_OK)
      const dest = join(dir, SHIM), tmp = `${dest}.${process.pid}.tmp`
      copyFileSync(shim, tmp)
      chmodSync(tmp, 0o755)
      renameSync(tmp, dest)
      console.log(`Installed: ${dest}`)
    } catch { /* not writable: skip */ }
  }
}

if (process.argv.includes('--cli-only')) { installCommand(); process.exit(0) }

run(process.execPath, [join(root, 'scripts/package.mjs'), ...(LABS ? ['--labs'] : [])])
if (!existsSync(built)) throw new Error(`not built: ${built}`)

if (!LABS && !existsSync(join(homedir(), 'Library/Application Support', NAME, 'settings.json'))) await quit(OLD_BUNDLE_ID)
await quit(BUNDLE_ID) // Labs: only the Labs app (the normal app keeps running)

// Copy next to the target first, then swap, so /Applications never holds half an app.
const fresh = `/Applications/.${NAME}.app.new`
rmSync(fresh, { recursive: true, force: true })
run('ditto', [built, fresh])
rmSync(target, { recursive: true, force: true })
renameSync(fresh, target)
run('codesign', ['--verify', '--deep', '--strict', target])
console.log(`Installed: ${target}`)
installCommand()
run('open', [target])
