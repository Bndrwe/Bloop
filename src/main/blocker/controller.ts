// Decides when sites are blocked: while the user has it on, or while a study block runs. It keeps
// /etc/hosts in line with that (one change at a time) and reports a BlockerStatus for the UI.
import { BLOCKER_SITES_MAX, type BlockerStatus } from '@shared/planner'
import { expandHostnames, normalizeSite } from './hosts'
import { NeedsSetupError } from './siteBlocker'

export interface BlockerData {
  sites: string[]
  manual: boolean
}

export interface SiteBlockerLike {
  block(hostnames: string[], allowPrompt: boolean): Promise<void>
  unblock(): Promise<void>
}

export interface RunningBlock {
  label: string
  until: number
}

export interface BlockerControllerDeps {
  blocker: SiteBlockerLike
  supported: boolean
  load(): BlockerData
  save(d: BlockerData): void
  activeBlock(): RunningBlock | null
  onChange?: (s: BlockerStatus) => void
  log?: (m: string) => void
}

/** Clean a site list: normalized, valid, unique, capped. */
export function cleanSites(sites: unknown): string[] {
  if (!Array.isArray(sites)) return []
  const out: string[] = []
  for (const s of sites) {
    const d = typeof s === 'string' ? normalizeSite(s) : null
    if (d && !out.includes(d)) out.push(d)
  }
  return out.slice(0, BLOCKER_SITES_MAX)
}

export class BlockerController {
  private data: BlockerData
  /** Hostnames in /etc/hosts now; null = unknown (at launch: a crash may have left a block). */
  private applied: string[] | null = null
  private busy = false
  private again = false
  private error: string | undefined
  /** The admin prompt was turned down; scheduled blocks don't ask again until the user does. */
  private declined = false
  private nextAllowPrompt = false
  /** The target that last failed; not retried without a prompt (no log spam every tick). */
  private failedKey: string | null = null
  private disposed = false
  private readonly log: (m: string) => void

  constructor(private readonly deps: BlockerControllerDeps) {
    const d = deps.load()
    this.data = { sites: cleanSites(d.sites), manual: d.manual === true }
    this.log = deps.log ?? (() => undefined)
  }

  status(): BlockerStatus {
    const block = this.deps.activeBlock()
    const wanted = this.wanted(block)
    const reason = !wanted ? null : this.data.manual ? 'manual' : 'block'
    return {
      supported: this.deps.supported,
      active: !!this.applied && this.applied.length > 0,
      reason,
      manual: this.data.manual,
      sites: this.data.sites,
      ...(reason === 'block' && block ? { blockLabel: block.label, until: block.until } : {}),
      busy: this.busy,
      ...(this.error ? { error: this.error } : {})
    }
  }

  setSites(sites: unknown): Promise<BlockerStatus> {
    this.save({ ...this.data, sites: cleanSites(sites) })
    return this.reconcile(false)
  }

  setManual(on: boolean): Promise<BlockerStatus> {
    if (on && this.data.sites.length === 0) {
      this.error = 'Add a site to block first.'
      this.push()
      return Promise.resolve(this.status())
    }
    this.declined = false
    this.failedKey = null
    this.error = undefined
    this.save({ ...this.data, manual: on })
    return this.reconcile(on)
  }

  /** Re-check (called every few seconds): a block may have started or ended. */
  tick(): Promise<BlockerStatus> {
    return this.reconcile(!this.declined)
  }

  /** Is anything (possibly) in /etc/hosts right now? Unknown at launch counts as yes. */
  hasBlock(): boolean {
    return this.applied === null || this.applied.length > 0
  }

  /** Stop for good (quit / Reset): no further block or unblock runs. The caller lifts the block. */
  dispose(): void {
    this.disposed = true
  }

  private wanted(block: RunningBlock | null): boolean {
    return this.deps.supported && this.data.sites.length > 0 && (this.data.manual || !!block)
  }

  private save(d: BlockerData): void {
    this.data = d
    this.deps.save(d)
  }

  private push(): void {
    this.deps.onChange?.(this.status())
  }

  private async reconcile(allowPrompt: boolean): Promise<BlockerStatus> {
    if (!this.deps.supported || this.disposed) return this.status()
    if (this.busy) {
      this.again = true
      this.nextAllowPrompt ||= allowPrompt
      return this.status()
    }
    const target = this.wanted(this.deps.activeBlock()) ? expandHostnames(this.data.sites) : []
    if (this.applied && same(this.applied, target)) return this.status()
    // the same change failed before: retry only when the user may be asked again (unblock never asks)
    if (this.failedKey === target.join(' ') && (!allowPrompt || target.length === 0)) return this.status()
    this.busy = true
    this.push()
    try {
      if (target.length) await this.deps.blocker.block(target, allowPrompt)
      else await this.deps.blocker.unblock()
      this.applied = target
      this.error = undefined
      this.failedKey = null
    } catch (e) {
      this.onFailure(e as Error, target)
    } finally {
      this.busy = false
    }
    this.push()
    if (this.again) {
      this.again = false
      const p = this.nextAllowPrompt
      this.nextAllowPrompt = false
      return this.reconcile(p)
    }
    return this.status()
  }

  private onFailure(e: Error, target: string[]): void {
    this.log(`blocker: ${e.message}`)
    this.failedKey = target.join(' ') // not retried every tick
    if (target.length === 0) {
      // couldn't unblock without the helper: nothing Bloop set up can be in /etc/hosts
      if (e instanceof NeedsSetupError) this.applied = []
      else this.error = e.message
      return
    }
    // `applied` stays as it was: if a stale block may be there (null), quit still tries to lift it
    this.error = e.message
    this.declined = true
    if (this.data.manual) this.save({ ...this.data, manual: false })
  }
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
