// Glue for "depends on what's open" sites: your corrections first, then the local rules
// (contentJudge.ts), then the AI for unsure pages (contentAi.ts). No electron imports: everything
// platform-specific is injected (tests/contentService.test.ts).
//
// Privacy: titles and URLs are only used in memory, in the remembered-pages list you create with
// "This is study" / "Not study", and (hashed) as AI cache keys. The log gets verdicts and reasons only.
import type { ContentJudgement, ContentOverrideInfo, Settings } from '@shared/types'
import { contentSite } from './classifier'
import { allCourses, judgeContent, pageTitle, titleKey, urlKey, type JudgeContext } from './contentJudge'
import type { AiJudge } from './contentAi'
import type { RawActive } from './tracker'

export interface StoredOverride {
  id: string
  /** urlKey and/or titleKey of the page */
  keys: string[]
  label: string
  study: boolean
  at: number
}

export const MAX_OVERRIDES = 300

/** Valid stored overrides only (the store file may be stale or edited by hand). */
export function cleanOverrides(v: unknown): StoredOverride[] {
  if (!Array.isArray(v)) return []
  const out: StoredOverride[] = []
  const ids = new Set<string>()
  for (const o of v.slice(-MAX_OVERRIDES)) {
    if (!o || typeof o !== 'object') continue
    const r = o as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id) || typeof r.study !== 'boolean' || !Array.isArray(r.keys)) continue
    const keys = r.keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 600).slice(0, 4)
    if (!keys.length) continue
    ids.add(r.id)
    out.push({
      id: r.id.slice(0, 64),
      keys,
      label: typeof r.label === 'string' ? r.label.slice(0, 200) : keys[0] as string,
      study: r.study,
      at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0
    })
  }
  return out
}

export interface ContentServiceDeps {
  getSettings: () => Settings
  getContext: () => JudgeContext
  loadOverrides: () => unknown
  saveOverrides: (list: StoredOverride[]) => void
  ai?: AiJudge | null
  /** Best-effort page headings/description for a browser (macOS); null when it can't be read. */
  readPageText?: (app: string) => Promise<string | null>
  now?: () => number
  log?: (m: string) => void
  newId?: () => string
}

interface LastPage {
  raw: RawActive
  domain: string
  keys: string[]
}

export class ContentService {
  private overrides: StoredOverride[]
  private last: LastPage | null = null
  private lastLogged = ''
  private pageText = new Map<string, string>()
  private textInFlight: string | null = null
  /** page text reading failed (browser setting off): don't try again until the setting is toggled */
  private textBlocked = new Set<string>()
  private lastReadSetting = false
  private readonly now: () => number

  constructor(private readonly d: ContentServiceDeps) {
    this.overrides = cleanOverrides(d.loadOverrides())
    this.now = d.now ?? (() => Date.now())
  }

  /**
   * The verdict for a sample, or null when the page isn't on the "depends on what's open" list.
   * Synchronous: an AI answer that isn't cached yet is requested in the background.
   */
  judge(raw: RawActive): ContentJudgement | null {
    const s = this.d.getSettings()
    const domain = contentSite(raw, s)
    if (!domain) {
      this.last = null
      return null
    }
    const keys = [urlKey(raw.url), titleKey(domain, raw.title)].filter((k): k is string => !!k)
    this.last = { raw, domain, keys }
    const result = this.decide(raw, domain, keys, s)
    const line = `${result.verdict} (${result.source}${result.source === 'local' || result.source === 'override' ? `: ${result.reason}` : ''})`
    if (line !== this.lastLogged) {
      this.lastLogged = line
      // never the title or URL
      this.d.log?.(`content: ${line}`)
    }
    return result
  }

