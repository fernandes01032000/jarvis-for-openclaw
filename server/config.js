import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import webPush from 'web-push';

// Load .env from project root if present (values never override existing env vars)
try {
  const envPath = new URL('../.env', import.meta.url).pathname;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch {}

const OPENCLAW_DIR = path.join(process.env.HOME, '.openclaw');
const VAPID_KEYS_PATH = path.join(OPENCLAW_DIR, 'pwa-vapid-keys.json');
const SUBSCRIPTIONS_PATH = path.join(OPENCLAW_DIR, 'pwa-push-subscriptions.json');
const JWT_SECRET_PATH = path.join(OPENCLAW_DIR, 'jarvis-jwt-secret');

// JWT secret: env wins; else read/generate persistent file (chmod 600). The
// secret never appears in source nor logs. Rotating the file invalidates all
// outstanding tokens — useful for forced re-auth on suspected leak.
function loadOrCreateJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET;
  }
  try {
    if (fs.existsSync(JWT_SECRET_PATH)) {
      const s = fs.readFileSync(JWT_SECRET_PATH, 'utf-8').trim();
      if (s.length >= 32) return s;
    }
  } catch {}
  const fresh = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
  fs.writeFileSync(JWT_SECRET_PATH, fresh, { mode: 0o600 });
  console.log('[Config] Generated JWT secret at', JWT_SECRET_PATH);
  return fresh;
}

// Load or generate VAPID keys
function loadVapidKeys() {
  try {
    if (fs.existsSync(VAPID_KEYS_PATH)) {
      return JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8'));
    }
  } catch (err) {
    console.error('[Config] Failed to load VAPID keys:', err.message);
  }

  console.log('[Config] Generating new VAPID keys...');
  const keys = webPush.generateVAPIDKeys();
  fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
  fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(keys, null, 2));
  console.log('[Config] VAPID keys saved to', VAPID_KEYS_PATH);
  return keys;
}

const vapidKeys = loadVapidKeys();
const jwtSecret = loadOrCreateJwtSecret();

const DEFAULT_ALLOWED_ORIGINS = [
  'https://jarvis.fernandes.lat',
  'http://127.0.0.1:18800',
  'http://localhost:18800',
];

const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export default {
  port: 18800,
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  gatewayUrl: 'ws://127.0.0.1:18789',
  gatewayPassword: process.env.GATEWAY_PASSWORD,
  gatewayToken: process.env.GATEWAY_TOKEN,

  // WS limits
  wsMaxPayloadBytes: parseInt(process.env.WS_MAX_PAYLOAD_BYTES || String(5 * 1024 * 1024), 10),

  // HTTP rate limiting (per IP)
  httpRateLimitWindowMs: parseInt(process.env.HTTP_RATE_LIMIT_WINDOW_MS || '60000', 10),
  httpRateLimitMax: parseInt(process.env.HTTP_RATE_LIMIT_MAX || '120', 10),

  // Local health checker (off by default — Ollama not installed on VPS2)
  localHealthEnabled: process.env.LOCAL_HEALTH_ENABLED === 'true',

  // WS upgrade hardening
  allowedOrigins: envOrigins.length ? envOrigins : DEFAULT_ALLOWED_ORIGINS,
  // Allow PWA standalone mode (often sends Origin: null)
  allowNullOrigin: process.env.ALLOW_NULL_ORIGIN !== 'false',
  // Auth brute-force protection (per remote IP)
  authMaxAttempts: parseInt(process.env.AUTH_MAX_ATTEMPTS || '5', 10),
  authWindowMs: parseInt(process.env.AUTH_WINDOW_MS || '60000', 10),
  authLockoutMs: parseInt(process.env.AUTH_LOCKOUT_MS || '300000', 10),

  // JWT (PWA ↔ relay only — NOT used to talk to the gateway)
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  jwtIssuer: 'jarvis-pwa-relay',
  // Set to 'false' to disable the legacy raw-password path on /pwa/ws
  acceptLegacyPassword: process.env.ACCEPT_LEGACY_PASSWORD !== 'false',

  // Event buffer
  maxEvents: 2000,
  maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
  rateLimitWindowMs: 60000,
  maxReplayPerMinute: 500,

  // VAPID
  vapidKeys,
  vapidSubject: process.env.VAPID_EMAIL,

  // File paths
  subscriptionsPath: SUBSCRIPTIONS_PATH,
  openclawDir: OPENCLAW_DIR,

  // Local health checker (Qwen2.5 via Ollama)
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:1.5b',
  healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '60000', 10),
  healthCheckTimeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '10000', 10),

  // Agent model config (set via env vars or ~/.openclaw/agent-models.json)
  chatModel: process.env.CHAT_MODEL || null,
  heartbeatModel: process.env.HEARTBEAT_MODEL || null,
  proxmoxModel: process.env.PROXMOX_MODEL || null,
};
