import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, Notification, app, dialog, globalShortcut, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import { APP_ID } from '@shared/appId'
import type { AppStatus, BrightspaceStatus, Settings } from '@shared/types'
import { getDeadlines, refreshDeadlines } from './deadlines'
import {
  getBrightspaceStatus,
  hardenBrightspaceContents,
  loginBrightspace,
  logoutBrightspace,
  refreshBrightspace,
  startBrightspace,
  stopBrightspace
} from './brightspaceApp'
import { guardSender } from './ai/guard'
import { detectSessionType, isGnomeDesktop, setLinuxAutostart } from './linux'
import { clearLogs, initFileLog, logError, logFile, logsDir } from './log'
import { envSearchDirs, generatePlan, loadEnv, planToReminders } from './plan'
import { registerAiIpc, trustedOrigins } from './ai/ipc'
import {
  getPermissions,
  openPermissionSettings,
  parsePermissionQuery,
  parseResetRequest,
  probeAutomation,
  refreshPermissions,
  requestAutomation,
  resetPermissions
} from './permissions'
import { ReminderScheduler } from './reminders'
import { SessionEngine, type NotifyOptions } from './session'
import * as store from './store'
import { sampleActiveWindow } from './tracker'
import { clickTrayItem, createTray, trayBounds, trayMenuLabels, updateTray, type TrayActions } from './tray'
import {
  isNudgeMood,
  needsHiddenSafetyNet,
  parsePetContextMenu,
  petContextMenuTemplate,
  petShortcut,
  petToggleLabel,
  PetVisibility,
  registerPetShortcut
} from './petVisibility'
import * as windows from './windows'
import { chatStore, registerChat } from './chatApp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FAST = process.env['BLOOP_FAST'] === '1'
const isMac = process.platform === 'darwin'

const log = (m: string): void => console.log(`[bloop] ${m}`)

/** IPC channel for "Quit Bloop" from the renderer (to be added to src/shared/ipc.ts as IPC.quitApp). */
const QUIT_APP_CHANNEL = 'app:quit'


// ------------------------------------------------------------------ crash handling

// An installed app has no terminal: without these, a stray exception in main shows Electron's
// generic dialog (or kills the app) and leaves no trace. Log it and keep running instead.
let startupFailed = false
function fatal(kind: string, err: unknown): void {
  const e = err as NodeJS.ErrnoException | undefined
  if (e?.code === 'EPIPE') return // stdout went away (launched from a closed terminal)
  logError(`[bloop] ${kind}: ${e?.stack ?? String(err)}`)
}
process.on('uncaughtException', (err) => fatal('uncaught exception', err))
process.on('unhandledRejection', (reason) => fatal('unhandled rejection', reason))

// ------------------------------------------------------------------ single instance

// Windows: toast notifications only show when the AppUserModelId matches the Start-menu shortcut
// the NSIS installer creates (= build.appId). In dev there is no shortcut, so use the exe path.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)

