// QA: classifier on tricky URLs / hosts / app names.
import { describe, expect, it } from 'vitest'
import {
  appPatternScore,
  classify,
  domainFromUrl,
  domainPatternScore,
  isBrowser,
  normalizeAppName,
  resolveDomain,
  type ClassifyLists
} from '../src/main/classifier'
import { DEFAULT_SETTINGS } from '../src/main/defaults'

const lists: ClassifyLists = DEFAULT_SETTINGS
const chrome = (url?: string, title = ''): string => classify({ app: 'Google Chrome', url, title }, lists)
const custom = (over: Partial<ClassifyLists>): ClassifyLists => ({ focusApps: [], distractApps: [], focusDomains: [], distractDomains: [], ...over })

describe('domainFromUrl: tricky inputs', () => {
  it.each([
    ['http://localhost:3000/x', 'localhost'],
    ['localhost:3000', undefined], // "localhost:" parses as a scheme, not a host
    ['http://127.0.0.1:8080', '127.0.0.1'],
    ['http://[::1]:8080/', '[::1]'],
    ['https://youtube.com:8443/a', 'youtube.com'],
    ['https://user:pw@youtube.com/', 'youtube.com'],
    ['https://YOUTUBE.COM./', 'youtube.com'],
    ['youtube.com/watch?v=1', 'youtube.com'],
    ['//youtube.com/x', 'youtube.com'],
    ['  https://github.com  ', 'github.com'],
    ['https://www.www.youtube.com', 'www.youtube.com'], // only one www stripped
    ['https://xn--mnchen-3ya.de/', 'xn--mnchen-3ya.de'],
    ['https://münchen.de/', 'xn--mnchen-3ya.de'], // URL parser punycodes IDN
    ['https://sub.domain.co.uk/a', 'sub.domain.co.uk']
  ])('%s -> %s', (url, host) => {
    expect(domainFromUrl(url)).toBe(host)
  })

  it.each(['file:///Users/me/notes.pdf', 'about:blank', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.com', 'view-source:https://youtube.com', '', '   ', null, undefined, 'http://', 'https://?x=1'])(
    'no host for %j',
    (u) => {
      expect(domainFromUrl(u as string)).toBeUndefined()
    }
  )

  // BUG: classifier.ts domainFromUrl() returns the first path segment as a "host" for non-web schemes
  // that have an authority form: chrome://newtab -> "newtab", edge://settings -> "settings",
  // chrome-extension://<id>/page.html -> "<id>". These internal pages then show up as a "site" in
  // session summaries (topFocus/topDistract) and can collide with dot-less user patterns.
  it.fails('BUG: browser-internal URLs (chrome://newtab, edge://settings) have no site', () => {
    expect(domainFromUrl('chrome://newtab')).toBeUndefined()
    expect(domainFromUrl('edge://settings/')).toBeUndefined()
  })
})

describe('classify: browser special pages', () => {
  it('about:blank, chrome://newtab, file:// are neutral with the default lists', () => {
    for (const u of ['about:blank', 'chrome://newtab', 'chrome://newtab/', 'file:///Users/me/a.html', 'chrome://settings', 'edge://newtab']) {
      expect(chrome(u)).toBe('neutral')
    }
  })
  it('file:// url without title is neutral; file:// with a recognisable title falls back to the title', () => {
    expect(chrome('file:///tmp/a.pdf', '')).toBe('neutral')
    expect(chrome('file:///tmp/a.pdf', 'Notes about youtube - Google Chrome')).toBe('distract')
  })
  it('localhost is neutral by default and focus when the user lists it', () => {
    expect(chrome('http://localhost:3000/app')).toBe('neutral')
    expect(classify({ app: 'Google Chrome', url: 'http://localhost:3000/app' }, custom({ focusDomains: ['localhost'] }))).toBe('focus')
  })
  it('IP addresses are neutral and can be listed explicitly', () => {
    expect(chrome('http://192.168.0.5/')).toBe('neutral')
    expect(classify({ app: 'Safari', url: 'http://192.168.0.5/admin' }, custom({ distractDomains: ['192.168.0.5'] }))).toBe('distract')
  })
  it('a browser with neither URL nor title is neutral, never focus', () => {
    expect(chrome(undefined, '')).toBe('neutral')
    expect(classify({ app: 'Safari' }, custom({ focusApps: ['Safari'] }))).toBe('neutral')
  })
  it('a browser with an unrecognised title is neutral', () => {
    expect(chrome(undefined, 'New Tab - Google Chrome')).toBe('neutral')
  })
})

describe('classify: host matching', () => {
  it('ports and credentials do not change the verdict', () => {
    expect(chrome('https://youtube.com:8443/')).toBe('distract')
    expect(chrome('https://me:pw@github.com/x')).toBe('focus')
  })
  it('subdomains match, look-alike suffixes do not', () => {
    expect(chrome('https://music.youtube.com/')).toBe('distract')
    expect(chrome('https://evilyoutube.com/')).toBe('neutral')
    expect(chrome('https://youtube.com.evil.com/')).toBe('neutral')
    expect(chrome('https://notx.com/')).toBe('neutral')
    expect(chrome('https://fox.com/')).toBe('neutral')
    expect(chrome('https://x.com/home')).toBe('distract')
  })
  it('dot-less patterns >= 3 chars match a non-TLD label only', () => {
    expect(chrome('https://canvas.ucla.edu/')).toBe('focus')
    expect(chrome('https://my.canvas.school.edu/')).toBe('focus')
    expect(chrome('https://school.edu/canvas')).toBe('neutral') // the path never counts for dot-less labels
    expect(chrome('https://mycanvas.school.edu/')).toBe('neutral') // whole label only
    expect(chrome('https://school.canvas/')).toBe('neutral') // the TLD label is excluded
  })
  it('dot-less pattern shorter than 3 chars requires an exact host', () => {
    const l = custom({ distractDomains: ['ab'] })
    expect(classify({ app: 'Arc', url: 'https://ab/' }, l)).toBe('distract')
    expect(classify({ app: 'Arc', url: 'https://x.ab.com/' }, l)).toBe('neutral')
  })
  it('a TLD-only pattern never matches every site', () => {
    expect(classify({ app: 'Arc', url: 'https://anything.com/' }, custom({ distractDomains: ['com'] }))).toBe('neutral')
  })
  it('patterns are case/space/scheme/www/trailing-slash insensitive', () => {
    const l = custom({ distractDomains: ['  HTTPS://WWW.Reddit.com/  '] })
    expect(classify({ app: 'Arc', url: 'https://old.reddit.com/r/all' }, l)).toBe('distract')
  })
  it('empty and whitespace patterns match nothing', () => {
    const l = custom({ distractDomains: ['', '   ', '/'] })
    expect(classify({ app: 'Arc', url: 'https://youtube.com' }, l)).toBe('neutral')
  })
  it('is case-insensitive for URL hosts', () => {
    expect(chrome('HTTPS://WWW.YOUTUBE.COM/')).toBe('distract')
  })
})

describe('classify: specificity, paths and ties', () => {
  it('a path-scoped focus pattern beats a broader distract domain', () => {
    const l = custom({ focusDomains: ['reddit.com/r/learnprogramming'], distractDomains: ['reddit.com'] })
    expect(classify({ app: 'Arc', url: 'https://www.reddit.com/r/learnprogramming/comments/1' }, l)).toBe('focus')
    expect(classify({ app: 'Arc', url: 'https://www.reddit.com/r/funny' }, l)).toBe('distract')
  })
  it('path prefix matches on segment boundaries only', () => {
    const l = custom({ focusDomains: ['github.com/orgs'], distractDomains: ['github.com'] })
    expect(classify({ app: 'Arc', url: 'https://github.com/orgs/acme' }, l)).toBe('focus')
    expect(classify({ app: 'Arc', url: 'https://github.com/orgs' }, l)).toBe('focus')
    expect(classify({ app: 'Arc', url: 'https://github.com/orgs-evil' }, l)).toBe('distract')
  })
  it('equal specificity: distract wins the tie', () => {
    const l = custom({ focusDomains: ['example.com'], distractDomains: ['example.com'] })
    expect(classify({ app: 'Arc', url: 'https://example.com' }, l)).toBe('distract')
  })
  it('more specific (longer) pattern wins', () => {
    const l = custom({ focusDomains: ['docs.example.com'], distractDomains: ['example.com'] })
    expect(classify({ app: 'Arc', url: 'https://docs.example.com/x' }, l)).toBe('focus')
    expect(classify({ app: 'Arc', url: 'https://www.example.com/x' }, l)).toBe('distract')
  })
  it('domainPatternScore is 0 on misses and > 0 on hits', () => {
    expect(domainPatternScore('youtube.com', 'youtube.com')).toBeGreaterThan(0)
    expect(domainPatternScore('youtube.com', 'vimeo.com')).toBe(0)
    expect(domainPatternScore('', 'youtube.com')).toBe(0)
  })

  // BUG: classifier.ts normalizePattern()/domainFromUrl(): URLs are punycoded by `new URL()` but user
  // patterns are only lower-cased, so an IDN pattern ("münchen.de") never matches the host
  // ("xn--mnchen-3ya.de") and the site is silently unclassified.
  it.fails('BUG: IDN domain patterns match IDN hosts', () => {
    const l = custom({ focusDomains: ['münchen.de'] })
    expect(classify({ app: 'Arc', url: 'https://münchen.de/uni' }, l)).toBe('focus')
  })

  // BUG: classifier.ts normalizePattern(): a pattern typed with a port ("localhost:3000") keeps the
  // ":3000" in `host`, but the URL host never has a port, so it can never match.
  it.fails('BUG: a pattern with a port ("localhost:3000") matches that dev server', () => {
    const l = custom({ focusDomains: ['localhost:3000'] })
    expect(classify({ app: 'Arc', url: 'http://localhost:3000/' }, l)).toBe('focus')
  })
})

describe('title fallback for browsers without URL', () => {
  it('infers the site from the title (Windows style)', () => {
    expect(chrome(undefined, 'Lofi beats - YouTube - Google Chrome')).toBe('distract')
    expect(chrome(undefined, 'anthropics/claude - GitHub - Mozilla Firefox')).toBe('focus')
  })
  it('resolveDomain prefers the URL over the title; non-browsers never use the title', () => {
    expect(resolveDomain({ app: 'Google Chrome', url: 'https://github.com', title: 'YouTube - Google Chrome' })).toBe('github.com')
    expect(resolveDomain({ app: 'Code', title: 'YouTube' })).toBeUndefined()
    expect(resolveDomain({ app: 'msedge.exe', title: 'Netflix - Microsoft Edge' })).toBe('netflix.com')
  })
  it('a URL on a non-browser app still resolves a domain (e.g. Electron apps reporting urls)', () => {
    expect(classify({ app: 'Slack', url: 'https://youtube.com' }, lists)).toBe('distract')
  })
  it('title match needs a whole word of >= 5 chars (so "x"/"claude" titles do not match via fallback)', () => {
    expect(classify({ app: 'Google Chrome', title: 'matrix reloaded' }, custom({ distractDomains: ['x.com'] }))).toBe('neutral')
    expect(classify({ app: 'Google Chrome', title: 'Reddit: front page' }, custom({ distractDomains: ['reddit.com'] }))).toBe('distract')
    expect(classify({ app: 'Google Chrome', title: 'redditor tips' }, custom({ distractDomains: ['reddit.com'] }))).toBe('neutral')
  })
})

describe('app names', () => {
  it('normalizeAppName trims, lowercases and drops .exe', () => {
    expect(normalizeAppName('  Code.EXE ')).toBe('code')
    expect(normalizeAppName('a.exe.exe')).toBe('a.exe')
  })
  it.each([
    ['Code.exe', 'focus'],
    ['code', 'focus'],
    ['CODE', 'focus'],
    ['Code - Insiders', 'focus'],
    ['Visual Studio Code', 'focus'],
    ['WINWORD.EXE', 'focus'],
    ['Windows Terminal', 'focus'],
    ['WindowsTerminal.exe', 'focus'],
    ['iTerm2', 'focus'],
    ['Notion Calendar', 'focus'],
    ['discord.exe', 'distract'],
    ['Spotify Helper', 'distract'],
    ['iTerm', 'neutral'],
    ['Codex', 'neutral'],
    ['Decode', 'neutral'],
    ['Finder', 'neutral'],
    ['', 'neutral'],
    ['   ', 'neutral'],
    ['Unknown', 'neutral']
  ])('%j -> %s', (app, expected) => {
    expect(classify({ app }, lists)).toBe(expected)
  })
  it('exact match beats a partial match from the other list', () => {
    const l = custom({ focusApps: ['Notion'], distractApps: ['Notion Games'] })
    expect(classify({ app: 'Notion' }, l)).toBe('focus')
    expect(classify({ app: 'Notion Games' }, l)).toBe('distract')
  })
  it('regex metacharacters in patterns are literal and do not throw', () => {
    expect(appPatternScore('c++', 'c++ builder')).toBeGreaterThan(0)
    expect(appPatternScore('(', 'a(b')).toBe(0) // "(" is not preceded by a word boundary char class in this app name
    expect(() => appPatternScore('[', 'x')).not.toThrow()
    expect(() => appPatternScore('.*', 'anything')).not.toThrow()
    expect(appPatternScore('.*', 'anything')).toBe(0)
  })
  it('isBrowser covers platform spellings and rejects look-alikes', () => {
    for (const b of ['Google Chrome', 'chrome.exe', 'MSEDGE.EXE', 'firefox', 'Brave Browser', 'Arc', 'Safari', 'Google Chrome Helper']) {
      expect(isBrowser(b)).toBe(true)
    }
    for (const n of ['', 'Archive Utility', 'Chromatic', 'Code', 'Operator']) expect(isBrowser(n)).toBe(false)
  })
  it('a focus app that is also a browser name is still treated as a browser (no URL -> neutral)', () => {
    expect(classify({ app: 'Arc', title: '' }, custom({ focusApps: ['Arc'] }))).toBe('neutral')
  })
})
