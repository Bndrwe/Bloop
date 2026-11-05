import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  autostartContents,
  classifyTrackerError,
  createRateLimitedLog,
  detectSessionType,
  isGnomeDesktop,
  linuxTrackingInfo,
  quoteExecArg,
  setLinuxAutostart
} from '../src/main/linux'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'bloop-linux-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('setLinuxAutostart', () => {
  it('uses the install script launcher when the AppImage was installed by scripts/install.sh', () => {
    const home = mkdtempSync(join(tmpdir(), 'bloop-home-'))
    const appimage = join(home, '.local', 'opt', 'bloop', 'Bloop.AppImage')
    // no launcher yet: falls back to the AppImage
    expect(autostartContents({ home, env: { APPIMAGE: appimage } })).toContain(`Exec=${quoteExecArg(appimage)}`)
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    writeFileSync(join(home, '.local', 'bin', 'bloop'), '#!/bin/sh\n')
    expect(autostartContents({ home, env: { APPIMAGE: appimage } })).toContain(`Exec=${quoteExecArg(join(home, '.local', 'bin', 'bloop'))}`)
    // an AppImage elsewhere ignores the launcher
    expect(autostartContents({ home, env: { APPIMAGE: '/tmp/Bloop.AppImage' } })).toContain(`Exec=${quoteExecArg('/tmp/Bloop.AppImage')}`)
  })

  it('writes ~/.config/autostart/bloop.desktop with execPath and removes it', () => {
    const home = tmp()
    const f = setLinuxAutostart(true, { home, env: {}, execPath: '/opt/Bloop/bloop' })
    expect(f).toBe(join(home, '.config/autostart/bloop.desktop'))
    const t = readFileSync(f, 'utf8')
    expect(t).toContain('[Desktop Entry]')
    expect(t).toContain('Exec="/opt/Bloop/bloop"')
    expect(t).toContain('X-GNOME-Autostart-enabled=true')
    setLinuxAutostart(false, { home, env: {} })
    expect(existsSync(f)).toBe(false)
    expect(() => setLinuxAutostart(false, { home, env: {} })).not.toThrow()
  })
  it('prefers APPIMAGE and honours XDG_CONFIG_HOME, with spaces quoted', () => {
    const home = tmp()
    const xdg = join(tmp(), 'cfg')
    const f = setLinuxAutostart(true, { home, env: { XDG_CONFIG_HOME: xdg, APPIMAGE: '/home/a b/Apps/Bloop 1.0.AppImage' }, execPath: '/tmp/.mount_x/bloop' })
    expect(f).toBe(join(xdg, 'autostart/bloop.desktop'))
    const t = readFileSync(f, 'utf8')
    expect(t).toContain('Exec="/home/a b/Apps/Bloop 1.0.AppImage"')
    expect(t).not.toContain('.mount_x')
  })
  it('ignores a relative XDG_CONFIG_HOME', () => {
    const home = tmp()
    expect(setLinuxAutostart(true, { home, env: { XDG_CONFIG_HOME: 'rel' }, execPath: '/x' })).toBe(join(home, '.config/autostart/bloop.desktop'))
  })
})

describe('quoteExecArg', () => {
  it('escapes reserved characters', () => {
    expect(quoteExecArg('/a b/c')).toBe('"/a b/c"')
    expect(quoteExecArg('/a"b')).toBe('"/a\\"b"')
    expect(quoteExecArg('/a$b`c')).toBe('"/a\\$b\\`c"')
    expect(quoteExecArg('/a\\b')).toBe('"/a\\\\\\\\b"')
    expect(quoteExecArg('/100%')).toBe('"/100%%"')
  })
})

describe('session detection', () => {
  it('detects wayland / x11', () => {
    expect(detectSessionType({ XDG_SESSION_TYPE: 'wayland' })).toBe('wayland')
    expect(detectSessionType({ XDG_SESSION_TYPE: 'x11' })).toBe('x11')
    expect(detectSessionType({ WAYLAND_DISPLAY: 'wayland-0' })).toBe('wayland')
    expect(detectSessionType({ DISPLAY: ':0' })).toBe('x11')
    expect(detectSessionType({})).toBe('unknown')
  })
  it('detects GNOME in a list', () => {
    expect(isGnomeDesktop({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe(true)
    expect(isGnomeDesktop({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe(false)
  })
  it('tracking note: missing tools, wayland, x11', () => {
    expect(linuxTrackingInfo({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, () => false).note).toContain('install x11-utils')
    const w = linuxTrackingInfo({ XDG_SESSION_TYPE: 'wayland' }, () => true)
    expect(w.limited).toBe(true)
    expect(w.note).toContain('XWayland')
    expect(linuxTrackingInfo({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, () => true).limited).toBe(false)
  })
})

describe('tracker error handling', () => {
  it('classifies errors', () => {
    expect(classifyTrackerError(Object.assign(new Error('spawn xprop ENOENT'), { code: 'ENOENT' }))).toBe('missing-xprop')
    expect(classifyTrackerError(new Error('xprop: error: Can\'t open display'))).toBe('other')
    expect(classifyTrackerError(Object.assign(new Error('x'), { stderr: 'xprop: unable to open display ""' }))).toBe('no-display')
    expect(classifyTrackerError(Object.assign(new Error('x'), { killed: true }))).toBe('timeout')
  })
  it('rate limits repeats and reports the suppressed count', () => {
    const out: string[] = []
    let t = 0
    const log = createRateLimitedLog((m) => out.push(m), 1000, () => t)
    expect(log('a', 'boom')).toBe(true)
    expect(log('a', 'boom')).toBe(false)
    expect(log('a', 'boom')).toBe(false)
    expect(log('b', 'other')).toBe(true)
    t = 1500
    expect(log('a', 'boom')).toBe(true)
    expect(out).toEqual(['boom', 'other', 'boom (2 similar suppressed)'])
  })
})
