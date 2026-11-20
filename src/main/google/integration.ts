// Google (Gmail + Calendar) behind one interface. Today only MockGoogleIntegration exists: it
// stores a "connected" flag per service and never does OAuth or calls an API. A real version
// implements the same GoogleIntegration (OAuth with a loopback redirect, tokens in the keychain
// via safeStorage like src/main/ai/cloud/secrets.ts) and is swapped in where it's created in
// src/main/planner/app.ts. Nothing else changes: IPC, preload and UI only see GoogleStatus.
import { GOOGLE_SERVICES, type GoogleService, type GoogleServiceStatus, type GoogleStatus } from '@shared/planner'
import type { Result } from '@shared/types'

export interface GoogleIntegration {
  status(): GoogleStatus
  connect(service: GoogleService): Promise<Result<GoogleStatus>>
  disconnect(service: GoogleService): Promise<GoogleStatus>
}

export type GoogleData = Partial<Record<GoogleService, GoogleServiceStatus>>

export function isGoogleService(v: unknown): v is GoogleService {
  return typeof v === 'string' && (GOOGLE_SERVICES as readonly string[]).includes(v)
}

const MOCK_ACCOUNT = 'you@gmail.com (demo)'

export class MockGoogleIntegration implements GoogleIntegration {
  private data: GoogleData

  constructor(
    private readonly deps: { load(): GoogleData; save(d: GoogleData): void; now?: () => number }
  ) {
    this.data = deps.load() ?? {}
  }

  status(): GoogleStatus {
    const one = (s: GoogleService): GoogleServiceStatus => {
      const v = this.data[s]
      return v?.connected ? { connected: true, account: v.account, connectedAt: v.connectedAt } : { connected: false }
    }
    return { services: { gmail: one('gmail'), calendar: one('calendar') }, mock: true }
  }

  async connect(service: GoogleService): Promise<Result<GoogleStatus>> {
    if (!isGoogleService(service)) return { ok: false, error: 'Unknown Google service.' }
    const now = (this.deps.now ?? Date.now)()
    this.update({ ...this.data, [service]: { connected: true, account: MOCK_ACCOUNT, connectedAt: now } })
    return { ok: true, value: this.status() }
  }

  async disconnect(service: GoogleService): Promise<GoogleStatus> {
    if (isGoogleService(service)) this.update({ ...this.data, [service]: { connected: false } })
    return this.status()
  }

  private update(d: GoogleData): void {
    this.data = d
    this.deps.save(d)
  }
}
