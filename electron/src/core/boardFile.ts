import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from './atomic'
import { arrangeColumn, BOARD_FILE, cardId, encodeBoard, moveCard, newestFirst, parseBoard, prune, type BoardOrder, type DropSpot } from './board'
import { withFileLock } from './fileLock'
import type { FolderEntry } from './folderMaker'
import { listLibrary } from './library'

/**
 * Reading and writing `<library>/.video-notes-board.json` (the logic is in `board.ts`). One file per library folder
 * (the status folder, e.g. learning-log), keyed by video id, for the videos at any depth (its topics too): every
 * folder view (only its own videos) and 📚 All videos show the library's order filtered to their cards, and moving a
 * video between topics keeps its place.
 */

export const boardPath = (parent: string): string => join(parent, BOARD_FILE)

const readText = (p: string): string | null => { try { return readFileSync(p, 'utf8') } catch { return null } }

/** The board order of a parent folder (none yet: {}). */
export function readBoard(parent: string): BoardOrder {
  return parseBoard(readText(boardPath(parent)))
}

/**
 * Moves card `id` to column `to` at `spot` in the parent folder's board order (the card's status must already
 * be `to`). Under the file's lock: read fresh, change, drop stale ids, atomic write only when the text changes.
 * `entries`: the library's video folders at any depth (default: listed now). Returns the new order.
 */
export function moveOnBoard(parent: string, id: string, to: string, spot: DropSpot, entries?: FolderEntry[]): BoardOrder {
  const path = boardPath(parent)
  return withFileLock(path, () => {
    const before = readText(path)
    const list = entries ?? listLibrary(parent)
    const arranged = arrangeColumn(list.filter((e) => e.status === to), parseBoard(before)[to], cardId, newestFirst).map(cardId)
    const live = new Map(list.map((e) => [cardId(e), e.status]))
    const next = prune(moveCard(parseBoard(before), id, to, arranged, spot), live)
    const text = encodeBoard(next)
    if (text !== before && !(before === null && Object.keys(next).length === 0)) atomicWrite(path, text)
    return next
  })
}
