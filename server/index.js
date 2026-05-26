import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import EventBuffer from './event-buffer.js';
import GatewayClient from './gateway-client.js';
import PushManager from './push-manager.js';
import { categorize, extractText } from './category-filter.js';
import LocalHealthChecker from './local-health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

// Initialize
const eventBuffer = new EventBuffer();
const gatewayClient = new GatewayClient(eventBuffer);
const pushManager = new PushManager();
const localHealth = new LocalHealthChecker(gatewayClient);

// Track connected PWA clients and their visibility
const pwaClients = new Map(); // id -> { ws, isVisible }
const pendingRequests = new Map(); // requestId -> clientId
const runCompleteTimers = new Map();

// Express app
const app = express();
app.use(express.json());

// API routes
function apiRoutes(router) {
  router.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      gateway: gatewayClient.isReady() ? 'connected' : 'disconnected',
      gatewayMetrics: gatewayClient.getMetrics(),
      pwaClients: pwaClients.size,
      buffer: eventBuffer.getStats(),
      localHealth: localHealth.getVerdict(),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/api/vapid-public-key', (req, res) => {
    res.json({ publicKey: pushManager.getPublicKey() });
  });

  router.get('/api/balance', async (req, res) => {
    let apiKey = null;
    try {
      const oc = JSON.parse(fs.readFileSync(path.join(config.openclawDir, 'openclaw.json'), 'utf-8'));
      apiKey = oc?.models?.providers?.openrouter?.apiKey || null;
    } catch {}
    if (!apiKey) {
      return res.status(503).json({ error: 'OpenRouter API key not configured' });
    }
    try {
      const response = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Upstream API error' });
      }
      const data = await response.json();
      const d = data?.data || {};
      const totalCredits = d.total_credits ?? 0;
      const totalUsage = d.total_usage ?? 0;
      res.json({
        provider: 'openrouter',
        balance: Math.max(0, totalCredits - totalUsage),
        totalCredits,
        totalUsage,
      });
    } catch (err) {
      console.error('[API] Balance fetch failed:', err.message);
      res.status(500).json({ error: 'Failed to fetch balance' });
    }
  });

  router.get('/api/models', (req, res) => {
    // Read openclaw.json for primary model + model name lookup table
    let primary = 'unknown';
    const nameMap = {}; // "provider/model-id" -> friendly name
    try {
      const oc = JSON.parse(fs.readFileSync(path.join(config.openclawDir, 'openclaw.json'), 'utf-8'));
      primary = oc?.agents?.defaults?.model?.primary || 'unknown';
      // Build name map from all configured providers
      const providers = oc?.models?.providers || {};
      for (const [providerKey, provider] of Object.entries(providers)) {
        for (const m of (provider.models || [])) {
          if (m.id && m.name) nameMap[`${providerKey}/${m.id}`] = m.name;
        }
      }
    } catch {}

    const resolveName = (modelId) => nameMap[modelId] || modelId;

    // Read per-job models from cron/jobs.json
    const jobModels = {};
    try {
      const jobs = JSON.parse(fs.readFileSync(path.join(config.openclawDir, 'cron', 'jobs.json'), 'utf-8'));
      const list = Array.isArray(jobs) ? jobs : (jobs.jobs || []);
      for (const job of list) {
        const model = job?.payload?.model || primary;
        jobModels[job.name] = model;
      }
    } catch {}

    const resolve = (modelId) => resolveName(modelId || primary);

    res.json({
      chat:            resolve(primary),
      heartbeatCron:   resolve(jobModels['Hourly Heartbeat']),
      heartbeatScript: config.ollamaModel, // PWA relay local health checker (Ollama)
      watchdog:        resolve(jobModels['MCP Server Watchdog']),
      newsBot:         resolve(jobModels['Daily AI & Tech News']),
      proxmoxReport:   resolve(jobModels['Proxmox Daily Report']),
      orderMonitor:    resolve(jobModels['Daily Reminders']),
      proxmoxSecurity: resolve(jobModels['Proxmox Security Updates']),
      source: 'live',
    });
  });

  router.post('/api/push/subscribe', (req, res) => {
    const { clientId, subscription } = req.body;
    if (!clientId || !subscription?.endpoint) {
      return res.status(400).json({ error: 'Missing clientId or subscription' });
    }
    pushManager.registerSubscription(clientId, subscription);
    res.json({ ok: true });
  });

}

apiRoutes(app);
const pwaRouter = express.Router();
apiRoutes(pwaRouter);
app.use('/pwa', pwaRouter);

// Serve static files
app.use('/pwa', express.static(distDir));
app.use(express.static(distDir));

