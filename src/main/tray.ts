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
  /** Hide or show the pet (petVisibility.ts). */
  togglePet(): void
  /** "Hide pet (Ctrl+Shift+B)" / "Show pet (Ctrl+Shift+B)": the label reflects the current state. */
  petLabel(): string
  about(): void
  openLogs(): void
  quit(): void
  /** Open (or focus) the Chat with Bloop window. */
  openChat?(): void
  /** macOS: true while Screen Recording or Automation isn't granted (shows "Permissions…"). */
  permissionsNeeded?(): boolean
  /** Settings → Permissions. */
  openPermissions?(): void
}

let tray: Tray | null = null
let lastKey = ''
let lastItems: MenuItemConstructorOptions[] = []

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

/**
 * Windows draws the tray icon at 16 px (100%), 20 (125%), 24 (150%) or 32 (200%). A single 32 px
 * bitmap gets squashed by the shell and looks blurry, so give it one representation per scale.
 */
function windowsTrayImage(src: Electron.NativeImage): Electron.NativeImage {
  const out = nativeImage.createEmpty()
  for (const scaleFactor of [1, 1.25, 1.5, 2]) {
    const px = Math.round(16 * scaleFactor)
    const r = src.resize({ width: px, height: px, quality: 'best' })
    out.addRepresentation({ scaleFactor, width: px, height: px, buffer: r.toPNG() })
  }
  return out.isEmpty() ? src : out
}

export function createTray(actions: TrayActions, status: AppStatus): Tray | null {
  const path = iconPath()
  try {
    let img = nativeImage.createFromPath(path)
    if (img.isEmpty()) throw new Error(`tray icon not found at ${path}`)
    if (process.platform === 'darwin') img.setTemplateImage(true)
    if (process.platform === 'win32') img = windowsTrayImage(img)
    tray = new Tray(img)
  } catch (e) {
    console.log(`[bloop] tray unavailable: ${(e as Error).message}`)
    return null
  }
  console.log(`[bloop] tray ready (icon ${path})`)
  if (process.platform !== 'darwin') tray.on('click', () => actions.togglePanel())
  // Windows users often double-click tray icons; treat it like a click.
  if (process.platform === 'win32') tray.on('double-click', () => actions.togglePanel())
  updateTray(actions, status)
  return tray
}

/** For automated tests of the packaged app (BLOOP_E2E=1): the current menu's labels. */
export function trayMenuLabels(): string[] | null {
  if (!tray || tray.isDestroyed()) return null
  return lastItems.filter((i) => i.type !== 'separator').map((i) => String(i.label ?? ''))
}

/** For automated tests of the packaged app (BLOOP_E2E=1): click a menu item by label. */
export function clickTrayItem(label: string): boolean {
  const item = lastItems.find((i) => i.label === label && i.enabled !== false)
  if (!item?.click) return false
  ;(item.click as () => void)()
  return true
}

/** Tray icon bounds (macOS / Windows; Linux reports an empty rect). For placing the panel. */
export function trayBounds(): Electron.Rectangle | null {
  if (!tray || tray.isDestroyed()) return null
  try {
    return tray.getBounds()
  } catch {
    return null
  }
}

export function updateTray(actions: TrayActions, s: AppStatus): void {
  if (!tray || tray.isDestroyed()) return
  const scoreText = s.score === null ? '—' : `${s.score}`
  const tip =
    s.phase === 'idle'
      ? s.watching
        ? `Bloop — no session, watching for distractions · focus score ${scoreText}`
        : 'Bloop — no session running'
      : `Bloop — ${s.phase === 'paused' ? 'paused' : s.phase} · focus score ${scoreText}`
  tray.setToolTip(tip)
  // the countdown next to the menu-bar icon (mac only)
  if (process.platform === 'darwin') {
    tray.setTitle(s.phase === 'focus' || s.phase === 'break' ? ` ${fmt(s.remainingSec)}` : s.phase === 'paused' ? ' ⏸' : '')
  }
  // rebuild the menu only when its shape changes
  const petLabel = actions.petLabel()
  const perms = !!actions.openPermissions && actions.permissionsNeeded?.() === true
  const key = `${s.phase}|${s.pausedPhase}|${scoreText}|${petLabel}|${perms}`
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
    { label: petLabel, click: () => actions.togglePet() },
    { label: 'Settings…', click: () => actions.openSettings() },
    ...(perms ? [{ label: 'Permissions…', click: () => actions.openPermissions?.() }] : []),
    ...(actions.openChat ? [{ label: 'Chat with Bloop', click: () => actions.openChat?.() }] : []),
    { type: 'separator' },
    { label: `About Bloop ${app.getVersion()}`, click: () => actions.about() },
    { label: 'Open logs folder', click: () => actions.openLogs() },
    { type: 'separator' },
    { label: 'Quit Bloop', click: () => actions.quit() }
  )
  lastItems = items
  tray.setContextMenu(Menu.buildFromTemplate(items))
}
