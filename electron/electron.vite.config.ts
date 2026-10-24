import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Like yaseen-docs-app: main + preload + renderer with electron-vite, everything bundled into out/
// (the packaged app ships no node_modules). Two main entries: the app, and the plain-Node CLI.
// The build flavor (normal | labs, docs/labs.md) comes from VIDEO_NOTES_FLAVOR at build time and is compiled in as
// __VN_FLAVOR__; the Labs build goes to out-labs/ (not out/) so the two builds never overwrite each other.
const FLAVOR = process.env.VIDEO_NOTES_FLAVOR === 'labs' ? 'labs' : 'normal'
const define = { __VN_FLAVOR__: JSON.stringify(FLAVOR) }
const OUT = resolve(__dirname, FLAVOR === 'labs' ? 'out-labs' : 'out')

export default defineConfig({
  main: {
    define,
    build: {
      outDir: resolve(OUT, 'main'),
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), cli: resolve(__dirname, 'src/cli/index.ts') } },
    },
  },
  preload: {
    define,
    build: {
      outDir: resolve(OUT, 'preload'),
      externalizeDeps: false,
      rollupOptions: {
        input: { shell: resolve(__dirname, 'src/preload/shell.ts'), player: resolve(__dirname, 'src/preload/player.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    define,
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: { outDir: resolve(OUT, 'renderer'), rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
})
