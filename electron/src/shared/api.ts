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

/** A followed channel in the 📺 Feed. */
export interface FeedChannelInfo { id: string; title: string; error: string | null; fetchedAt: string | null; videos: number }

/** A video in the 📺 Feed (Shorts, hidden and upcoming videos are already left out). */
export interface FeedItem {
  id: string
  title: string
  channelId: string
  channelTitle: string
  /** ISO time. */
  published: string
  thumbnail: string
  url: string
  /** "2:25:00" when known (not from the RSS feeds). */
  duration: string | null
  /** The Library folder that has this video ("In Library"), or null. */
  folder: string | null
  /** Came out after the Feed was opened the time before. */
  isNew: boolean
}

export interface FeedState {
  channels: FeedChannelInfo[]
  items: FeedItem[]
  /** The sidebar badge: videos that came out since the Feed was last opened. */
  newCount: number
  refreshing: boolean
  /** The followed-channels list (`<feedDir>/subscriptions.md`). */
  file: string
  /** Lines in subscriptions.md that could not be resolved ("link: why"). */
  problems: string[]
}

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
  // 📺 Feed
  feedState(): Promise<FeedState>
  onFeed(cb: (s: FeedState) => void): () => void
  /** The Feed view was opened (refreshes when stale, clears the badge). `again`: still open, just mark new videos seen. */
  feedOpened(again?: boolean): void
  feedRefresh(): void
  /** Follows a channel: @handle, a channel link, or a video link. Returns an error message, or null. */
  feedFollow(input: string): Promise<string | null>
  /** Follows the channel of a Library folder's video. */
  feedFollowFolder(folder: string): Promise<string | null>
  feedUnfollow(channelId: string): void
  feedHide(videoId: string): void
}
