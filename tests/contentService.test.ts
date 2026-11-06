import { describe, expect, it } from 'vitest'
import { contentSite } from '../src/main/classifier'
import { ContentService, cleanOverrides, type StoredOverride } from '../src/main/contentService'
import { AiJudge } from '../src/main/contentAi'
import { DEFAULT_SETTINGS, mergeSettings } from '../src/main/defaults'
import { SessionEngine } from '../src/main/session'
import type { AiProvider } from '../src/main/ai/types'
import type { Settings } from '../src/shared/types'
import type { JudgeContext } from '../src/main/contentJudge'
import type { RawActive } from '../src/main/tracker'

const CTX: JudgeContext = { courses: [{ label: 'CHEM 201', name: 'Organic Chemistry' }], deadlineTitles: ['CHEM 201: Midterm 2'], focusWords: [] }
const LECTURE: RawActive = {
  app: 'Google Chrome',
  url: 'https://www.youtube.com/watch?v=lec12',
  title: 'Organic Chemistry Lecture 12: SN1 vs SN2 - YouTube - Google Chrome'
}
const GAME: RawActive = { app: 'Google Chrome', url: 'https://www.youtube.com/watch?v=mc45', title: "Minecraft Hardcore Let's Play #45 - YouTube" }
const HOME: RawActive = { app: 'Google Chrome', url: 'https://www.youtube.com/', title: 'YouTube' }
const VAGUE: RawActive = { app: 'Google Chrome', url: 'https://www.youtube.com/watch?v=v1', title: 'What happened to Sam? - YouTube' }

function service(opts: { settings?: Partial<Settings>; ai?: AiJudge | null; logs?: string[] } = {}) {
  let stored: StoredOverride[] = []
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings }
  const svc = new ContentService({
    getSettings: () => settings,
    getContext: () => CTX,
    loadOverrides: () => stored,
    saveOverrides: (l) => (stored = JSON.parse(JSON.stringify(l))),
    ai: opts.ai ?? null,
    log: (m) => opts.logs?.push(m),
    newId: (() => {
      let i = 0
      return () => `id${++i}`
    })()
  })
  return { svc, settings, stored: () => stored }
}

describe('contentSite (classifier integration)', () => {
  it('youtube.com, m.youtube.com and reddit.com depend on what is open by default', () => {
    expect(contentSite(LECTURE, DEFAULT_SETTINGS)).toBe('youtube.com')
    expect(contentSite({ app: 'Safari', url: 'https://m.youtube.com/watch?v=1' }, DEFAULT_SETTINGS)).toBe('m.youtube.com')
    expect(contentSite({ app: 'Arc', url: 'https://www.reddit.com/r/chemhelp' }, DEFAULT_SETTINGS)).toBe('reddit.com')
  })
  it('twitch, docs.google.com and apps do not', () => {
    expect(contentSite({ app: 'Google Chrome', url: 'https://twitch.tv/x' }, DEFAULT_SETTINGS)).toBeUndefined()
    expect(contentSite({ app: 'Google Chrome', url: 'https://docs.google.com/d/1' }, DEFAULT_SETTINGS)).toBeUndefined()
    expect(contentSite({ app: 'Code', title: 'youtube.com' }, DEFAULT_SETTINGS)).toBeUndefined()
  })
  it('works from the window title when there is no URL (Windows)', () => {
    expect(contentSite({ app: 'Google Chrome', title: 'Organic Chemistry Lecture - YouTube - Google Chrome' }, DEFAULT_SETTINGS)).toBe('youtube.com')
  })
  it('a more specific focus/distract pattern beats the content list; an empty list turns it off', () => {
    const s = { ...DEFAULT_SETTINGS, distractDomains: [...DEFAULT_SETTINGS.distractDomains, 'youtube.com/shorts'] }
    expect(contentSite({ app: 'Google Chrome', url: 'https://www.youtube.com/shorts/x' }, s)).toBeUndefined()
    expect(contentSite(LECTURE, { ...DEFAULT_SETTINGS, contentDomains: [] })).toBeUndefined()
  })
  it('old saved settings get the default list', () => {
    const { contentDomains: _c, ...old } = DEFAULT_SETTINGS
    void _c
    expect(mergeSettings(old).contentDomains).toEqual(['youtube.com', 'reddit.com', 'medium.com', 'quora.com', 'vimeo.com'])
  })
})

