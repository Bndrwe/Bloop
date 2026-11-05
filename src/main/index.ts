import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Notification, app, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppStatus, Settings } from '@shared/types'
import { getDeadlines, refreshDeadlines } from './deadlines'
import { guardSender } from './ai/guard'
import { detectSessionType, isGnomeDesktop, setLinuxAutostart } from './linux'
import { clearLogs, initFileLog, logError, logFile, logsDir } from './log'
import { envSearchDirs, generatePlan, loadEnv, planToReminders } from './plan'
import { registerAiIpc, trustedOrigins } from './ai/ipc'
import { getPermissions, openPermissionSettings, probeAutomation, refreshPermissions, requestAutomation } from './permissions'
import { ReminderScheduler } from './reminders'
import { SessionEngine, type NotifyOptions } from './session'
import * as store from './store'
import { sampleActiveWindow } from './tracker'
import { clickTrayItem, createTray, trayMenuLabels, updateTray, type TrayActions } from './tray'
import * as windows from './windows'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FAST = process.env['BLOOP_FAST'] === '1'
const isMac = process.platform === 'darwin'

const log = (m: string): void => console.log(`[bloop] ${m}`)

/** IPC channel for "Quit Bloop" from the renderer (to be added to src/shared/ipc.ts as IPC.quitApp). */
const QUIT_APP_CHANNEL = 'app:quit'

/** Must equal package.json build.appId. */
const APP_ID = 'edu.bloop.app'

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

let lastBroadcast = ''
function broadcast(status: AppStatus): void {
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

const trayActions: TrayActions = {
  start: () => engine.start(),
  pause: () => engine.pause(),
  resume: () => engine.resume(),
  stop: () => engine.stop(),
  openSettings: () => windows.openSettings(),
  togglePanel: () => windows.togglePanel(),
  about: () => void showAbout(),
  openLogs: () => void openLogsFolder(),
  quit: () => app.quit()
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
    log('settings saved')
    broadcastSettings(next)
    broadcast(engine.getStatus())
    return next
  })
  h(IPC.resetData, () => {
    if (engine.isRunning()) engine.stop()
    store.resetData()
    clearLogs()
    applyLoginItem(store.getSettings())
    log('all data reset')
    broadcastSettings(store.getSettings())
    broadcast(engine.getStatus())
  })

  h(IPC.openSettings, () => windows.openSettings())
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

  h(IPC.getPermissions, () => refreshPermissions())
  h(IPC.relaunchApp, () => {
    app.relaunch()
    app.quit()
  })
  h(IPC.openPermissionSettings, (_e, kind) =>
    openPermissionSettings(kind === 'automation' ? 'automation' : 'screenRecording')
  )
  h(IPC.requestAutomation, () => requestAutomation())
  h(IPC.dismissOnboarding, () => {
    store.setOnboardingDismissed(true)
  })

  h(IPC.getDeadlines, () => getDeadlines())
  h(IPC.refreshDeadlines, () => refreshDeadlines(store.getSettings().icalUrl))
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
app.on('second-instance', () => {
  log('second instance launched: showing the panel')
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
    engine.dispose()
  } catch (e) {
    fatal('quit cleanup failed', e)
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
  registerAiIpc(ipcMain, { allWindows: windows.allWindows })
  windows.createPetWindow()
  windows.ensurePanelWindow()
  const tray = createTray(trayActions, engine.getStatus())
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
  })

  // keep the deadline cache fresh (stretch)
  const icalUrl = store.getSettings().icalUrl
  if (icalUrl) void refreshDeadlines(icalUrl)

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
    // Same import and getLlama options as BloopRuntime: proves the prebuilt llama.cpp binary loads
    // from app.asar.unpacked without a model or a build step.
    g['__bloopProbeLlama'] = async () => {
      const nlc = await import('node-llama-cpp')
      const llama = await nlc.getLlama({ build: 'never', logLevel: nlc.LlamaLogLevel.error })
      const r = { gpu: llama.gpu, buildType: llama.buildType, supportsGpuOffloading: llama.supportsGpuOffloading }
      await llama.dispose()
      return r
    }
  }
}
