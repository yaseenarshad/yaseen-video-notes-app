import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs' // added by notes-view
import { build as esbuild, type Plugin as EsbuildPlugin } from 'esbuild' // added by notes-view
import type { Plugin } from 'vite' // added by notes-view

// Like yaseen-docs-app: main + preload + renderer with electron-vite, everything bundled into out/
// (the packaged app ships no node_modules). Two main entries: the app, and the plain-Node CLI.
// The build flavor (normal | labs, docs/labs.md) comes from VIDEO_NOTES_FLAVOR at build time and is compiled in as
// __VN_FLAVOR__; the Labs build goes to out-labs/ (not out/) so the two builds never overwrite each other.
const FLAVOR = process.env.VIDEO_NOTES_FLAVOR === 'labs' ? 'labs' : 'normal'
const define = { __VN_FLAVOR__: JSON.stringify(FLAVOR) }
const OUT = resolve(__dirname, FLAVOR === 'labs' ? 'out-labs' : 'out')

// added by notes-view: `import x from './entry.ts?iife'` → `{ js, css }` strings — the file bundled for the browser
// by esbuild (one IIFE, minified; the CSS its imports pull in, `*.css?inline` as a string). Lets a Labs experiment's
// main.ts serve a page bundle (notes-view: Milkdown) that the player page loads lazily. See docs/labs.md.
function iifeBundle(): Plugin {
  const inlineCss: EsbuildPlugin = {
    name: 'inline-css',
    setup(b) {
      b.onResolve({ filter: /\?inline$/ }, async (a) => {
        const r = await b.resolve(a.path.replace(/\?inline$/, ''), { resolveDir: a.resolveDir, kind: 'import-statement' })
        return { path: r.path, namespace: 'inline-css' }
      })
      b.onLoad({ filter: /.*/, namespace: 'inline-css' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }))
    },
  }
  return {
    name: 'vn-iife',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id.endsWith('?iife')) return null
      const r = await this.resolve(id.slice(0, -5), importer, { skipSelf: true })
      return r ? '\0iife:' + r.id : null
    },
    async load(id) {
      if (!id.startsWith('\0iife:')) return null
      const r = await esbuild({
        entryPoints: [id.slice(6)], bundle: true, format: 'iife', minify: true, write: false, outdir: resolve(OUT, '.iife'),
        platform: 'browser', target: 'chrome140', metafile: true, legalComments: 'none', plugins: [inlineCss],
        define: { 'process.env.NODE_ENV': '"production"' },
      })
      for (const f of Object.keys(r.metafile.inputs)) if (!f.includes(':')) this.addWatchFile(resolve(__dirname, f))
      const js = r.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? ''
      const css = r.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? ''
      return `export default ${JSON.stringify({ js, css })}`
    },
  }
}

export default defineConfig({
  main: {
    define,
    plugins: [iifeBundle()], // added by notes-view
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
