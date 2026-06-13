// WebSocket client for PWA ↔ Relay communication
export class WSClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.lastSeq = parseInt(localStorage.getItem('openclaw-lastSeq') || '0', 10);
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.shouldReconnect = true;
    this.connected = false;
    this.authenticated = false;
    this._keepSeqOnBufferReset = false;
    
    // Independent Session Key
    this.sessionKey = localStorage.getItem('openclaw-sessionKey');
    if (!this.sessionKey) {
      this.sessionKey = `agent:main:pwa-${crypto.randomUUID().split('-')[0]}`;
      localStorage.setItem('openclaw-sessionKey', this.sessionKey);
    }
    console.log(`[WS] Instance sessionKey: ${this.sessionKey}`);
  }

  // `credential` is a JWT (preferred) or a raw gateway password (legacy).
  // It's sent verbatim to the relay; the relay accepts either form.
  connect(credential) {
    this.credential = credential;
    this.shouldReconnect = true;
    this._connect();
  }

  _connect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/pwa/ws?lastSeq=${this.lastSeq}`;
    console.log('[WS] Connecting to', url);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[WS] Connected, authenticating...');
      this.connected = true;
      this.reconnectDelay = 1000;
      // A JWT looks like xxx.yyy.zzz — that's how the relay decides between
      // the new token path and the legacy password path. Both are accepted
      // by the server while ACCEPT_LEGACY_PASSWORD is on.
      const cred = this.credential;
      const looksLikeJwt = typeof cred === 'string' && cred.split('.').length === 3;
      const payload = looksLikeJwt
        ? { type: 'auth', token: cred }
        : { type: 'auth', password: cred };
      this.ws.send(JSON.stringify(payload));
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        // App-level keep-alive: echo the relay's ping so it sees us alive
        // through the Cloudflare tunnel (native ping/pong frames aren't always
        // proxied). Cheap data frame; not surfaced to the UI.
        if (msg.type === 'ping') { this.send({ type: 'pong' }); return; }

        // Auth response
        if (msg.type === 'auth') {
          if (msg.ok) {
            this.authenticated = true;
            this.dispatchEvent(new CustomEvent('authenticated'));
          } else {
            this.dispatchEvent(new CustomEvent('auth-failed', { detail: msg.error }));
            this.shouldReconnect = false;
            this.ws.close();
          }
          return;
        }

        // Buffer reset (server restart or session reset)
        if (msg.type === 'buffer-reset') {
          const newest = msg.newestSeq || 0;
          if (this._keepSeqOnBufferReset) {
            console.log(`[WS] Buffer reset received after user clear — skipping replay by updating lastSeq to ${newest}`);
            this.lastSeq = newest;
            localStorage.setItem('openclaw-lastSeq', String(this.lastSeq));
            this._keepSeqOnBufferReset = false;
          } else {
            console.log('[WS] Server buffer reset, catching up from 0');
            this.lastSeq = 0;
            localStorage.setItem('openclaw-lastSeq', '0');
          }
          this.dispatchEvent(new CustomEvent('buffer-reset'));
          return;
        }

        // Track seq in-memory for the current session's replay buffer alignment.
        // PERSISTENCE is handled by AppShell via commitSeq() after DB storage.
        if (typeof msg.seq === 'number') {
          // Detect sequence reset (server restarted)
          if (msg.seq < this.lastSeq - 1000) {
            console.log(`[WS] Sequence reset detected: ${this.lastSeq} -> ${msg.seq}`);
            this.lastSeq = msg.seq;
          } else {
            this.lastSeq = Math.max(this.lastSeq, msg.seq);
          }
        }

        // Dispatch event
        this.dispatchEvent(new CustomEvent('message', { detail: msg }));
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this.connected = false;
      this.authenticated = false;
      this.dispatchEvent(new CustomEvent('disconnected'));

      if (this.shouldReconnect) {
        // Full-jitter exponential backoff: spreads reconnects so many tabs/
        // devices dropping at once don't hammer the relay in lockstep.
        const jittered = Math.round(Math.random() * this.reconnectDelay);
        console.log(`[WS] Reconnecting in ${jittered}ms (cap ${this.reconnectDelay}ms)...`);
        setTimeout(() => this._connect(), jittered);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  commitSeq(seq) {
    if (typeof seq === 'number') {
      const stored = parseInt(localStorage.getItem('openclaw-lastSeq') || '0', 10);
      const newSeq = Math.max(stored, seq);
      this.lastSeq = Math.max(this.lastSeq, newSeq);
      localStorage.setItem('openclaw-lastSeq', String(newSeq));
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
      return true;
    }
    return false;
  }

  sendChat(message, attachment = null, sessionKey = this.sessionKey) {
    const id = crypto.randomUUID().toUpperCase();
    const params = {
      sessionKey,
      message,
      idempotencyKey: crypto.randomUUID(),
    };
    if (attachment) params.attachment = attachment;

    const sent = this.send({
      type: 'req',
      id,
      method: 'chat.send',
      params,
    });
    return sent ? id : null;
  }


  resetSession(sessionKey = this.sessionKey) {
    const id = crypto.randomUUID().toUpperCase();
    this.send({
      type: 'req',
      id,
      method: 'sessions.reset',
      params: {
        key: sessionKey
      },
    });
    return id;
  }

  sendVisibility(visible) {
    this.send({ type: 'visibility', visible });
  }

  /**
   * Send exec approval response to gateway
   * @param {string} approvalId - The approval request ID
   * @param {string} decision - 'allow-once', 'allow-always', or 'deny'
   */
  sendApprovalResponse(approvalId, decision) {
    const id = crypto.randomUUID().toUpperCase();
    this.send({
      type: 'req',
      id,
      method: 'exec.approval.resolve',
      params: {
        approvalId,
        decision,
      },
    });
    console.log(`[WS] Sent approval response: ${decision} for ${approvalId}`);
    return id;
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) this.ws.close();
  }
}

export const wsClient = new WSClient();
