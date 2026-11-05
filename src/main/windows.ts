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
let petRestarts = 0
/** The pet's shown / hidden state (petVisibility.ts decides; a restarted pet window honours it). */
let petWanted = true
/** Where the panel opens when the pet is hidden: the tray icon's bounds (null / empty = unknown). */
let trayBounds: () => Rectangle | null = () => null

function webPreferences(): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload: join(__dirname, '../preload/index.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  }
}

/**
 * Installed apps have no terminal, so renderer errors, failed loads and crashes go to the main
 * log (and so to main.log, see log.ts) where a user can find them. Crashes are logged in index.ts.
 */
function watchContents(win: BrowserWindow, route: string): void {
  const wc = win.webContents
  wc.on('console-message', (e) => {
    const d = e as unknown as { level?: string | number; message?: string; sourceId?: string; lineNumber?: number }
    if (d.level === 'error' || d.level === 3) {
      console.log(`[bloop] renderer(${route}) error: ${d.message ?? ''} (${d.sourceId ?? ''}:${d.lineNumber ?? ''})`)
    }
  })
  wc.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[bloop] renderer(${route}) failed to load ${url}: ${code} ${desc}`)
  })
  wc.on('preload-error', (_e, path, err) => {
    console.log(`[bloop] renderer(${route}) preload ${path} failed: ${err.message}`)
  })
}

function loadRoute(win: BrowserWindow, route: string): void {
  watchContents(win, route)
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  // Packaged: out/main/index.js and out/renderer/index.html both sit inside app.asar, so this
  // relative path works in dev (`electron-vite preview`) and in the installed app alike.
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
    title: 'Bloop',
    webPreferences: webPreferences()
  })
  setTopLevel(win, 'pet')
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    /* not supported on this platform */
  }
  win.once('ready-to-show', () => {
    if (petWanted && !win.isDestroyed()) win.showInactive()
  })
  win.on('closed', () => {
    if (petWin === win) petWin = null
    stopDrag()
  })
  // The pet is the app's only always-visible UI: if its renderer crashes, bring it back
  // (a few times at most, so a renderer that crashes on load can't loop forever).
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit' || petRestarts >= 3) return
    petRestarts++
    setTimeout(() => {
      if (!win.isDestroyed()) win.destroy()
      if (!getPetWindow()) createPetWindow()
    }, 1000)
  })
  loadRoute(win, 'pet')
  petWin = win
  return win
}

/** Show or hide the pet window. It is never destroyed, so its renderer and state survive. */
export function setPetVisible(visible: boolean): void {
  petWanted = visible
  const win = getPetWindow()
  if (!win) return
  if (visible) {
    if (!win.isVisible() && !win.webContents.isLoading()) win.showInactive()
  } else {
    stopDrag()
    if (win.isVisible()) win.hide()
  }
}

export function isPetVisible(): boolean {
  const win = getPetWindow()
  return !!win && win.isVisible()
}

/** index.ts hands over the tray's bounds so the panel can open by the tray while the pet is hidden. */
export function setTrayBoundsProvider(fn: () => Rectangle | null): void {
  trayBounds = fn
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
  // Linux: click-through with {forward:true} isn't supported and can leave the pet unclickable,
  // and without a tray (GNOME) the pet is the only way into Bloop. Keep it clickable.
  if (process.platform === 'linux') return
  getPetWindow()?.setIgnoreMouseEvents(ignore, { forward: true })
}

// ------------------------------------------------------------------ panel

/** With the pet hidden: by the tray icon if we know where it is, else the top-right of the work area. */
function hiddenPetAnchor(): Rectangle {
  let tb: Rectangle | null = null
  try {
    tb = trayBounds()
  } catch {
    tb = null
  }
  // Linux reports empty bounds for tray icons; a zero-size rect means "unknown".
  if (tb && tb.width > 0 && tb.height > 0) return tb
  const wa = screen.getPrimaryDisplay().workArea
  // a zero-height anchor at the top-right corner: the panel opens right below it
  return { x: wa.x + wa.width - MARGIN, y: wa.y + MARGIN - 4, width: 0, height: 0 }
}

function positionPanel(win: BrowserWindow): void {
  const pet = getPetWindow()
  const anchor = !petWanted
    ? hiddenPetAnchor()
    : pet
      ? pet.getBounds()
      : { ...defaultPetPosition(), width: PET_SIZE, height: PET_SIZE }
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
    title: 'Bloop',
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

/** Show the panel (never hide it): used when the user launches Bloop again while it is running. */
export function showPanel(): void {
  if (!panelWin || panelWin.isDestroyed()) panelWin = createPanelWindow()
  const win = panelWin
  if (win.isVisible()) {
    win.focus()
    return
  }
  positionPanel(win)
  if (win.webContents.isLoading()) win.once('ready-to-show', () => win.show())
  else win.show()
  win.focus()
  if (isMac) app.focus({ steal: true })
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
  settingsWin = framedWindow('settings', 760, 640, 'Bloop — Settings')
  settingsWin.on('closed', () => {
    settingsWin = null
  })
  if (isMac) app.focus({ steal: true })
}

export function openOnboarding(): void {
  if (onboardingWin && !onboardingWin.isDestroyed()) return bringToFront(onboardingWin)
  onboardingWin = framedWindow('onboarding', 520, 560, 'Welcome to Bloop')
  onboardingWin.on('closed', () => {
    onboardingWin = null
  })
  if (isMac) app.focus({ steal: true })
}

export function closeOnboarding(): void {
  if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close()
}

// ------------------------------------------------------------------ chat

let chatWin: BrowserWindow | null = null

/** Chat with Bloop (#/chat): opens the chat window, or focuses it when it is already open. */
export function openChat(): void {
  closePanel()
  if (chatWin && !chatWin.isDestroyed()) return bringToFront(chatWin)
  chatWin = framedWindow('chat', 420, 640, 'Bloop — Chat')
  chatWin.setMinimumSize(360, 420)
  chatWin.on('closed', () => {
    chatWin = null
  })
  if (isMac) app.focus({ steal: true })
}