// SPA fallback
const spaFallback = (req, res, next) => {
  if (path.extname(req.path) || req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(distDir, 'index.html'));
};
app.use('/pwa', spaFallback);
app.use(spaFallback);

// HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ 
  noServer: true,
  maxPayload: 150 * 1024 * 1024 // 150MB limit
});

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/pwa/ws' || pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const lastSeq = parseInt(url.searchParams.get('lastSeq') || '0', 10);
  const clientId = `pwa-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  console.log(`[WS] New connection: ${clientId}, lastSeq: ${lastSeq}`);

  let authenticated = false;
  ws.isAlive = true;
  let isVisible = true; // Assume visible on connect

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    ws.isAlive = true;
    try {
      const msg = JSON.parse(data.toString());

      // Visibility update
      if (msg.type === 'visibility') {
        isVisible = msg.visible;
        if (authenticated) {
          pwaClients.set(clientId, { ws, isVisible });
        }
        return;
      }

      // Auth: client sends { type: "auth", password: "..." }
      if (msg.type === 'auth') {
        if (msg.password === config.gatewayPassword) {
          authenticated = true;
          pwaClients.set(clientId, { ws, isVisible });
          ws.send(JSON.stringify({ type: 'auth', ok: true }));
          console.log(`[WS] ${clientId} authenticated`);
          sendGatewayStatusTo(ws);

          // Replay missed events
          const stats = eventBuffer.getStats();
          if (lastSeq > stats.newestSeq) {
            console.log(`[WS] ${clientId} lastSeq (${lastSeq}) ahead of buffer (${stats.newestSeq}), triggering client reset`);
            ws.send(JSON.stringify({ type: 'buffer-reset', newestSeq: stats.newestSeq }));
          }

          // Replay if client is behind OR if we just sent a reset (since getEventsSince handles the reset case)
          if (lastSeq !== stats.newestSeq) {
            const missed = eventBuffer.getEventsSince(lastSeq, clientId);
            console.log(`[WS] Replaying ${missed.length} events for ${clientId}`);
            for (const event of missed) {
              const replayMsg = {
                type: event.type,
                event: event.event,
                seq: event.bufferSeq,
                timestamp: event.timestamp,
                payload: event.payload,
                _replayed: true,
              };
              // Preserve res-specific fields for proper client-side handling
              if (event.type === 'res') {
                if (event.id !== undefined) replayMsg.id = event.id;
                if (event.ok !== undefined) replayMsg.ok = event.ok;
                if (event.method !== undefined) replayMsg.method = event.method;
                if (event.error !== undefined) replayMsg.error = event.error;
              }
              ws.send(JSON.stringify(replayMsg));
            }
          }
        } else {
          ws.send(JSON.stringify({ type: 'auth', ok: false, error: 'Invalid password' }));
          ws.close();
        }
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
        return;
      }

      // Forward requests to gateway (chat.send, etc.)
      if (msg.type === 'req') {
        console.log(`[WS] ${clientId} forwarding req: method=${msg.method}, id=${msg.id}`);
        pendingRequests.set(msg.id, clientId);
        const sent = gatewayClient.send(msg);
        console.log(`[WS] Forward result: ${sent}`);
      }
    } catch (err) {
      console.error(`[WS] ${clientId} message error:`, err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] ${clientId} disconnected`);
    pwaClients.delete(clientId);
    // Rate limit data will expire naturally based on window
    for (const [reqId, cId] of pendingRequests) {
      if (cId === clientId) pendingRequests.delete(reqId);
    }
  });

  ws.on('error', () => {
    pwaClients.delete(clientId);
  });
});

// Ping all PWA clients
const pingInterval = setInterval(() => {
  for (const [id, client] of pwaClients) {
    if (!client.ws.isAlive) {
      console.log(`[WS] ${id} dead (no pong), terminating`);
      pwaClients.delete(id);
      client.ws.terminate();
      continue;
    }
    client.ws.isAlive = false;
    client.ws.ping();
  }
}, 15000);

