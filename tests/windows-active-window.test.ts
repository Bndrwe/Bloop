import { describe, expect, it } from 'vitest'
import { classify, exeBasename, isBrowser, normalizeOwner, resolveDomain } from '../src/main/classifier'
import { inferDomainFromTitle, stripBrowserSuffix } from '../src/main/titleDomain'
import { DEFAULT_SETTINGS } from '../src/main/defaults'

// Realistic get-windows (Windows) results: owner.name / owner.path / title.
const W = (name: string, path: string, title: string) => ({ owner: { name, path }, title })
const sys = 'C:\\Windows\\System32\\'
const pf = 'C:\\Program Files\\'

function run(w: ReturnType<typeof W>) {
  const { app, title } = normalizeOwner(w.owner, w.title)
  return { app, title, category: classify({ app, title }, DEFAULT_SETTINGS), domain: resolveDomain({ app, title }) }
}

describe('exeBasename', () => {
  it('handles backslash, forward slash and missing paths', () => {
    expect(exeBasename('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('chrome')
    expect(exeBasename('C:/Windows/System32/ApplicationFrameHost.EXE')).toBe('applicationframehost')
    expect(exeBasename(undefined)).toBe('')
  })
})

describe('normalizeOwner', () => {
  it('keeps a proper owner name', () => {
    expect(normalizeOwner({ name: 'Google Chrome', path: pf + 'Google\\Chrome\\Application\\chrome.exe' }, 'x').app).toBe('Google Chrome')
    expect(normalizeOwner({ name: 'Code', path: 'C:\\Users\\Sam\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe' }, 'x').app).toBe('Visual Studio Code')
  })
  it('uses the exe when the name is the bare exe name or empty', () => {
    expect(normalizeOwner({ name: 'chrome.exe', path: pf + 'Google\\Chrome\\Application\\chrome.exe' }, '').app).toBe('Google Chrome')
    expect(normalizeOwner({ name: '', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }, '').app).toBe('Microsoft Edge')
    expect(normalizeOwner({ name: 'WindowsTerminal', path: pf + 'WindowsApps\\Microsoft.WindowsTerminal_1.20\\WindowsTerminal.exe' }, '').app).toBe('Windows Terminal')
    expect(normalizeOwner({ name: 'pwsh', path: pf + 'PowerShell\\7\\pwsh.exe' }, '').app).toBe('PowerShell')
    expect(normalizeOwner({ name: '', path: 'C:\\Tools\\mytool.exe' }, '').app).toBe('mytool')
  })
  it('uses the title for UWP apps behind ApplicationFrameHost', () => {
    expect(normalizeOwner({ name: 'Application Frame Host', path: sys + 'ApplicationFrameHost.exe' }, 'Calculator').app).toBe('Calculator')
    expect(normalizeOwner({ name: 'ApplicationFrameHost', path: sys + 'ApplicationFrameHost.exe' }, '').app).toBe('Application Frame Host')
  })
  it('tolerates missing owner', () => {
    expect(normalizeOwner(undefined, 'hi')).toEqual({ app: '', title: 'hi' })
  })
})

describe('classification of Windows samples', () => {
  it('VS Code, terminals and Word are focus', () => {
    expect(run(W('Code', 'C:\\Users\\Sam\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', 'index.ts - StudyPet - Visual Studio Code')).category).toBe('focus')
    expect(run(W('Visual Studio Code', 'C:\\x\\Code.exe', 'a')).category).toBe('focus')
    expect(run(W('Windows Terminal', pf + 'WindowsApps\\wt\\WindowsTerminal.exe', 'PS C:\\Users\\Sam>')).category).toBe('focus')
    expect(run(W('', pf + 'PowerShell\\7\\pwsh.exe', 'pwsh')).category).toBe('focus')
    expect(run(W('Windows PowerShell', sys + 'WindowsPowerShell\\v1.0\\powershell.exe', 'Windows PowerShell')).category).toBe('focus')
    expect(run(W('Microsoft Word', pf + 'Microsoft Office\\root\\Office16\\WINWORD.EXE', 'Essay.docx - Word')).category).toBe('focus')
    expect(run(W('', pf + 'Microsoft Office\\root\\Office16\\WINWORD.EXE', 'Essay.docx - Word')).category).toBe('focus')
  })
  it('Discord/Spotify/Steam are distract', () => {
    expect(run(W('Discord', 'C:\\Users\\Sam\\AppData\\Local\\Discord\\app-1.0.9\\Discord.exe', '#general')).category).toBe('distract')
    expect(run(W('', 'C:\\Users\\Sam\\AppData\\Roaming\\Spotify\\Spotify.exe', 'Song')).category).toBe('distract')
    expect(run(W('Steam', 'C:\\Program Files (x86)\\Steam\\steamwebhelper.exe', 'Steam')).category).toBe('distract')
  })
  it('UWP app title decides', () => {
    expect(run(W('Application Frame Host', sys + 'ApplicationFrameHost.exe', 'Spotify')).category).toBe('distract')
    expect(run(W('Application Frame Host', sys + 'ApplicationFrameHost.exe', 'Calculator')).category).toBe('neutral')
  })
  it('browsers: site inferred from title', () => {
    const chrome = pf + 'Google\\Chrome\\Application\\chrome.exe'
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    const ff = pf + 'Mozilla Firefox\\firefox.exe'
    expect(run(W('Google Chrome', chrome, 'lofi hip hop radio - YouTube - Google Chrome - Person 1'))).toMatchObject({ domain: 'youtube.com', category: 'distract' })
    expect(run(W('', chrome, 'Intro to Algorithms - Khan Academy - Google Chrome'))).toMatchObject({ domain: 'khanacademy.org', category: 'focus' })
    expect(run(W('Microsoft Edge', edge, 'YouTube and 3 more pages - Personal - Microsoft\u200b Edge'))).toMatchObject({ domain: 'youtube.com', category: 'distract' })
    expect(run(W('msedge', edge, 'Reddit - Dive into anything - [InPrivate] - Microsoft Edge'))).toMatchObject({ domain: 'reddit.com' })
    expect(run(W('Firefox', ff, 'YouTube \u2014 Mozilla Firefox'))).toMatchObject({ app: 'Mozilla Firefox', domain: 'youtube.com' })
    expect(run(W('Firefox', ff, 'GitHub \u2014 Mozilla Firefox Private Browsing'))).toMatchObject({ domain: 'github.com' })
    expect(run(W('Arc', 'C:\\Users\\Sam\\AppData\\Local\\Microsoft\\WindowsApps\\Arc.exe', 'Netflix - Arc'))).toMatchObject({ domain: 'netflix.com' })
    expect(run(W('Brave Browser', pf + 'BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Twitch - Brave'))).toMatchObject({ domain: 'twitch.tv' })
  })
  it('a browser with no recognisable site is neutral, never focus', () => {
    expect(run(W('Google Chrome', 'C:\\chrome.exe', 'New Tab - Google Chrome')).category).toBe('neutral')
    expect(run(W('Microsoft Edge', 'C:\\msedge.exe', 'Microsoft Edge')).category).toBe('neutral')
  })
  it('isBrowser accepts exe-style names', () => {
    for (const n of ['chrome.exe', 'msedge.exe', 'Firefox', 'Brave Browser', 'Arc']) expect(isBrowser(n)).toBe(true)
    expect(isBrowser('Code')).toBe(false)
  })
})

describe('title edge cases', () => {
  it.each([
    ['(99+) YouTube - Google Chrome', 'youtube.com'],
    ['Inbox (3) - Gmail - Google Chrome', undefined],
    ['Home / X - Microsoft Edge', 'x.com'],
    ['Sign in to GitHub \u00b7 GitHub - Google Chrome', 'github.com'],
    ['youtube.com/watch?v=abc123 - Google Chrome', 'youtube.com'],
    ['Google Chrome', undefined],
    ['', undefined],
    ['Title - Microsoft Edge Beta', undefined],
    ['Notes \u2013 Reddit \u2013 Vivaldi', 'reddit.com'],
    ['Mozilla Firefox', undefined]
  ])('%s -> %s', (t, d) => {
    expect(inferDomainFromTitle(t)).toBe(d)
  })
  it('strips Edge profile/more-pages and Firefox private suffixes', () => {
    expect(stripBrowserSuffix('Docs and 12 more pages - Work - Microsoft Edge')).toBe('Docs')
    expect(stripBrowserSuffix('Cats \u2014 Mozilla Firefox Private Browsing')).toBe('Cats')
    expect(stripBrowserSuffix('Cats - Google Chrome Canary')).toBe('Cats')
  })
})
