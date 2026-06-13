import { LitElement, html, css } from 'lit';
import { hapticMedium } from '../services/haptics.js';

export class MessageItem extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      margin-bottom: 24px;
      font-family: var(--f-body);
      font-size: var(--chat-font-size, 14px);
      line-height: 1.4;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

    .message-container {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 8px;
      position: relative;
      transition: all 0.5s ease;
      box-sizing: border-box;
      word-wrap: break-word;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .text {
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .streaming-cursor {
      display: inline-block;
      width: 2px;
      height: 1em;
      background: var(--c-primary);
      margin-left: 2px;
      vertical-align: text-bottom;
      box-shadow: 0 0 6px var(--c-primary);
      animation: blink-cursor 1s step-end infinite;
    }

    @keyframes blink-cursor {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    
    .role-user {
      align-self: flex-end;
      background: rgba(0, 153, 255, 0.2);
      border: 1px solid rgba(0, 153, 255, 0.4);
      color: var(--chat-user-color, #E0F7FA);
      box-shadow: 0 0 10px rgba(0, 153, 255, 0.1);
    }

    .role-assistant {
      align-self: flex-start;
      background: rgba(0, 20, 30, 0.95);
      border: 1px solid var(--c-primary);
      color: var(--chat-agent-color, var(--c-text));
      box-shadow: 0 0 15px rgba(0, 255, 255, 0.1);
    }
    
    .role-assistant::before {
      content: '';
      position: absolute;
      top: 0; left: 0; width: 4px; height: 100%;
      background: var(--c-primary);
      box-shadow: 0 0 8px var(--c-primary);
    }

    /* Unread Highlight for Assistant Messages */
    .role-assistant.unread {
      border: 1px solid var(--c-primary);
      box-shadow: 0 0 20px rgba(0, 255, 255, 0.3);
      animation: pulse-border 2s infinite;
    }

    @keyframes pulse-border {
      0% { border-color: var(--c-primary-dim); box-shadow: 0 0 10px rgba(0, 255, 255, 0.2); }
      50% { border-color: var(--c-primary); box-shadow: 0 0 25px rgba(0, 255, 255, 0.5); }
      100% { border-color: var(--c-primary-dim); box-shadow: 0 0 10px rgba(0, 255, 255, 0.2); }
    }

    .timestamp-bar {
      font-size: calc(var(--chat-font-size, 14px) * 0.75);
      color: var(--c-primary, #00FFFF);
      font-family: 'Orbitron', sans-serif;
      font-weight: 600;
      padding: 4px 10px 5px 0;
      margin: -6px -10px 10px -10px;
      background: rgba(0, 255, 255, 0.05);
      border: 1px solid rgba(0, 255, 255, 0.25);
      border-radius: 6px 6px 0 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      box-shadow: inset 0 1px 0 rgba(0, 255, 255, 0.1), 0 2px 4px rgba(0, 0, 0, 0.2);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      line-height: 1.2;
    }

    .timestamp-bar .jarvis-label {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
      margin-left: -4px;
    }

    .timestamp-bar .jarvis-label::before {
      content: '';
      width: 5px;
      height: 5px;
      background: var(--c-primary);
      border-radius: 50%;
      box-shadow: 0 0 6px var(--c-primary);
      animation: pulse-dot 2s infinite;
      flex-shrink: 0;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; box-shadow: 0 0 6px var(--c-primary); }
      50% { opacity: 0.5; box-shadow: 0 0 3px var(--c-primary-dim); }
    }

    .timestamp-bar .date-part {
      color: rgba(0, 255, 255, 0.85);
      font-family: var(--f-mono);
      font-size: 0.9em;
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
      text-align: right;
    }

    /* Attachment Styles */
    .attachment-zone {
      margin-bottom: 12px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(0, 255, 255, 0.2);
      background: rgba(0, 0, 0, 0.3);
    }

    .attachment-img {
      display: block;
      width: 100%;
      max-height: 300px;
      object-fit: contain;
      background: #000;
    }

    .attachment-file {
      padding: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--c-primary);
      text-decoration: none;
    }

    .attachment-file svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
      flex-shrink: 0;
    }

    .file-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .file-name {
      font-family: var(--f-mono);
      font-size: 12px;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .file-meta {
      font-family: var(--f-mono);
      font-size: 9px;
      opacity: 0.6;
      text-transform: uppercase;
    }

    .role-user .timestamp-bar {
      display: none;
    }

    .meta {
      font-size: calc(var(--chat-font-size, 14px) * 0.82);
      color: #FFFFFF;
      margin-top: 6px;
      text-align: right;
      font-family: var(--f-mono);
      font-weight: 500;
      opacity: 0.72;
    }

    .action-menu {
      position: fixed;
      background: #00141e;
      border: 1px solid var(--c-primary);
      border-radius: 8px;
      padding: 6px;
      display: flex;
      gap: 6px;
      z-index: 120;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      backdrop-filter: blur(15px);
      box-shadow: 0 0 30px rgba(0, 255, 255, 0.3);
      white-space: nowrap;
      width: max-content;
      transform: translate(-50%, -50%) scale(0.9);
    }

    .action-menu.visible {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, -50%) scale(1);
    }

    .action-btn {
      background: rgba(0, 255, 255, 0.15);
      border: 1px solid rgba(0, 255, 255, 0.4);
      color: var(--c-primary);
      font-family: var(--f-mono);
      font-size: 11px;
      padding: 10px 14px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-radius: 4px;
      white-space: nowrap;
      font-weight: bold;
    }

    .action-btn:active {
      background: rgba(0, 255, 255, 0.1);
    }

    .action-btn.delete {
      color: var(--c-alert);
    }

    .copy-toast {
      position: fixed;
      left: 50%;
      transform: translate(-50%, 0);
      background: var(--c-primary);
      color: #fff;
      font-family: var(--f-mono);
      font-size: 12px;
      font-weight: 900;
      padding: 6px 16px;
      border-radius: 4px;
      opacity: 0;
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      pointer-events: none;
      z-index: 200;
      box-shadow: 0 0 20px rgba(0, 255, 255, 0.4);
      letter-spacing: 1px;
    }

    .copy-toast.visible {
      opacity: 1;
      transform: translate(-50%, -60px);
    }

    .copy-toast.delete {
      background: var(--c-alert);
      color: #fff;
      box-shadow: 0 0 20px rgba(255, 51, 51, 0.4);
    }

    .status-indicator {
      font-family: var(--f-mono);
      font-size: 9px;
      letter-spacing: 1px;
      margin-top: 4px;
      text-align: right;
      opacity: 0.7;
    }

    .status-sending { color: #FFFF00; }
    .status-failed { color: var(--c-alert, #FF3333); font-weight: bold; opacity: 1; }
  `;

  static properties = {
    msgId: { type: Number },
    role: { type: String },
    text: { type: String },
    timestamp: { type: Number },
    seen: { type: Boolean },
    attachment: { type: Object },
    streaming: { type: Boolean },
    status: { type: String },
    _menuOpen: { type: Boolean, state: true },
    _menuX: { type: Number, state: true },
    _menuY: { type: Number, state: true },
    _showCopied: { type: Boolean, state: true },
    _toastText: { type: String, state: true },
    _isDeleteToast: { type: Boolean, state: true },
  };

  constructor() {
    super();
    this.seen = true;
    this.status = null;
    this._menuOpen = false;
    this._menuX = 0;
    this._menuY = 0;
    this._showCopied = false;
    this._toastText = 'COPIED';
    this._isDeleteToast = false;
    this._observer = null;
    this.streaming = false;
  }

  firstUpdated() {
    if (this.role === 'assistant' && !this.seen) {
      this._setupObserver();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Normally torn down in _markAsSeen(); this covers the element leaving the
    // DOM (navigation / chat clear) before it's ever seen, which would
    // otherwise leak one IntersectionObserver per unseen message.
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }

  _setupObserver() {
    this._observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setTimeout(() => this._markAsSeen(), 500);
      }
    }, { threshold: 0.5 });
    this._observer.observe(this.shadowRoot.querySelector('.message-container'));
  }

  _handleMessageClick(e) {
    if (this.role === 'assistant' && !this.seen) {
      this._markAsSeen();
      hapticMedium();
      return;
    }

    this._menuX = e.clientX || 0;
    this._menuY = e.clientY || 0;
    this._menuOpen = !this._menuOpen;
    if (this._menuOpen) hapticMedium();
  }

  async _copy() {
    try {
      await navigator.clipboard.writeText(this.text);
      this._toastText = 'COPIED';
      this._isDeleteToast = false;
      this._showCopied = true;
      this.requestUpdate();
      
      const { hapticSuccess } = await import('../services/haptics.js');
      hapticSuccess();
      
      setTimeout(() => {
        this._showCopied = false;
        this._menuOpen = false;
      }, 1200);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  _delete() {
    this._toastText = 'DELETED';
    this._isDeleteToast = true;
    this._showCopied = true;
    hapticMedium();

    setTimeout(() => {
      this.dispatchEvent(new CustomEvent('delete-message', {
        detail: { id: this.msgId, timestamp: this.timestamp },
        bubbles: true,
        composed: true
      }));
      this._showCopied = false;
      this._menuOpen = false;
    }, 800);
  }

  _markAsSeen() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    
    if (!this.seen) {
      this.seen = true;
      this.dispatchEvent(new CustomEvent('message-seen', {
        detail: { id: this.msgId, timestamp: this.timestamp },
        bubbles: true,
        composed: true
      }));
      this.requestUpdate();
    }
  }

  render() {
    const containerClasses = ['message-container', `role-${this.role}`];
    if (this.role === 'assistant' && !this.seen) {
      containerClasses.push('unread');
    }

    const dateObj = new Date(this.timestamp);
    const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isToday = dateObj.toDateString() === new Date().toDateString();
    const dateString = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const fullDateTime = isToday ? timeString : `${dateString} · ${timeString}`;

    return html`
      <div class="${containerClasses.join(' ')}" @click=${this._handleMessageClick}>
        <div class="copy-toast ${this._showCopied ? 'visible' : ''} ${this._isDeleteToast ? 'delete' : ''}"
             style="left: ${this._menuX}px; top: ${this._menuY}px;">
          ${this._toastText}
        </div>
        ${this.role === 'assistant' ? html`<div class="timestamp-bar"><span class="jarvis-label">Jarvis</span><span class="date-part">${isToday ? timeString : `${dateString} · ${timeString}`}</span></div>` : ''}
        
        ${this.attachment ? html`
          <div class="attachment-zone">
            ${this.attachment.type?.startsWith('image/') ? html`
              <img src="${this.attachment.data}" class="attachment-img" alt="Attachment" loading="lazy">
            ` : html`
              <div class="attachment-file">
                <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                <div class="file-info">
                  <div class="file-name">${this.attachment.name}</div>
                  <div class="file-meta">${this.attachment.type || 'FILE'}</div>
                </div>
              </div>
            `}
          </div>
        ` : ''}

        <div class="text">${this.text}${this.streaming ? html`<span class="streaming-cursor"></span>` : ''}</div>
        ${this.role === 'user' ? html`<div class="meta">${fullDateTime}</div>` : ''}
        ${this.role === 'user' && this.status === 'sending' ? html`<div class="status-indicator status-sending">SENDING...</div>` : ''}
        ${this.role === 'user' && this.status === 'failed' ? html`<div class="status-indicator status-failed">SEND FAILED</div>` : ''}

        <div class="action-menu ${this._menuOpen ? 'visible' : ''}" 
             style="left: ${this._menuX}px; top: ${this._menuY}px;"
             @click=${(e) => e.stopPropagation()}>
          <button class="action-btn" @click=${this._copy}>Copy</button>
          <button class="action-btn delete" @click=${this._delete}>Delete</button>
          <button class="action-btn" @click=${() => this._menuOpen = false}>Close</button>
        </div>
      </div>
      ${this._menuOpen ? html`<div style="position:fixed; inset:0; z-index:90;" @click=${() => this._menuOpen = false}></div>` : ''}
    `;
  }
}

customElements.define('message-item', MessageItem);