describe('ContentService', () => {
  it('judges with the local rules', () => {
    const { svc } = service()
    expect(svc.judge(LECTURE)).toEqual({ verdict: 'study', reason: 'matches CHEM 201', source: 'local' })
    expect(svc.judge(GAME)).toEqual({ verdict: 'not-study', reason: 'looks like gameplay', source: 'local' })
    expect(svc.judge(HOME)).toMatchObject({ verdict: 'unsure', reason: 'no title to judge' })
    expect(svc.judge({ app: 'Code', title: 'x' })).toBeNull()
  })

  it('overrides win over everything, newest first, and can be forgotten', () => {
    const { svc, stored } = service()
    svc.judge(LECTURE)
    expect(svc.markCurrent(false)).toEqual(LECTURE)
    expect(svc.judge(LECTURE)).toEqual({ verdict: 'not-study', reason: 'you marked this page', source: 'override' })
    expect(stored()[0]).toMatchObject({ keys: ['youtube.com/watch?v=lec12', 'youtube.com|organic chemistry lecture 12: sn1 vs sn2'], study: false })
    // the same title at another URL (e.g. a re-upload) is remembered too
    expect(svc.judge({ ...LECTURE, url: 'https://www.youtube.com/watch?v=other' })?.source).toBe('override')
    svc.judge(LECTURE)
    svc.markCurrent(true)
    expect(svc.list()).toHaveLength(1)
    expect(svc.list()[0]).toMatchObject({ label: 'Organic Chemistry Lecture 12: SN1 vs SN2', study: true })
    expect(svc.judge(LECTURE)?.verdict).toBe('study')
    expect(svc.forget(svc.list()[0]?.id)).toEqual([])
    expect(svc.judge(LECTURE)?.source).toBe('local')
  })

  it('markCurrent with no judged page does nothing', () => {
    const { svc } = service()
    expect(svc.markCurrent(true)).toBeNull()
    svc.judge(LECTURE)
    svc.judge({ app: 'Code', title: '' }) // left the page
    expect(svc.markCurrent(true)).toBeNull()
  })

  it('unsure pages go to the AI in the background; the answer is used once it arrives', async () => {
    const calls: string[] = []
    const provider: AiProvider = {
      label: 'Ollama · test',
      kind: 'local',
      complete: async (p) => {
        calls.push(p)
        return '{"study": false, "reason": "celebrity gossip"}'
      }
    }
    const ai = new AiJudge({ provider: async () => provider })
    const logs: string[] = []
    const { svc } = service({ ai, logs })
    expect(svc.judge(VAGUE)).toEqual({ verdict: 'unsure', reason: 'asking your AI', source: 'pending' })
    await ai.whenIdle()
    expect(svc.judge(VAGUE)).toEqual({ verdict: 'not-study', reason: 'celebrity gossip', source: 'ai' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('What happened to Sam?')
    expect(calls[0]).toContain('CHEM 201 Organic Chemistry')
    expect(calls[0]).not.toContain('watch?v=')
    // a page with no title is never sent
    expect(svc.judge(HOME)?.source).toBe('local')
    // the log never has the title or URL
    expect(logs.join('\n')).not.toMatch(/Sam|Organic|youtube\.com\/watch/)
  })

  it('cleanOverrides drops junk', () => {
    expect(cleanOverrides([{ id: 'a', keys: ['k'], study: true, label: 'x', at: 1 }, { id: 'a', keys: ['k'], study: true }, null, { id: 'b', keys: [], study: true }, 'x'])).toHaveLength(1)
    expect(cleanOverrides('nope')).toEqual([])
  })
})

describe('SessionEngine with content judging (always-on watching)', () => {
  function harness(judge: (raw: RawActive) => ReturnType<ContentService['judge']>) {
    let now = 1_700_000_000_000
    const notes: string[] = []
    const settings = { ...DEFAULT_SETTINGS }
    const engine = new SessionEngine({
      now: () => now,
      setInterval: () => 0,
      clearInterval: () => {},
      setTimeout: () => 0,
      clearTimeout: () => {},
      getSettings: () => settings,
      sample: async () => null,
      notify: (t) => notes.push(t),
      saveSession: () => {},
      log: () => {},
      random: () => 0,
      judge
    })
    const run = (raw: RawActive, sec: number) => {
      for (let i = 0; i < sec; i += 2) {
        now += 2000
        engine.recordSample(raw)
      }
    }
    return { engine, run, notes }
  }

  it('a lecture on YouTube counts as focus: happy, no reminders, score stays high', () => {
    const { svc } = service()
    const { engine, run, notes } = harness((r) => svc.judge(r))
    run(LECTURE, 300)
    const st = engine.getStatus()
    expect(st.current).toMatchObject({ domain: 'youtube.com', category: 'focus', content: { verdict: 'study', reason: 'matches CHEM 201' } })
    expect(st.pet.mood).toBe('happy')
    expect(notes).toHaveLength(0)
    expect(st.score).toBe(100)
  })

  it('gameplay is distracting: worried + bubble at once, reminder after 1 min', () => {
    const { svc } = service()
    const { engine, run, notes } = harness((r) => svc.judge(r))
    run(GAME, 2)
    let st = engine.getStatus()
    expect(st.current).toMatchObject({ category: 'distract', content: { verdict: 'not-study', reason: 'looks like gameplay' } })
    expect(st.pet.mood).toBe('worried')
    expect(st.pet.message).toBeTruthy()
    run(GAME, 60)
    st = engine.getStatus()
    expect(notes.length).toBe(1)
  })

  it('unsure keeps the list category (YouTube home = distracting)', () => {
    const { svc } = service()
    const { engine, run } = harness((r) => svc.judge(r))
    run(HOME, 2)
    expect(engine.getStatus().current).toMatchObject({ category: 'distract', content: { verdict: 'unsure' } })
  })

  it('an unsure page on a site in no list stays neutral', () => {
    const { svc } = service()
    const { engine, run } = harness((r) => svc.judge(r))
    run({ app: 'Google Chrome', url: 'https://vimeo.com/123', title: 'Untitled 4 on Vimeo' }, 2)
    expect(engine.getStatus().current).toMatchObject({ category: 'neutral', content: { verdict: 'unsure' } })
  })

  it('an override turns gameplay into study', () => {
    const { svc } = service()
    const { engine, run } = harness((r) => svc.judge(r))
    run(GAME, 2)
    svc.markCurrent(true)
    run(GAME, 2)
    expect(engine.getStatus().current).toMatchObject({ category: 'focus', content: { source: 'override' } })
  })
})
