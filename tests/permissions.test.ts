// Settings → Permissions: the Screen Recording fallback probe, Reset permissions… (tccutil via
// execFile, no shell), the new IPC channels' argument checks, and the pet badge's "+" / "–".
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const realPlatform = process.platform
  // permissions.ts reads the platform at import time
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  return {
    realPlatform,
    mediaStatus: 'denied' as string,
    sources: [] as { id: string; name: string }[],
    getSources: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
    ownIds: ['window:100:0'],
    dismissed: true,
    packaged: true,
    execCalls: [] as { file: string; args: string[] }[],
    execFail: false,
    opened: [] as string[]
  }
})

vi.mock('electron', () => {
  h.getSources = vi.fn(async (opts: { types: string[] }) => (opts.types.includes('window') ? h.sources : []))
  return {
    app: {
      get isPackaged() {
        return h.packaged
      }
    },
    BrowserWindow: { getAllWindows: () => h.ownIds.map((id) => ({ isDestroyed: () => false, getMediaSourceId: () => id })) },
    desktopCapturer: { getSources: (o: { types: string[] }) => h.getSources(o) },
    shell: { openExternal: vi.fn(async (u: string) => void h.opened.push(u)) },
    systemPreferences: { getMediaAccessStatus: () => h.mediaStatus }
  }
})
vi.mock('../src/main/store', () => ({ isOnboardingDismissed: () => h.dismissed }))
vi.mock('node:child_process', () => ({
  execFile: (file: string, args: string[], _opts: unknown, cb: (err: Error | null, out: string, errOut: string) => void) => {
    h.execCalls.push({ file, args })
    if (h.execFail) cb(new Error('boom'), '', 'tccutil: No such bundle identifier')
    else cb(null, '', '')
  }
}))

import {
  appBundleId,
  bundleIdFromPlist,
  clearScreenRecordingProbe,
  DEFAULT_BUNDLE_ID,
  getScreenRecordingState,
  hasOtherAppWindows,
  parsePermissionQuery,
  parseResetRequest,
  probeScreenRecording,
  resetPermissions,
  tccResetCommands
} from '../src/main/permissions'
import { APP_ID } from '../src/shared/appId'
import { IPC } from '../src/shared/ipc'
import { badgeText, panelToggleLabel } from '../src/shared/petBadge'

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: h.realPlatform, configurable: true })
})

beforeEach(() => {
  h.mediaStatus = 'denied'
  h.sources = []
  h.dismissed = true
  h.packaged = true
  h.execCalls = []
  h.execFail = false
  h.opened = []
  h.getSources.mockClear()
  clearScreenRecordingProbe()
})

