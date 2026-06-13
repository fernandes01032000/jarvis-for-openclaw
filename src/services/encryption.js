// AES-GCM encryption of IndexedDB messages.
//
// The salt + iteration count below are fixed so that:
//   (a) the same password always derives the same key (history stays readable)
//   (b) auth.js can derive once, persist the raw key bytes, and re-import them
//       on next boot without keeping the password in localStorage.

const SALT = new TextEncoder().encode('openclaw-jarvis-pwa-salt');
const ITERATIONS = 100000;

let cachedKey = null;

/**
 * Derive an AES-GCM 256-bit key from a password. Returns both the CryptoKey
 * (extractable, so the raw bytes can be persisted by auth.js) and the raw
 * bytes themselves.
 */
export async function deriveKeyFromPassword(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // extractable so auth.js can stash raw bytes
    ['encrypt', 'decrypt']
  );
  const rawBytes = await crypto.subtle.exportKey('raw', key);
  cachedKey = key;
  return { key, rawBytes };
}

/** Cache pre-exported raw key bytes (called from auth.js after login). */
export async function cacheKeyBytes(rawBytes) {
  cachedKey = await crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return cachedKey;
}

/** Import + cache from raw bytes (idempotent, used on cold boot). */
export async function importCachedKey(rawBytes) {
  if (cachedKey) return cachedKey;
  return cacheKeyBytes(rawBytes);
}

async function resolveKey(maybeKeyOrPassword) {
  if (cachedKey) return cachedKey;
  if (!maybeKeyOrPassword) return null;
  // Legacy callers may still pass a raw password; derive transparently.
  if (typeof maybeKeyOrPassword === 'string') {
    const { key } = await deriveKeyFromPassword(maybeKeyOrPassword);
    return key;
  }
  // Already a CryptoKey
  cachedKey = maybeKeyOrPassword;
  return cachedKey;
}

export async function encrypt(text, keyOrPassword) {
  try {
    const key = await resolveKey(keyOrPassword);
    if (!key) return text;

    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(text)
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  } catch (err) {
    console.error('[Encryption] Failed:', err);
    return text;
  }
}

export async function decrypt(base64Data, keyOrPassword) {
  try {
    const key = await resolveKey(keyOrPassword);
    if (!key) return base64Data;

    const combined = new Uint8Array(
      atob(base64Data).split('').map((c) => c.charCodeAt(0))
    );
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.warn('[Encryption] Decryption failed, returning raw data');
    return base64Data;
  }
}

export function clearEncryptionCache() {
  cachedKey = null;
}
