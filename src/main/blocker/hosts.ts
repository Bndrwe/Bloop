// Website blocking on macOS through /etc/hosts. The system resolver (and with it Safari, Chrome,
// Arc, Edge, and Firefox unless DNS-over-HTTPS is on) sends the listed sites to 0.0.0.0 / ::.
//
// Editing /etc/hosts needs root. Rather than asking for the password on every block, Bloop asks once
// to install a tiny root-owned helper plus a sudoers rule that lets this user run only that helper
// without a password. The helper only rewrites Bloop's own marked section of /etc/hosts and checks
// every domain itself, so the rule grants nothing else. Pure functions only: siteBlocker.ts runs them.

export const HELPER_PATH = '/Library/PrivilegedHelperTools/io.github.bndrwe.bloop.siteblocker'
export const SUDOERS_PATH = '/etc/sudoers.d/bloop-site-blocker'
/** Bump when HELPER_SCRIPT changes: an older installed helper is replaced (one more prompt). */
export const HELPER_VERSION = '1'
export const SECTION_BEGIN = '# >>> bloop site blocker >>>'
export const SECTION_END = '# <<< bloop site blocker <<<'

/** Hostname rule, shared with the helper's own check: lowercase labels, a dot, a letter TLD. */
export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z]{2,63}$/
const SAFE_USER_RE = /^[a-zA-Z0-9._-]{1,64}$/
/** The helper refuses more names than this (each site becomes up to 3). */
export const MAX_HOSTNAMES = 400
/** Never blockable (they or any subdomain): blocking them breaks macOS updates, iCloud or HTTPS. */
export const PROTECTED_DOMAINS = [
  'apple.com',
  'icloud.com',
  'icloud-content.com',
  'mzstatic.com',
  'apple-dns.net',
  'cdn-apple.com',
  'aaplimg.com',
  'apple-cloudkit.com',
  'digicert.com',
  'lencr.org'
] as const

