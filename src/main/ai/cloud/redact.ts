// Secret redaction used on every error path. Pure (no electron import) so it is safe anywhere.

const PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{6,}/g,
  /sk-or-v1-[A-Za-z0-9_-]{6,}/g,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /((?:x-api-key|authorization|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi
]

/** Replace API keys / bearer tokens (and any explicitly known secrets) with "[redacted]". */
export function redact(text: string, known: Array<string | null | undefined> = []): string {
  let out = String(text ?? '')
  for (const k of known) {
    if (k && k.length >= 4) out = out.split(k).join('[redacted]')
  }
  for (const re of PATTERNS) {
    out = out.replace(re, (...m) => (typeof m[1] === 'string' && m.length > 3 && !/^(Bearer|Basic)$/i.test(m[1]) ? `${m[1]}[redacted]` : '[redacted]'))
  }
  return out
}

/** Redacted, single-line, length-capped message for showing to the user. */
export function safeMessage(e: unknown, known: Array<string | null | undefined> = [], max = 240): string {
  const raw = e instanceof Error ? e.message : String(e)
  const one = redact(raw, known).replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}
