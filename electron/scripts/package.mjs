#!/usr/bin/env node
// USAGE: npm run package            → electron/dist/Yaseen Video Notes.app      (bundle id com.yaseen.videonotes)
//        npm run package:labs       → electron/dist/Yaseen Video Notes Labs.app (com.yaseen.videonotes.labs)
// Builds (electron-vite), packs with electron-builder (--mac --dir, arm64) and puts the app in electron/dist/.
// Nothing outside electron/ is written. (Builds from before the rename are electron/dist/Follow Along.app; that
// copy is left alone, it may be running.)
// The Labs flavor (--labs, docs/labs.md) builds with VIDEO_NOTES_FLAVOR=labs into out-labs/ and packs into
// dist-builder-labs/ with its own name, bundle id and icon, so the two builds never touch each other's files.
// To put the build in /Applications and restart it: npm run install-app (install-app:labs).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LABS = process.argv.includes('--labs')
const NAME = LABS ? 'Yaseen Video Notes Labs' : 'Yaseen Video Notes'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })

const builderOut = LABS ? 'dist-builder-labs' : 'dist-builder'
if (LABS) run('npx', ['electron-vite', 'build'], { VIDEO_NOTES_FLAVOR: 'labs' }) // → out-labs/ (electron.vite.config.ts)
else run('npx', ['electron-vite', 'build'], { VIDEO_NOTES_FLAVOR: 'normal' })
rmSync(join(root, builderOut), { recursive: true, force: true })

const builderArgs = ['electron-builder', '--mac', '--dir', '--arm64']
let labsConfig = null
if (LABS) {
  // the package.json "build" config with the Labs name, bundle id, icon and output folders
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const config = {
    ...pkg.build,
    appId: 'com.yaseen.videonotes.labs',
    productName: NAME,
    directories: { output: builderOut },
    files: ['out-labs/**'],
    mac: { ...pkg.build.mac, icon: 'build/icon-labs.icns' },
    extraMetadata: { name: 'yaseen-video-notes-labs', productName: NAME, main: 'out-labs/main/index.js' },
  }
  labsConfig = join(root, '.labs-builder.json')
  writeFileSync(labsConfig, JSON.stringify(config, null, 2))
  builderArgs.push('--config', labsConfig)
}
try {
  run('npx', builderArgs)
} finally {
  if (labsConfig) rmSync(labsConfig, { force: true })
}
const built = join(root, `${builderOut}/mac-arm64/${NAME}.app`)
if (!existsSync(built)) throw new Error(`not built: ${built}`)
const out = join(root, `dist/${NAME}.app`)
rmSync(out, { recursive: true, force: true })
mkdirSync(dirname(out), { recursive: true })
run('ditto', [built, out])
rmSync(join(root, builderOut), { recursive: true, force: true })
run('codesign', ['--verify', '--deep', '--strict', out])
console.log(`App: ${out}`)
