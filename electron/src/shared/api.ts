// The shell renderer's API (tab bar + New Tab pages), exposed by src/preload/shell.ts as window.fa.
import type { BoardOrder, DropSpot } from '../core/board'
import type { FolderEntry } from '../core/folderMaker'
import type { FolderNode } from '../core/library'

export type { BoardOrder, DropSpot, FolderEntry, FolderNode }

export type TabKind = 'new' | 'player'
export interface TabInfo { id: string; kind: TabKind; title: string; tooltip: string }
export interface ShellState { tabs: TabInfo[]; active: string | null; scale: number }

/**
 * What the New Tab lists. `folder`: a library or topic folder, Finder-style (only the videos right in it); `all`:
 * 📚 All videos (every library's videos at any depth, with topic chips).
 */
export type Source = { kind: 'recent' } | { kind: 'inProgress' } | { kind: 'all' } | { kind: 'folder'; path: string }

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

export type LibraryView = 'table' | 'board'
export interface LauncherInfo { pinned: string[]; outputParent: string; groupByStatus: boolean; collapsedColumns: string[]; collapsedFolders: string[]; columnWidths: Record<string, number>; home: string }

/** A folder action's answer: the (new) path, or why it did not happen. */
export type FolderResult = { path: string } | { error: string }
/** A video moved: from → to (Undo moves `to` back into the folder of `from`); null: it was already there. */
export type MoveAnswer = { from: string; to: string } | { error: string } | null

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
  /** Saves the collapsed Board columns (status values, ":none"). */
  setCollapsedColumns(keys: string[]): void
  /** Saves the Board column widths (px by column key; "<key>:collapsed" for a collapsed strip). */
  setColumnWidths(widths: Record<string, number>): void
  /** The board order of a parent folder (`.video-notes-board.json`). */
  boardOrder(parent: string): Promise<BoardOrder>
  /** 📚 All videos: every library's board order, merged column by column. */
  boardOrderAll(): Promise<BoardOrder>
  /**
   * Moves a card on a folder's board: sets the status first when it changes (locked frontmatter write), then the
   * order. Returns an error message, or null.
   */
  boardMove(folder: string, toStatus: string, spot: DropSpot): Promise<string | null>
  // the sidebar's folder tree (libraries = pinned folders, and their topic folders)
  /** One tree per pinned folder: its topic folders, recursively, with video counts (direct `videos`, `total` at any depth). */
  folderTree(): Promise<FolderNode[]>
  newFolder(parent: string, name: string): Promise<FolderResult>
  renameFolder(path: string, name: string): Promise<FolderResult>
  /** Deletes an EMPTY folder after a confirm. Returns an error message, 'cancel', or null when deleted. */
  deleteFolder(path: string): Promise<string | null>
  setCollapsedFolders(paths: string[]): void
  /** Moves a video folder into a library / topic folder (rename; locked; every saved path follows). */
  moveVideo(folder: string, destParent: string): Promise<MoveAnswer>
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