describe('Screen Recording detection fallback', () => {
  it('a titled window from another app means granted', () => {
    expect(hasOtherAppWindows([{ id: 'window:7:0', name: 'Lecture notes.pdf' }], [])).toBe(true)
  })

  it("only Bloop's own windows, untitled windows or system windows mean not granted", () => {
    const own = ['window:1:0']
    expect(hasOtherAppWindows([], own)).toBe(false)
    expect(hasOtherAppWindows([{ id: 'window:1:0', name: 'Some page title' }], own)).toBe(false)
    expect(hasOtherAppWindows([{ id: 'window:2:0', name: '' }, { id: 'window:3:0', name: '   ' }], own)).toBe(false)
    expect(hasOtherAppWindows([{ id: 'window:4:0', name: 'Bloop — Settings' }, { id: 'window:5:0', name: 'Welcome to Bloop' }], own)).toBe(false)
    expect(hasOtherAppWindows([{ id: 'window:6:0', name: 'Dock' }, { id: 'window:8:0', name: 'Menubar' }], own)).toBe(false)
  })

  it('getMediaAccessStatus granted wins without probing', async () => {
    h.mediaStatus = 'granted'
    await probeScreenRecording()
    expect(h.getSources).not.toHaveBeenCalled()
    expect(getScreenRecordingState()).toBe('granted')
  })

  it('upgrades a stale "denied" to granted when other apps\' windows are listed', async () => {
    h.sources = [{ id: 'window:100:0', name: 'Bloop' }, { id: 'window:42:0', name: 'Essay draft - Google Docs' }]
    expect(getScreenRecordingState()).toBe('denied')
    await probeScreenRecording()
    expect(getScreenRecordingState()).toBe('granted')
    // window list only, no thumbnails captured (cheap, and no permission prompt)
    expect(h.getSources).toHaveBeenCalledWith(expect.objectContaining({ types: ['window'], thumbnailSize: { width: 0, height: 0 } }))
  })

  it('stays not granted when only own windows are listed', async () => {
    h.sources = [{ id: 'window:100:0', name: 'Essay draft' }]
    await probeScreenRecording()
    expect(getScreenRecordingState()).toBe('denied')
  })

  it('caches the result (no probe on every poll) until the TTL or a forced check', async () => {
    await probeScreenRecording()
    await probeScreenRecording()
    await probeScreenRecording()
    expect(h.getSources).toHaveBeenCalledTimes(1)
    await probeScreenRecording(true)
    expect(h.getSources).toHaveBeenCalledTimes(2)
  })

  it('concurrent calls share one probe', async () => {
    await Promise.all([probeScreenRecording(true), probeScreenRecording(true), probeScreenRecording()])
    expect(h.getSources).toHaveBeenCalledTimes(1)
  })

  it('never probes before the user has been through setup (unless explicitly asked)', async () => {
    h.dismissed = false
    h.sources = [{ id: 'window:9:0', name: 'Other app' }]
    await probeScreenRecording()
    expect(h.getSources).not.toHaveBeenCalled()
    expect(getScreenRecordingState()).toBe('denied')
    await probeScreenRecording(true) // "Check again"
    expect(getScreenRecordingState()).toBe('granted')
  })

  it('a failing probe counts as not granted', async () => {
    h.getSources.mockRejectedValueOnce(new Error('no window server'))
    await probeScreenRecording()
    expect(getScreenRecordingState()).toBe('denied')
  })
})

describe('Reset permissions…', () => {
  it('runs tccutil reset for ScreenCapture and AppleEvents with argument arrays (no shell)', async () => {
    const r = await resetPermissions({ bundleId: APP_ID })
    expect(r).toEqual({ ok: true, bundleId: APP_ID })
    expect(h.execCalls).toEqual([
      { file: '/usr/bin/tccutil', args: ['reset', 'ScreenCapture', APP_ID] },
      { file: '/usr/bin/tccutil', args: ['reset', 'AppleEvents', APP_ID] }
    ])
    // re-registers screen capture (so Bloop is listed again) and opens the Screen Recording pane
    expect(h.getSources).toHaveBeenCalledWith(expect.objectContaining({ types: ['screen'] }))
    expect(h.opened).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'])
  })

  it('in development it explains that reset applies to the installed app and runs nothing', async () => {
    h.packaged = false
    const r = await resetPermissions()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('dev')
      expect(r.message).toMatch(/installed Bloop app/)
    }
    expect(h.execCalls).toEqual([])
  })

  it('reports a tccutil failure', async () => {
    h.execFail = true
    const r = await resetPermissions({ bundleId: APP_ID })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('failed')
    expect(h.opened).toEqual([])
  })

  it('rejects a bundle id that is not a plain reverse-DNS id', () => {
    expect(() => tccResetCommands('a b')).toThrow()
    expect(() => tccResetCommands('x;rm -rf /')).toThrow()
    expect(() => tccResetCommands('')).toThrow()
  })

  it('reads the bundle id from Info.plist, falling back to build.appId', () => {
    expect(bundleIdFromPlist('<key>CFBundleIdentifier</key>\n\t<string>io.github.bndrwe.bloop</string>')).toBe('io.github.bndrwe.bloop')
    expect(bundleIdFromPlist('<key>CFBundleName</key><string>Bloop</string>')).toBeNull()
    expect(bundleIdFromPlist('<key>CFBundleIdentifier</key><string>bad id;</string>')).toBeNull()
    expect(appBundleId('/nonexistent/Bloop.app/Contents/MacOS/Bloop')).toBe(DEFAULT_BUNDLE_ID)
  })

  it('one app id everywhere: src/shared/appId.ts = package.json build.appId = the perms script', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { build: { appId: string } }
    expect(pkg.build.appId).toBe(APP_ID)
    expect(DEFAULT_BUNDLE_ID).toBe(APP_ID)
    expect(readFileSync(join(process.cwd(), 'scripts/mac-permissions.sh'), 'utf8')).toContain(`APP_ID="${APP_ID}"`)
  })
})

