// The shell renderer's API (tab bar + New Tab pages), exposed by src/preload/shell.ts as window.fa.
import type { FolderEntry } from '../core/folderMaker'

export type { FolderEntry }

export type TabKind = 'new' | 'player'
export interface TabInfo { id: string; kind: TabKind; title: string; tooltip: string }
export interface ShellState { tabs: TabInfo[]; active: string | null; scale: number }

export type Source = { kind: 'recent' } | { kind: 'inProgress' } | { kind: 'folder'; path: string }

/** Progress of opening / making a folder in a New Tab. */
export interface WorkEvent { tabId: string; step: 'browse' | 'working' | 'failed'; line?: string; error?: string }

export interface MenuSpec {
  id?: string
  label?: string
  checked?: boolean
  enabled?: boolean
  separator?: boolean
  submenu?: MenuSpec[]
}

export interface LauncherInfo { pinned: string[]; outputParent: string; groupByStatus: boolean; home: string }

/** Main → shell commands from the app menu. */
export type ShellCommand = { kind: 'focusFilter'; tabId: string } | { kind: 'toast'; text: string; ms?: number }

export interface FaAPI {
  state(): Promise<ShellState>
  onState(cb: (s: ShellState) => void): () => void
  onWork(cb: (e: WorkEvent) => void): () => void
  onCommand(cb: (c: ShellCommand) => void): () => void
  newTab(): void
  selectTab(id: string): void
  closeTab(id: string): void
  tabMenu(id: string): void
  launcherInfo(): Promise<LauncherInfo>
  list(source: Source): Promise<FolderEntry[]>
  addFolder(startAt?: string): Promise<string | null>
  removeFolder(path: string): Promise<LauncherInfo>
  openFolder(tabId: string, path: string): void
  openExisting(tabId: string, startAt?: string): void
  create(tabId: string, link: string, destination: string): void
  setStatus(folder: string, value: string): Promise<string | null>
  setGroupByStatus(on: boolean): void
  popup(items: MenuSpec[]): Promise<string | null>
  showInFinder(path: string): void
}
