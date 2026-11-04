import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { AppStatus } from '@shared/types'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface TrayActions {
  start(): void
  pause(): void
  resume(): void
  stop(): void
  openSettings(): void
  togglePanel(): void
}

let tray: Tray | null = null
let lastKey = ''

/**
 * Tray icon: macOS uses a monochrome template image; Windows/Linux need a coloured PNG
 * (template images are mac-only). Packaged builds ship resources/ via electron-builder
 * `extraResources` (<install>/resources/resources); in dev it is <project>/resources.
 */
function iconPath(): string {
  const name = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-win.png'
  const candidates = [
    join(process.resourcesPath ?? '', 'resources', name), // packaged
    join(app.getAppPath(), 'resources', name), // dev (app path = project root)
    join(__dirname, '../../resources', name) // out/main -> <root>/resources
  ]
  return candidates.find((p) => existsSync(p)) ?? (candidates[2] as string)
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function createTray(actions: TrayActions, status: AppStatus): Tray | null {
  try {
    const img = nativeImage.createFromPath(iconPath())
    if (img.isEmpty()) throw new Error(`tray icon not found at ${iconPath()}`)
    if (process.platform === 'darwin') img.setTemplateImage(true)
    tray = new Tray(img)
  } catch (e) {
    console.log(`[bloop] tray unavailable: ${(e as Error).message}`)
    return null
  }
  if (process.platform !== 'darwin') tray.on('click', () => actions.togglePanel())
  updateTray(actions, status)
  return tray
}

export function updateTray(actions: TrayActions, s: AppStatus): void {
  if (!tray || tray.isDestroyed()) return
  const scoreText = s.score === null ? '—' : `${s.score}`
  const tip =
    s.phase === 'idle'
      ? 'Bloop — no session running'
      : `Bloop — ${s.phase === 'paused' ? 'paused' : s.phase} · focus score ${scoreText}`
  tray.setToolTip(tip)
  // the countdown next to the menu-bar icon (mac only)
  if (process.platform === 'darwin') {
    tray.setTitle(s.phase === 'focus' || s.phase === 'break' ? ` ${fmt(s.remainingSec)}` : s.phase === 'paused' ? ' ⏸' : '')
  }
  // rebuild the menu only when its shape changes
  const key = `${s.phase}|${s.pausedPhase}|${scoreText}`
  if (key === lastKey) return
  lastKey = key
  const running = s.phase === 'focus' || s.phase === 'break' || s.phase === 'paused'
  const items: MenuItemConstructorOptions[] = [
    { label: running ? `Focus score: ${scoreText}` : 'Bloop', enabled: false },
    { type: 'separator' }
  ]
  if (!running) items.push({ label: 'Start session', click: () => actions.start() })
  else {
    if (s.phase === 'paused') items.push({ label: 'Resume', click: () => actions.resume() })
    else items.push({ label: 'Pause', click: () => actions.pause() })
    items.push({ label: 'Stop session', click: () => actions.stop() })
  }
  items.push(
    { type: 'separator' },
    { label: 'Show panel', click: () => actions.togglePanel() },
    { label: 'Settings…', click: () => actions.openSettings() },
    { type: 'separator' },
    { label: 'Quit Bloop', click: () => app.quit() }
  )
  tray.setContextMenu(Menu.buildFromTemplate(items))
}
