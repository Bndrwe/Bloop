import { describe, expect, it } from 'vitest'
import { classify, domainFromUrl, isBrowser, BROWSER_APPS } from '../src/main/classifier'
import { DEFAULT_SETTINGS } from '../src/main/defaults'

const lists = DEFAULT_SETTINGS
const c = (app: string, url?: string, title?: string): string => classify({ app, url, title }, lists)

describe('domainFromUrl', () => {
  it('strips www and lowercases', () => {
    expect(domainFromUrl('https://WWW.YouTube.com/watch?v=1')).toBe('youtube.com')
    expect(domainFromUrl('github.com/foo')).toBe('github.com')
    expect(domainFromUrl('')).toBeUndefined()
    expect(domainFromUrl('not a url at all')).toBeUndefined()
  })
})

describe('app matching', () => {
  it('matches focus apps by owner name', () => {
    expect(c('Code')).toBe('focus')
    expect(c('Visual Studio Code')).toBe('focus')
    expect(c('Cursor')).toBe('focus')
    expect(c('iTerm2')).toBe('focus')
    expect(c('Microsoft Word')).toBe('focus')
    expect(c('code')).toBe('focus') // linux owner name
  })
  it('matches distract apps', () => {
    expect(c('Discord')).toBe('distract')
    expect(c('Spotify')).toBe('distract')
    expect(c('Messages')).toBe('distract')
  })
  it('matches words, not substrings', () => {
    expect(c('Xcode')).toBe('focus') // via its own entry
    expect(classify({ app: 'Xcode' }, { ...lists, focusApps: ['Code'] })).toBe('neutral')
    expect(c('Finder')).toBe('neutral')
    expect(c('Codex Helper')).toBe('neutral')
  })
})

describe('domain matching', () => {
  it('matches exact domains and subdomains', () => {
    expect(c('Google Chrome', 'https://www.youtube.com/watch?v=x')).toBe('distract')
    expect(c('Google Chrome', 'https://m.youtube.com/')).toBe('distract')
    expect(c('Safari', 'https://github.com/anthropics')).toBe('focus')
    expect(c('Arc', 'https://en.wikipedia.org/wiki/Cat')).toBe('focus')
    expect(c('Arc', 'https://docs.google.com/document/d/1')).toBe('focus')
  })
  it('matches dot-less patterns as hostname labels', () => {
    expect(c('Google Chrome', 'https://purdue.brightspace.com/d2l/home')).toBe('focus')
    expect(c('Google Chrome', 'https://canvas.ucla.edu/courses/1')).toBe('focus')
    expect(c('Google Chrome', 'https://school.instructure.com/')).toBe('focus')
  })
  it('does not over-match short patterns', () => {
    expect(c('Google Chrome', 'https://x.com/home')).toBe('distract')
    expect(c('Google Chrome', 'https://box.com/')).toBe('neutral')
    expect(c('Google Chrome', 'https://xkcd.com/')).toBe('neutral')
    expect(classify({ app: 'Arc', url: 'https://www.bx.com/' }, { ...lists, distractDomains: ['x'] })).toBe('neutral')
    expect(classify({ app: 'Arc', url: 'https://foo.com/' }, { ...lists, distractDomains: ['com'] })).toBe('neutral')
    expect(c('Google Chrome', 'https://notyoutube.com/')).toBe('neutral')
  })
  it('more specific pattern wins, ties go to distract', () => {
    const l = { ...lists, focusDomains: ['scholar.google.com'], distractDomains: ['google.com'] }
    expect(classify({ app: 'Arc', url: 'https://scholar.google.com/' }, l)).toBe('focus')
    expect(classify({ app: 'Arc', url: 'https://news.google.com/' }, l)).toBe('distract')
    const tie = { ...lists, focusDomains: ['reddit.com'], distractDomains: ['reddit.com'] }
    expect(classify({ app: 'Arc', url: 'https://reddit.com/' }, tie)).toBe('distract')
  })
  it('supports path patterns', () => {
    const l = { ...lists, focusDomains: ['reddit.com/r/learnprogramming'] }
    expect(classify({ app: 'Arc', url: 'https://www.reddit.com/r/learnprogramming/top' }, l)).toBe('focus')
    expect(classify({ app: 'Arc', url: 'https://www.reddit.com/r/memes' }, l)).toBe('distract')
  })
  it('browser without a matching domain is neutral', () => {
    expect(c('Google Chrome', 'https://example.com/')).toBe('neutral')
    expect(c('Google Chrome')).toBe('neutral')
    expect(c('Safari', undefined, '')).toBe('neutral')
  })
  it('falls back to the window title for browsers without a URL', () => {
    expect(c('Google Chrome', undefined, 'Funny cats - YouTube')).toBe('distract')
    expect(c('Google Chrome', undefined, 'Some page')).toBe('neutral')
  })
})

describe('isBrowser', () => {
  it('knows the main browsers', () => {
    for (const b of ['Google Chrome', 'Arc', 'Safari', 'Brave Browser', 'Microsoft Edge', 'Firefox', 'Chromium'])
      expect(BROWSER_APPS).toContain(b)
    expect(isBrowser('google chrome')).toBe(true)
    expect(isBrowser('Archive Utility')).toBe(false)
  })
})
