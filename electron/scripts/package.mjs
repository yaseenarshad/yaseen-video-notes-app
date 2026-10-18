#!/usr/bin/env node
// USAGE: npm run package
// Builds (electron-vite), packs with electron-builder (--mac --dir, arm64) and puts the app at
// electron/dist/Follow Along.app. Nothing outside electron/ is written (the Swift app's
// build/Follow Along.app is a different folder and bundle id).
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' })
run('npx', ['electron-vite', 'build'])
rmSync(join(root, 'dist-builder'), { recursive: true, force: true })
run('npx', ['electron-builder', '--mac', '--dir', '--arm64'])
const built = join(root, 'dist-builder/mac-arm64/Follow Along.app')
if (!existsSync(built)) throw new Error(`not built: ${built}`)
const out = join(root, 'dist/Follow Along.app')
rmSync(out, { recursive: true, force: true })
mkdirSync(dirname(out), { recursive: true })
run('ditto', [built, out])
rmSync(join(root, 'dist-builder'), { recursive: true, force: true })
run('codesign', ['--verify', '--deep', '--strict', out])
console.log(`App: ${out}`)
