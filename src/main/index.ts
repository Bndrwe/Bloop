import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, Notification, app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppStatus, Settings } from '@shared/types'
import { getDeadlines, refreshDeadlines } from './deadlines'
import { generatePlan, hasApiKey, loadEnv, planToReminders } from './plan'
import { getPermissions, openPermissionSettings, refreshPermissions, requestAutomation } from './permissions'
import { ReminderScheduler } from './reminders'
import { SessionEngine, type NotifyOptions } from './session'
import * as store from './store'
import { sampleActiveWindow } from './tracker'
import { createTray, updateTray, type TrayActions } from './tray'
import * as windows from './windows'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FAST = process.env['BLOOP_FAST'] === '1'
const isMac = process.platform === 'darwin'

const log = (m: string): void => console.log(`[bloop] ${m}`)

// ------------------------------------------------------------------ single instance

// Windows: needed for toast notifications (must match build.appId) and taskbar grouping.
if (process.platform === 'win32') app.setAppUserModelId('edu.bloop.app')

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

loadEnv([process.cwd(), app.getAppPath(), join(__dirname, '../..'), app.getPath('userData')])

// Keep notifications referenced until they are handled (otherwise GC can drop action callbacks).
const liveNotifications = new Set<Notification>()

function notify(title: string, body: string, opts?: NotifyOptions): void {
  log(`notification: ${title} — ${body}`)
  if (!Notification.isSupported()) return
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

const trayActions: TrayActions = {
  start: () => engine.start(),
  pause: () => engine.pause(),
  resume: () => engine.resume(),
  stop: () => engine.stop(),
  openSettings: () => windows.openSettings(),
  togglePanel: () => windows.togglePanel()
}

const reminders = new ReminderScheduler({ engine, getSettings: () => store.getSettings(), notify })

function applyLoginItem(s: Settings): void {
  if (!isMac && process.platform !== 'win32') return
  try {
    app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
  } catch (e) {
    log(`setLoginItemSettings failed: ${(e as Error).message}`)
  }
}

// ------------------------------------------------------------------ IPC

function registerIpc(): void {
  const h = (ch: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(ch, async (e, ...args) => {
      try {
        return await fn(e, ...args)
      } catch (err) {
        log(`ipc ${ch} failed: ${(err as Error).stack ?? err}`)
        throw err
      }
    })
  }

  h(IPC.getStatus, () => engine.getStatus())

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
    broadcast(engine.getStatus())
    return next
  })
  h(IPC.resetData, () => {
    if (engine.isRunning()) engine.stop()
    store.resetData()
    applyLoginItem(store.getSettings())
    log('all data reset')
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
  h(IPC.hasApiKey, () => hasApiKey())
}

// ------------------------------------------------------------------ lifecycle

app.on('second-instance', () => {
  windows.togglePanel()
})

// Menu-bar app: keep running with no windows open.
app.on('window-all-closed', () => {
  /* stay alive in the tray */
})

// Ctrl-C / kill in dev: quit cleanly so the running session gets saved.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => app.quit())

app.on('before-quit', () => {
  if (engine.isRunning()) engine.stop() // save the in-progress session
  reminders.stop()
  engine.dispose()
})

app.whenReady().then(() => {
  log(`starting (platform=${process.platform}, fast=${FAST}, fake=${process.env['BLOOP_FAKE_ACTIVE'] ?? 'no'})`)
  if (isMac) app.dock?.hide()
  registerIpc()
  windows.createPetWindow()
  windows.ensurePanelWindow()
  createTray(trayActions, engine.getStatus())
  reminders.start()
  applyLoginItem(store.getSettings())

  const perms = getPermissions()
  log(`permissions: screen=${perms.screenRecording} automation=${perms.automation} onboarding=${perms.showOnboarding}`)
  if (perms.showOnboarding) windows.openOnboarding()

  // keep the deadline cache fresh (stretch)
  const icalUrl = store.getSettings().icalUrl
  if (icalUrl) void refreshDeadlines(icalUrl)

  // dev/demo: auto-start a session for headless verification
  if (process.env['BLOOP_AUTOSTART'] === '1') setTimeout(() => engine.start(), 1500)

  app.on('activate', () => windows.togglePanel())
})
