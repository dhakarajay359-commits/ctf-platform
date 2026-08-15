(function() {
  if (window.__chatInitialized) return;
  
  async function initChat() {
    // Only show on non-admin pages
    if (window.location.pathname.startsWith('/admin') || window.location.pathname.endsWith('/admin.html')) return;
    if (document.getElementById('chatWidget')) return;
    window.__chatInitialized = true;

    // Helper to safely escape HTML
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Inject Chat UI
    const chatWidget = document.createElement('div');
    chatWidget.id = 'chatWidget';
    chatWidget.innerHTML = `
      <div id="chatIcon" class="chat-icon" title="Support Comms">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <div id="chatBadge" class="notif-badge hidden"></div>
      </div>
      <div id="chatPanel" class="chat-panel hidden">
        <div class="chat-header">
          <h3 id="chatTitle">SYNDICATE COMMS</h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="chatClearBtn" title="Wipe chat history" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px; padding: 2px 4px; transition: color 0.2s;" onmouseover="this.style.color='#ff5252'" onmouseout="this.style.color='var(--text-muted)'">🗑️</button>
            <button id="chatCloseBtn" aria-label="Close Chat">&times;</button>
          </div>
        </div>
        <div id="chatMessages" class="chat-messages">
          <div class="chat-msg admin-msg">
            <div style="font-size: 10px; opacity: 0.8; margin-bottom: 2px;">🛡️ System Support</div>
            <div>Welcome to the CTF! If you need a hint or technical support, drop a message here.</div>
          </div>
        </div>
        <div class="chat-input-area" style="display: flex; flex-direction: column; gap: 4px;">
          <select id="chatAliasSelect" class="hidden" style="background: rgba(10,14,20,0.8); color: var(--primary); border: 1px solid var(--border-color); font-family: var(--mono); font-size: 11px; padding: 4px; border-radius: 4px;"></select>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="chatInput" placeholder="Type message..." style="flex: 1; border-radius: 4px; padding: 8px 12px; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); color: #fff; outline: none;">
            <button id="chatSendBtn" class="btn-primary" style="padding: 0 16px; cursor: pointer;">Send</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(chatWidget);

    const chatIcon = document.getElementById('chatIcon');
    const chatPanel = document.getElementById('chatPanel');
    const chatBadge = document.getElementById('chatBadge');
    const chatMessages = document.getElementById('chatMessages');
    const chatCloseBtn = document.getElementById('chatCloseBtn');
    const chatClearBtn = document.getElementById('chatClearBtn');
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');

    if (chatClearBtn) {
      chatClearBtn.onclick = async () => {
        if (!confirm('Wipe chat history for this session?')) return;
        try {
          const res = await fetch('/api/chat/messages', { method: 'DELETE' });
          if (res.ok) {
            chatMessages.innerHTML = `
              <div class="chat-msg admin-msg">
                <div style="font-size: 10px; opacity: 0.8; margin-bottom: 2px;">🛡️ System Support</div>
                <div>Chat history wiped.</div>
              </div>
            `;
          }
        } catch (err) {
          console.error('Error clearing chat:', err);
        }
      };
    }

    // Toggle Panel
    chatIcon.onclick = () => {
      chatPanel.classList.toggle('hidden');
      chatBadge.classList.add('hidden');
      scrollToBottom();
      if (!chatPanel.classList.contains('hidden')) {
        chatInput.focus();
      }
    };
    chatCloseBtn.onclick = () => {
      chatPanel.classList.add('hidden');
    };

    function scrollToBottom() {
      if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    }

    function appendMessage(msg) {
      if (!chatMessages) return;
      const isAdmin = msg.is_from_admin === 1 || msg.is_from_admin === true;
      const div = document.createElement('div');
      div.className = 'chat-msg ' + (isAdmin ? 'admin-msg' : 'user-msg');
      const timeStr = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      
      div.innerHTML = `
        <div style="font-size: 10px; opacity: 0.8; margin-bottom: 2px;">
          ${isAdmin ? '🛡️ Admin Support' : 'You'} ${timeStr ? `• ${timeStr}` : ''}
        </div>
        <div style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(msg.text)}</div>
      `;
      chatMessages.appendChild(div);
      scrollToBottom();
    }

    // Load past chat only if logged in
    try {
      const authRes = await fetch('/api/auth/me');
      const authData = await authRes.json();
      if (!authData.team && !authData.isAdmin) {
        chatWidget.style.display = 'none';
        return;
      }

      if (authData.team && authData.team.operative_type === 'Syndicate') {
        const aliasSelect = document.getElementById('chatAliasSelect');
        if (aliasSelect) {
          aliasSelect.classList.remove('hidden');
          const roster = authData.team.roster || [];
          for (let i = 0; i < (authData.team.members_count || 2); i++) {
            const val = roster[i] || `Operative ${i + 1}`;
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            aliasSelect.appendChild(opt);
          }
        }
      }

      const res = await fetch('/api/chat/messages');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          data.forEach(appendMessage);
        }
      }
    } catch (e) {
      console.warn('Chat initialization notice:', e);
    }

    const fbSocket = typeof io !== 'undefined' ? (window.fbSocket || (window.fbSocket = io())) : null;

    if (fbSocket) {
      fbSocket.on('chat:receive', (msg) => {
        appendMessage(msg);
        if (chatPanel && chatPanel.classList.contains('hidden')) {
          chatBadge.classList.remove('hidden');
        }
      });

      function sendMessage() {
        let text = chatInput.value.trim();
        if (!text) return;

        const aliasSelect = document.getElementById('chatAliasSelect');
        if (aliasSelect && !aliasSelect.classList.contains('hidden') && aliasSelect.value) {
          text = `[${aliasSelect.value}] ${text}`;
        }

        fbSocket.emit('chat:send', { text });
        chatInput.value = '';
      }

      chatSendBtn.onclick = sendMessage;
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    initChat();
  }
})();
