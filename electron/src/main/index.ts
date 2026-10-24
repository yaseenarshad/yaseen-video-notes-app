import { app, dialog } from 'electron'
import { join } from 'node:path'
import { isCLI, flag, runCLI } from '../cli/run'
import { ensure, findYTDLP, NeedsFormatting, YTDLP_MISSING } from '../core/folderMaker'
import { migrateSettings, OLD_APP_NAME } from '../core/migrate'
import { checkDue, DAILY_STALE_DAYS, describe, downloadsRunning, isOlderThan, isUpdating, updateYTDLP, versionForAge } from '../core/ytdlpUpdate'
import { DebugLog } from './debugLog'
import { registerFeed, startFeedTimer } from './feed'
import { buildMenu } from './menu'
import { Settings } from './settings'
import { MainWindow, registerIPC } from './window'

// Electron app entry. The same binary is also the CLI: `Yaseen Video Notes --make <url> --out <dir>`.
// (The app was called "Follow Along" before; that name stays in its file names, e.g. `.follow-along.json`.)
const args = process.argv.slice(app.isPackaged ? 1 : 2)

/** `--name value` or `--name=value`. */
const opt = (name: string): string | null => {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  return eq ? eq.slice(name.length + 1) : flag(args, name)
}

app.setName('Yaseen Video Notes')

/** `VIDEO_NOTES_<name>`, or the old `FOLLOW_ALONG_<name>` environment variable. */
const env = (name: string): string | undefined => process.env[`VIDEO_NOTES_${name}`] ?? process.env[`FOLLOW_ALONG_${name}`]

if (isCLI(args)) {
  app.dock?.hide()
  app.whenReady().then(async () => app.exit(await runCLI(args)))
} else {
  startApp()
}

function startApp(): void {
  // Test instances: their own settings folder (and so their own tabs, Recent and prefs).
  const userData = opt('--user-data-dir') ?? env('USER_DATA') ?? null
  if (userData) app.setPath('userData', userData)
  const openPath = opt('--open')
  DebugLog.start(opt('--debug-log') ?? env('DEBUG_LOG'))

  // Test instances (--inactive) open behind other windows: keep them painting and running anyway.
  if (args.includes('--inactive')) {
    for (const sw of ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding', 'disable-background-timer-throttling']) app.commandLine.appendSwitch(sw)
  }
  // Play without a click (the page starts the video with Space / the app's commands).
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  // Look like Chrome, so YouTube serves its normal (full quality) player.
  app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|follow-along|Follow Along|FollowAlong|yaseen-video-notes|Yaseen Video Notes|YaseenVideoNotes)\/\S+/g, '')

  let main: MainWindow | null = null
  registerIPC(() => main)
  registerFeed(() => main)

  app.whenReady().then(async () => {
    // First launch under the new name: carry over the "Follow Along" settings (read-only on the old folder).
    if (!userData) {
      try {
        if (migrateSettings(join(app.getPath('appData'), OLD_APP_NAME), app.getPath('userData'))) DebugLog.log(`copied the ${OLD_APP_NAME} settings`)
      } catch (e) { DebugLog.log(`could not copy the ${OLD_APP_NAME} settings: ${e}`) }
    }
    Settings.load()
    if (!userData && !openPath && !env('NO_IMPORT')) Settings.importFromSwift()
    buildMenu(() => main, { updateYTDLP: () => void updateYTDLPNow(() => main) })
    const rendererURL = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null
    main = new MainWindow({
      remember: openPath === null,
      muted: args.includes('--mute') || env('MUTE') === '1',
      inactive: args.includes('--inactive'),
      preloadDir: join(__dirname, '../preload'),
      rendererURL,
      rendererFile: join(__dirname, '../renderer/index.html'),
    })
    DebugLog.log(`started (Electron ${process.versions.electron}, Chrome ${process.versions.chrome}) userData=${app.getPath('userData')}`)
    // Keep yt-dlp up to date: a few seconds after the window is up, then hourly (each check runs at most once a day).
    setTimeout(() => void dailyYTDLPCheck(() => main), 5000)
    setInterval(() => void dailyYTDLPCheck(() => main), 60 * 60_000).unref()
    // The 📺 Feed: a first refresh soon (for the badge), then hourly (main/feed.ts).
    startFeedTimer()
    // --open <path> opens just that video; otherwise the tabs of last time come back.
    const paths = openPath ? [openPath.startsWith('~/') ? app.getPath('home') + openPath.slice(1) : openPath] : Settings.openTabs
    if (!paths.length) { main.newTab(); return }
    let opened = 0
    for (const path of paths) {
      try {
        const t = await ensure(path, { allowFormat: false, progress: (l) => DebugLog.log(`prepare: ${l}`) })
        await main.openPlayer(t)
        opened += 1
      } catch (e) {
        DebugLog.log(`could not open ${path}: ${e}`)
        if (openPath) {
          const tab = main.newTab()
          if (e instanceof NeedsFormatting) void main.openFolder(tab.id, path)
          else main.work({ tabId: tab.id, step: 'failed', error: e instanceof Error ? e.message : String(e) })
          opened += 1
        }
      }
    }
    if (opened === 0) main.newTab()
    else if (!openPath && main.tabs[0]) main.select(main.tabs[0].id)
  }).catch((e) => {
    dialog.showErrorBox('Yaseen Video Notes', String(e))
    app.exit(1)
  })

  app.on('before-quit', () => {
    main?.saveOpenTabs()
    main?.savePositions()
    Settings.flush()
  })
  app.on('window-all-closed', () => app.quit())
  // `kill` (SIGTERM) and Ctrl+C quit like ⌘Q: positions and open tabs are written first.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => app.quit())
}

