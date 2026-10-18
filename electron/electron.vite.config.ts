import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Like yaseen-docs-app: main + preload + renderer with electron-vite, everything bundled into out/
// (the packaged app ships no node_modules). Two main entries: the app, and the plain-Node CLI.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), cli: resolve(__dirname, 'src/cli/index.ts') } },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: { shell: resolve(__dirname, 'src/preload/shell.ts'), player: resolve(__dirname, 'src/preload/player.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
})