describe('new IPC channels', () => {
  it('are namespaced and unique', () => {
    expect(IPC.resetPermissions).toBe('perm:reset')
    expect(IPC.openPermissionsSetup).toBe('perm:open-setup')
    expect(IPC.isPanelOpen).toBe('win:panel-open')
    expect(IPC.panelOpenPush).toBe('win:panel-open-push')
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })

  it('perm:reset is accepted only from the Settings window with no arguments', () => {
    expect(parseResetRequest(true, [])).toBe(true)
    expect(parseResetRequest(false, [])).toBe(false)
    expect(parseResetRequest(true, ['io.github.evil'])).toBe(false)
    expect(parseResetRequest(true, [undefined])).toBe(false)
  })

  it('perm:get takes nothing or `true`; anything else is a plain (cached) read', () => {
    expect(parsePermissionQuery([])).toEqual({ fresh: false })
    expect(parsePermissionQuery([true])).toEqual({ fresh: true })
    expect(parsePermissionQuery(['true'])).toEqual({ fresh: false })
    expect(parsePermissionQuery([1])).toEqual({ fresh: false })
    expect(parsePermissionQuery([true, true])).toEqual({ fresh: false })
  })

  it('main registers the new handlers behind the guarded h() wrapper, with the sender check for reset', () => {
    const index = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    for (const ch of ['resetPermissions', 'openPermissionsSetup', 'isPanelOpen']) expect(index).toContain(`h(IPC.${ch},`)
    expect(index).toMatch(/parseResetRequest\(!!settingsWin && BrowserWindow\.fromWebContents\(e\.sender\) === settingsWin, args\)/)
    expect(index).toContain('parsePermissionQuery(args)')
  })

  it('the preload exposes named functions only, coercing the fresh flag', () => {
    const preload = readFileSync(join(process.cwd(), 'src/preload/index.ts'), 'utf8')
    expect(preload).toContain('opts?.fresh === true ? inv(IPC.getPermissions, true) : inv(IPC.getPermissions)')
    expect(preload).toContain('resetPermissions: () => inv(IPC.resetPermissions)')
    expect(preload).toContain('cb(open === true)')
  })
})

describe('pet badge', () => {
  it('shows "+" when there is no score and the panel is closed, "–" when it is open', () => {
    expect(badgeText(null, false)).toBe('+')
    expect(badgeText(undefined, false)).toBe('+')
    expect(badgeText(null, true)).toBe('–')
  })

  it('shows the score whenever there is one, open or closed', () => {
    expect(badgeText(72.4, false)).toBe('72')
    expect(badgeText(0, true)).toBe('0')
  })

  it('labels the toggle; the panel and stats keep their own "–" for no score', () => {
    expect(panelToggleLabel(false)).toBe('Open panel')
    expect(panelToggleLabel(true)).toBe('Close panel')
    expect(readFileSync(join(process.cwd(), 'src/renderer/src/lib/format.ts'), 'utf8')).toContain("score == null ? '–' : String(Math.round(score))")
  })
})
