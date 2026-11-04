// API keys: encrypted with Electron safeStorage (Keychain / DPAPI / libsecret) and kept in electron-store
// under `aiKeys` as base64 ciphertext. Plaintext keys exist only transiently in the main process;
// nothing here is ever sent to the renderer (status only says "key set").
import { safeStorage } from 'electron'
import Store from 'electron-store'
import { redact, safeMessage } from './redact'

export { redact, safeMessage }

export type ApiKeyProvider = 'anthropic' | 'openrouter'

interface KeySchema {
  aiKeys: Partial<Record<ApiKeyProvider, string>>
}

let store: Store<KeySchema> | null = null
function s(): Store<KeySchema> {
  // Same file as src/main/store.ts ("bloop"): electron-store re-reads the file on each access.
  if (!store) store = new Store<KeySchema>({ name: 'bloop', defaults: { aiKeys: {} }, clearInvalidConfig: true })
  return store
}

const NO_ENCRYPTION =
  "Can't store the key: secure storage isn't available on this system (macOS Keychain / Windows DPAPI / a Linux keyring). Nothing was saved."

export function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** Basic shape check so pasted text with spaces / newlines isn't stored as a "key". */
export function validateKey(key: string): string | null {
  const k = key.trim()
  if (k.length < 10 || k.length > 512) return 'That does not look like an API key (wrong length).'
  if (/\s/.test(k)) return 'An API key has no spaces or line breaks. Paste just the key.'
  return null
}

export function saveApiKey(provider: ApiKeyProvider, key: string): { ok: boolean; error?: string } {
  const bad = validateKey(key)
  if (bad) return { ok: false, error: bad }
  if (!canEncrypt()) return { ok: false, error: NO_ENCRYPTION }
  try {
    const enc = safeStorage.encryptString(key.trim()).toString('base64')
    s().set('aiKeys', { ...(s().get('aiKeys') ?? {}), [provider]: enc })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Couldn't save the key: ${safeMessage(e, [key])}` }
  }
}

export function removeApiKey(provider: ApiKeyProvider): { ok: boolean; error?: string } {
  try {
    const next = { ...(s().get('aiKeys') ?? {}) }
    delete next[provider]
    s().set('aiKeys', next)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Couldn't remove the key: ${safeMessage(e)}` }
  }
}

/** Decrypted stored key (main process only), or null. */
export function getStoredKey(provider: ApiKeyProvider): string | null {
  try {
    const enc = s().get('aiKeys')?.[provider]
    if (!enc || !canEncrypt()) return null
    const k = safeStorage.decryptString(Buffer.from(enc, 'base64')).trim()
    return k || null
  } catch {
    return null
  }
}

export function hasStoredKey(provider: ApiKeyProvider): boolean {
  try {
    return Boolean(s().get('aiKeys')?.[provider])
  } catch {
    return false
  }
}

/** Key to use: the stored one, else (Anthropic only) ANTHROPIC_API_KEY from the environment / .env. */
export function resolveKey(provider: ApiKeyProvider): { key: string; source: 'stored' | 'env' } | null {
  const stored = getStoredKey(provider)
  if (stored) return { key: stored, source: 'stored' }
  if (provider === 'anthropic') {
    const env = process.env['ANTHROPIC_API_KEY']?.trim()
    if (env) return { key: env, source: 'env' }
  }
  return null
}

/** True when a key exists, even if it can't be decrypted right now. */
export function keyStatus(provider: ApiKeyProvider): { set: boolean; source?: 'stored' | 'env'; undecryptable?: boolean } {
  const r = resolveKey(provider)
  if (r) return { set: true, source: r.source }
  if (hasStoredKey(provider)) return { set: false, undecryptable: true }
  return { set: false }
}
