// Auth + encryption-key storage for the PWA.
//
// What's in localStorage:
//   openclaw-auth-token : JWT issued by POST /api/auth/login (sent over WS)
//   openclaw-auth-exp   : token expiry (ms epoch) — local sanity check only
//   openclaw-enc-key    : AES-GCM raw key bytes (base64), derived in-browser
//                          from the password via PBKDF2 (encryption.js).
//
// What is NOT stored anymore: the raw gateway password. XSS can still steal
// the derived encryption key + JWT, but rotating the gateway password no
// longer leaks the user's local history (key is decoupled), and the JWT
// expires / can be revoked server-side by rotating ~/.openclaw/jarvis-jwt-secret.

import { deriveKeyFromPassword, cacheKeyBytes, importCachedKey, clearEncryptionCache } from './encryption.js';

const TOKEN_KEY = 'openclaw-auth-token';
const EXP_KEY = 'openclaw-auth-exp';
const ENC_KEY = 'openclaw-enc-key';

// Legacy migration: old builds stored the raw password under 'openclaw-auth'.
const LEGACY_PASSWORD_KEY = 'openclaw-auth';

async function postLogin(password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).error || detail; } catch {}
    throw new Error(detail);
  }
  return res.json(); // { token, expiresAt }
}

/**
 * Exchange a password for a JWT and stash the derived encryption key.
 * @returns {Promise<{token: string, expiresAt: number|null}>}
 */
export async function loginWithPassword(password) {
  const { token, expiresAt } = await postLogin(password);

  // Derive AES-GCM key in-browser. encryption.js controls the salt/iterations
  // so existing encrypted IndexedDB messages stay decryptable.
  const { rawBytes } = await deriveKeyFromPassword(password);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(rawBytes)));

  localStorage.setItem(TOKEN_KEY, token);
  if (expiresAt) localStorage.setItem(EXP_KEY, String(expiresAt));
  localStorage.setItem(ENC_KEY, b64);
  localStorage.removeItem(LEGACY_PASSWORD_KEY);

  await cacheKeyBytes(rawBytes);
  return { token, expiresAt: expiresAt || null };
}

/**
 * Compatibility entry-point for callers that used to do `saveAuth(password)`.
 * Now performs the full login round-trip and key derivation.
 */
export async function saveAuth(password) {
  await loginWithPassword(password);
}

/** Returns the JWT to be sent over WS, or null. */
export function getAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const exp = parseInt(localStorage.getItem(EXP_KEY) || '0', 10);
  if (exp && exp < Date.now()) return null; // expired
  return token;
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXP_KEY);
  localStorage.removeItem(ENC_KEY);
  localStorage.removeItem('openclaw-lastSeq');
  localStorage.removeItem(LEGACY_PASSWORD_KEY);
  clearEncryptionCache();
}

export function isLoggedIn() {
  return !!getAuth();
}

/** Returns the cached AES-GCM CryptoKey, importing from localStorage if needed. */
export async function getEncryptionKey() {
  const b64 = localStorage.getItem(ENC_KEY);
  if (!b64) return null;
  try {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return importCachedKey(raw.buffer);
  } catch {
    return null;
  }
}

/**
 * One-shot legacy migration: if a previous build stored the raw password
 * under 'openclaw-auth', exchange it for a JWT + derived key on first boot.
 * Returns true if it migrated something.
 */
export async function migrateLegacyIfNeeded() {
  const legacy = localStorage.getItem(LEGACY_PASSWORD_KEY);
  if (!legacy || localStorage.getItem(TOKEN_KEY)) return false;
  try {
    await loginWithPassword(legacy);
    return true;
  } catch (err) {
    console.warn('[Auth] Legacy migration failed:', err.message);
    return false;
  }
}
