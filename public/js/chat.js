(function() {
  document.addEventListener('DOMContentLoaded', async () => {
    // Only show on non-admin pages (unless we want admin to have the widget too, but admin has a dashboard)
    if (window.location.pathname === '/admin.html') return;

    // Inject Chat UI
    const chatWidget = document.createElement('div');
    chatWidget.id = 'chatWidget';
    chatWidget.innerHTML = `
      <div id="chatIcon" class="chat-icon">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        <div id="chatBadge" class="notif-badge hidden"></div>
      </div>
      <div id="chatPanel" class="chat-panel hidden">
        <div class="chat-header">
          <h3 id="chatTitle">SYNDICATE COMMS</h3>
          <button id="chatCloseBtn">&times;</button>
        </div>
        <div id="chatMessages" class="chat-messages">
          <div class="chat-msg admin-msg">System: Welcome to the CTF. If you need a hint or technical support, drop a message here!</div>
        </div>
        <div class="chat-input-area" style="display: flex; flex-direction: column; gap: 4px;">
          <select id="chatAliasSelect" class="hidden" style="background: rgba(10,14,20,0.8); color: var(--primary); border: 1px solid var(--border-color); font-family: var(--mono); font-size: 11px; padding: 4px;"></select>
          <div style="display: flex;">
            <input type="text" id="chatInput" placeholder="Type message..." style="flex: 1;">
            <button id="chatSendBtn">Send</button>
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
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');

    // Toggle Panel
    chatIcon.onclick = () => {
      chatPanel.classList.toggle('hidden');
      chatBadge.classList.add('hidden');
      scrollToBottom();
    };
    chatCloseBtn.onclick = () => {
      chatPanel.classList.add('hidden');
    };

    function scrollToBottom() {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function appendMessage(msg) {
      const div = document.createElement('div');
      div.className = 'chat-msg ' + (msg.is_from_admin ? 'admin-msg' : 'user-msg');
      div.textContent = msg.text;
      chatMessages.appendChild(div);
      scrollToBottom();
    }

    // Load past chat only if logged in
    let currentTeamAlias = '';
    try {
      const authRes = await fetch('/api/auth/me');
      const authData = await authRes.json();
      if (!authData.team && !authData.isAdmin) {
        chatWidget.style.display = 'none';
        return;
      }
      
      if (authData.team && authData.team.operative_type === 'Syndicate') {
        const aliasSelect = document.getElementById('chatAliasSelect');
        aliasSelect.classList.remove('hidden');
        const roster = authData.team.roster || [];
        for (let i = 0; i < authData.team.members_count; i++) {
          const val = roster[i] || `Operative ${i+1}`;
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          aliasSelect.appendChild(opt);
        }
      }
      
      const res = await fetch('/api/chat/messages');
      if (res.ok) {
        const data = await res.json();
        data.forEach(appendMessage);
      }
    } catch (e) {}

    const fbSocket = typeof io !== 'undefined' ? io() : null;

    if (fbSocket) {
      fbSocket.on('chat:receive', (msg) => {
        appendMessage(msg);
        if (chatPanel.classList.contains('hidden')) {
          chatBadge.classList.remove('hidden');
        }
      });

      function sendMessage() {
        let text = chatInput.value.trim();
        if (!text) return;
        
        const aliasSelect = document.getElementById('chatAliasSelect');
        if (!aliasSelect.classList.contains('hidden') && aliasSelect.value) {
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
  });
})();
