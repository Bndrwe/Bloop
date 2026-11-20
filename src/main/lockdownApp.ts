// Electron / OS side of lockdown: bring the target back to the front ("Take me back").
// Best effort per platform; the cover stays the real lock either way.
import { execFile } from 'node:child_process'
import { shell } from 'electron'
import type { LockTarget } from '@shared/types'
import { exeBasename } from './classifier'
import { SAFE_APP_NAME as SAFE_NAME, windowsActivateScript } from './lockdown'

function run(cmd: string, args: string[], log: (m: string) => void): void {
  execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err) => {
    if (err) log(`lockdown: bringing the target back failed (${cmd}): ${err.message}`)
  })
}

export function activateTarget(target: LockTarget, log: (m: string) => void): void {
  if (target.kind === 'site') {
    void shell.openExternal(`https://${target.domain}/`).catch((e: unknown) => log(`lockdown: could not open the site: ${(e as Error).message}`))
    return
  }
  if (process.platform === 'darwin') {
    if (target.appPath && /\.app$/.test(target.appPath)) run('open', [target.appPath], log)
    else if (SAFE_NAME.test(target.app)) run('open', ['-a', target.app], log)
    return
  }
  if (process.platform === 'win32') {
    const name = target.appPath ? exeBasename(target.appPath) : target.app.replace(/\.exe$/i, '')
    if (SAFE_NAME.test(name)) run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsActivateScript(name)], log)
    return
  }
  // Linux (X11): wmctrl can raise a window by its class, if installed
  if (SAFE_NAME.test(target.app)) run('wmctrl', ['-x', '-a', target.app], log)
}