// Forward events
gatewayClient.on('event', (event) => {
  const enrichedEvent = { ...event };
  if (event.bufferSeq) enrichedEvent.seq = event.bufferSeq;
  const data = JSON.stringify(enrichedEvent);

  let visibleCount = 0;
  for (const [id, client] of pwaClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(data);
        if (client.isVisible) visibleCount++;
      } catch {}
    }
  }

  // Handle exec approval requests - also send push notification if no visible clients
  if (event.event === 'exec.approval.requested') {
    console.log(`[Relay] Approval request received: ${event.payload?.approvalId}`);
    if (visibleCount === 0) {
      // App is in background - send push notification
      const { command, agentId, approvalId } = event.payload || {};
      const truncated = command && command.length > 100 ? command.substring(0, 97) + '...' : (command || 'Unknown command');
      pushManager.sendToAll({
        title: 'Jarvis: Approval Required',
        body: `Agent "${agentId}" requests exec: ${truncated}`,
        category: 'approval',
        tag: `approval-${approvalId}`,
        url: '/pwa/',
        requireInteraction: true,
        data: {
          approvalId,
          command,
          agentId,
          category: 'approval',
        },
      });
    }
    return;
  }

  // Agent action events mean the run is still active — cancel pending run.complete for this run only
  if (event.event === 'agent') {
    const stream = event.payload?.stream;
    const runId = event.payload?.runId;
    if ((stream === 'tool_call' || stream === 'tool_result' || stream === 'subagent' || stream === 'shell' || stream === 'thinking') && runId) {
      clearTimeout(runCompleteTimers.get(runId));
      runCompleteTimers.delete(runId);
    }
  }

  if (event.event === 'chat') {
    const runId = event.payload?.runId;
    // Cancel any pending run.complete for this runId — agent is still active
    clearTimeout(runCompleteTimers.get(runId));
    runCompleteTimers.delete(runId);
    if (event.payload?.state === 'final') {
      const sessionKey = event.payload?.sessionKey;
      // 500ms debounce: if no new chat event arrives, broadcast run.complete
      runCompleteTimers.set(runId, setTimeout(() => {
        runCompleteTimers.delete(runId);
        console.log(`[Relay] run.complete firing for runId=${runId}`);
        const completeMsg = JSON.stringify({ type: 'event', event: 'run.complete', payload: { runId, sessionKey } });
        for (const [id, client] of pwaClients) {
          if (client.ws.readyState === WebSocket.OPEN) {
            try { client.ws.send(completeMsg); } catch {}
          }
        }
      }, 500));

      // Push notification when app is in background
      if (visibleCount > 0) return;
      const text = extractText(event);
      if (text.trim()) {
        const category = categorize(event);
        const truncated = text.length > 200 ? text.substring(0, 197) + '...' : text;
        const title = category === 'alert' ? 'Jarvis Alert' : (category === 'report' ? 'Jarvis Report' : 'Jarvis');
        pushManager.sendToAll({ 
          title, 
          body: truncated, 
          category, 
          tag: category, 
          url: '/pwa/', 
          data: { 
            event: enrichedEvent, // Full event for PWA reconstruction
            category,
          } 
        });
      }
    }
  }
});

// Forward responses
gatewayClient.on('response', (msg) => {
  const enrichedMsg = { ...msg };
  if (msg.bufferSeq) enrichedMsg.seq = msg.bufferSeq;
  const data = JSON.stringify(enrichedMsg);

  // If a session reset was successful, we MUST clear the relay buffer
  // so that other clients don't replay old history from us.
  if (msg.method === 'sessions.reset' && msg.ok) {
    console.log('[Relay] Global session reset successful, clearing event buffer');
    eventBuffer.clear();
    // Broadcast buffer-reset to all clients so they align their lastSeq
    const resetMsg = JSON.stringify({ type: 'buffer-reset', newestSeq: 0 });
    for (const [id, client] of pwaClients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(resetMsg);
      }
    }
  }

  const originClientId = pendingRequests.get(msg.id);
  if (originClientId) {
    pendingRequests.delete(msg.id);
    const client = pwaClients.get(originClientId);
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
      return;
    }
  }

  // Fallback: origin unknown or disconnected — broadcast
  for (const [id, client] of pwaClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try { client.ws.send(data); } catch {}
    }
  }
});

// Start
server.listen(config.port, () => {
  console.log(`[Relay] Server running on port ${config.port}`);
});

function broadcastGatewayStatus(connected) {
  const msg = JSON.stringify({ type: 'gateway-status', connected });
  for (const [id, client] of pwaClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try { client.ws.send(msg); } catch {}
    }
  }
}

gatewayClient.on('authenticated', () => broadcastGatewayStatus(true));
gatewayClient.on('disconnected', () => broadcastGatewayStatus(false));

// Also send current gateway status to a newly connected PWA client
function sendGatewayStatusTo(ws) {
  try { ws.send(JSON.stringify({ type: 'gateway-status', connected: gatewayClient.isReady() })); } catch {}
}

gatewayClient.connect();
setTimeout(() => localHealth.start(), 5000); // allow gateway connection to begin

// Graceful shutdown
const shutdown = () => {
  console.log('[Relay] Shutting down...');
  clearInterval(pingInterval);
  localHealth.stop();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