export function isProtected(host: string): boolean {
  return PROTECTED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Our own entry lines inside the section (anything else there is kept, e.g. if a marker was lost). */
const ENTRY_RE = /^(0\.0\.0\.0|::) [a-z0-9.-]+$/

/** "https://www.YouTube.com/watch?v=1" -> "youtube.com"; null if it isn't a usable hostname. */
export function normalizeSite(input: string): string | null {
  let s = String(input ?? '').trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  s = s.split(/[/?#]/)[0] // path, query, hash
  s = s.replace(/^[^@]*@/, '') // user@
  s = s.replace(/:\d+$/, '') // port
  s = s.replace(/^www\./, '').replace(/\.$/, '')
  return DOMAIN_RE.test(s) && !isProtected(s) ? s : null
}

/** Each site plus its www. and m. variants (/etc/hosts has no wildcards), de-duplicated, capped. */
export function expandHostnames(sites: string[]): string[] {
  const out = new Set<string>()
  for (const raw of sites) {
    const d = normalizeSite(raw)
    if (!d) continue
    for (const h of [d, `www.${d}`, `m.${d}`]) if (DOMAIN_RE.test(h)) out.add(h)
  }
  return [...out].slice(0, MAX_HOSTNAMES)
}

/** /etc/hosts with Bloop's section replaced by `hostnames` (or removed when empty). */
export function renderHosts(current: string, hostnames: string[]): string {
  const kept: string[] = []
  let inside = false
  for (const line of current.split('\n')) {
    if (line === SECTION_BEGIN) inside = true
    else if (line === SECTION_END) inside = false
    else if (!inside || !ENTRY_RE.test(line)) kept.push(line)
  }
  while (kept.length && kept[kept.length - 1] === '') kept.pop()
  if (hostnames.length === 0) return kept.join('\n') + '\n'
  const section = [SECTION_BEGIN, ...hostnames.flatMap((h) => [`0.0.0.0 ${h}`, `:: ${h}`]), SECTION_END]
  return [...kept, ...section].join('\n') + '\n'
}

const PROTECTED_CASE = PROTECTED_DOMAINS.flatMap((d) => [d, `*.${d}`]).join('|')

/**
 * The root helper. `block <host>...` rewrites Bloop's section, `unblock` removes it, `version`
 * prints HELPER_VERSION. Same logic as renderHosts, in sh/awk so it needs nothing installed. The
 * hosts path is fixed (no environment override: it runs as root); tests rewrite the HOSTS= line.
 * The new file is written next to /etc/hosts and moved over it, so a failure never truncates it.
 */
export const HELPER_SCRIPT = `#!/bin/sh
# Bloop site blocker helper (installed by Bloop). Only edits Bloop's section of /etc/hosts.
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
HOSTS=/etc/hosts
BEGIN='${SECTION_BEGIN}'
END='${SECTION_END}'
cmd="\${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  version) echo ${HELPER_VERSION}; exit 0 ;;
  block|unblock) ;;
  *) echo "usage: $0 block <host>... | unblock | version" >&2; exit 2 ;;
esac
if [ "$cmd" = block ]; then
  [ $# -ge 1 ] && [ $# -le ${MAX_HOSTNAMES} ] || { echo "bad host count" >&2; exit 2; }
  for d in "$@"; do
    # grep checks line by line, so first refuse any other character (a newline would sneak a line in)
    case "$d" in ''|*[!a-z0-9.-]*) echo "bad host" >&2; exit 3 ;; esac
    case "$d" in ${PROTECTED_CASE}) echo "protected host: $d" >&2; exit 4 ;; esac
    printf '%s\\n' "$d" | grep -Eqx '${DOMAIN_RE.source.slice(1, -1)}' || { echo "bad host: $d" >&2; exit 3; }
  done
fi
tmp=$(mktemp "$HOSTS.bloop.XXXXXX")
trap 'rm -f "$tmp"' EXIT INT TERM HUP
awk -v b="$BEGIN" -v e="$END" '$0==b{s=1;next} $0==e{s=0;next} s && /${ENTRY_RE.source}/{next} {print}' "$HOSTS" > "$tmp"
if [ "$cmd" = block ]; then
  echo "$BEGIN" >> "$tmp"
  for d in "$@"; do printf '0.0.0.0 %s\\n:: %s\\n' "$d" "$d" >> "$tmp"; done
  echo "$END" >> "$tmp"
fi
[ -s "$tmp" ] || { echo "refusing to write an empty hosts file" >&2; exit 5; }
chmod 644 "$tmp"
mv -f "$tmp" "$HOSTS"
if [ "$HOSTS" = /etc/hosts ]; then
  dscacheutil -flushcache 2>/dev/null || true
  killall -HUP mDNSResponder 2>/dev/null || true
fi
`

export function sudoersLine(user: string): string {
  if (!SAFE_USER_RE.test(user)) throw new Error(`unexpected user name: ${user}`)
  return `${user} ALL=(root) NOPASSWD: ${HELPER_PATH}\n`
}

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

/**
 * The one-time install, run as root through the macOS admin prompt. File contents travel as
 * base64 inside the command and are staged only inside root-owned folders (no user-writable temp
 * file to swap), and the sudoers rule is checked with visudo before it goes live. Staged files are
 * removed even when a step fails.
 */
export function installCommand(user: string): string {
  const helperNew = `${HELPER_PATH}.new`
  const sudoNew = '/etc/sudoers.d/.bloop-site-blocker.new' // sudo ignores names with a dot
  const steps = [
    '/bin/mkdir -p /Library/PrivilegedHelperTools /etc/sudoers.d',
    `/bin/echo ${b64(HELPER_SCRIPT)} | /usr/bin/base64 -D > ${helperNew}`,
    `/usr/sbin/chown root:wheel ${helperNew}`,
    `/bin/chmod 755 ${helperNew}`,
    `/bin/mv -f ${helperNew} ${HELPER_PATH}`,
    `/bin/echo ${b64(sudoersLine(user))} | /usr/bin/base64 -D > ${sudoNew}`,
    `/usr/sbin/visudo -cf ${sudoNew}`,
    `/usr/sbin/chown root:wheel ${sudoNew}`,
    `/bin/chmod 440 ${sudoNew}`,
    `/bin/mv -f ${sudoNew} ${SUDOERS_PATH}`
  ].join(' && ')
  return `( ${steps} ); S=$?; /bin/rm -f ${helperNew} ${sudoNew}; exit $S`
}

/** `osascript -e <this>`: shows the standard macOS admin prompt, then runs `cmd` as root. */
export function adminAppleScript(cmd: string, prompt: string): string {
  const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return `do shell script ${q(cmd)} with prompt ${q(prompt)} with administrator privileges`
}
