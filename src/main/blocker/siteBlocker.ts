// Applies and removes the /etc/hosts block through the root helper (see hosts.ts). The helper is
// installed on first use with the macOS admin prompt; after that `sudo -n helper ...` needs no
// password. The command runner is injected so tests never touch sudo or /etc/hosts.
import { HELPER_PATH, HELPER_VERSION, adminAppleScript, installCommand } from './hosts'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}
export type Runner = (file: string, args: string[], timeoutMs?: number) => Promise<RunResult>

/** The helper isn't installed and we weren't allowed to ask for the password. */
export class NeedsSetupError extends Error {
  constructor() {
    super('Website blocking needs a one-time OK with your Mac password. Turn the blocker on to set it up.')
    this.name = 'NeedsSetupError'
  }
}

const SUDO = '/usr/bin/sudo'
const OSASCRIPT = '/usr/bin/osascript'
const PROMPT = 'Bloop wants to block distracting websites during your study blocks. This is asked only once.'
/** osascript's "User canceled." */
const CANCELLED_RE = /-128|User canceled/i

export interface SiteBlockerDeps {
  run: Runner
  /** The macOS short user name the sudoers rule is for. */
  user: string
  log?: (m: string) => void
}

export class SiteBlocker {
  private readonly log: (m: string) => void

  constructor(private readonly deps: SiteBlockerDeps) {
    this.log = deps.log ?? (() => undefined)
  }

  /** Is the current helper installed and runnable without a password? */
  async isReady(): Promise<boolean> {
    const r = await this.deps.run(SUDO, ['-n', HELPER_PATH, 'version'], 10_000).catch(() => null)
    return !!r && r.code === 0 && r.stdout.trim() === HELPER_VERSION
  }

  /** Block exactly these hostnames (already expanded and validated). */
  async block(hostnames: string[], allowPrompt: boolean): Promise<void> {
    if (hostnames.length === 0) return this.unblock()
    await this.ensureHelper(allowPrompt)
    await this.helper(['block', ...hostnames])
    this.log(`blocker: ${hostnames.length} hostnames blocked`)
  }

  /** Remove Bloop's section from /etc/hosts. Never prompts: without the helper nothing was blocked. */
  async unblock(): Promise<void> {
    if (!(await this.isReady())) return
    await this.helper(['unblock'])
    this.log('blocker: unblocked')
  }

  private async helper(args: string[]): Promise<void> {
    const r = await this.deps.run(SUDO, ['-n', HELPER_PATH, ...args], 20_000)
    if (r.code !== 0) throw new Error(`The blocker helper failed (${r.stderr.trim() || `exit ${r.code}`}).`)
  }

  private async ensureHelper(allowPrompt: boolean): Promise<void> {
    if (await this.isReady()) return
    if (!allowPrompt) throw new NeedsSetupError()
    this.log('blocker: installing the helper (admin prompt)')
    const script = adminAppleScript(installCommand(this.deps.user), PROMPT)
    const r = await this.deps.run(OSASCRIPT, ['-e', script], 5 * 60_000)
    if (r.code !== 0) {
      if (CANCELLED_RE.test(r.stderr)) throw new Error('Blocking needs your Mac password once. Turn it on again when you’re ready.')
      throw new Error(`Couldn’t set up website blocking (${r.stderr.trim() || `exit ${r.code}`}).`)
    }
    if (!(await this.isReady())) throw new Error('Website blocking was set up but can’t run yet. Try again.')
  }
}
