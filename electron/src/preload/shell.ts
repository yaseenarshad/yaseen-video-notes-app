// Preload of the shell (tab bar + New Tab pages): a small, typed IPC surface as window.fa.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FaAPI, ShellCommand, ShellState, WorkEvent } from '../shared/api'

const on = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const f = (_e: IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, f)
  return () => ipcRenderer.removeListener(channel, f)
}

const api: FaAPI = {
  state: () => ipcRenderer.invoke('shell:state'),
  onState: (cb) => on<ShellState>('shell:state', cb),
  onWork: (cb) => on<WorkEvent>('shell:work', cb),
  onCommand: (cb) => on<ShellCommand>('shell:command', cb),
  newTab: () => ipcRenderer.send('tab:new'),
  selectTab: (id) => ipcRenderer.send('tab:select', id),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  tabMenu: (id) => ipcRenderer.send('tab:menu', id),
  launcherInfo: () => ipcRenderer.invoke('launcher:info'),
  list: (source) => ipcRenderer.invoke('launcher:list', source),
  addFolder: (startAt) => ipcRenderer.invoke('launcher:addFolder', startAt),
  removeFolder: (path) => ipcRenderer.invoke('launcher:removeFolder', path),
  openFolder: (tabId, path) => ipcRenderer.send('launcher:open', tabId, path),
  openExisting: (tabId, startAt) => ipcRenderer.send('launcher:openExisting', tabId, startAt),
  create: (tabId, link, destination) => ipcRenderer.send('launcher:create', tabId, link, destination),
  setStatus: (folder, value) => ipcRenderer.invoke('launcher:setStatus', folder, value),
  setGroupByStatus: (on) => ipcRenderer.send('launcher:groupByStatus', on),
  popup: (items) => ipcRenderer.invoke('menu:popup', items),
  showInFinder: (path) => ipcRenderer.send('finder:show', path),
}

contextBridge.exposeInMainWorld('fa', api)
