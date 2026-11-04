// Find CLI binaries. A GUI-launched mac app inherits a minimal PATH (/usr/bin:/bin:...), so a plain
// execFile('claude') fails even when the tool is installed. We ask the user's login shell first and
// then probe the usual install dirs.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

export interface DetectDeps {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  /** Run a command and resolve its stdout (rejects on failure / timeout). */
  run(file: string, args: string[], timeoutMs: number): Promise<string>
  exists(path: string): boolean
  listDir(path: string): string[]
}

const defaultDeps: DetectDeps = {
  platform: process.platform,
  env: process.env,
  home: homedir(),
  run: (file, args, timeoutMs) =>
    new Promise((resolve, reject) => {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) =>
        err ? reject(err) : resolve(String(stdout))
      )
    }),
  exists: (p) => existsSync(p),
  listDir: (p) => {
    try {
      return readdirSync(p)
    } catch {
      return []
    }
  }
}

/** Compare "v22.1.0"-style names, newest first. */
function byVersionDesc(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0)
  return 0
}

/** Directories searched after the login-shell lookup, in priority order. */
export function fallbackDirs(deps: Pick<DetectDeps, 'platform' | 'env' | 'home' | 'listDir'>): string[] {
  const { platform, env, home } = deps
  if (platform === 'win32') {
    const appData = env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
    const local = env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
    return [
      join(appData, 'npm'),
      join(home, '.bun', 'bin'),
      join(home, '.volta', 'bin'),
      join(local, 'Programs', 'claude'),
      join(home, '.local', 'bin')
    ]
  }
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'), join(home, '.volta', 'bin')]
  // nvm: the shell's active node (NVM_BIN) first, then every installed version, newest first.
  const nvmDir = env['NVM_DIR'] ?? join(home, '.nvm')
  if (env['NVM_BIN']) dirs.push(env['NVM_BIN'])
  const versionsRoot = join(nvmDir, 'versions', 'node')
  for (const v of deps.listDir(versionsRoot).sort(byVersionDesc)) dirs.push(join(versionsRoot, v, 'bin'))
  dirs.push('/usr/bin', '/bin')
  return [...new Set(dirs)]
}

function exts(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
}

/** Pick the first absolute, existing path from a `command -v` / `where` output (ignores rc-file noise and aliases). */
export function pickPathFromOutput(out: string, deps: Pick<DetectDeps, 'platform' | 'exists'>): string | null {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const isAbs = (l: string): boolean => (deps.platform === 'win32' ? /^[A-Za-z]:\\/.test(l) : l.startsWith('/'))
  const abs = lines.filter(isAbs)
  // shell startup files may print junk before the answer, so prefer the LAST match on unix, first on `where`
  const ordered = deps.platform === 'win32' ? abs : [...abs].reverse()
  return ordered.find((l) => deps.exists(l)) ?? null
}

export async function detectBinary(bin: string, deps: DetectDeps = defaultDeps): Promise<string | null> {
  // 1. login shell PATH (mac/linux) or `where` (windows)
  try {
    if (deps.platform === 'win32') {
      const out = await deps.run('where', [bin], 3000)
      const hit = pickPathFromOutput(out, deps)
      if (hit) return hit
    } else {
      const shell = deps.env['SHELL'] || '/bin/zsh'
      const out = await deps.run(shell, ['-lc', `command -v ${bin}`], 3000)
      const hit = pickPathFromOutput(out, deps)
      if (hit) return hit
    }
  } catch {
    /* fall through to the directory list */
  }
  // 2. the process's own PATH, then the common install dirs
  const own = (deps.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  for (const dir of [...fallbackDirs(deps), ...own]) {
    for (const ext of exts(deps.platform)) {
      const p = join(dir, bin + ext)
      if (deps.exists(p)) return p
    }
  }
  return null
}

const NEG_TTL_MS = 60_000
const cache = new Map<string, { path: string | null; at: number }>()

/** Cached lookup. `refresh` forces a re-scan; misses are retried after a minute. */
export async function resolveBinary(bin: string, opts: { refresh?: boolean; deps?: DetectDeps } = {}): Promise<string | null> {
  const hit = cache.get(bin)
  if (hit && !opts.refresh && (hit.path || Date.now() - hit.at < NEG_TTL_MS)) {
    if (!hit.path || (opts.deps ?? defaultDeps).exists(hit.path)) return hit.path
  }
  const path = await detectBinary(bin, opts.deps ?? defaultDeps)
  cache.set(bin, { path, at: Date.now() })
  return path
}

export function clearBinaryCache(): void {
  cache.clear()
}

/** PATH for the child process: the binary's own dir first (so `#!/usr/bin/env node` finds its node), then the usual dirs. */
export function childPath(binPath: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const sep = platform === 'win32' ? '\\' : '/'
  const dir = binPath.slice(0, Math.max(binPath.lastIndexOf(sep), 0)) || '.'
  const extra = platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin']
  return [dir, ...extra, env['PATH'] ?? ''].filter(Boolean).join(platform === 'win32' ? ';' : ':')
}
