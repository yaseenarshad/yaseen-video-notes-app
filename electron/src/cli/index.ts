// The Follow Along CLI as plain Node: `node out/main/cli.js --make <url> --out <dir>`.
import { runCLI } from './run'

runCLI(process.argv.slice(2)).then((code) => process.exit(code))
