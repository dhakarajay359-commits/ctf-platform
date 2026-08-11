(function() {
  document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inject Notifications Panel UI
    const notifContainer = document.createElement('div');
    notifContainer.id = 'notifContainer';
    notifContainer.innerHTML = `
      <div id="notifBell" class="notif-bell" title="Notifications">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        <div id="notifBadge" class="notif-badge hidden"></div>
      </div>
      <div id="notifPanel" class="notif-panel hidden">
        <div class="notif-header">
          <h3>GLOBAL ALERTS</h3>
          <button id="notifCloseBtn">&times;</button>
        </div>
        <div id="notifList" class="notif-list">
          <div style="padding: 16px; color: var(--text-muted); text-align: center;">No alerts active.</div>
        </div>
      </div>
      <div id="notifToastContainer" class="notif-toast-container"></div>
    `;
    document.body.appendChild(notifContainer);

    const notifBell = document.getElementById('notifBell');
    const notifPanel = document.getElementById('notifPanel');
    const notifBadge = document.getElementById('notifBadge');
    const notifList = document.getElementById('notifList');
    const notifCloseBtn = document.getElementById('notifCloseBtn');
    const notifToastContainer = document.getElementById('notifToastContainer');

    // Toggle Panel
    notifBell.onclick = () => {
      notifPanel.classList.toggle('hidden');
      notifBadge.classList.add('hidden'); // clear badge when opened
    };
    notifCloseBtn.onclick = () => {
      notifPanel.classList.add('hidden');
    };

    // Load past notifications
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      if (data && data.length > 0) {
        renderNotifs(data);
      }
    } catch (e) {}

    function renderNotifs(alerts) {
      if (alerts.length === 0) return;
      notifList.innerHTML = '';
      alerts.forEach(a => {
        const div = document.createElement('div');
        div.className = 'notif-item';
        div.innerHTML = `
          <div class="notif-time">${new Date(a.created_at || a.timestamp).toLocaleTimeString()}</div>
          <div class="notif-msg">${escapeHtml(a.message)}</div>
        `;
        notifList.appendChild(div);
      });
    }

    function showToast(msg) {
      const toast = document.createElement('div');
      toast.className = 'notif-toast glitch-active';
      toast.innerHTML = `
        <div class="toast-title">⚠ ANOMALY DETECTED</div>
        <div class="toast-msg">${escapeHtml(msg)}</div>
      `;
      notifToastContainer.appendChild(toast);
      
      // Remove after 6 seconds
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
      }, 6000);
    }

    // Socket.io integration
    const fbSocket = typeof io !== 'undefined' ? io() : null;
    if (fbSocket) {
      fbSocket.on('anomaly_alert', (data) => {
        // Show floating toast
        showToast(data.message);
        
        // Show unread badge
        notifBadge.classList.remove('hidden');

        // Prepend to panel list
        if (notifList.innerText.includes('No alerts active')) notifList.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'notif-item new-item';
        div.innerHTML = `
          <div class="notif-time">${new Date(data.timestamp).toLocaleTimeString()}</div>
          <div class="notif-msg">${escapeHtml(data.message)}</div>
        `;
        notifList.prepend(div);
      });
    }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = s ?? '';
      return d.innerHTML;
    }
  });
})();