if (process.platform === 'linux') {
  // transparent pet window on X11 compositors
  app.commandLine.appendSwitch('enable-transparent-visuals')
  if (process.env['BLOOP_DISABLE_GPU'] === '1') app.disableHardwareAcceleration()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

initFileLog()

// .env (ANTHROPIC_API_KEY fallback): dev reads the project folder; a packaged app reads
// <userData>/.env and the folder next to the app (see README → AI study plan → .env fallback).
loadEnv(
  envSearchDirs({
    packaged: app.isPackaged,
    platform: process.platform,
    userData: app.getPath('userData'),
    exePath: process.execPath,
    projectRoot: join(__dirname, '../..'),
    cwd: process.cwd(),
    appImage: process.env['APPIMAGE'],
    portableExe: process.env['PORTABLE_EXECUTABLE_FILE']
  })
)

// Keep notifications referenced until they are handled (otherwise GC can drop action callbacks).
const liveNotifications = new Set<Notification>()

let loggedNoNotifications = false
function notify(title: string, body: string, opts?: NotifyOptions): void {
  log(`notification: ${title}`) // not the body: it can name the app/site you were on
  if (!Notification.isSupported()) {
    if (!loggedNoNotifications) log('system notifications are not supported here; the pet speech bubble still works')
    loggedNoNotifications = true
    return
  }
  try {
    const n = new Notification({
      title,
      // Notification buttons are mac-only; elsewhere clicking the notification itself triggers the action.
      body: opts?.actionText && !isMac ? `${body}\nClick to ${opts.actionText.toLowerCase()}.` : body,
      silent: false,
      ...(opts?.actionText && isMac ? { actions: [{ type: 'button' as const, text: opts.actionText }] } : {})
    })
    liveNotifications.add(n)
    const done = (): void => {
      liveNotifications.delete(n)
    }
    n.on('click', () => {
      done()
      opts?.onAction?.()
    })
    n.on('action', () => {
      done()
      opts?.onAction?.()
    })
    n.on('close', done)
    n.on('failed', done)
    n.show()
    setTimeout(done, 10 * 60_000)
  } catch (e) {
    log(`notification failed: ${(e as Error).message}`)
  }
}

// ------------------------------------------------------------------ engine

const engine = new SessionEngine({
  getSettings: () => store.getSettings(),
  sample: () => sampleActiveWindow(),
  notify,
  saveSession: (rec) => store.addSession(rec),
  fast: FAST
})

// ------------------------------------------------------------------ pet visibility (hide / show)

let trayOk = false
/** "Ctrl+Shift+B" / "⌘⇧B" once the global shortcut is registered; null if it was taken. */
let petShortcutLabel: string | null = null

const pet = new PetVisibility({
  getSettings: () => store.getSettings(),
  saveSettings: (patch) => store.saveSettings(patch),
  setWindowVisible: (v) => windows.setPetVisible(v),
  onChange: (s) => {
    broadcastSettings(s)
    updateTray(trayActions, engine.getStatus())
  },
  notify: (title, body) => notify(title, body),
  log,
  safetyNet: () => needsHiddenSafetyNet({ platform: process.platform, gnome: isGnomeDesktop(), trayOk }),
  shortcutLabel: () => petShortcutLabel
})

let lastPetMessageId = 0

let lastBroadcast = ''
function broadcast(status: AppStatus): void {
  // a new nudge bubble while the pet is hidden: pop it up for a few seconds (if allowed)
  if (status.pet.messageId !== lastPetMessageId) {
    lastPetMessageId = status.pet.messageId
    if (status.pet.message && isNudgeMood(status.pet.mood)) pet.nudge()
  }
  const key = JSON.stringify(status)
  if (key !== lastBroadcast) {
    lastBroadcast = key
    for (const w of windows.allWindows()) {
      if (!w.webContents.isDestroyed()) w.webContents.send(IPC.statusPush, status)
    }
  }
  updateTray(trayActions, status)
}
engine.on('status', broadcast)

function broadcastSettings(settings: Settings): void {
  for (const w of windows.allWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send(IPC.settingsChanged, settings)
  }
}

function broadcastBrightspace(status: BrightspaceStatus): void {
  for (const w of windows.allWindows()) {
    if (!w.webContents.isDestroyed()) w.webContents.send(IPC.brightspaceStatusPush, status)
  }
}

const trayActions: TrayActions = {
  start: () => engine.start(),
  pause: () => engine.pause(),
  resume: () => engine.resume(),
  stop: () => engine.stop(),
  openSettings: () => windows.openSettings(),
  togglePanel: () => windows.togglePanel(),
  togglePet: () => pet.toggle('tray'),
  petLabel: () => petToggleLabel(pet.wanted(), petShortcutLabel),
  about: () => void showAbout(),
  openLogs: () => void openLogsFolder(),
  quit: () => app.quit(),
  openChat: () => windows.openChat(),
  permissionsNeeded: () => {
    const p = getPermissions()
    return isMac && (p.screenRecording !== 'granted' || p.automation !== 'granted')
  },
  openPermissions: () => windows.openSettings('permissions')
}

async function openLogsFolder(): Promise<void> {
  const dir = logsDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  const err = await shell.openPath(dir)
  if (err) log(`open logs folder failed: ${err}`)
}

async function showAbout(): Promise<void> {
  if (isMac) app.focus({ steal: true })
  const v = process.versions
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'About Bloop',
    message: `Bloop ${app.getVersion()}`,
    detail: [
      'Your little study pet.',
      '',
      `Electron ${v.electron} · Chromium ${v.chrome} · Node ${v.node}`,
      `${process.platform} ${process.arch}${app.isPackaged ? '' : ' (development)'}`,
      '',
      `Logs: ${logFile() ?? logsDir()}`,
      `Data: ${app.getPath('userData')}`
    ].join('\n'),
    buttons: ['OK', 'Open logs folder'],
    defaultId: 0,
    cancelId: 0
  })
  if (response === 1) await openLogsFolder()
}

const reminders = new ReminderScheduler({ engine, getSettings: () => store.getSettings(), notify })

