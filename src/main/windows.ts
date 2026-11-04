import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, screen, type BrowserWindowConstructorOptions, type Rectangle } from 'electron'
import { getPetPosition, setPetPosition } from './store'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

/** Always-on-top level: above the Windows taskbar, or floating over normal windows on macOS/Linux. */
function setTopLevel(win: BrowserWindow, kind: 'pet' | 'panel'): void {
  if (isWin) win.setAlwaysOnTop(true, kind === 'pet' ? 'screen-saver' : 'pop-up-menu')
  else win.setAlwaysOnTop(true, isMac ? 'floating' : 'normal')
}

export const PET_SIZE = 180
const PANEL_W = 352
const PANEL_H = 580
const MARGIN = 16

let petWin: BrowserWindow | null = null
let panelWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let onboardingWin: BrowserWindow | null = null

function webPreferences(): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload: join(__dirname, '../preload/index.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
}

function loadRoute(win: BrowserWindow, route: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}#/${route}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: `/${route}` })
}

export function allWindows(): BrowserWindow[] {
  return [petWin, panelWin, settingsWin, onboardingWin].filter((w): w is BrowserWindow => !!w && !w.isDestroyed())
}

export function getPetWindow(): BrowserWindow | null {
  return petWin && !petWin.isDestroyed() ? petWin : null
}

// ------------------------------------------------------------------ pet

function rectVisibleOnSomeDisplay(r: Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    const ix = Math.min(r.x + r.width, wa.x + wa.width) - Math.max(r.x, wa.x)
    const iy = Math.min(r.y + r.height, wa.y + wa.height) - Math.max(r.y, wa.y)
    return ix >= r.width / 2 && iy >= r.height / 2
  })
}

function defaultPetPosition(): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - PET_SIZE - MARGIN, y: wa.y + MARGIN }
}

export function createPetWindow(): BrowserWindow {
  const stored = getPetPosition()
  const pos =
    stored && rectVisibleOnSomeDisplay({ ...stored, width: PET_SIZE, height: PET_SIZE }) ? stored : defaultPetPosition()
  const win = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    // Windows: don't steal focus from the app being studied in; mouse clicks still work.
    focusable: !isWin,
    ...(isWin ? { thickFrame: false, roundedCorners: false } : {}),
    show: false,
    title: 'Study Pet',
    webPreferences: webPreferences()
  })
  setTopLevel(win, 'pet')
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    /* not supported on this platform */
  }
  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => {
    petWin = null
    stopDrag()
  })
  loadRoute(win, 'pet')
  petWin = win
  return win
}

// ------------------------------------------------------------------ dragging

let drag: { timer: ReturnType<typeof setInterval>; cursor: Electron.Point; win: Electron.Point; moved: boolean } | null = null

export function dragStart(): void {
  const win = getPetWindow()
  if (!win) return
  stopDrag()
  const [wx, wy] = win.getPosition()
  const cursor = screen.getCursorScreenPoint()
  const state = { cursor, win: { x: wx, y: wy }, moved: false, timer: null as unknown as ReturnType<typeof setInterval> }
  state.timer = setInterval(() => {
    const w = getPetWindow()
    if (!w) return stopDrag()
    const c = screen.getCursorScreenPoint()
    const dx = c.x - state.cursor.x
    const dy = c.y - state.cursor.y
    if (!state.moved && Math.hypot(dx, dy) <= 4) return
    state.moved = true
    w.setPosition(Math.round(state.win.x + dx), Math.round(state.win.y + dy))
  }, 16)
  drag = state
}

function stopDrag(): boolean {
  if (!drag) return false
  clearInterval(drag.timer)
  const moved = drag.moved
  drag = null
  return moved
}

export function dragEnd(): { moved: boolean } {
  const moved = stopDrag()
  const win = getPetWindow()
  if (moved && win) {
    const [x, y] = win.getPosition()
    setPetPosition({ x, y })
    if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) positionPanel(panelWin)
  }
  return { moved }
}

export function setIgnoreMouse(ignore: boolean): void {
  getPetWindow()?.setIgnoreMouseEvents(ignore, { forward: true })
}

// ------------------------------------------------------------------ panel

function positionPanel(win: BrowserWindow): void {
  const pet = getPetWindow()
  const anchor = pet ? pet.getBounds() : { ...defaultPetPosition(), width: PET_SIZE, height: PET_SIZE }
  const wa = screen.getDisplayMatching(anchor).workArea
  // prefer below the pet, right-aligned with it; flip above if there's no room
  let x = anchor.x + anchor.width - PANEL_W
  let y = anchor.y + anchor.height + 4
  if (y + PANEL_H > wa.y + wa.height) y = anchor.y - PANEL_H - 4
  if (y < wa.y) {
    // no room above or below (small work area): sit beside the pet
    y = anchor.y
    x = anchor.x - PANEL_W - 4 >= wa.x ? anchor.x - PANEL_W - 4 : anchor.x + anchor.width + 4
  }
  // never leave the work area (taskbar excluded), whatever branch was taken
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - PANEL_W - 8))
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - PANEL_H))
  win.setPosition(Math.round(x), Math.round(y))
}

export function ensurePanelWindow(): void {
  if (!panelWin || panelWin.isDestroyed()) panelWin = createPanelWindow()
}

function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Study Pet',
    backgroundColor: '#000000',
    roundedCorners: true,
    webPreferences: webPreferences()
  })
  setTopLevel(win, 'panel')
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    /* ignore */
  }
  win.on('blur', () => {
    // clicking the pet would blur the panel and then toggle it right back open
    if (!win.isDestroyed()) {
      lastPanelBlurAt = Date.now()
      win.hide()
    }
  })
  win.on('closed', () => {
    panelWin = null
  })
  loadRoute(win, 'panel')
  return win
}

let lastPanelBlurAt = 0

export function togglePanel(): void {
  if (!panelWin || panelWin.isDestroyed()) panelWin = createPanelWindow()
  const win = panelWin
  if (win.isVisible()) {
    win.hide()
    return
  }
  // If the panel just hid because the user clicked the pet, treat this click as "close".
  if (Date.now() - lastPanelBlurAt < 250) return
  positionPanel(win)
  if (win.webContents.isLoading()) win.once('ready-to-show', () => win.show())
  else win.show()
  win.focus()
}

export function closePanel(): void {
  if (panelWin && !panelWin.isDestroyed()) panelWin.hide()
}

// ------------------------------------------------------------------ settings / onboarding

function framedWindow(route: string, width: number, height: number, title: string): BrowserWindow {
  const win = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(width, 480),
    minHeight: Math.min(height, 420),
    show: false,
    title,
    backgroundColor: '#000000',
    webPreferences: webPreferences()
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  loadRoute(win, route)
  return win
}

function bringToFront(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (isMac) app.focus({ steal: true })
}

export function openSettings(): void {
  closePanel()
  if (settingsWin && !settingsWin.isDestroyed()) return bringToFront(settingsWin)
  settingsWin = framedWindow('settings', 760, 640, 'Study Pet — Settings')
  settingsWin.on('closed', () => {
    settingsWin = null
  })
  if (isMac) app.focus({ steal: true })
}

export function openOnboarding(): void {
  if (onboardingWin && !onboardingWin.isDestroyed()) return bringToFront(onboardingWin)
  onboardingWin = framedWindow('onboarding', 520, 560, 'Welcome to Study Pet')
  onboardingWin.on('closed', () => {
    onboardingWin = null
  })
  if (isMac) app.focus({ steal: true })
}

export function closeOnboarding(): void {
  if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close()
}
