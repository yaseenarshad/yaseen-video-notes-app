import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MainWindow } from './window'

/** The app menus (same items and keys as the Swift app's). */
export function buildMenu(get: () => MainWindow | null, actions: { updateYTDLP: () => void }): void {
  const w = (f: (m: MainWindow) => void) => () => { const m = get(); if (m) f(m) }
  const tabs: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: i === 8 ? 'Last Tab' : `Tab ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: w((m) => m.selectIndex(i + 1)),
  }))
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'About Yaseen Video Notes' },
        { id: 'update-ytdlp', label: 'Update yt-dlp Now', click: () => actions.updateYTDLP() },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Yaseen Video Notes' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Yaseen Video Notes' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: w((m) => m.newTab()) },
        { label: 'New Video…', accelerator: 'CmdOrCtrl+N', click: w((m) => m.newTab()) },
        { label: 'Open Existing…', accelerator: 'CmdOrCtrl+O', click: w((m) => m.newTab(true)) },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: w((m) => m.closeActive()) },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', click: w((m) => m.win.close()) },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Transcript…', accelerator: 'CmdOrCtrl+F', click: w((m) => m.find()) },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Video', accelerator: 'CmdOrCtrl+R', click: w((m) => m.reloadActive()) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: w((m) => m.zoom(1)) },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, acceleratorWorksWhenHidden: true, click: w((m) => m.zoom(1)) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: w((m) => m.zoom(-1)) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: w((m) => m.zoom(0)) },
        { type: 'separator' },
        { label: 'Focus Mode (⇧F)', click: w((m) => m.toggleFocus()) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' as const }, {
          label: 'Developer Tools', accelerator: 'Alt+CmdOrCtrl+I',
          click: w((m) => (m.activeSession?.view.webContents ?? m.shell.webContents).toggleDevTools()),
        }]),
      ],
    },
    {
      label: 'Window',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
        { label: 'Show Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: w((m) => m.step(1)) },
        { label: 'Show Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: w((m) => m.step(-1)) },
        { type: 'separator' },
        ...tabs,
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