function applyLoginItem(s: Settings): void {
  // In dev this would register the bare Electron binary as a login item: only installed apps.
  if (!app.isPackaged) return
  try {
    if (isMac) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
    else if (process.platform === 'win32') {
      // Portable build: point at the .exe the user has, not the temp folder it unpacks to.
      const path = process.env['PORTABLE_EXECUTABLE_FILE'] || process.execPath
      app.setLoginItemSettings({ openAtLogin: s.launchAtLogin, path, args: [] })
    } else if (process.platform === 'linux') setLinuxAutostart(s.launchAtLogin)
  } catch (e) {
    log(`launch at login failed: ${(e as Error).message}`)
  }
}

// ------------------------------------------------------------------ IPC

function registerIpc(): void {
  const origins = trustedOrigins()
  const h = (ch: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(ch, async (e, ...args) => {
      guardSender(ch, e, origins) // only Bloop's own windows may call in
      try {
        return await fn(e, ...args)
      } catch (err) {
        log(`ipc ${ch} failed: ${(err as Error).stack ?? err}`)
        throw err
      }
    })
  }

  h(IPC.getStatus, () => engine.getStatus())
  // A Quit path that doesn't depend on the tray (GNOME without AppIndicator shows none).
  h(QUIT_APP_CHANNEL, () => {
    setTimeout(() => app.quit(), 0) // let the invoke reply first
  })

  h(IPC.startSession, () => {
    windows.closePanel()
    engine.start()
  })
  h(IPC.pauseSession, () => engine.pause())
  h(IPC.resumeSession, () => engine.resume())
  h(IPC.stopSession, () => {
    engine.stop()
  })
  h(IPC.skipBreak, () => engine.skipBreak())

  h(IPC.getStats, () => store.getStats())
  h(IPC.getSessions, () => store.getSessions())

  h(IPC.getSettings, () => store.getSettings())
  h(IPC.saveSettings, (_e, patch) => {
    const p = patch && typeof patch === 'object' ? (patch as Partial<Settings>) : {}
    const before = store.getSettings()
    const next = store.saveSettings(p)
    if (before.launchAtLogin !== next.launchAtLogin) applyLoginItem(next)
    pet.settingsChanged(before, next)
    log('settings saved')
    broadcastSettings(next)
    broadcast(engine.getStatus())
    return next
  })
  h(IPC.resetData, async () => {
    if (engine.isRunning()) engine.stop()
    await logoutBrightspace().catch((e: Error) => log(`brightspace logout on reset failed: ${e.message}`))
    store.resetData()
    chatStore.clear()
    clearLogs()
    applyLoginItem(store.getSettings())
    pet.apply() // showPet is back to its default (shown)
    log('all data reset')
    broadcastSettings(store.getSettings())
    broadcast(engine.getStatus())
  })

  h(IPC.openSettings, (_e, section) => windows.openSettings(section === 'permissions' ? 'permissions' : undefined))
  h(IPC.togglePanel, () => windows.togglePanel())
  h(IPC.closePanel, () => windows.closePanel())
  h(IPC.closeWindow, (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w === windows.getPetWindow()) return // never close the pet itself
    w.close()
  })
  h(IPC.dragStart, () => windows.dragStart())
  h(IPC.dragEnd, () => windows.dragEnd())
  h(IPC.setIgnoreMouse, (_e, ignore) => windows.setIgnoreMouse(Boolean(ignore)))
  h(IPC.togglePet, () => {
    pet.toggle('panel')
    return pet.wanted()
  })
  // The pet's right-click menu: only the pet window may open it (guardSender already checked the origin).
  h(IPC.petContextMenu, (e, ...args) => {
    const petWin = windows.getPetWindow()
    const req = parsePetContextMenu(!!petWin && BrowserWindow.fromWebContents(e.sender) === petWin, args)
    if (!req || !petWin) {
      log('ipc pet:context-menu rejected')
      return
    }
    const menu = Menu.buildFromTemplate(
      petContextMenuTemplate(
        {
          hidePet: () => pet.set(false, 'pet menu'),
          openPanel: () => windows.showPanel(),
          openSettings: () => windows.openSettings(),
          quit: () => app.quit()
        },
        petShortcutLabel ? petShortcut(process.platform).accelerator : null
      )
    )
    menu.popup({ window: petWin, ...(req.x !== undefined && req.y !== undefined ? { x: req.x, y: req.y } : {}) })
  })

  h(IPC.getPermissions, (_e, ...args) => refreshPermissions(parsePermissionQuery(args).fresh))
  h(IPC.relaunchApp, () => {
    // macOS only re-reads Screen Recording on launch. quit() saves a running session first;
    // exit(0) makes sure the relaunch happens even if something holds the quit up.
    app.relaunch()
    setTimeout(() => app.quit(), 0) // let the invoke reply first
    setTimeout(() => app.exit(0), 3000).unref()
  })
  // Reset permissions…: only the Settings window may ask, with no arguments.
  h(IPC.resetPermissions, async (e, ...args) => {
    const settingsWin = windows.getSettingsWindow()
    if (!parseResetRequest(!!settingsWin && BrowserWindow.fromWebContents(e.sender) === settingsWin, args)) {
      log('ipc perm:reset rejected')
      return { ok: false, reason: 'failed', message: 'Open Settings → Permissions to reset permissions.' }
    }
    const r = await resetPermissions()
    updateTray(trayActions, engine.getStatus())
    return r
  })
  h(IPC.openPermissionsSetup, () => windows.openOnboarding())
  h(IPC.isPanelOpen, () => windows.isPanelOpen())
  h(IPC.openPermissionSettings, (_e, kind) =>
    openPermissionSettings(kind === 'automation' ? 'automation' : 'screenRecording')
  )
  h(IPC.requestAutomation, () => requestAutomation())
  h(IPC.dismissOnboarding, () => {
    store.setOnboardingDismissed(true)
  })

  h(IPC.getDeadlines, () => getDeadlines())
  h(IPC.refreshDeadlines, async () => {
    const r = await refreshDeadlines(store.getSettings().icalUrl)
    broadcastBrightspace(getBrightspaceStatus()) // the panel reloads its deadlines on this push
    return r
  })

  h(IPC.brightspaceStatus, () => getBrightspaceStatus())
  h(IPC.brightspaceLogin, (_e, host) => {
    if (typeof host !== 'string' || host.length > 300) return { ok: false, error: "Enter your school's Brightspace address." }
    return loginBrightspace(host)
  })
  h(IPC.brightspaceLogout, () => logoutBrightspace())
  h(IPC.brightspaceRefresh, () => refreshBrightspace())
  h(IPC.getPlan, () => store.getStudyPlan())
  h(IPC.generatePlan, async () => {
    const dl = getDeadlines()
    const r = await generatePlan(dl.ok ? dl.value : [], store.getStats(), store.getSettings())
    if (r.ok) store.setStudyPlan(r.value)
    return r
  })
  h(IPC.addPlanReminders, () => {
    const plan = store.getStudyPlan()
    if (!plan) return { ok: false, error: 'Generate a plan first.' }
    const s = store.getSettings()
    // replace reminders from earlier plans, keep the user's own
    const own = s.reminders.filter((r) => !r.id.startsWith('plan-'))
    const added = planToReminders(plan)
    store.saveSettings({ reminders: [...own, ...added] })
    return { ok: true, value: added.length }
  })
}

