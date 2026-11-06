// "Is what's on screen actually study?" Local, rule-based judge for "depends on what's open" sites
// (a lecture on YouTube is study, gameplay is not). Pure: no electron or node imports, so it is
// unit-tested directly (tests/contentJudge.test.ts). Nothing here leaves the computer.
import type { ContentVerdict } from '@shared/types'
import { stripBrowserSuffix } from './titleDomain'

export interface CourseHint {
  /** Short label, e.g. "CHEM 201". */
  label: string
  /** Full course name, e.g. "Organic Chemistry". */
  name?: string
}

export interface JudgeContext {
  courses: CourseHint[]
  /** Upcoming deadline titles, e.g. "CHEM 201: Midterm 2". */
  deadlineTitles: string[]
  /** Distinctive words from the user's focus apps / sites ("notion", "overleaf"). */
  focusWords: string[]
}

export interface PageInfo {
  /** e.g. "youtube.com" */
  domain: string
  url?: string
  /** Raw window / tab title (browser suffix and site name are stripped here). */
  title?: string
  /** Optional headings / description read from the page (best effort, macOS). Weighs half. */
  pageText?: string
}

export interface JudgeResult {
  verdict: ContentVerdict
  /** Short human reason, never the page title: "matches CHEM 201", "looks like gameplay". */
  reason: string
  /** Study and entertainment evidence (for tests and tuning). */
  study: number
  fun: number
}

export const EMPTY_CONTEXT: JudgeContext = { courses: [], deadlineTitles: [], focusWords: [] }

// ------------------------------------------------------------------ text helpers

/** Lowercase, straight apostrophes, no zero-width chars, single spaces. */
export function normText(s: string): string {
  return s
    .replace(/[​-‍﻿]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[  ]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Site names that pages append to their title ("... - YouTube", "... | Medium"). */
const SITE_SUFFIX = /^(youtube|youtube music|reddit|medium|quora|vimeo|on vimeo)$/i
const SEGMENT_SPLIT = /\s+[-–—|·]\s+/

/**
 * The page's own title: no browser suffix, no "(3) " notification counter, no trailing site name.
 * "Organic Chemistry Lecture 12: SN1 vs SN2 - YouTube - Google Chrome" → "Organic Chemistry Lecture 12: SN1 vs SN2".
 * A bare site name ("YouTube", "Reddit - Dive into anything") gives "".
 */
export function pageTitle(rawTitle: string | undefined, domain?: string): string {
  if (!rawTitle) return ''
  let t = stripBrowserSuffix(rawTitle).replace(/^\(\d+\+?\)\s*/, '').trim()
  if (/^reddit\s+-\s+dive into anything$/i.test(t)) return ''
  const main = domain ? (domain.split('.').slice(-2, -1)[0] ?? '') : ''
  const segs = t.split(SEGMENT_SPLIT)
  while (segs.length > 0) {
    const last = (segs[segs.length - 1] as string).trim()
    if (SITE_SUFFIX.test(last) || (main.length >= 4 && last.toLowerCase() === main)) segs.pop()
    else break
  }
  t = segs.join(' - ').replace(/\s+on vimeo$/i, '').trim()
  return t
}

/** "OrganicChemistry" → "organic chemistry", "learn_math" → "learn math". */
function splitWords(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_+-]+/g, ' ')
    .trim()
}

/**
 * Useful words from the URL: a YouTube search, a YouTube channel handle, Shorts, a subreddit, an
 * article slug. Video ids, hashes and other query parameters are ignored.
 */
