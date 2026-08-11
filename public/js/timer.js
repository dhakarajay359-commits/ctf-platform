(function() {
  document.addEventListener('DOMContentLoaded', async () => {
    // Inject Timer UI in topbar
    const topbar = document.querySelector('.topbar');
    if (topbar) {
      const timerDiv = document.createElement('div');
      timerDiv.id = 'ctfTimer';
      timerDiv.style.cssText = 'font-family: var(--mono); color: var(--primary); font-size: 14px; margin-left: 20px; border: 1px solid var(--border-color); padding: 4px 10px; border-radius: 4px; display: none;';
      timerDiv.innerHTML = `<span id="ctfTimerLabel">TIME REMAINING:</span> <span id="ctfTimerText">00:00:00</span>`;
      
      // Insert before nav-links if possible
      const navLinks = topbar.querySelector('.nav-links');
      if (navLinks) {
        topbar.insertBefore(timerDiv, navLinks);
      } else {
        topbar.appendChild(timerDiv);
      }
    }

    const timerDiv = document.getElementById('ctfTimer');
    const timerText = document.getElementById('ctfTimerText');
    const timerLabel = document.getElementById('ctfTimerLabel');
    let ctfStartTime = null;
    let ctfEndTime = null;
    let timerInterval = null;

    async function fetchTimer() {
      try {
        const res = await fetch('/api/timer');
        const data = await res.json();
        ctfStartTime = data.startTime;
        ctfEndTime = data.endTime;
        updateTimer();
      } catch (e) {}
    }

    function updateTimer() {
      if (!ctfEndTime && !ctfStartTime) {
        if (timerDiv) timerDiv.style.display = 'none';
        if (timerInterval) clearInterval(timerInterval);
        return;
      }
      
      if (timerDiv) timerDiv.style.display = 'block';

      if (!timerInterval) {
        timerInterval = setInterval(updateTimer, 1000);
      }

      const now = Date.now();
      let targetTime;
      let label;

      if (ctfStartTime && now < ctfStartTime) {
        targetTime = ctfStartTime;
        label = 'CTF STARTS IN:';
        if (timerText) timerText.style.color = '#ffff00'; // yellow for upcoming
      } else if (ctfEndTime) {
        targetTime = ctfEndTime;
        label = 'TIME REMAINING:';
        if (timerText) timerText.style.color = 'var(--primary)';
        
        // If the page is locked in upcoming mode but the time has passed, reload to unlock challenges
        if (document.getElementById('upcomingOverlay')) {
          window.location.reload();
        }
      } else {
        targetTime = null;
      }

      if (timerLabel) timerLabel.textContent = label;

      if (!targetTime) {
        if (timerText) timerText.textContent = '';
        return;
      }

      const remaining = targetTime - now;
      if (remaining <= 0) {
        if (timerText) {
          timerText.textContent = '00:00:00';
          timerText.style.color = 'red';
          timerText.classList.add('glitch-active');
        }
        if (label === 'CTF STARTS IN:') {
           // Started! Reload to refresh state
           window.location.reload();
        } else {
           clearInterval(timerInterval);
           timerInterval = null;
        }
      } else {
        const h = Math.floor(remaining / 3600000).toString().padStart(2, '0');
        const m = Math.floor((remaining % 3600000) / 60000).toString().padStart(2, '0');
        const s = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
        if (timerText) {
          timerText.textContent = `${h}:${m}:${s}`;
          timerText.classList.remove('glitch-active');
        }
      }
    }

    fetchTimer();

    // Listen for socket updates
    const fbSocket = typeof io !== 'undefined' ? io() : null;
    if (fbSocket) {
      fbSocket.on('timer:update', (data) => {
        ctfStartTime = data.startTime;
        ctfEndTime = data.endTime;
        updateTimer();
      });
    }
  });
})();
