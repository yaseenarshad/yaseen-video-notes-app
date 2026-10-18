// electron-builder `afterPack` hook: trim Chromium's locale files to English, then seal the bundle
// with a deep signature — with the free self-signed "Yaseen Local Signing" certificate when the
// keychain has it (the same one the Swift app and yaseen-docs-app use, so macOS keeps permissions
// across builds), else ad-hoc. Same approach as yaseen-docs-app's desktop/build/adhocSign.cjs.
const { execFileSync } = require('node:child_process')
const { readdirSync, rmSync } = require('node:fs')
const path = require('node:path')

function hasIdentity(name) {
  try {
    return execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' }).includes(`"${name}"`)
  } catch {
    return false
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const res = path.join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources')
  for (const name of readdirSync(res)) if (name.endsWith('.lproj') && name !== 'en.lproj' && !name.startsWith('en_')) rmSync(path.join(res, name), { recursive: true })
  const name = process.env.MAC_SIGN_IDENTITY || 'Yaseen Local Signing'
  const identity = hasIdentity(name) ? name : '-'
  if (identity === '-') console.warn(`warning: no "${name}" certificate in the keychain; signing ad-hoc.`)
  execFileSync('codesign', ['--force', '--deep', '--sign', identity, app], { stdio: 'inherit' })
}
