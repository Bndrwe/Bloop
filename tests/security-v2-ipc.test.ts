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
    const files = mainFiles.filter((f) => /ipcMain\.handle\(/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(ROOT.length + 1)).sort()
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

  it('the AI IPC validates every argument that carries data (choice, model, url, key, prompt, system prompt)', () => {
    const ai = read('src/main/ai/ipc.ts')
    expect(ai).toMatch(/validateChoice\(raw\)/)
    expect(ai).toMatch(/model\.trim\(\)\.length > 200/)
    expect(ai).toMatch(/normalizeOllamaUrl\(url\)/)
    expect(ai).toMatch(/key\.length > 4096/)
    expect(ai).toMatch(/SYSTEM_PROMPT_MAX/)
    expect(ai).toMatch(/tryPrompt\(\(\) => registry\.resolve/)
    expect(ai).toMatch(/model\.length <= 200/)
  })
})

describe('installer model download (check 6, static)', () => {
  const sh = read('scripts/install.sh')
  const ps = read('scripts/install.ps1')
  const shDownload = sh.slice(sh.indexOf('download_model() {'), sh.indexOf('\n}\n', sh.indexOf('download_model() {')))
  const psDownload = ps.slice(ps.indexOf('function Start-ModelDownload'), ps.indexOf('function Complete-ModelDownload'))

  it('the sha256 is checked before the file is moved into place (both installers)', () => {
    const shSha = shDownload.indexOf('sha256_of "$part"')
    const shMv = shDownload.indexOf('mv -f "$part" "$dest"')
    expect(shSha).toBeGreaterThan(-1)
    expect(shSha).toBeLessThan(shMv)
    const ps1 = ps.indexOf('Get-FileSha256 $c.Part')
    const mvPs = ps.indexOf('Move-Item -LiteralPath $c.Part -Destination $c.Dest')
    expect(ps1).toBeGreaterThan(-1)
    expect(ps1).toBeLessThan(mvPs)
  })

  it('the sha256 is a 64-hex string and the file name cannot contain a path (both installers)', () => {
    expect(shDownload).toMatch(/\^\[0-9a-fA-F\]\{64\}\$/)
    expect(shDownload).toContain('"$file" == */*')
    expect(psDownload).toMatch(/\[0-9a-f\]\{64\}/)
    expect(psDownload).toMatch(/\[\\\\\/\]/)
  })

  // Found in review: neither installer checks that the model URL is https. Only the in-app download
  // (bloop.ts) does. The URL normally comes from bloop.ts, but BLOOP_MODEL_URL_OVERRIDE (test-only)
  // can replace it silently. The sha256 still gates the file, so this is defence in depth.
  it('install.sh refuses a non-https model URL before it downloads anything', () => {
    expect(shDownload).toMatch(/=~\s*\^https:\/\//)
  })

  it('install.ps1 refuses a non-https model URL before it downloads anything', () => {
    expect(psDownload).toMatch(/-match\s+'\^https:\/\/'|-notmatch\s+'\^https:\/\/'/)
  })

  it('the test-only override variables are documented as test-only in both installers and model-info', () => {
    for (const src of [sh, ps, read('scripts/model-info.mjs')]) {
      expect(src).toMatch(/TEST ONLY/)
      expect(src).toContain('BLOOP_MODEL_URL_OVERRIDE')
    }
  })

  it('no eval, Invoke-Expression, or iex of anything in the installers or the model helper', () => {
    expect(sh).not.toMatch(/(^|[;&|(\s])eval\s/m)
    expect(ps).not.toMatch(/Invoke-Expression|\biex\b/)
    expect(read('scripts/model-info.mjs')).not.toMatch(/\beval\(|new Function\(/)
  })

  it('no sudo is run by the installers (sudo only appears in printed hints)', () => {
    for (const src of [sh]) {
      const runs = src.split('\n').filter((l) => /^\s*(sudo\s|.*[|&;]\s*sudo\s)/.test(l))
      expect(runs).toEqual([])
    }
    expect(ps).not.toMatch(/Start-Process[^\n]*-Verb\s+RunAs/)
  })
})
