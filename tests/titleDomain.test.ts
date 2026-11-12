import { describe, expect, it } from 'vitest'
import { inferDomainFromTitle, stripBrowserSuffix } from '../src/main/titleDomain'
import { classify, isBrowser, resolveDomain } from '../src/main/classifier'
import { DEFAULT_SETTINGS } from '../src/main/defaults'

describe('stripBrowserSuffix', () => {
  it('removes browser names with any dash', () => {
    expect(stripBrowserSuffix('Cats - YouTube - Google Chrome')).toBe('Cats - YouTube')
    expect(stripBrowserSuffix('Cats — Mozilla Firefox')).toBe('Cats')
    expect(stripBrowserSuffix('Inbox and 2 more pages - Work - Microsoft​ Edge')).toBe('Inbox')
    expect(stripBrowserSuffix('Cats - Brave')).toBe('Cats')
    expect(stripBrowserSuffix('Google Chrome')).toBe('')
  })
})

describe('inferDomainFromTitle', () => {
  it.each([
    ['Lofi Hip Hop Radio - YouTube - Google Chrome', 'youtube.com'],
    ['(2) YouTube - Google Chrome', 'youtube.com'],
    ['YouTube — Mozilla Firefox', 'youtube.com'],
    ['r/studying - Reddit - Microsoft Edge', 'reddit.com'],
    ['Reddit - Dive into anything - Brave', 'reddit.com'],
    ['Stranger Things - Netflix - Google Chrome', 'netflix.com'],
    ['Essay draft - Google Docs - Google Chrome', 'docs.google.com'],
    ['Budget - Google Sheets - Microsoft Edge', 'docs.google.com'],
    ['Thesis - Overleaf, Online LaTeX Editor - Google Chrome', 'overleaf.com'],
    ['Bndrwe/Bloop: A pet - GitHub - Google Chrome', 'github.com'],
    ['Course Home - CS 101 - Brightspace - Google Chrome', 'brightspace.com'],
    ['ChatGPT - Google Chrome', 'chatgpt.com'],
    ['New chat - Claude - Google Chrome', 'claude.ai'],
    ['Alan Turing - Wikipedia - Google Chrome', 'wikipedia.org'],
    ['(1) Instagram - Google Chrome', 'instagram.com'],
    ['TikTok - Make Your Day - Google Chrome', 'tiktok.com'],
    ['Home / X - Google Chrome', 'x.com'],
    ['(3) Home / X - Microsoft Edge', 'x.com'],
    ['Derivatives | Khan Academy - Google Chrome', 'khanacademy.org'],
    ['Dashboard - Canvas - Google Chrome', 'instructure.com']
  ])('%s -> %s', (title, domain) => {
    expect(inferDomainFromTitle(title)).toBe(domain)
  })

  it('does not misfire on ambiguous words', () => {
    expect(inferDomainFromTitle('X marks the spot - Google Chrome')).toBeUndefined()
    expect(inferDomainFromTitle('Max Payne - Google Chrome')).toBeUndefined()
    expect(inferDomainFromTitle('Claude Shannon - Google Chrome')).toBeUndefined()
    expect(inferDomainFromTitle('Claude Shannon - Wikipedia - Google Chrome')).toBe('wikipedia.org')
    expect(inferDomainFromTitle('Canvas painting tips - Google Chrome')).toBeUndefined()
    expect(inferDomainFromTitle('New Tab - Google Chrome')).toBeUndefined()
    expect(inferDomainFromTitle('Google Chrome')).toBeUndefined()
    expect(inferDomainFromTitle('')).toBeUndefined()
  })
})

describe('title-based classification (Windows)', () => {
  const c = (app: string, title: string): string => classify({ app, title }, DEFAULT_SETTINGS)
  it('classifies browsers by inferred site', () => {
    expect(c('Google Chrome', 'Cats - YouTube - Google Chrome')).toBe('distract')
    expect(c('Microsoft Edge', 'Home / X - Microsoft Edge')).toBe('distract')
    expect(c('Firefox', 'Notes - Google Docs — Mozilla Firefox')).toBe('focus')
    expect(c('chrome.exe', 'Overleaf - Google Chrome')).toBe('focus')
    expect(c('Google Chrome', 'New Tab - Google Chrome')).toBe('neutral')
  })
  it('reports the inferred domain only for browsers without a URL', () => {
    expect(resolveDomain({ app: 'Google Chrome', title: 'Cats - YouTube - Google Chrome' })).toBe('youtube.com')
    expect(resolveDomain({ app: 'Google Chrome', url: 'https://github.com/x', title: 'Cats - YouTube' })).toBe('github.com')
    expect(resolveDomain({ app: 'Code', title: 'YouTube.ts - Visual Studio Code' })).toBeUndefined()
  })
})

describe('Windows app names', () => {
  const c = (app: string): string => classify({ app }, DEFAULT_SETTINGS)
  it('strips .exe and matches Windows names', () => {
    expect(c('Code.exe')).toBe('focus')
    expect(c('Visual Studio Code')).toBe('focus')
    expect(c('Windows Terminal')).toBe('focus')
    expect(c('WindowsTerminal.exe')).toBe('focus')
    expect(c('PowerShell')).toBe('focus')
    expect(c('Windows PowerShell')).toBe('focus')
    expect(c('Command Prompt')).toBe('focus')
    expect(c('WINWORD.EXE')).toBe('focus')
    expect(c('Microsoft Word')).toBe('focus')
    expect(c('Adobe Acrobat')).toBe('focus')
    expect(c('Acrobat.exe')).toBe('focus')
    expect(c('Notion')).toBe('focus')
    expect(c('Discord.exe')).toBe('distract')
    expect(c('Spotify')).toBe('distract')
    expect(c('Steam')).toBe('distract')
    expect(c('explorer.exe')).toBe('neutral')
  })
  it('recognises Windows browser names', () => {
    for (const n of ['chrome.exe', 'msedge.exe', 'firefox.exe', 'Mozilla Firefox', 'Brave Browser', 'Arc', 'Opera']) {
      expect(isBrowser(n)).toBe(true)
    }
    expect(isBrowser('Code.exe')).toBe(false)
  })
})
