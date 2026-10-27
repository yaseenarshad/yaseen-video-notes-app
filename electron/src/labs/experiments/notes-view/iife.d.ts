// notes-view: `import x from './file.ts?iife'` — the file bundled for the browser by esbuild at build time
// (electron.vite.config.ts, the `iife` plugin): its JS (an IIFE) and the CSS its imports pulled in.
declare module '*?iife' {
  const bundle: { js: string; css: string }
  export default bundle
}
