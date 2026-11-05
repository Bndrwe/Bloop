// Pure helpers to infer a site from a browser window title (used on Windows, and on any
// platform when the tab URL is unavailable). No electron imports: unit-tested in tests/titleDomain.test.ts.

/** Strip zero-width characters and turn no-break spaces into plain ones (Edge: "Microsoft\u200b Edge"). */
export function cleanTitle(title: string): string {
  return title.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[\u00a0\u202f]/g, ' ')
}

const SEP = '[-\\u2013\\u2014]' // hyphen, en dash, em dash

/** Browser names that browsers append to the window title. */
const BROWSER_NAMES =
  '(?:Google Chrome|Microsoft Edge)(?: Beta| Dev| Canary)?|Chromium|Mozilla Firefox|Firefox(?: Developer Edition| Nightly)?|Brave(?: Browser)?|Arc|Opera(?: GX)?|Vivaldi|Safari'

// "Title - Google Chrome", also "Title - Google Chrome - Profile", "... and 3 more pages - Work - Microsoft Edge"
const BROWSER_SUFFIX = new RegExp(`\\s+${SEP}\\s+(?:${BROWSER_NAMES})(?: \\(?Private Browsing\\)?)?(?:\\s+${SEP}\\s+.*)?$`, 'i')
const BROWSER_ONLY = new RegExp(`^(?:${BROWSER_NAMES})$`, 'i')

/** Remove the " - Google Chrome" style suffix. Returns the page title. */
export function stripBrowserSuffix(title: string): string {
  const t = cleanTitle(title).trim()
  if (BROWSER_ONLY.test(t)) return ''
  // Edge: "Page and 2 more pages - Profile - Microsoft Edge"
  return t.replace(BROWSER_SUFFIX, '').replace(/\s+and \d+ more pages?\b.*$/i, '').trim()
}

interface Site {
  /** matched case-insensitively against a title segment */
  re: RegExp
  domain: string
  /** true: may only match the last segment (the usual "Page - Site" position) */
  strict?: boolean
}

const w = (s: string): RegExp => new RegExp(`(^|[^a-z0-9])${s}([^a-z0-9]|$)`, 'i')

const SITES: Site[] = [
  { re: w('google docs'), domain: 'docs.google.com' },
  { re: w('google sheets'), domain: 'docs.google.com' },
  { re: w('google slides'), domain: 'docs.google.com' },
  { re: w('google scholar'), domain: 'scholar.google.com' },
  { re: w('youtube'), domain: 'youtube.com' },
  { re: w('reddit'), domain: 'reddit.com' },
  { re: w('netflix'), domain: 'netflix.com' },
  { re: w('instagram'), domain: 'instagram.com' },
  { re: w('tiktok'), domain: 'tiktok.com' },
  { re: w('twitch'), domain: 'twitch.tv' },
  { re: w('facebook'), domain: 'facebook.com' },
  { re: w('twitter'), domain: 'twitter.com' },
  { re: w('overleaf'), domain: 'overleaf.com' },
  { re: w('github'), domain: 'github.com' },
  { re: w('brightspace'), domain: 'brightspace.com' },
  { re: w('chatgpt'), domain: 'chatgpt.com' },
  { re: w('khan academy'), domain: 'khanacademy.org' },
  { re: w('wikipedia'), domain: 'wikipedia.org' },
  { re: w('stack ?overflow'), domain: 'stackoverflow.com' },
  { re: w('instructure'), domain: 'instructure.com' },
  { re: /^canvas$/i, domain: 'instructure.com', strict: true },
  // Ambiguous words: last segment only, and "X" only as the whole segment ("Home / X").
  { re: /^x$/i, domain: 'x.com', strict: true },
  { re: /^claude(\.ai)?$/i, domain: 'claude.ai', strict: true }
]

/** Separators between page and site name: " - ", " – ", " — ", " | ", " / ", " · ". */
const SEGMENT_SPLIT = /\s+[-–—|/·]\s+/

/**
 * Infer the site (a domain such as "youtube.com") from a browser window title like
 * "Lofi beats - YouTube - Google Chrome". Returns undefined when nothing is recognised.
 */
export function inferDomainFromTitle(title: string): string | undefined {
  if (!title) return undefined
  const page = stripBrowserSuffix(title).replace(/^\(\d+\+?\)\s*/, '').trim() // "(3) " notification counter
  if (!page) return undefined
  const segments = page.split(SEGMENT_SPLIT).map((s) => s.trim()).filter(Boolean)
  const last = segments[segments.length - 1]
  if (!last) return undefined
  for (const s of SITES) if (s.re.test(last)) return s.domain
  // second pass: distinctive names in earlier segments ("YouTube - Music")
  for (let i = segments.length - 2; i >= 0; i--) {
    for (const s of SITES) if (!s.strict && s.re.test(segments[i] as string)) return s.domain
  }
  return undefined
}
