#!/usr/bin/env node
// USAGE: npm run package
// Builds (electron-vite), packs with electron-builder (--mac --dir, arm64) and puts the app at
// electron/dist/Yaseen Video Notes.app. Nothing outside electron/ is written. (Builds from before the
// rename are electron/dist/Follow Along.app; that copy is left alone, it may be running.)
// To put the build in /Applications and restart it: npm run install-app.
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
run('npx', ['electron-vite', 'build'])
rmSync(join(root, 'dist-builder'), { recursive: true, force: true })
run('npx', ['electron-builder', '--mac', '--dir', '--arm64'])
const built = join(root, 'dist-builder/mac-arm64/Yaseen Video Notes.app')
if (!existsSync(built)) throw new Error(`not built: ${built}`)
const out = join(root, 'dist/Yaseen Video Notes.app')
rmSync(out, { recursive: true, force: true })
mkdirSync(dirname(out), { recursive: true })
run('ditto', [built, out])
rmSync(join(root, 'dist-builder'), { recursive: true, force: true })
run('codesign', ['--verify', '--deep', '--strict', out])
console.log(`App: ${out}`)
