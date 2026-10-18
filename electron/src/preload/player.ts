// Preload of a player page (served from http://localhost:<port>/): one way to talk to the app,
// window.faNative.post(message) — what window.webkit.messageHandlers.fa was in the Swift app.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('faNative', {
  post: (m: unknown) => {
    try { ipcRenderer.send('player:native', JSON.parse(JSON.stringify(m))) } catch { /* not serializable */ }
  },
})