// ------------------------------------------------------------------ lifecycle

// Launching Bloop again (e.g. from the Start menu while it already runs from login) shows the panel.
// It also always brings a hidden pet back (on GNOME without a tray that is the way back in).
app.on('second-instance', () => {
  log('second instance launched: showing the pet and the panel')
  if (!pet.wanted()) pet.set(true, 'second instance')
  windows.showPanel()
})

// Menu-bar app: keep running with no windows open.
app.on('window-all-closed', () => {
  /* stay alive in the tray */
})

// Ctrl-C / kill in dev: quit cleanly so the running session gets saved.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => app.quit())

let quitting = false
app.on('before-quit', () => {
  if (quitting) return
  quitting = true
  log('quitting')
  try {
    if (engine.isRunning()) engine.stop() // save the in-progress session
    reminders.stop()
    stopBrightspace()
    pet.dispose()
    engine.dispose()
  } catch (e) {
    fatal('quit cleanup failed', e)
  }
})

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* app not ready (early quit) */
  }
})

app.on('render-process-gone', (_e, wc, d) => log(`renderer ${wc.getURL().split('#')[1] ?? ''} gone: ${d.reason} (exit ${d.exitCode})`))
app.on('child-process-gone', (_e, d) => {
  if (d.reason !== 'clean-exit') log(`${d.type} process gone: ${d.reason} (exit ${d.exitCode})`)
})

app
  .whenReady()
  .then(startApp)
  .catch((e: unknown) => {
    fatal('startup failed', e)
    if (startupFailed) return
    startupFailed = true
    dialog.showErrorBox(
      'Bloop could not start',
      `${(e as Error)?.message ?? String(e)}\n\nDetails are in the log file:\n${logFile() ?? logsDir()}`
    )
    app.quit()
  })

