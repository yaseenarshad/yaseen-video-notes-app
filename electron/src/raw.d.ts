declare module '*?raw' {
  const text: string
  export default text
}

/** The build flavor, set by electron.vite.config.ts from VIDEO_NOTES_FLAVOR at build time: 'normal' | 'labs'. */
declare const __VN_FLAVOR__: string
