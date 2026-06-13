import config from './config.js';

export default class EventBuffer {
  constructor() {
    this.buffer = [];
    this.nextSeq = 1;
    this.clientReplayCounts = new Map();
  }

  addEvent(event) {
    const bufferSeq = this.nextSeq++;
    const timestamp = Date.now();
    const gatewaySeq = (typeof event.seq === 'number') ? event.seq : bufferSeq;

    const bufferedEvent = {
      seq: gatewaySeq,
      bufferSeq,
      timestamp,
      type: event.type,
      event: event.event,
      payload: event.payload,
    };

    // Preserve res-specific fields so replayed responses aren't stripped
    if (event.type === 'res') {
      if (event.id !== undefined) bufferedEvent.id = event.id;
      if (event.ok !== undefined) bufferedEvent.ok = event.ok;
      if (event.method !== undefined) bufferedEvent.method = event.method;
      if (event.error !== undefined) bufferedEvent.error = event.error;
    }

    // Attach bufferSeq and timestamp to the original event for immediate use by GatewayClient listeners
    event.bufferSeq = bufferSeq;
    event.timestamp = timestamp;

    this.buffer.push(bufferedEvent);
    this._cleanup();
    return gatewaySeq;
  }

  getEventsSince(lastSeq, clientId) {
    if (!this._checkRateLimit(clientId)) {
      console.log(`[EventBuffer] Rate limit exceeded for ${clientId}`);
      return [];
    }

    const oldest = this.buffer.length > 0 ? this.buffer[0].bufferSeq : 0;
    const newest = this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].bufferSeq : 0;

    let effectiveLastSeq = lastSeq;
    // If client's lastSeq is in the future (server restarted), reset to catch up from buffer start
    if (lastSeq > newest) {
      console.log(`[EventBuffer] ${clientId} lastSeq (${lastSeq}) ahead of buffer (${newest}), resetting to ${oldest - 1}`);
      effectiveLastSeq = Math.max(0, oldest - 1);
    }

    // Use bufferSeq for more stable replay across gateway restarts/resets
    const missed = this.buffer.filter(e => e.bufferSeq > effectiveLastSeq);
    this._updateRateLimit(clientId, missed.length);
    return missed;
  }

  _cleanup() {
    const cutoff = Date.now() - config.maxAgeMs;
    let filtered = this.buffer.filter(e => e.timestamp >= cutoff);
    if (filtered.length > config.maxEvents) {
      filtered = filtered.slice(-config.maxEvents);
    }
    this.buffer = filtered;
  }

  _checkRateLimit(clientId) {
    const now = Date.now();
    const data = this.clientReplayCounts.get(clientId);
    if (!data) return true;
    if (now - data.windowStart > config.rateLimitWindowMs) return true;
    return data.count < config.maxReplayPerMinute;
  }

  _updateRateLimit(clientId, eventCount) {
    const now = Date.now();
    let data = this.clientReplayCounts.get(clientId);
    if (!data || now - data.windowStart > config.rateLimitWindowMs) {
      data = { windowStart: now, count: eventCount };
    } else {
      data.count += eventCount;
    }
    this.clientReplayCounts.set(clientId, data);
    this._pruneReplayCounts(now);
  }

  // clientReplayCounts is keyed by per-connection clientId, so it grows
  // unbounded as the PWA reconnects over days (the relay can run for weeks).
  // Drop entries whose rate-limit window has lapsed, with a hard size cap as
  // a backstop. Prevents a slow memory creep on a long-lived relay process.
  _pruneReplayCounts(now = Date.now()) {
    for (const [id, d] of this.clientReplayCounts) {
      if (now - d.windowStart > config.rateLimitWindowMs) this.clientReplayCounts.delete(id);
    }
    const CAP = 500;
    if (this.clientReplayCounts.size > CAP) {
      let excess = this.clientReplayCounts.size - CAP;
      for (const id of this.clientReplayCounts.keys()) {
        if (excess-- <= 0) break;
        this.clientReplayCounts.delete(id);
      }
    }
  }

  clear() {
    console.log('[EventBuffer] Clearing all events from buffer');
    this.buffer = [];
    this.nextSeq = 1;
    this.clientReplayCounts.clear();
  }

  getStats() {
    return {
      totalEvents: this.buffer.length,
      oldestSeq: this.buffer.length > 0 ? this.buffer[0].bufferSeq : 0,
      newestSeq: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].bufferSeq : 0,
      nextSeq: this.nextSeq,
    };
  }
}
