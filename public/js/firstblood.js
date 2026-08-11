(function() {
  document.addEventListener('DOMContentLoaded', () => {
    // Inject college background dynamically
    const bgWrapper = document.createElement('div');
    bgWrapper.className = 'college-bg-container';
    bgWrapper.innerHTML = `
      <div class="college-bg-image"></div>
      <div class="college-bg-overlay"></div>
    `;
    document.body.prepend(bgWrapper);
    document.body.style.setProperty('background', 'transparent', 'important');
  });

  const fbSocket = typeof io !== 'undefined' ? io() : null;
  if (!fbSocket) return;

  fbSocket.on('first_blood', (data) => {
    const overlay = document.createElement('div');
    overlay.className = 'first-blood-overlay';
    
    overlay.innerHTML = `
      <div class="first-blood-content glitch-active">
        <h1 class="fb-glitch-text" data-text="CRITICAL BREACH">CRITICAL BREACH</h1>
        <h2 class="fb-subtitle">FIRST BLOOD DRAWN</h2>
        <p class="fb-desc"><span style="color:#00ff66;">${escapeHtml(data.team)}</span> has just compromised <span style="color:#00D2FF;">${escapeHtml(data.challenge)}</span></p>
        ${data.bounty ? `<p style="color:#ffcc00; font-size:1.2em; font-weight:bold; margin-top:10px;">+${data.bounty} POINT BOUNTY CLAIMED!</p>` : ''}
      </div>
    `;

    document.body.appendChild(overlay);

    // Remove after 4.5 seconds
    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.5s ease';
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 500);
    }, 4500);
  });

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }
})();
