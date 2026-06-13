import { LitElement, html, css } from 'lit';
import { wsClient } from '../services/ws-client.js';
import { getAuth, saveAuth, clearAuth, migrateLegacyIfNeeded } from '../services/auth.js';
import { registerPush, resyncPush } from '../services/push-registration.js';
import { addMessage, getLatest, deleteMessage, markSeen, clearByCategory, clearAll, isTombstoned } from '../services/message-store.js';
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from '../services/haptics.js';
import './splash-screen.js';
import './login-screen.js';
import './chat-view.js';
import './alert-view.js';
import './report-view.js';
import './settings-view.js';
import './nav-bar.js';
import './approval-dialog.js';

const AGENT_SESSION = 'agent:main:main';

function categorize(text) {
  const firstLine = text.trimStart().split('\n')[0];
  if (/^[^\[]{0,10}\[ALERT\]/i.test(firstLine)) return 'alert';
  if (/^[^\[]{0,10}\[REPORT\]/i.test(firstLine)) return 'report';
  return 'chat';
}

function extractText(msg) {
  const content = msg.payload?.message?.content || [];
  return content.filter(c => c.type === 'text').map(c => c.text).join('');
}

export class AppShell extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .app-wrapper {
      display: flex;
      flex-direction: column;
      position: fixed;
      inset: 0;
      width: 100vw;
      background: #000;
      overflow: hidden;
      overflow-x: hidden;
    }

    .header {
      padding-top: env(safe-area-inset-top, 44px);
      height: calc(var(--s-header-h) + env(safe-area-inset-top, 44px));
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-left: 20px;
      padding-right: 20px;
      border-bottom: 1px solid rgba(0, 255, 255, 0.15);
      background: #000;
      z-index: 50;
      flex-shrink: 0;
    }

    .header h1 {
      font-family: var(--f-display);
      font-size: 18px;
      letter-spacing: 2px;
      color: var(--c-primary);
      text-shadow: 0 0 10px var(--c-primary-dim);
      margin: 0;
      flex: 1;
      white-space: nowrap;
    }

    .header h1 span {
      font-size: 10px;
      vertical-align: middle;
      opacity: 0.5;
      font-family: var(--f-mono);
      margin-left: 5px;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .strm-badge {
      font-family: var(--f-mono);
      border: 1px solid rgba(0, 255, 255, 0.4);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      letter-spacing: 1px;
      color: var(--c-primary);
      background: rgba(0, 255, 255, 0.1);
      box-shadow: 0 0 8px rgba(0, 255, 255, 0.2);
    }

    .status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #333;
      box-shadow: 0 0 5px #333;
    }
    .status-dot.online { background: #00FF00; box-shadow: 0 0 8px #00FF00; }
    .status-dot.connecting { background: #FFFF00; box-shadow: 0 0 8px #FFFF00; }

    /* Desktop Enhancements */
    @media (min-width: 1024px) {
      .header {
        height: 60px;
        padding-left: 30px;
        padding-right: 30px;
      }
      .header h1 {
        font-size: 24px;
        letter-spacing: 3px;
      }
      .header h1 span {
        font-size: 12px;
        margin-left: 10px;
      }
      .status {
        gap: 20px;
      }
      .strm-badge {
        font-size: 14px;
        padding: 4px 16px;
        border-width: 1.5px;
        border-radius: 6px;
      }
      .status-dot {
        width: 10px;
        height: 10px;
        box-shadow: 0 0 10px #00FF00;
      }
      .header .status span {
        font-size: 12px !important;
        letter-spacing: 1.5px !important;
      }
    }

    .main-view {
      flex: 1;
      position: relative;
      background: radial-gradient(circle at center, #001111 0%, #000000 100%);
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .bg-grid {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background-image:
        linear-gradient(rgba(0, 255, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 255, 255, 0.03) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
      z-index: 0;
    }

    .view-container {
      flex: 1;
      position: relative;
      display: flex;
      flex-direction: column;
      z-index: 1;
      min-height: 0;
    }

    .view-container.slide-left { animation: slideLeft 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
    .view-container.slide-right { animation: slideRight 0.3s cubic-bezier(0.4, 0, 0.2, 1); }

    .swipe-trail {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: linear-gradient(to bottom, transparent, var(--c-primary), transparent);
      box-shadow: 0 0 15px var(--c-primary);
      z-index: 100;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .swipe-trail.active {
      opacity: 0.4;
    }

    @keyframes slideLeft {
      from { transform: translateX(30px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    @keyframes slideRight {
      from { transform: translateX(-30px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    login-screen {
      flex: 1;
    }

    /* Feedback Banner */
    .feedback-banner {
      position: fixed;
      top: 40%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      background: rgba(0, 20, 30, 0.95);
      border: 1px solid var(--c-primary);
      padding: 20px 40px;
      border-radius: 12px;
      z-index: 10000;
      opacity: 0;
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      box-shadow: 0 0 50px rgba(0, 255, 255, 0.4);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      min-width: 200px;
      backdrop-filter: blur(20px);
    }

    .feedback-banner.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }

    .feedback-banner.error {
      border-color: var(--c-alert);
      box-shadow: 0 0 50px rgba(255, 51, 51, 0.4);
    }

    .feedback-icon {
      width: 80px;
      height: 80px;
      animation: feedback-pulse 1s ease-out;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .feedback-icon svg {
      width: 100%;
      height: 100%;
      fill: #FFFFFF !important;
      filter: drop-shadow(0 0 20px var(--c-primary));
    }

    .feedback-banner.error .feedback-icon svg { 
      fill: #FFFFFF !important;
      filter: drop-shadow(0 0 20px var(--c-alert));
    }

    @keyframes feedback-pulse {
      0% { transform: scale(0.6); opacity: 0; }
      50% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }

    .feedback-text {
      font-family: var(--f-display);
      font-size: 18px;
      letter-spacing: 4px;
      color: #FFF;
      text-transform: uppercase;
      font-weight: 900;
      text-shadow: 0 0 10px var(--c-primary);
    }
  `;

  static properties = {
    view: { type: String },
    loggedIn: { type: Boolean },
    connected: { type: Boolean },
    gatewayConnected: { type: Boolean },
    messages: { type: Array },
    thinking: { type: Boolean },
    streaming: { type: Boolean },
    alertCount: { type: Number },
    reportCount: { type: Number },
    _keyboardOpen: { type: Boolean, reflect: true, attribute: 'keyboard-open' },
    _slideDir: { type: String, state: true },
    _swipeX: { type: Number, state: true },
    _isSwiping: { type: Boolean, state: true },
    _loadingStore: { type: Boolean, state: true },
    _balance: { type: Number, state: true },
    _notification: { type: Object, state: true },
    _pendingApproval: { type: Object, state: true },
    _agentStatus: { type: String, state: true },
    _splashDone: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.view = 'chat';
    this.loggedIn = false;
    this.connected = false;
    this.gatewayConnected = false;
    this.messages = [];
    this.thinking = false;
    this.streaming = false;
    this.alertCount = 0;
    this.reportCount = 0;
    this._keyboardOpen = false;
    this._slideDir = '';
    this._swipeX = 0;
    this._isSwiping = false;
    this._loadingStore = true;
    this._touchStart = null;
    this._boundMouseMove = this._handleMouseMove.bind(this);
    this._boundMouseUp = this._handleMouseUp.bind(this);
    this._wheelAccumulator = 0;
    this._wheelTimeout = null;
    this._isNavigating = false;
    this._balance = null;
    this._balanceInterval = null;
    this._wheelLatched = false;
    this._notification = { visible: false, message: '', type: 'success' };
    this._pendingApproval = null;
    this._splashDone = false;
    this._clearThinkingTimeout = null;
    this._agentStatus = 'Thinking';
    this._streamingIndex = new Map();

    // Explicitly bind listeners to ensure 'this' context is preserved on all platforms
    this._onNavigate = this._onNavigate.bind(this);
    this._onSendMessage = this._onSendMessage.bind(this);
    this._onRefresh = this._onRefresh.bind(this);
    this._onDeleteMessage = this._onDeleteMessage.bind(this);
    this._onClearCategory = this._onClearCategory.bind(this);
    this._onLogin = this._onLogin.bind(this);
    this._onLogout = this._onLogout.bind(this);
    this._onMessageSeen = this._onMessageSeen.bind(this);
    this._onApprovalResponse = this._onApprovalResponse.bind(this);
  }

  _notify(message, type = 'success') {
    this._notification = { visible: true, message, type };
    hapticSuccess();
    setTimeout(() => {
      this._notification = { ...this._notification, visible: false };
    }, 1200);
  }

  connectedCallback() {
    super.connectedCallback();
    this._runSplash();
    this._setupViewport();
    this._setupWebSocket();
    this._checkLogin();
    this._applyGlobalSettings();
    this._handleSharedData();

    this.addEventListener('navigate', this._onNavigate);
    this.addEventListener('send-message', this._onSendMessage);
    this.addEventListener('refresh', this._onRefresh);
    this.addEventListener('delete-message', this._onDeleteMessage);
    this.addEventListener('clear-category', this._onClearCategory);
    this.addEventListener('login', this._onLogin);
    this.addEventListener('logout', this._onLogout);
    this.addEventListener('message-seen', this._onMessageSeen);
    this.addEventListener('approval-response', this._onApprovalResponse);

    this._balanceInterval = setInterval(() => this._fetchBalance(), 30_000);

    window.addEventListener('focus', () => this._clearBadgeAndNotifications());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this._clearBadgeAndNotifications();
      } else {
        wsClient.sendVisibility(false);
      }
    });
    this._clearBadgeAndNotifications();
  }

  _runSplash() {
    // Start fade-out at 700ms, remove at 1050ms (after 350ms CSS transition)
    setTimeout(() => {
      const el = this.shadowRoot?.querySelector('splash-screen');
      if (el) el.classList.add('hiding');
    }, 700);
    setTimeout(() => { this._splashDone = true; }, 1050);
  }

  _handleSharedData() {
    const url = new URL(window.location.href);
    const text = url.searchParams.get('text');
    const sharedUrl = url.searchParams.get('url');
    
    if (text || sharedUrl) {
      const command = (text || '') + (sharedUrl ? '\n' + sharedUrl : '');
      // Wait for app to be ready/connected before sending
      setTimeout(() => {
        if (this.loggedIn && command.trim()) {
          this._onSendMessage({ detail: { text: command.trim() } });
          // Clear URL params without reloading
          window.history.replaceState({}, document.title, '/pwa/');
        }
      }, 1000);
    }
  }


  _clearBadgeAndNotifications() {
    // Report visibility to server for push suppression
    wsClient.sendVisibility(true);

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('clear-badge');
      navigator.serviceWorker.controller.postMessage('clear-notifications');
    }
  }

  _handleTouchStart(e) {
    if (this._keyboardOpen) return;
    this._touchStart = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now()
    };
    this._swipeX = e.touches[0].clientX;
  }

  _handleTouchMove(e) {
    if (!this._touchStart) return;
    this._swipeX = e.touches[0].clientX;
    this._isSwiping = true;
  }

  _handleTouchEnd(e) {
    this._isSwiping = false;
    if (!this._touchStart) return;
    
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = endX - this._touchStart.x;
    const diffY = endY - this._touchStart.y;
    const duration = Date.now() - this._touchStart.time;

    const startX = this._touchStart.x;
    this._touchStart = null;

    // Reject if: too slow (>300ms), too vertical, or starts at screen edges (iOS system gestures)
    if (duration > 300 || Math.abs(diffY) > Math.abs(diffX) || startX < 25 || startX > window.innerWidth - 25) return;

    this._executeSwipe(diffX);
  }

  _handleMouseDown(e) {
    if (this._keyboardOpen) return;
    // Don't trigger if clicking input or buttons
    if (e.target.closest('input, button, select, a')) return;
    
    this._touchStart = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now()
    };
    this._swipeX = e.clientX;
    
    // Add global listeners for mouseup/move to handle dragging outside the element
    window.addEventListener('mousemove', this._boundMouseMove);
    window.addEventListener('mouseup', this._boundMouseUp);
  }

  _handleMouseMove(e) {
    if (!this._touchStart) return;
    this._swipeX = e.clientX;
    this._isSwiping = true;
  }

  _handleMouseUp(e) {
    if (!this._touchStart) return;
    
    const diffX = e.clientX - this._touchStart.x;
    const diffY = e.clientY - this._touchStart.y;
    const duration = Date.now() - this._touchStart.time;

    this._isSwiping = false;
    this._touchStart = null;
    
    window.removeEventListener('mousemove', this._boundMouseMove);
    window.removeEventListener('mouseup', this._boundMouseUp);

    // Desktop/Tab can be a bit more relaxed on duration or verticality if desired
    if (duration > 500 || Math.abs(diffY) > Math.abs(diffX)) return;

    this._executeSwipe(diffX);
  }

  _executeSwipe(diffX) {
    if (this._isNavigating) return;
    const threshold = 60;
    if (Math.abs(diffX) > threshold) {
      const order = ['chat', 'alert', 'report', 'settings'];
      const currentIdx = order.indexOf(this.view);
      
      if (diffX < 0 && currentIdx < order.length - 1) {
        // Swipe Left -> Next Tab (Right)
        this._onNavigate({ detail: order[currentIdx + 1] });
      } else if (diffX > 0 && currentIdx > 0) {
        // Swipe Right -> Prev Tab (Left)
        this._onNavigate({ detail: order[currentIdx - 1] });
      }
    }
  }

  _handleWheel(e) {
    // Completely ignore wheel events while a navigation transition is active
    if (this._isNavigating) {
      this._wheelAccumulator = 0;
      this._wheelLatched = true; // Stay latched during transition
      return;
    }

    // Only handle horizontal swipes
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      this._isSwiping = false;
      return;
    }
    
    // Latch mechanism: if we just navigated, ignore all input until deltaX returns to zero
    // This is the most effective way to kill trackpad inertia.
    if (this._wheelLatched) {
      if (Math.abs(e.deltaX) < 2) {
        this._wheelLatched = false;
      }
      return;
    }

    this._wheelAccumulator += e.deltaX;
    this._isSwiping = true;
    
    // Provide a hint of the swipe trail
    this._swipeX = (window.innerWidth / 2) - (this._wheelAccumulator * 0.5);

    clearTimeout(this._wheelTimeout);
    this._wheelTimeout = setTimeout(() => {
      this._wheelAccumulator = 0;
      this._isSwiping = false;
    }, 150);

    const threshold = 120; // Slightly higher for high-res trackpads
    if (Math.abs(this._wheelAccumulator) > threshold) {
      const dir = this._wheelAccumulator > 0 ? -1 : 1; 
      this._wheelLatched = true; // Lock until fingers stop moving
      this._executeSwipe(dir * 70); 
      this._wheelAccumulator = 0;
      this._isSwiping = false;
    }
  }

  _onMessageSeen(e) {
    const { id, timestamp } = e.detail;
    // Update in-memory state
    this.messages = this.messages.map(m => {
      if ((id && m.id === id) || (timestamp && m.timestamp === timestamp)) {
        return { ...m, seen: true };
      }
      return m;
    });
    // Persist to store if it has an ID
    if (id) markSeen(id);
  }

  _onApprovalResponse(e) {
    const { approvalId, decision } = e.detail;
    console.log(`[AppShell] Approval response: ${decision} for ${approvalId}`);
    
    // Send response to gateway via WebSocket
    wsClient.sendApprovalResponse(approvalId, decision);
    
    // Clear the pending approval
    this._pendingApproval = null;
    
    // Show notification based on decision
    if (decision === 'allow-once' || decision === 'allow-always') {
      this._notify('APPROVAL GRANTED');
    } else if (decision === 'deny') {
      this._notify('EXEC DENIED', 'error');
    }
  }

  _setupViewport() {
    if (window.visualViewport) {
      const handleResize = () => {
        const vv = window.visualViewport;
        const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
        const isKeyboard = keyboardHeight > 150;

        const wrapper = this.shadowRoot.querySelector('.app-wrapper');
        if (wrapper) {
          if (isKeyboard) {
            wrapper.style.height = `${vv.height}px`;
            wrapper.style.bottom = 'auto';
          } else {
            wrapper.style.height = '';
            wrapper.style.bottom = '';
          }
        }

        // Reposition chat input bar above the keyboard so it's never hidden
        const chatView = this.shadowRoot.querySelector('chat-view');
        const inputBar = chatView?.shadowRoot?.querySelector('.input-area-container');
        if (inputBar) {
          if (isKeyboard) {
            // Disable CSS transition during keyboard animation to keep bar in sync
            inputBar.style.transition = 'none';
            inputBar.style.bottom = `${keyboardHeight}px`;
          } else {
            inputBar.style.transition = '';
            inputBar.style.bottom = '';
          }
        }

        if (isKeyboard !== this._keyboardOpen) {
          this._keyboardOpen = isKeyboard;
          if (isKeyboard && this.view === 'chat') {
             setTimeout(() => {
               if(chatView) chatView.scrollToBottom();
             }, 100);
          }
        }
      };

      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
      handleResize();
    }
  }

  _setupWebSocket() {
    wsClient.addEventListener('authenticated', async () => {
      this.connected = true;
      // Report actual visibility so server doesn't assume visible (default) and skip push notifications
      wsClient.sendVisibility(document.visibilityState === 'visible');
      await resyncPush();
      this._fetchBalance();
    });

    wsClient.addEventListener('buffer-reset', () => {
      console.log('[AppShell] Buffer reset detected, updating UI...');
      // We no longer wipe the entire store on buffer-reset to preserve alerts/reports.
      // Robust deduplication in addMessage will handle any replayed events.
      this.messages = [...this.messages]; 
      this._loadStoredMessages();
    });

    wsClient.addEventListener('disconnected', () => {
      this.connected = false;
      this.streaming = false;
      this._clearThinking();
      // Remove in-flight streaming messages — final will recreate via replay
      this.messages = this.messages.filter(m => !m.streaming);
      this._rebuildStreamingIndex();
    });

    wsClient.addEventListener('auth-failed', (e) => {
      this.loggedIn = false;
      clearAuth();
      hapticError();
      const loginEl = this.shadowRoot.querySelector('login-screen');
      if (loginEl) loginEl.setError(e.detail || 'Authentication failed');
    });

    wsClient.addEventListener('message', (e) => {
      this._handleMessage(e.detail);
    });
  }

  async _checkLogin() {
    // Old builds stored the raw password under 'openclaw-auth'. If we find
    // one and there's no JWT yet, swap it for a fresh JWT + derived key
    // before booting the WS — keeps the user logged in across the upgrade.
    await migrateLegacyIfNeeded();
    const token = getAuth();
    if (token) {
      this.loggedIn = true;
      wsClient.connect(token);
      this._loadStoredMessages();
      this._fetchBalance();
    }
  }

  _applyGlobalSettings() {
    const fontSize = localStorage.getItem('settings-font-size') || '16px';
    const userColor = localStorage.getItem('settings-user-color') || '#00FFFF';
    const agentColor = localStorage.getItem('settings-agent-color') || '#E0FFFF';
    
    document.documentElement.style.setProperty('--chat-font-size', fontSize);
    document.documentElement.style.setProperty('--chat-user-color', userColor);
    document.documentElement.style.setProperty('--chat-agent-color', agentColor);
  }

  async _loadStoredMessages() {
    this._loadingStore = true;
    try {
      const raw = await getLatest(200);
      // Filter out messages whose tombstone was created after they were stored (race condition)
      const tombstoneChecks = await Promise.all(raw.map(m => isTombstoned(m)));
      const STALE_THRESHOLD_MS = 30_000;
      const now = Date.now();
      const all = raw.filter((_, i) => !tombstoneChecks[i]).map(m => {
        if (m.status === 'sending' && now - m.timestamp > STALE_THRESHOLD_MS) {
          return { ...m, status: 'failed' };
        }
        return m;
      });
      if (all.length > 0) {
        // Merge with existing messages (like replayed ones) without duplicating.
        // Exclusion logic: skip stored message if ANY of its identifiers is already in memory.
        const currentIds = new Set(this.messages.map(m => m.id).filter(Boolean));
        const currentRunIds = new Set(this.messages.map(m => m.runId).filter(Boolean));
        const currentReqs = new Set(this.messages.map(m => m.requestId).filter(Boolean));

        const newOnes = all.filter(m => {
          if (m.id && currentIds.has(m.id)) return false;
          if (m.runId && currentRunIds.has(m.runId)) return false;
          if (m.requestId && currentReqs.has(m.requestId)) return false;
          return true;
        });

        if (this.messages.length === 0) {
          this.messages = all;
        } else {
          this.messages = [...newOnes, ...this.messages].sort((a, b) => a.timestamp - b.timestamp);
        }
      }
    } catch (err) {
      console.error('Failed to load stored messages:', err);
    } finally {
      this._rebuildStreamingIndex();
      setTimeout(() => { this._loadingStore = false; }, 400);
    }
  }

  _setThinking(status = 'Thinking') {
    clearTimeout(this._clearThinkingTimeout);
    this._agentStatus = status;
    this.thinking = true;
  }

  _clearThinking() {
    clearTimeout(this._clearThinkingTimeout);
    this._clearThinkingTimeout = null;
    this._agentStatus = 'Thinking';
    this.thinking = false;
  }

  _rebuildStreamingIndex() {
    this._streamingIndex.clear();
    this.messages.forEach((m, i) => {
      if (m.streaming && m.runId) this._streamingIndex.set(m.runId, i);
    });
  }

  _handleMessage(msg) {
    if (msg.type === 'gateway-status') return this._handleGatewayStatus(msg);
    if (msg.type === 'res') return this._handleRes(msg);
    if (msg.type !== 'event') return;
    if (msg.event === 'exec.approval.requested') return this._handleApprovalRequest(msg);
    if (msg.event === 'run.complete') return this._handleRunComplete(msg);
    if (msg.event === 'agent') return this._handleAgentEvent(msg);
    if (msg.event === 'chat') return this._handleChatEvent(msg);
  }

  _handleGatewayStatus(msg) {
    this.gatewayConnected = msg.connected;
  }

  _handleRes(msg) {
    if (msg.ok && msg.payload?.status === 'started') {
      this._setThinking();
      const idx = msg.id
        ? this.messages.findLastIndex(m => m.role === 'user' && m.requestId === msg.id)
        : this.messages.findLastIndex(m => m.role === 'user' && m.status === 'sending');
      if (idx !== -1) {
        const updated = [...this.messages];
        updated[idx] = { ...updated[idx], status: 'received', runId: msg.payload?.runId };
        this.messages = updated;
      }
      return;
    }

    if (msg.ok === false) {
      const idx = msg.id
        ? this.messages.findLastIndex(m => m.role === 'user' && m.requestId === msg.id)
        : this.messages.findLastIndex(m => m.role === 'user' && (m.status === 'sending' || m.status === 'received'));
      if (idx !== -1) {
        const updated = [...this.messages];
        updated[idx] = { ...updated[idx], status: 'failed' };
        this.messages = updated;
      }
      return;
    }

    // Handle universal clear
    if (msg.ok && msg.method === 'sessions.reset') {
      console.log('[AppShell] Universal session reset received, clearing chat data');
      this.messages = this.messages.filter(m => m.category === 'alert' || m.category === 'report');
      clearByCategory('chat').catch(err => console.error('Failed to clear chat store:', err));
    }
  }

  _handleApprovalRequest(msg) {
    console.log('[AppShell] Received approval request:', msg.payload);
    const { approvalId, command, agentId, host, timeoutMs } = msg.payload || {};
    this._pendingApproval = {
      approvalId,
      command,
      agentId,
      host,
      timeoutMs: timeoutMs || 60000,
    };
  }

  _handleRunComplete(msg) {
    const msgSessionKey = msg.payload?.sessionKey;
    // Only clear thinking if this is our session (or no sessionKey = legacy)
    if (!msgSessionKey || msgSessionKey === AGENT_SESSION) {
      this._clearThinking();
    }
  }

  _handleAgentEvent(msg) {
    const { stream, data, sessionKey: agentSessionKey } = msg.payload || {};
    const isCurrentSession = !agentSessionKey || agentSessionKey === AGENT_SESSION;
    const isLive = !msg._replayed;
    if (isCurrentSession && isLive) {
      if (stream === 'lifecycle' && data?.phase === 'start') {
        this._agentStatus = 'Initializing';
      } else if (stream === 'thinking') {
        this._setThinking('Reasoning');
      } else if (stream === 'tool_call') {
        const name = data?.toolName || 'tool';
        this._setThinking(`Tool: ${name}`);
      } else if (stream === 'tool_result') {
        this._setThinking('Processing');
      } else if (stream === 'subagent' && data?.action === 'spawn') {
        this._setThinking(`Spawning: ${data?.agentId || 'agent'}`);
      } else if (stream === 'subagent' && data?.action === 'complete') {
        this._setThinking('Processing');
      } else if (stream === 'shell') {
        this._setThinking('Running shell');
      }
    }
  }

  async _handleChatEvent(msg) {
    const payload = msg.payload || {};
    const sessionKey = payload.sessionKey || AGENT_SESSION;
    const state = payload.state;
    const runId = payload.runId;
    const role = payload.message?.role || 'assistant';
    const text = extractText(msg);
    const category = categorize(text);
    const eventTimestamp = msg.timestamp || Date.now();

    // Ignore chat events for other sessions to ensure independence
    // BUT allow reports/alerts from main session, heartbeat session, and cron sessions
    // (any agent:main:* except another PWA session like agent:main:pwa-XXXX)
    const isAgentMainSession = sessionKey.startsWith('agent:main:') &&
      !sessionKey.startsWith('agent:main:pwa-');

    if (sessionKey !== wsClient.sessionKey && !isAgentMainSession) {
      console.log(`[AppShell] Ignoring event for unrelated session: ${sessionKey}`);
      return;
    }

    // Extract attachment from gateway format if present
    let attachment = null;
    const mediaPart = payload.message?.content?.find(c => c.type === 'image' || c.type === 'file');
    if (mediaPart) {
      attachment = {
        name: mediaPart.name || 'file',
        type: mediaPart.type === 'image' ? 'image/png' : (mediaPart.contentType || 'application/octet-stream'),
        data: mediaPart.data || mediaPart.url
      };
    }

    console.log(`[AppShell] Recv Chat: state=${state} runId=${runId} seq=${msg.seq} text="${text.substring(0, 30)}..." replayed=${!!msg._replayed}`);

    if (state === 'delta') {
      // Skip replayed delta if a final for this runId is already in memory
      if (runId && this.messages.some(m => m.runId === runId && m.streaming === false)) return;
      // Skip tombstoned runs — prevents deleted messages flashing during replay
      if (runId && await isTombstoned({ runId })) return;
      this._clearThinking();
      this.streaming = true;
      // Re-lookup after await — array may have shifted
      const existingIdx = this._streamingIndex.has(runId) ? this._streamingIndex.get(runId) : -1;
      if (existingIdx !== -1 && existingIdx < this.messages.length && this.messages[existingIdx]?.runId === runId) {
        const updated = [...this.messages];
        updated[existingIdx] = { ...updated[existingIdx], text, streaming: true };
        this.messages = updated;
      } else {
        this.messages = [...this.messages, { role, text, category, timestamp: eventTimestamp, streaming: true, runId }];
        this._streamingIndex.set(runId, this.messages.length - 1);
      }
    } else if (state === 'final') {
      this.streaming = false;
      // Re-show thinking indicator only for the active PWA session (not cron/background agents)
      // run.complete (from relay) will clear it deterministically; 8s is a safety net.
      if ((sessionKey === AGENT_SESSION || !sessionKey) && !msg._replayed) {
        this._setThinking();
        this._clearThinkingTimeout = setTimeout(() => this._clearThinking(), 8000);
      }

      const finalMsg = { role, text, category, timestamp: eventTimestamp, streaming: false, runId, seq: msg.seq, seen: false, attachment };

      // 1. Tombstone check (ensure deleted messages don't reappear)
      if (await isTombstoned(finalMsg)) {
        console.log(`[AppShell] Ignoring tombstoned message: seq=${msg.seq} runId=${runId}`);
        // Re-lookup after await
        const tombstoneIdx = this._streamingIndex.has(runId) ? this._streamingIndex.get(runId) : -1;
        if (tombstoneIdx !== -1) {
          this.messages = this.messages.filter((_, i) => i !== tombstoneIdx);
          this._streamingIndex.delete(runId);
        }
        return;
      }

      // Re-lookup streaming index after await — array may have shifted
      const existingIdx = this._streamingIndex.has(runId) ? this._streamingIndex.get(runId) : -1;

      // 2. In-memory Deduplication (runId only — seq resets on server restart)
      const isDuplicate = this.messages.some(m =>
        (runId && m.runId === runId && m.streaming === false)
      );
      if (isDuplicate) {
        // Belt-and-suspenders: clean up stale streaming bubble that leaked through
        const staleStreamIdx = this._streamingIndex.has(runId) ? this._streamingIndex.get(runId) : -1;
        if (staleStreamIdx !== -1) {
          this.messages = this.messages.filter((_, i) => i !== staleStreamIdx);
          this._streamingIndex.delete(runId);
        }
        console.log(`[AppShell] Ignoring duplicate: seq=${msg.seq} runId=${runId}`);
        if (typeof msg.seq === 'number') wsClient.commitSeq(msg.seq);
        return;
      }

      if (existingIdx !== -1 && existingIdx < this.messages.length && this.messages[existingIdx]?.runId === runId) {
        const updated = [...this.messages];
        updated[existingIdx] = finalMsg;
        this.messages = updated;
      } else {
        this.messages = [...this.messages, finalMsg];
      }
      this._streamingIndex.delete(runId);

      // 3. Persist
      try {
        const id = await addMessage(finalMsg);
        // Commit seq even if id is null (duplicate in DB)
        if (typeof msg.seq === 'number') wsClient.commitSeq(msg.seq);

        if (id) {
          // Match by runId (stable UUID) — timestamp can collide if two messages arrive same ms
          const matchFn = runId
            ? m => m.runId === runId && m.streaming === false
            : m => m.timestamp === finalMsg.timestamp;
          this.messages = this.messages.map(m => matchFn(m) ? { ...m, id } : m);
        }
      } catch (err) {
        console.error('Failed to store message:', err);
      }

      if (category === 'alert' && this.view !== 'alert') this.alertCount++;
      else if (category === 'report' && this.view !== 'report') this.reportCount++;

      hapticLight();
    }
  }

  async _onLogin(e) {
    const { password } = e.detail;
    try {
      await saveAuth(password);
    } catch (err) {
      hapticError();
      const loginEl = this.shadowRoot.querySelector('login-screen');
      if (loginEl) loginEl.setError(err?.message || 'Login failed');
      return;
    }
    this.loggedIn = true;
    wsClient.connect(getAuth());
    this._loadStoredMessages();
    hapticSuccess();
  }

  _onLogout() {
    clearAuth();
    wsClient.disconnect();
    this.loggedIn = false;
    this.messages = [];
    this.view = 'chat';
    hapticMedium();
  }

  _onNavigate(e) {
    const nextView = e.detail;
    if (nextView === this.view || this._isNavigating) return;

    this._isNavigating = true;
    setTimeout(() => { this._isNavigating = false; }, 500);

    const order = ['chat', 'alert', 'report', 'settings'];
    const oldIdx = order.indexOf(this.view);
    const nextIdx = order.indexOf(nextView);

    this._slideDir = nextIdx > oldIdx ? 'slide-left' : 'slide-right';
    this.view = nextView;

    if (this.view === 'alert') this.alertCount = 0;
    if (this.view === 'report') this.reportCount = 0;
    hapticLight();
    if (this.view === 'chat') {
      setTimeout(() => {
        const cv = this.shadowRoot.querySelector('chat-view');
        if (cv) cv.scrollToBottom();
      }, 50);
    }
  }

  _onSendMessage(e) {
    const { text, attachment, skipWebSocket } = e.detail;
    
    let requestId = null;
    let sendFailed = false;
    if (!skipWebSocket) {
      requestId = wsClient.sendChat(text, attachment);
      if (requestId === null) sendFailed = true;
    }

    const status = skipWebSocket ? 'received' : (sendFailed ? 'failed' : 'sending');
    const userMsg = { 
      role: 'user', 
      text, 
      category: 'chat', 
      timestamp: Date.now(), 
      requestId, 
      status, 
      seen: true,
      attachment,
    };
    this.messages = [...this.messages, userMsg];
    addMessage(userMsg).catch(err => console.error('Failed to store message:', err));
    if (sendFailed) hapticError();
    else hapticMedium();
    setTimeout(() => this._fetchBalance(), 3000);
  }

  async _fetchBalance() {
    try {
      const res = await fetch('/pwa/api/balance');
      const data = await res.json();
      if (data?.provider === 'openrouter' && data.balance != null) {
        this._balance = data.balance;
      }
    } catch (err) {
      console.warn('[AppShell] Balance fetch failed:', err);
    }
  }

  _onRefresh() {
    this._loadStoredMessages();
    this._fetchBalance();
    this._notify('DATA REFRESHED');
    hapticMedium();
  }

  async _onDeleteMessage(e) {
    const { id, timestamp } = e.detail;
    this.messages = this.messages.filter(m => {
      if (id && m.id === id) return false;
      if (timestamp && m.timestamp === timestamp && !m.id) return false;
      return true;
    });
    
    // Always call deleteMessage, it handles missing ID by using timestamp for tombstoning
    await deleteMessage(id, timestamp).catch(err => console.error('Failed to delete message:', err));
    
    this._rebuildStreamingIndex();
    this._notify('MESSAGE DELETED');
    hapticLight();
  }

  async _onClearCategory(e) {
    const category = e.detail;
    console.log(`[AppShell] _onClearCategory received for: ${category}`);
    
        if (category === 'chat') {
          // Clear chat messages AND all user messages from memory using same logic as store
          this.messages = this.messages.filter(m => m.category === 'alert' || m.category === 'report');
    
          // Clear all non-alert/report messages from database
          await clearByCategory('chat').catch(err => console.error('Failed to clear chat:', err));
    
          // Notify the gateway to reset the session buffer/history for this session
          wsClient._keepSeqOnBufferReset = true;
          wsClient.resetSession();
          this._notify('CHAT CLEARED');
        } else {
          this.messages = this.messages.filter(m => m.category !== category);
          await clearByCategory(category).catch(err => console.error('Failed to clear category:', err));
          this._notify(`${category.toUpperCase()}S CLEARED`);
        }    
    hapticMedium();
  }

  render() {
    return html`
      ${!this._splashDone ? html`<splash-screen></splash-screen>` : ''}
      ${this._pendingApproval ? html`
        <approval-dialog
          .approvalId=${this._pendingApproval.approvalId}
          .command=${this._pendingApproval.command}
          .agentId=${this._pendingApproval.agentId}
          .host=${this._pendingApproval.host}
          .timeoutMs=${this._pendingApproval.timeoutMs}
          @approval-response=${this._onApprovalResponse}
        ></approval-dialog>
      ` : ''}

      <div class="app-wrapper">
        ${this._notification.visible ? html`
          <div class="feedback-banner visible ${this._notification.type === 'error' ? 'error' : ''}">
            <div class="feedback-icon">
              ${this._notification.type === 'error' ? html`
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
              ` : html`
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              `}
            </div>
            <div class="feedback-text">${this._notification.message}</div>
          </div>
        ` : ''}

        ${!this.loggedIn ? html`
          <login-screen @login=${this._onLogin}></login-screen>
        ` : html`
          <div class="header">
            <h1>JARVIS <span>v${__APP_VERSION__}</span></h1>
            <div class="status">
              <div class="strm-badge">
                STRM: ${this.messages.length.toString().padStart(3, '0')}
              </div>
              <span style="font-size: 9px; letter-spacing: 1px; color: ${!this.connected ? 'var(--c-alert)' : !this.gatewayConnected ? '#FF9900' : 'var(--c-primary)'}; opacity: 0.8;">
                ${!this.connected ? (this.loggedIn ? 'CONNECTING' : 'OFFLINE') : !this.gatewayConnected ? 'NO GATEWAY' : 'ONLINE'}
              </span>
              <div class="status-dot ${!this.connected ? 'connecting' : !this.gatewayConnected ? 'connecting' : 'online'}" style="${!this.connected ? '' : !this.gatewayConnected ? 'background:#FF9900;box-shadow:0 0 8px #FF9900;' : ''}"></div>
            </div>
          </div>

          ${!this.connected ? html`
            <div style="background: var(--c-alert); color: #fff; font-family: var(--f-mono); font-size: 10px; padding: 4px 10px; text-align: center; letter-spacing: 2px; z-index: 100;">
              // CONNECTION LOST - ATTEMPTING RECONNECT...
            </div>
          ` : ''}

          <div class="main-view" 
               @wheel=${this._handleWheel}
               @mousedown=${this._handleMouseDown}
               @touchstart=${this._handleTouchStart}
               @touchmove=${this._handleTouchMove}
               @touchend=${this._handleTouchEnd}>
            <div class="bg-grid"></div>
            
            <div class="swipe-trail ${this._isSwiping ? 'active' : ''}" 
                 style="left: ${this._swipeX}px;"></div>

            <div class="view-container ${this._slideDir}">
              ${this.view === 'chat' ? html`
                <chat-view
                  .messages=${this.messages.filter(m => m.category === 'chat' || !m.category)}
                  .thinking=${this.thinking}
                  .streaming=${this.streaming}
                  .agentStatus=${this._agentStatus}
                  .loading=${this._loadingStore}
                  .balance=${this._balance}
                ></chat-view>
              ` : ''}
              ${this.view === 'alert' ? html`
                <alert-view .messages=${this.messages}></alert-view>
              ` : ''}
              ${this.view === 'report' ? html`
                <report-view .messages=${this.messages}></report-view>
              ` : ''}
              ${this.view === 'settings' ? html`
                <settings-view></settings-view>
              ` : ''}
            </div>
          </div>

          <nav-bar
            .active=${this.view}
            .alertCount=${this.alertCount}
            .reportCount=${this.reportCount}
            ?keyboard-open=${this._keyboardOpen}
          ></nav-bar>

        `}
      </div>
    `;
  }
}

customElements.define('app-shell', AppShell);