// ---------- yt-dlp upkeep (core/ytdlpUpdate.ts) ----------

let checking = false

/**
 * The daily check: at most once in 24 h (`ytdlpCheckedAt` in settings.json), updates yt-dlp in the background
 * when it is more than 14 days old. Quiet unless it updated. Skipped (tried again in 10 min) while a caption
 * download or an update runs.
 */
async function dailyYTDLPCheck(get: () => MainWindow | null): Promise<void> {
  if (checking) return
  if (!checkDue(Settings.ytdlpCheckedAt)) { DebugLog.log(`yt-dlp check: not due (last ${Settings.ytdlpCheckedAt})`); return }
  if (downloadsRunning() > 0 || isUpdating()) {
    DebugLog.log('yt-dlp check: a download or update is running; trying again in 10 min')
    setTimeout(() => void dailyYTDLPCheck(get), 10 * 60_000).unref()
    return
  }
  checking = true
  try {
    const bin = findYTDLP()
    if (!bin) { DebugLog.log('yt-dlp check: yt-dlp not found'); return }
    const version = await versionForAge(bin)
    if (isOlderThan(version, DAILY_STALE_DAYS)) {
      DebugLog.log(`yt-dlp check: ${version} is more than ${DAILY_STALE_DAYS} days old; updating`)
      const r = await updateYTDLP(bin, (l) => DebugLog.log(`yt-dlp update: ${l}`))
      DebugLog.log(`yt-dlp check: ${describe(r)}`)
      if (r.kind === 'updated') get()?.notify(`yt-dlp updated to ${r.to}`, 5000)
    } else {
      DebugLog.log(`yt-dlp check: ${version ?? 'unknown version'} is recent enough`)
    }
  } catch (e) {
    DebugLog.log(`yt-dlp check failed: ${e}`)
  } finally {
    checking = false
    Settings.ytdlpCheckedAt = new Date().toISOString()
  }
}

/** Yaseen Video Notes → Update yt-dlp Now: updates and says how it went (toast; a dialog when it failed). */
async function updateYTDLPNow(get: () => MainWindow | null): Promise<void> {
  const parent = () => get()?.win
  const bin = findYTDLP()
  if (!bin) {
    const w = parent()
    const opts = { type: 'warning' as const, message: 'yt-dlp was not found', detail: YTDLP_MISSING }
    void (w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts))
    return
  }
  get()?.notify('Updating yt-dlp…', 180_000)
  const r = await updateYTDLP(bin, (l) => {
    DebugLog.log(`yt-dlp update: ${l}`)
    if (l.startsWith('Waiting')) get()?.notify(l, 180_000)
  })
  DebugLog.log(`yt-dlp menu: ${describe(r)}`)
  if (r.kind !== 'failed') {
    Settings.ytdlpCheckedAt = new Date().toISOString()
    get()?.notify(describe(r), 5000)
    return
  }
  get()?.notify('Could not update yt-dlp', 1500)
  const w = parent()
  const opts = { type: 'warning' as const, message: 'Could not update yt-dlp', detail: r.reason }
  await (w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts))
}
