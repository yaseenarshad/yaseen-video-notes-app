// The Yaseen Video Notes CLI as plain Node: `node out/main/cli.js --make <url> --out <dir>`.
// The Labs build (`video-notes-labs`) runs read-only on the vault, like the Labs app (core/flavor.ts).
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { configureLabs, labsUserDataDefault } from '../core/flavor'
import { flag, runCLI } from './run'

const args = process.argv.slice(2)
if (__VN_FLAVOR__ === 'labs') {
  const ud = flag(args, '--user-data-dir') ?? process.env.VIDEO_NOTES_USER_DATA ?? labsUserDataDefault()
  configureLabs(resolve(ud.startsWith('~/') ? homedir() + ud.slice(1) : ud), (l) => process.stderr.write(l + '\n'))
}
runCLI(args).then((code) => process.exit(code))
