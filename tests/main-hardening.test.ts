// Main-process hardening: https-only manual redirects for the model download, settings whitelist/caps.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { fetchHttpsOnly } from '../src/main/ai/local/bloop'
import { mergeSettings } from '../src/main/defaults'
import type { Settings } from '../src/shared/types'

const redirect = (to: string, status = 302): Response => new Response(null, { status, headers: { location: to } })

describe('fetchHttpsOnly', () => {
  it('follows https redirects (relative ones too) and passes redirect:manual', async () => {
    const f = vi.fn<typeof fetch>()
    f.mockResolvedValueOnce(redirect('https://cdn.example/x.gguf')).mockResolvedValueOnce(redirect('/y.gguf', 307)).mockResolvedValueOnce(new Response('ok'))
    const res = await fetchHttpsOnly(f, 'https://hf.example/a')
    expect(await res.text()).toBe('ok')
    expect(f.mock.calls.map((c) => c[0])).toEqual(['https://hf.example/a', 'https://cdn.example/x.gguf', 'https://cdn.example/y.gguf'])
    expect(f.mock.calls.every((c) => (c[1] as RequestInit).redirect === 'manual')).toBe(true)
  })
  it('never requests an http hop', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValueOnce(redirect('http://evil.example/x'))
    await expect(fetchHttpsOnly(f, 'https://hf.example/a')).rejects.toThrow(/non-https/)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('refuses an http start URL and redirect loops', async () => {
    const f = vi.fn<typeof fetch>().mockImplementation(async () => redirect('https://a.example/'))
    await expect(fetchHttpsOnly(f, 'http://a.example/')).rejects.toThrow(/non-https/)
    await expect(fetchHttpsOnly(f, 'https://a.example/')).rejects.toThrow(/too many/)
  })
})

describe('mergeSettings whitelist and caps', () => {
  it('drops unknown keys', () => {
    const s = mergeSettings({ focusMinutes: 30, evil: 'x', __proto__: { polluted: 1 } } as unknown as Partial<Settings>) as unknown as Record<string, unknown>
    expect(s['evil']).toBeUndefined()
    expect(s['polluted']).toBeUndefined()
    expect(s['focusMinutes']).toBe(30)
  })
  it('caps icalUrl and brightspaceHost at 2048 characters', () => {
    const s = mergeSettings({ icalUrl: 'https://x.example/' + 'a'.repeat(5000), brightspaceHost: 'a'.repeat(5000) + '.com' })
    expect(s.icalUrl.length).toBeLessThanOrEqual(2048)
    expect(s.brightspaceHost).toBe('')
  })
})

describe('Brightspace login window', () => {
  it('checks subframe navigations too (will-frame-navigate)', () => {
    expect(readFileSync('src/main/brightspaceApp.ts', 'utf8')).toMatch(/'will-frame-navigate'/)
  })
})