function startApp(): void {
  log(
    `starting v${app.getVersion()} (platform=${process.platform}, packaged=${app.isPackaged}, fast=${FAST}, fake=${process.env['BLOOP_FAKE_ACTIVE'] ?? 'no'})`
  )
  log(`log file: ${logFile() ?? 'none'}; userData: ${app.getPath('userData')}`)
  if (isMac) app.dock?.hide()
  registerIpc()
  // The Brightspace login window (own session partition) gets its SSO-friendly policy; every other
  // webContents, including all of Bloop's windows, keeps the strict global guard.
  registerAiIpc(ipcMain, { allWindows: windows.allWindows, hardenSpecial: hardenBrightspaceContents })
  registerChat(ipcMain, { getStatus: () => engine.getStatus(), openChat: () => windows.openChat() })
  pet.apply() // before the pet window exists: a hidden pet stays hidden from the first frame
  windows.createPetWindow()
  windows.ensurePanelWindow()
  // Shows / hides the pet from anywhere. If another app holds it, it is logged and skipped.
  petShortcutLabel = registerPetShortcut(globalShortcut, process.platform, () => pet.toggle('shortcut'), log)
  const tray = createTray(trayActions, engine.getStatus())
  trayOk = !!tray
  windows.setTrayBoundsProvider(trayBounds)
  if (!store.getSettings().showPet) {
    log(`the pet is hidden (Show pet is off): ${petShortcutLabel ? `press ${petShortcutLabel}, ` : ''}use the tray, or run Bloop again to bring it back`)
  }
  // LSUIElement (no Dock icon) + no tray would leave no way to open settings or quit:
  // fall back to a normal Dock app so the Dock menu offers Quit.
  if (!tray && isMac) void app.dock?.show()
  if (process.platform === 'linux') {
    log(`desktop: ${process.env['XDG_CURRENT_DESKTOP'] ?? 'unknown'} session=${detectSessionType()}`)
    // GNOME hides tray icons unless the AppIndicator extension is installed (Tray creation still
    // "succeeds"), so the pet stays the way in: click it to open the panel.
    if (isGnomeDesktop()) log('GNOME: install gnome-shell-extension-appindicator for a tray icon; meanwhile click the pet to open the panel')
  }
  reminders.start()
  applyLoginItem(store.getSettings())

  // Probe Automation first: until something asks a browser, it reads "unknown", which used to
  // reopen the welcome screen (and show "Not checked yet") on every launch even after granting.
  void probeAutomation().then(() => {
    const perms = getPermissions()
    log(`permissions: screen=${perms.screenRecording} automation=${perms.automation} onboarding=${perms.showOnboarding}`)
    if (perms.showOnboarding) windows.openOnboarding()
    updateTray(trayActions, engine.getStatus()) // "Permissions…" item
  })

  // keep the deadline cache fresh (stretch)
  const icalUrl = store.getSettings().icalUrl
  if (icalUrl) void refreshDeadlines(icalUrl)
  // Brightspace login: sync shortly after launch (only if connected) and every 2 hours
  startBrightspace(broadcastBrightspace)

  // Always-on watching (Settings → "Watch without a session") needs the 1 s ticker from launch.
  engine.startTicker()

  // dev/demo: auto-start a session for headless verification
  if (process.env['BLOOP_AUTOSTART'] === '1') setTimeout(() => engine.start(), 1500)

  // CI / debugging: periodically log what the onboarding "Re-check" button would see
  if (process.env['BLOOP_TRACE'] === '1') {
    log(`trace: userData=${app.getPath('userData')} exe=${app.getPath('exe')} pid=${process.pid}`)
    setInterval(() => {
      void refreshPermissions().then((p) =>
        log(`permissions(refresh): screen=${p.screenRecording} automation=${p.automation} onboarding=${p.showOnboarding}`)
      )
    }, 5000)
  }

  app.on('activate', () => windows.togglePanel())

  // Automated tests of the packaged app drive the tray from Playwright's main-process evaluate.
  if (process.env['BLOOP_E2E'] === '1') {
    const g = globalThis as Record<string, unknown>
    g['__bloopTray'] = () => ({ exists: !!tray && !tray.isDestroyed(), items: trayMenuLabels() ?? [] })
    g['__bloopTrayClick'] = (label: string) => clickTrayItem(label)
    g['__bloopLogFile'] = () => logFile()
    g['__bloopPet'] = () => ({ visible: windows.isPetVisible(), showPet: store.getSettings().showPet, shortcut: petShortcutLabel })
    g['__bloopTogglePet'] = () => pet.toggle('e2e')
    g['__bloopNudge'] = () => engine.say('hey, back to work?', 'worried')
    g['__bloopSecondInstance'] = () => app.emit('second-instance')
  }
}