export function urlText(url: string | undefined): string {
  if (!url) return ''
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`)
  } catch {
    return ''
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '')
  const parts = u.pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p)
    } catch {
      return p
    }
  })
  const out: string[] = []
  if (host.endsWith('youtube.com')) {
    const q = u.searchParams.get('search_query') ?? u.searchParams.get('q')
    if (q) out.push(q)
    if (parts[0] === 'shorts') out.push('#shorts')
    if (parts[0]?.startsWith('@')) out.push(splitWords(parts[0].slice(1)))
    if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) out.push(splitWords(parts[1]))
  } else if (host.endsWith('reddit.com')) {
    if (parts[0] === 'r' && parts[1]) out.push(`r/${parts[1].toLowerCase()}`, splitWords(parts[1]))
    if (parts[2] === 'comments' && parts[4]) out.push(splitWords(parts[4]))
  } else {
    // article-style slugs ("/@someone/how-to-solve-recurrences-3f2a9c")
    for (const p of parts.slice(-2)) {
      if (/^[a-z0-9]+(-[a-z0-9]+){2,}$/i.test(p)) out.push(p.replace(/-[0-9a-f]{6,}$/i, '').replace(/-/g, ' '))
    }
  }
  return out.join(' ')
}

// ------------------------------------------------------------------ vocabularies

interface Term {
  re: RegExp
  weight: number
  /** Reason shown when this is the strongest signal. */
  reason: string
}

const word = (p: string): RegExp => new RegExp(`(^|[^a-z0-9])(?:${p})(?=[^a-z0-9]|$)`, 'i')
const t = (p: string, weight: number, reason: string): Term => ({ re: word(p), weight, reason })

/** Study vocabulary. Channel names that are almost always study material weigh the most. */
const STUDY_TERMS: Term[] = [
  t('mit opencourseware|mit ocw|opencourseware', 5, 'from MIT OpenCourseWare'),
  t('khan academy', 5, 'from Khan Academy'),
  t('crash course', 4, 'from Crash Course'),
  t('(?:the )?organic chemistry tutor', 5, 'from The Organic Chemistry Tutor'),
  t('3blue1brown', 4, 'from 3Blue1Brown'),
  t('professor dave(?: explains)?|professor leonard|dr\\.? trefor bazett', 4, 'from a teaching channel'),
  t('freecodecamp(?:\\.org)?|cs50|nptel|stanford online|yale courses|coursera|edx|ted-ed', 4, 'from a course channel'),
  t('lectures?', 3, 'looks like a lecture'),
  t('tutorials?', 3, 'looks like a tutorial'),
  t('lessons?', 3, 'looks like a lesson'),
  t('courses?', 2, 'looks like a course'),
  t('explained|explanation|explainer', 3, 'looks like an explainer'),
  t('how to (?:solve|calculate|find|derive|prove|write|cite|balance)', 3, 'looks like a worked problem'),
  t('worked examples?|example problems?|solved problems?', 3, 'looks like a worked problem'),
  t('problem sets?|psets?', 3, 'looks like a problem set'),
  t('practice (?:problems?|questions?|exam|test)', 3, 'looks like exam practice'),
  t('(?:exam|test|final|midterm|unit) review|review session', 3, 'looks like exam review'),
  t('midterms?|final exams?|exam prep|exams?', 2, 'looks like exam prep'),
  t('derivations?|deriving', 3, 'looks like a derivation'),
  t('proofs?|theorem', 2, 'looks like a proof'),
  t('study with me', 2, 'looks like a study session'),
  t('step[- ]by[- ]step', 1.5, 'looks like a walkthrough'),
  t('intro(?:duction)? to', 2, 'looks like an intro lesson'),
  t('chapter \\d+|ch\\.? ?\\d+|unit \\d+|module \\d+', 2, 'looks like a chapter'),
  t('textbook|lecture notes|study guide|flashcards', 2, 'looks like study material'),
  t('homework|hw ?\\d+|assignment', 2, 'looks like homework'),
  t('revision', 2, 'looks like revision'),
  t('university|college|professor|prof\\.', 1.5, 'looks like a class'),
  // subjects
  t('organic chemistry|biochemistry|chemistry|stoichiometry|titration|sn1|sn2|e1|e2 reactions?|reaction mechanisms?|chemical reactions?', 1.5, 'about chemistry'),
  t('biology|cell biology|genetics|mitosis|meiosis|photosynthesis|enzymes?|anatomy|physiology|neuroscience', 1.5, 'about biology'),
  t('physics|kinematics|thermodynamics|electromagnetism|quantum mechanics|circuits?|newton\'?s laws?', 1.5, 'about physics'),
  t('calculus|algebra|linear algebra|geometry|trigonometry|differential equations?|integrals?|derivatives?|matri(?:x|ces)|eigen\\w*|limits and continuity', 1.5, 'about math'),
  t('statistics|probability|regression|hypothesis test(?:ing)?', 1.5, 'about statistics'),
  t('economics|microeconomics|macroeconomics|accounting', 1.5, 'about economics'),
  t('music theory|ear training', 2, 'about music theory'),
  t('psychology|sociology|philosophy|history of|world war|civilization', 1.5, 'about a humanities topic'),
  t('history', 1, 'about history'),
  t('essay|citations?|apa format|mla format|thesis statement|bibliography', 2, 'about essay writing'),
  t('programming|algorithms?|data structures|computer science|machine learning|python|java(?:script)?|c\\+\\+|recursion|sql', 1.5, 'about programming')
]

/** Entertainment vocabulary. */
const FUN_TERMS: Term[] = [
  t('gameplay|let\'?s play|lets play|playthrough|speedrun(?:s|ning)?|walkthrough part \\d+', 4, 'looks like gameplay'),
  t('minecraft|fortnite|roblox|valorant|gta(?: ?v| ?5| ?6)?|league of legends|call of duty|among us|elden ring|zelda|pok[eé]mon|fifa|apex legends|overwatch|genshin|hardcore survival', 3, 'looks like gameplay'),
  t('vlogs?|day in (?:my|the) life', 3, 'looks like a vlog'),
  t('pranks?', 3, 'looks like a prank video'),
  { re: /(^|[^a-z0-9])(?<!chemical |redox |nuclear |chain )(?:reacts?|reacting|reactions?)(?! mechanism| rate| kinetics)(?=[^a-z0-9]|$)/i, weight: 3, reason: 'looks like a reaction video' },
  t('highlights|best moments|top \\d+ plays', 3, 'looks like highlights'),
  t('(?:official )?trailer|teaser', 3, 'looks like a trailer'),
  t('music video|official video|official music video|official audio|lyric video|lyrics|visualizer|ft\\.|feat\\.', 3, 'looks like music'),
  t('lo-?fi|beats to (?:relax|study|chill)|songs?|music|album|remix', 1.5, 'looks like music'),
  t('funny|funniest|hilarious|try not to laugh|fails', 3, 'looks like something funny'),
  t('compilations?', 3, 'looks like a compilation'),
  t('memes?|shitpost(?:ing)?', 3, 'looks like memes'),
  t('mukbang', 4, 'looks like a mukbang'),
  t('asmr', 3, 'looks like ASMR'),
  t('#?shorts', 3, 'looks like Shorts'),
  t('live ?stream(?:ing)?|streaming now|🔴', 2, 'looks like a live stream'),
  t('unboxing|haul|giveaway', 3, 'looks like a haul or unboxing'),
  t('tier list|challenge|24 hours|\\$\\d+[,0-9]* vs', 2, 'looks like a challenge video'),
  t('full movie|movie|netflix|episode \\d+|season \\d+|ep\\.? ?\\d+|sitcom|anime', 2, 'looks like a show'),
  t('nba|nfl|ufc|premier league|champions league|world cup|soccer|football|f1', 2, 'looks like sports'),
  t('drama|gossip|celebrity|tea spill', 2, 'looks like drama'),
  t('mrbeast|pewdiepie|markiplier|dream smp|ishowspeed|kai cenat', 4, 'looks like entertainment')
]

/** Subreddits that are study or entertainment, by name. */
const STUDY_SUBS = /(^|\s)r\/(learnmath|math|mathhelp|homeworkhelp|chemhelp|chemistry|organicchemistry|biology|physics|askphysics|askscience|askhistorians|learnprogramming|cscareerquestions|compsci|studying|gradschool|engineeringstudents|premed|mcat|apstudents|statistics|economics|learnpython|javascript)(\s|$)/
const FUN_SUBS = /(^|\s)r\/(funny|memes|dankmemes|gaming|aww|pics|videos|askreddit|nba|nfl|soccer|teenagers|leagueoflegends|minecraft|wallstreetbets|tiktokcringe|publicfreakout|interestingasfuck|nextfuckinglevel|movies|television|music|anime|relationship_advice|amitheasshole)(\s|$)/

/** Words too generic to tie a page to a course or a deadline. */
const GENERIC = new Set(
  (
    'introduction intro principles general advanced topics topic seminar fundamentals studies section course online ' +
    'midterm final quiz exam exams assignment homework problem problems set due draft report week chapter module ' +
    'discussion reading readings submission project lecture lectures review practice part unit class lab labs ' +
    'about their there which these those other after before first second third the and for with from into your'
  ).split(' ')
)

// ------------------------------------------------------------------ context

const COURSE_CODE = /\b([A-Z]{2,5})[\s_.-]?(\d{2,4}[A-Z]?)\b/

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "CHEM 201" from the start of a deadline title like "CHEM 201: Midterm 2". */
export function courseCodeOf(title: string): string | null {
  const m = COURSE_CODE.exec(title)
  return m ? `${m[1]} ${m[2]}` : null
}

/** Distinctive words (5+ letters, not generic). */
function distinctive(s: string): string[] {
  return [...new Set(normText(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !GENERIC.has(w) && !/^\d+$/.test(w)))]
}

interface CompiledCourse {
  label: string
  code?: RegExp
  name?: RegExp
  words: RegExp[]
}

interface CompiledDeadline {
  label: string | null
  words: RegExp[]
}

function compileCourse(c: CourseHint): CompiledCourse {
  const label = c.label.trim()
  const m = /^([A-Za-z]{2,5})\s*[-_.]?\s*(\d{2,4}[A-Za-z]?)$/.exec(label)
  // "CHEM 201 - Organic Chemistry" → "organic chemistry"
  const name = normText((c.name ?? '').replace(COURSE_CODE, ' ').replace(/^[\s:\u2013\u2014-]+|[\s:\u2013\u2014-]+$/g, ''))
  return {
    label,
    ...(m ? { code: new RegExp(`(^|[^a-z0-9])${escapeRe(m[1] as string)}\\s*[-_.]?\\s*${escapeRe(m[2] as string)}(?=[^a-z0-9]|$)`, 'i') } : {}),
    ...(name.length >= 6 && !GENERIC.has(name) ? { name: word(escapeRe(name)) } : {}),
    words: distinctive(name).map((w) => word(escapeRe(w)))
  }
}

/** Courses from Brightspace plus course codes found in deadline titles, de-duplicated by label. */
export function allCourses(ctx: JudgeContext): CourseHint[] {
  const out = new Map<string, CourseHint>()
  for (const c of ctx.courses) {
    if (!c?.label?.trim()) continue
    const k = c.label.trim().toUpperCase()
    const prev = out.get(k)
    out.set(k, { label: c.label.trim(), name: c.name?.trim() || prev?.name })
  }
  for (const d of ctx.deadlineTitles) {
    const code = courseCodeOf(d)
    if (code && !out.has(code)) out.set(code, { label: code })
  }
  return [...out.values()]
}

// ------------------------------------------------------------------ scoring

interface Hit {
  weight: number
  reason: string
}

function scoreTerms(text: string, terms: Term[], mult: number, hits: Hit[]): void {
  if (!text) return
  for (const term of terms) if (term.re.test(text)) hits.push({ weight: term.weight * mult, reason: term.reason })
}

function sum(hits: Hit[]): number {
  return hits.reduce((a, h) => a + h.weight, 0)
}

function strongest(hits: Hit[]): Hit | undefined {
  return hits.reduce<Hit | undefined>((b, h) => (!b || h.weight > b.weight ? h : b), undefined)
}

/** Context compiled once per context object (courses and deadlines change rarely). */
const compiled = new WeakMap<JudgeContext, { courses: CompiledCourse[]; deadlines: CompiledDeadline[]; focus: RegExp[] }>()

function compile(ctx: JudgeContext): { courses: CompiledCourse[]; deadlines: CompiledDeadline[]; focus: RegExp[] } {
  let c = compiled.get(ctx)
  if (!c) {
    c = {
      courses: allCourses(ctx).map(compileCourse),
      deadlines: ctx.deadlineTitles.map((d) => {
        const code = courseCodeOf(d)
        const core = code ? d.replace(COURSE_CODE, ' ') : d
        return { label: code, words: distinctive(core).map((w) => word(escapeRe(w))) }
      }),
      focus: [...new Set(ctx.focusWords.map((w) => normText(w)).filter((w) => w.length >= 5))].map((w) => word(escapeRe(w)))
    }
    compiled.set(ctx, c)
  }
  return c
}

/** Study evidence from the user's own courses, deadlines and focus list. */
function personalHits(text: string, ctx: JudgeContext, mult: number, hits: Hit[]): void {
  if (!text) return
  const c = compile(ctx)
  for (const course of c.courses) {
    if (course.code?.test(text)) hits.push({ weight: 6 * mult, reason: `matches ${course.label}` })
    else if (course.name?.test(text)) hits.push({ weight: 5 * mult, reason: `matches ${course.label}` })
    else {
      const n = course.words.filter((r) => r.test(text)).length
      if (n >= 2 || (n === 1 && course.words.length === 1)) hits.push({ weight: Math.min(4, 2 * n) * mult, reason: `matches ${course.label}` })
    }
  }
  for (const d of c.deadlines) {
    const n = d.words.filter((r) => r.test(text)).length
    if (n > 0) hits.push({ weight: Math.min(4, 2 * n) * mult, reason: d.label ? `matches a ${d.label} deadline` : 'matches an upcoming deadline' })
  }
  for (const f of c.focus) if (f.test(text)) hits.push({ weight: 1.5 * mult, reason: 'mentions one of your focus tools' })
}

/** How far one side must lead for a verdict. */
const MARGIN = 1.5

/**
 * Judge a "depends on what's open" page from its title, URL and (optionally) page text.
 * - study: 3+ points of study evidence that outweigh entertainment by MARGIN
 * - not-study: 3+ points of entertainment evidence that outweigh study by MARGIN
 * - unsure: no readable title, no signals, or mixed signals
 */
export function judgeContent(page: PageInfo, ctx: JudgeContext = EMPTY_CONTEXT): JudgeResult {
  const title = normText(pageTitle(page.title, page.domain))
  // "of course" is not a course
  const main = `${title} ${normText(urlText(page.url))}`.replace(/\bof course\b/g, ' ').trim()
  const extra = normText(page.pageText ?? '').slice(0, 2000)
  if (!main && !extra) return { verdict: 'unsure', reason: 'no title to judge', study: 0, fun: 0 }

  const studyHits: Hit[] = []
  const funHits: Hit[] = []
  personalHits(main, ctx, 1, studyHits)
  scoreTerms(main, STUDY_TERMS, 1, studyHits)
  scoreTerms(main, FUN_TERMS, 1, funHits)
  if (STUDY_SUBS.test(main)) studyHits.push({ weight: 3, reason: 'a study subreddit' })
  if (FUN_SUBS.test(main)) funHits.push({ weight: 3, reason: 'looks like an entertainment subreddit' })
  if (extra) {
    personalHits(extra, ctx, 0.5, studyHits)
    scoreTerms(extra, STUDY_TERMS, 0.5, studyHits)
    scoreTerms(extra, FUN_TERMS, 0.5, funHits)
  }
  const study = Math.round(sum(studyHits) * 10) / 10
  const fun = Math.round(sum(funHits) * 10) / 10
  if (study >= 3 && study >= fun + MARGIN) return { verdict: 'study', reason: strongest(studyHits)?.reason ?? 'looks like study', study, fun }
  if (fun >= 3 && fun >= study + MARGIN) return { verdict: 'not-study', reason: strongest(funHits)?.reason ?? 'looks like entertainment', study, fun }
  return { verdict: 'unsure', reason: study > 0 && fun > 0 ? 'mixed signals' : 'not sure yet', study, fun }
}

// ------------------------------------------------------------------ keys (overrides, AI cache)

/**
 * A stable key for a page URL: host without www./m., path, and for YouTube the video id (or the
 * search). Other query parameters and the #hash are dropped. Undefined if not an http(s) URL.
 */
export function urlKey(url: string | undefined): string | undefined {
  if (!url) return undefined
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`)
  } catch {
    return undefined
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '')
  if (host === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0]
    return id ? `youtube.com/watch?v=${id}` : 'youtube.com'
  }
  const path = u.pathname.replace(/\/+$/, '')
  if (host.endsWith('youtube.com')) {
    const v = u.searchParams.get('v')
    if (path === '/watch' && v) return `youtube.com/watch?v=${v}`
    const q = u.searchParams.get('search_query')
    if (path === '/results' && q) return `youtube.com/results?search_query=${normText(q)}`
    const list = u.searchParams.get('list')
    if (path === '/playlist' && list) return `youtube.com/playlist?list=${list}`
  }
  return `${host}${path}`
}

/** A stable key for a page title on a site: "youtube.com|organic chemistry lecture 12". */
export function titleKey(domain: string, rawTitle: string | undefined): string | undefined {
  const t = normText(pageTitle(rawTitle, domain))
  return t ? `${domain.toLowerCase()}|${t}` : undefined
}
