import { LitElement, html, css } from 'lit';
import { hapticMedium, hapticLight } from '../services/haptics.js';
import './message-item.js';
import './stream-indicator.js';

export class ChatView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      flex: 1;
      min-height: 0;
      position: relative;
      background: transparent;
    }

    .messages {
      flex: 1;
      overflow-y: scroll;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      padding: 15px 20px;
      padding-bottom: 112px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
      touch-action: pan-y;
      width: 100%;
      box-sizing: border-box;
    }

    .messages::-webkit-scrollbar { width: 4px; }
    .messages::-webkit-scrollbar-thumb { background: rgba(0, 255, 255, 0.2); border-radius: 2px; }

    .input-area-container {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 64px;
      background: #000;
      border-top: 1px solid rgba(0, 255, 255, 0.15);
      z-index: 1050;
      display: flex;
      flex-direction: column;
      transform: translateY(0);
      opacity: 1;
      transition: transform 0.38s cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 0.38s cubic-bezier(0.4, 0, 0.2, 1);
      will-change: transform, opacity;
    }

    .input-area {
      padding: 0 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      height: 44px;
      min-height: 44px;
      box-sizing: border-box;
    }

    .balance-box {
      flex-shrink: 0;
      font-family: var(--f-mono);
      font-size: 18px;
      letter-spacing: 0.5px;
      color: rgba(0, 255, 255, 0.65);
      white-space: nowrap;
      padding-right: 6px;
    }


    @media (min-width: 1024px) {
      .input-area-container {
        position: fixed;
        bottom: 110px;
        left: 0;
        right: 0;
        padding: 0 60px;
        background: #000 !important;
        border-top: 1px solid rgba(0, 255, 255, 0.25);
        z-index: 1000;
      }
      .input-area {
        display: flex;
        align-items: center;
        gap: 15px;
        height: 60px;
      }
      .indicator-container {
        bottom: 170px !important;
      }
      .messages {
        padding-bottom: 210px !important;
      }
    }

    

    input[type="text"] {
      flex: 1;
      background: rgba(0, 255, 255, 0.05);
      border: 1px solid rgba(0, 255, 255, 0.2);
      border-radius: 8px;
      padding: 0 12px;
      height: 40px;
      color: var(--c-primary);
      font-family: var(--f-body);
      font-size: 16px;
      outline: none;
      -webkit-appearance: none;
      box-sizing: border-box;
      display: block;
      min-width: 0;
    }

    input[type="text"]:focus {
      border-color: var(--c-primary);
      background: rgba(0, 255, 255, 0.1);
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--c-text-dim);
      font-family: var(--f-mono);
      opacity: 0.5;
      padding: 60px 0;
    }
    
    .logo-spin {
      width: 50px; height: 50px;
      border: 2px solid var(--c-primary);
      border-radius: 50%;
      border-top-color: transparent;
      animation: spin 3s linear infinite;
      margin-bottom: 20px;
    }
    
    @keyframes spin { to { transform: rotate(360deg); } }

    .scroll-bottom-btn {
      position: absolute;
      bottom: 114px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 30, 40, 0.92);
      border: 1px solid var(--c-primary);
      color: var(--c-primary);
      border-radius: 24px;
      padding: 12px 22px;
      min-height: 44px;
      box-sizing: border-box;
      font-family: var(--f-mono);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1.5px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      z-index: 40;
      backdrop-filter: blur(15px);
      box-shadow: 0 0 25px rgba(0, 255, 255, 0.25), 0 4px 12px rgba(0, 0, 0, 0.5);
      transition: bottom 0.3s ease, opacity 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, 15px) scale(0.9);
      -webkit-tap-highlight-color: transparent;
    }

    .scroll-bottom-btn:active {
      background: rgba(0, 255, 255, 0.15);
    }

    .scroll-bottom-btn.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, 0) scale(1);
    }

    

    .indicator-container {
      position: absolute;
      bottom: 108px;
      left: 0;
      width: 100%;
      z-index: 25;
      pointer-events: none;
      transition: bottom 0.38s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .skeleton-message {
      width: 70%;
      height: 40px;
      background: rgba(0, 255, 255, 0.05);
      border: 1px solid rgba(0, 255, 255, 0.1);
      border-radius: 8px;
      margin-bottom: 12px;
      position: relative;
      overflow: hidden;
    }

    .skeleton-message::after {
      content: '';
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(0, 255, 255, 0.1), transparent);
      animation: skeleton-sweep 1.5s infinite;
    }

    .refresh-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px;
      color: var(--c-primary);
      font-family: var(--f-mono);
      font-size: 10px;
      letter-spacing: 2px;
      opacity: 0;
      transition: opacity 0.3s;
    }

    .refresh-indicator.visible {
      opacity: 0.6;
    }
  `;

  static properties = {
    messages: { type: Array },
    thinking: { type: Boolean },
    streaming: { type: Boolean },
    agentStatus: { type: String },
    loading: { type: Boolean },
    balance: { type: Number },
    _showScrollBtn: { type: Boolean, state: true },
    _isPulling: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.thinking = false;
    this.streaming = false;
    this.agentStatus = 'Thinking';
    this._touchStartY = 0;
    this._isAutoScrolling = false;
    this._showScrollBtn = false;
    this._isPulling = false;
    this.loading = false;
    this._userScrolledUp = false;
    this._initialLoadDone = false;
  }

  firstUpdated() {
    const el = this.shadowRoot.querySelector('.messages');
    setTimeout(() => this.scrollToBottom(false), 50);

    el.addEventListener('scroll', () => {
      if (this._isAutoScrolling) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      this._showScrollBtn = distFromBottom > 300;
      this._userScrolledUp = distFromBottom > 50;
    }, { passive: true });

    el.addEventListener('touchstart', (e) => {
      this._touchStartY = e.touches[0].clientY;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      const currentY = e.touches[0].clientY;
      const deltaY = currentY - this._touchStartY;
      if (el.scrollTop === 0 && deltaY > 40) {
        this._isPulling = true;
      }
      if (deltaY > 60) {
        const input = this.shadowRoot.querySelector('input[type="text"]');
        if (this.shadowRoot.activeElement === input) {
          input.blur();
          hapticLight();
        }
      }
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      if (this._isPulling) {
        hapticMedium();
        this.dispatchEvent(new CustomEvent('refresh', { bubbles: true, composed: true }));
        this._isPulling = false;
      }
    }, { passive: true });
  }

  updated(changed) {
    if (changed.has('messages')) {
      const oldMessages = changed.get('messages') || [];
      if ((this.messages.length > oldMessages.length || this.streaming) && !this._userScrolledUp) {
        this.scrollToBottom(false);
      }
    }
    if ((changed.has('thinking') && this.thinking) || (changed.has('streaming') && this.streaming)) {
      if (!this._userScrolledUp) this.scrollToBottom(false);
    }
    if (changed.has('loading') && !this.loading) {
      if (!this._initialLoadDone) {
        this._initialLoadDone = true;
        requestAnimationFrame(() => this.scrollToBottom(false));
      } else if (!this._userScrolledUp) {
        this.scrollToBottom(false);
      }
    }
  }

  scrollToBottom(smooth = false) {
    const el = this.shadowRoot.querySelector('.messages');
    if (el) {
      this._isAutoScrolling = true;
      this._showScrollBtn = false;
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      setTimeout(() => { this._isAutoScrolling = false; }, smooth ? 500 : 150);
    }
  }

  _restoreAndScrollToBottom() {
    this._isAutoScrolling = true;
    this._userScrolledUp = false;
    const el = this.shadowRoot.querySelector('.messages');
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    this._showScrollBtn = false;
    setTimeout(() => { this._isAutoScrolling = false; }, 150);
  }

  async _send(e) {
    e.preventDefault();
    const input = this.shadowRoot.querySelector('input[type="text"]');
    const text = input.value.trim();
    if (!text) return;
    hapticMedium();
    this._userScrolledUp = false;
    this.dispatchEvent(new CustomEvent('send-message', { detail: { text }, bubbles: true, composed: true }));
    input.value = '';
    setTimeout(() => this.scrollToBottom(true), 100);
  }

  render() {
    return html`
      <div class="messages">
        <div class="refresh-indicator ${this._isPulling ? 'visible' : ''}">
          // REFRESHING...
        </div>

        ${this.loading ? html`
          <div class="skeleton-message" style="width: 60%"></div>
          <div class="skeleton-message" style="width: 85%; align-self: flex-end; background: rgba(0, 153, 255, 0.05);"></div>
          <div class="skeleton-message" style="width: 40%"></div>
          <div class="skeleton-message" style="width: 75%"></div>
        ` : ''}

        ${!this.loading && this.messages.length === 0 ? html`
          <div class="empty-state">
            <div class="logo-spin"></div>
            <div>// JARVIS ONLINE</div>
            <div>WAITING FOR COMMAND</div>
          </div>
        ` : ''}
        
        ${this.messages.map(m => html`
          <message-item
            .msgId=${m.id}
            .role=${m.role}
            .text=${m.text}
            .timestamp=${m.timestamp}
            .seen=${m.seen}
            .attachment=${m.attachment}
            .streaming=${m.streaming === true}
            .status=${m.status || null}
          ></message-item>
        `)}
      </div>

      ${this.thinking ? html`
        <div class="indicator-container">
          <stream-indicator mode="thinking" .label=${this.agentStatus}></stream-indicator>
        </div>
      ` : ''}

      <div class="scroll-bottom-btn ${this._showScrollBtn ? 'visible' : ''}" @click=${() => { hapticMedium(); this._restoreAndScrollToBottom(); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
        <span>NEW MESSAGES</span>
      </div>

      <div class="input-area-container">
        <form class="input-area" @submit=${this._send}>
          <input type="text" placeholder="ENTER COMMAND..." autocomplete="off">
          ${this.balance !== null && this.balance !== undefined ? html`
            <div class="balance-box">$${this.balance.toFixed(2)}</div>
          ` : ''}
        </form>
      </div>
    `;
  }
}

customElements.define('chat-view', ChatView);