  private decide(raw: RawActive, domain: string, keys: string[], s: Settings): ContentJudgement {
    const ov = this.findOverride(keys)
    if (ov) return { verdict: ov.study ? 'study' : 'not-study', reason: 'you marked this page', source: 'override' }
    const ctx = this.d.getContext()
    const pageText = this.pageTextFor(raw, s)
    const local = judgeContent({ domain, url: raw.url, title: raw.title, pageText }, ctx)
    if (local.verdict !== 'unsure') return { verdict: local.verdict, reason: local.reason, source: 'local' }
    const ai = this.d.ai
    const title = pageTitle(raw.title, domain)
    const tk = titleKey(domain, raw.title)
    if (!ai || !title || !tk) return { verdict: 'unsure', reason: local.reason, source: 'local' }
    const cached = ai.lookup(tk)
    if (cached) return { verdict: cached.study ? 'study' : 'not-study', reason: cached.reason, source: 'ai' }
    const courses = allCourses(ctx).map((c) => (c.name && c.name !== c.label ? `${c.label} ${c.name}` : c.label))
    const r = ai.request(tk, { domain, title, courses })
    if (r === 'started' || r === 'pending') return { verdict: 'unsure', reason: 'asking your AI', source: 'pending' }
    return { verdict: 'unsure', reason: local.reason, source: 'local' }
  }

  private findOverride(keys: string[]): StoredOverride | undefined {
    if (!keys.length) return undefined
    // newest first: a later correction wins
    for (let i = this.overrides.length - 1; i >= 0; i--) {
      const o = this.overrides[i] as StoredOverride
      if (o.keys.some((k) => keys.includes(k))) return o
    }
    return undefined
  }

  /** Page text for the current URL if already read; starts a background read otherwise. */
  private pageTextFor(raw: RawActive, s: Settings): string | undefined {
    if (s.readPageText !== this.lastReadSetting) {
      this.lastReadSetting = s.readPageText
      this.textBlocked.clear() // turned off and on again: try once more
    }
    if (!s.readPageText || !this.d.readPageText || !raw.url) return undefined
    const key = urlKey(raw.url)
    if (!key) return undefined
    const have = this.pageText.get(key)
    if (have !== undefined) return have || undefined
    if (this.textInFlight || this.textBlocked.has(raw.app)) return undefined
    this.textInFlight = key
    const app = raw.app
    void this.d
      .readPageText(app)
      .then((text) => {
        if (text == null) {
          this.textBlocked.add(app)
          this.d.log?.(`content: page text unavailable in ${app}; using title and URL`)
          return
        }
        this.pageText.set(key, text.slice(0, 2000))
        while (this.pageText.size > 50) this.pageText.delete(this.pageText.keys().next().value as string)
      })
      .catch(() => {
        this.textBlocked.add(app)
      })
      .finally(() => {
        this.textInFlight = null
      })
    return undefined
  }

  /**
   * "This is study" / "Not study" for the last judged page (the one in front before Bloop's panel).
   * Returns that page's sample so the caller can re-score it, or null when there is none.
   */
  markCurrent(study: boolean): RawActive | null {
    const last = this.last
    if (!last || !last.keys.length) return null
    const label = pageTitle(last.raw.title, last.domain) || last.keys[0] || last.domain
    const keys = last.keys
    this.overrides = this.overrides.filter((o) => !o.keys.some((k) => keys.includes(k)))
    this.overrides.push({
      id: this.d.newId?.() ?? `p${this.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      keys,
      label: label.slice(0, 200),
      study,
      at: this.now()
    })
    if (this.overrides.length > MAX_OVERRIDES) this.overrides = this.overrides.slice(-MAX_OVERRIDES)
    this.d.saveOverrides(this.overrides)
    this.d.log?.(`content: you marked this page as ${study ? 'study' : 'not study'}`)
    return last.raw
  }

  list(): ContentOverrideInfo[] {
    return [...this.overrides].reverse().map(({ id, label, study, at }) => ({ id, label, study, at }))
  }

  forget(id?: string): ContentOverrideInfo[] {
    this.overrides = id ? this.overrides.filter((o) => o.id !== id) : []
    this.d.saveOverrides(this.overrides)
    return this.list()
  }

  /** Reset data: forget overrides and the page text read so far. */
  reset(): void {
    this.overrides = cleanOverrides(this.d.loadOverrides())
    this.pageText.clear()
    this.last = null
  }
}
