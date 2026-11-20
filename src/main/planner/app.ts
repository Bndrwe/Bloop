// Wires the study planner, the website blocker and the (mock) Google integration into the app:
// storage in userData/planner.json, the guarded IPC, pushes to every window, and one ticker that
// pulls new deadlines, re-places missed blocks and turns blocking on/off with the study blocks.
// Called once from main/index.ts (registerPlanner), like registerChat.
import { execFile, execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'
import Store from 'electron-store'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { BlockerStatus, PlannerState } from '@shared/planner'
import { guardSender } from '../ai/guard'
import { trustedOrigins } from '../ai/ipc'
import { generateText } from '../ai/registry'
import { getDeadlines } from '../deadlines'
import * as store from '../store'
import { BlockerController, cleanSites, type BlockerData } from '../blocker/controller'
import { HELPER_PATH } from '../blocker/hosts'
import { SiteBlocker, type Runner } from '../blocker/siteBlocker'
import { MockGoogleIntegration, isGoogleService, type GoogleData, type GoogleIntegration } from '../google/integration'
import { activeBlock } from './schedule'
import { EMPTY_PLANNER, PlannerService, type PlannerData } from './service'

interface Schema {
  planner: PlannerData
  /** null until first use: then seeded from Settings → Distracting sites. */
  blocker: BlockerData | null
  google: GoogleData
}

const TICK_MS = 15_000
const FIRST_SYNC_DELAY_MS = 5_000

export interface PlannerAppDeps {
  allWindows: () => BrowserWindow[]
  notify: (title: string, body: string) => void
  log: (m: string) => void
}

export interface PlannerApp {
  /** Quit: removes any block from /etc/hosts (synchronously, so it happens before exit). */
  dispose(): void
  /** Reset all data: forget tasks, sites and Google, and lift any block. */
  reset(): void
}

const run: Runner = (file, args, timeoutMs = 20_000) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })

const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function registerPlanner(ipcMain: IpcMain, deps: PlannerAppDeps): PlannerApp {
  const { log } = deps
  const db = new Store<Schema>({ name: 'planner', defaults: { planner: EMPTY_PLANNER, blocker: null, google: {} }, clearInvalidConfig: true })
  const isMac = process.platform === 'darwin'

  const send = (ch: string, payload: unknown): void => {
    for (const w of deps.allWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(ch, payload)
  }

  const makePlanner = (): PlannerService =>
    new PlannerService({
      load: () => db.get('planner'),
      save: (d) => db.set('planner', d),
      generate: generateText,
      getDeadlines: () => {
        const r = getDeadlines()
        return r.ok ? r.value : []
      },
      onChange: (s: PlannerState) => {
        send(IPC.plannerPush, s)
        void blocker.tick() // a block may have been marked done or moved
      },
      log
    })

  const runningBlock = (): { label: string; until: number } | null => {
    const a = activeBlock(planner.tasks(), Date.now())
    return a ? { label: `${a.step.title} · ${a.task.title}`, until: a.block.end } : null
  }

  const makeBlocker = (): BlockerController =>
    new BlockerController({
      supported: isMac,
      blocker: new SiteBlocker({ run, user: userInfo().username, log }),
      load: () => db.get('blocker') ?? { sites: cleanSites(store.getSettings().distractDomains), manual: false },
      save: (d) => db.set('blocker', d),
      activeBlock: runningBlock,
      onChange: (s: BlockerStatus) => send(IPC.blockerPush, s),
      log
    })

  const makeGoogle = (): GoogleIntegration =>
    new MockGoogleIntegration({ load: () => db.get('google'), save: (d) => db.set('google', d) })

  let planner = makePlanner()
  let blocker = makeBlocker()
  let google = makeGoogle()

  // ------------------------------------------------------------ ticker
  let lastDeadlinesAt = -1
  let lastBlockKey: string | null = null
  const tick = (): void => {
    const now = Date.now()
    const fetchedAt = store.getDeadlinesCache()?.fetchedAt ?? 0
    if (fetchedAt !== lastDeadlinesAt) {
      lastDeadlinesAt = fetchedAt
      void planner.sync().catch((e: Error) => log(`planner sync failed: ${e.message}`))
    } else if (planner.tasks().some((t) => t.steps.some((s) => !s.done && s.block && s.block.end <= now))) {
      planner.reschedule() // a block ended without being done: find it a new slot
    }
    const a = activeBlock(planner.tasks(), now)
    const key = a ? `${a.task.id}/${a.step.id}/${a.block.start}` : null
    if (key && key !== lastBlockKey) deps.notify(`Study block: ${a!.task.title}`, `${a!.step.title} · until ${fmtTime(a!.block.end)}`)
    lastBlockKey = key
    void blocker.tick()
  }
  const firstSync = setTimeout(tick, FIRST_SYNC_DELAY_MS)
  const timer = setInterval(tick, TICK_MS)

  // ------------------------------------------------------------ IPC
  const origins = trustedOrigins()
  const h = (ch: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(ch, async (e, ...args) => {
      guardSender(ch, e, origins) // only Bloop's own windows may call in
      try {
        return await fn(e, ...args)
      } catch (err) {
        log(`ipc ${ch} failed: ${(err as Error).message}`)
        throw err
      }
    })
  }
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

  h(IPC.plannerGet, () => planner.state())
  h(IPC.plannerAdd, (_e, title, due) => planner.add(str(title, 400), Number(due)))
  h(IPC.plannerRemove, (_e, id) => planner.remove(str(id, 64)))
  h(IPC.plannerStepDone, (_e, taskId, stepId, done) => planner.setStepDone(str(taskId, 64), str(stepId, 64), done === true))
  h(IPC.plannerSetWindow, (_e, w) => {
    const o = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>
    return planner.setWindow({ start: str(o['start'], 5), end: str(o['end'], 5) })
  })
  h(IPC.plannerSync, () => planner.sync())

  h(IPC.blockerGet, () => blocker.status())
  h(IPC.blockerSetSites, (_e, sites) => blocker.setSites(Array.isArray(sites) ? sites.slice(0, 200) : []))
  h(IPC.blockerSetManual, (_e, on) => blocker.setManual(on === true))

  h(IPC.googleGet, () => google.status())
  h(IPC.googleConnect, (_e, service) =>
    isGoogleService(service) ? google.connect(service) : { ok: false, error: 'Unknown Google service.' }
  )
  h(IPC.googleDisconnect, (_e, service) => (isGoogleService(service) ? google.disconnect(service) : google.status()))

  /** Lift the block synchronously (quit / reset must not leave sites blocked). */
  const unblockNow = (): void => {
    if (!isMac || !blocker.hasBlock()) return
    try {
      execFileSync('/usr/bin/sudo', ['-n', HELPER_PATH, 'unblock'], { timeout: 5_000, stdio: 'ignore' })
      log('blocker: unblocked on quit')
    } catch {
      /* helper not installed: nothing of Bloop's is in /etc/hosts */
    }
  }

  return {
    dispose() {
      clearTimeout(firstSync)
      clearInterval(timer)
      planner.dispose()
      blocker.dispose()
      unblockNow()
    },
    reset() {
      // the old instances may still have work in flight: make sure it can't write back or re-block
      planner.dispose()
      blocker.dispose()
      unblockNow()
      db.clear()
      planner = makePlanner()
      blocker = makeBlocker()
      google = makeGoogle()
      send(IPC.plannerPush, planner.state())
      send(IPC.blockerPush, blocker.status())
    }
  }
}
