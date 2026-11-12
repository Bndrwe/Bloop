// Security review v2, check 1 (every ipcMain registration is behind the sender guard) and check 6
// (installer model download: https only, sha256 before the rename, no eval, no silent sudo).
// Structural checks on the source: the Electron handlers themselves need a running app.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

describe('IPC sender checks (check 1)', () => {
  const mainFiles = walk(join(ROOT, 'src/main'))

  it('no ipcMain.on / once / handleOnce registrations anywhere in src/main (every entry point is a guarded handle)', () => {
    const offenders = mainFiles.filter((f) => /ipcMain\.(on|once|handleOnce)\(/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('exactly three files register ipcMain.handle, and each has ONE registration inside its guarded wrapper', () => {
    const files = mainFiles.filter((f) => /ipcMain\.handle\(/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/')).sort()
    expect(files).toEqual(['src/main/ai/ipc.ts', 'src/main/chat.ts', 'src/main/index.ts'])
    for (const f of files) {
      const count = (read(f).match(/ipcMain\.handle\(/g) ?? []).length
      expect(count, f).toBe(1)
    }
  })

  it('the three wrappers run the sender guard before the handler body', () => {
    const index = read('src/main/index.ts')
    const ai = read('src/main/ai/ipc.ts')
    const chat = read('src/main/chat.ts')
    const chatApp = read('src/main/chatApp.ts')
    const before = (src: string, guardLine: string): void => {
      const h = src.indexOf('ipcMain.handle(')
      const g = src.indexOf(guardLine)
      expect(g).toBeGreaterThan(-1)
      expect(g).toBeLessThan(src.indexOf('return await fn(', h))
      expect(g).toBeGreaterThan(h)
    }
    before(index, 'guardSender(ch, e, origins)')
    before(ai, 'guardSender(ch, e, origins)')
    before(chat, 'deps.guard(ch, e)')
    expect(chatApp).toContain('guardSender(ch, e as unknown as Parameters<typeof guardSender>[1], origins)')
  })

  it('the pet context-menu handler checks the sender is the pet window (and the argument shape)', () => {
    const index = read('src/main/index.ts')
    expect(index).toMatch(/parsePetContextMenu\(\s*!!petWin && BrowserWindow\.fromWebContents\(e\.sender\) === petWin,\s*args\s*\)/)
  })

  it('the Brightspace login IPC validates the host type and length before use', () => {
    const index = read('src/main/index.ts')
    expect(index).toContain("if (typeof host !== 'string' || host.length > 300)")
  })

  it('the AI IPC validates every argument that carries data (choice, model, url, key); the removed check / instructions channels are gone', () => {
    const ai = read('src/main/ai/ipc.ts')
    expect(ai).toMatch(/validateChoice\(raw\)/)
    expect(ai).toMatch(/model\.trim\(\)\.length > 200/)
    expect(ai).toMatch(/normalizeOllamaUrl\(url\)/)
    expect(ai).toMatch(/key\.length > 4096/)
    expect(ai).not.toMatch(/aiSetSystemPrompt|aiCheck|aiTry|tryPrompt/)
    expect(ai).not.toMatch(/showOpenDialog|aiDownload|aiImport/)
    expect(ai).toMatch(/model\.length <= 200/)
  })
})

describe('installers (check 6, static)', () => {
  const sh = read('scripts/install.sh')
  const ps = read('scripts/install.ps1')
  const uninstall = [read('scripts/uninstall.sh'), read('scripts/uninstall.ps1')]
  const oldFile = 'bloop-qwen3.5-0.8b-q4_k_m.gguf'

  it('the old on-device model file is cleaned up once, and only that file and its .part are deleted (both installers)', () => {
    const start = sh.indexOf('remove_old_model_file() {')
    const shFn = sh.slice(start, sh.indexOf('\n}\n', start))
    expect(shFn).toContain('Library/Application Support/bloop/models')
    expect(shFn).toContain('${XDG_CONFIG_HOME:-$HOME/.config}/bloop/models')
    expect(shFn).toContain(`"$dir/${oldFile}" "$dir/${oldFile}.part"`)
    expect(shFn).toContain('rmdir "$dir"')
    expect(shFn).not.toMatch(/rm\s+-[a-zA-Z]*r/)
    expect(shFn).toContain('Removed the old on-device model file (about 530 MB).')
    const pStart = ps.indexOf('function Remove-OldModelFile')
    const psFn = ps.slice(pStart, ps.indexOf('# ----', pStart))
    expect(psFn).toContain("Join-Path $env:APPDATA 'bloop\\models'")
    expect(psFn).toContain(`'${oldFile}', '${oldFile}.part'`)
    expect(psFn).not.toMatch(/-Recurse/)
    expect(psFn).toContain('Removed the old on-device model file (about 530 MB).')
  })

  it('the installers download nothing model related; the old flags are accepted silently and undocumented', () => {
    for (const src of [sh, ps, ...uninstall]) {
      expect(src).not.toMatch(/model-info|huggingface|download_model|ModelDownload|sha256_of|BLOOP_TEST_MODE|_OVERRIDE/i)
    }
    expect(sh).toContain('--no-model|--model-only) ;;')
    const u = sh.indexOf('usage() {')
    expect(sh.slice(u, sh.indexOf('\n}\n', u))).not.toMatch(/model/i)
    expect(ps).toContain('[switch]$NoModel')
    expect(ps).toContain('[switch]$ModelOnly')
    expect(ps.slice(0, ps.indexOf('[CmdletBinding()]'))).not.toMatch(/NoModel|ModelOnly/)
  })

  it('no eval, Invoke-Expression, or iex of anything in the installers', () => {
    expect(sh).not.toMatch(/(^|[;&|(\s])eval\s/m)
    expect(ps).not.toMatch(/Invoke-Expression|\biex\b/)
  })

  it('no sudo is run by the installers (sudo only appears in printed hints)', () => {
    for (const src of [sh]) {
      const runs = src.split('\n').filter((l) => /^\s*(sudo\s|.*[|&;]\s*sudo\s)/.test(l))
      expect(runs).toEqual([])
    }
    expect(ps).not.toMatch(/Start-Process[^\n]*-Verb\s+RunAs/)
  })
})
