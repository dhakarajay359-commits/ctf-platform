(function() {
  const terminalHtml = `
    <div id="hackerTerminal" class="hidden" style="position: fixed; top: 0; left: 0; right: 0; height: 50vh; background: rgba(5, 8, 12, 0.95); border-bottom: 2px solid var(--primary); z-index: 10000; font-family: var(--mono); color: var(--primary); padding: 20px; overflow-y: auto; display: flex; flex-direction: column; transition: transform 0.3s ease-in-out; transform: translateY(-100%);">
      <div style="flex: 1; overflow-y: auto;" id="termOutput">
        <div>CTF-OS v1.0 [CLI Interface Enabled]</div>
        <div>Type 'help' for a list of commands.</div>
      </div>
      <div style="display: flex; margin-top: 10px;">
        <span style="color: var(--primary); margin-right: 10px;">root@ctf:~#</span>
        <input type="text" id="termInput" style="flex: 1; background: transparent; border: none; color: #fff; font-family: var(--mono); outline: none;" autocomplete="off">
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', terminalHtml);

  const term = document.getElementById('hackerTerminal');
  const termOutput = document.getElementById('termOutput');
  const termInput = document.getElementById('termInput');

  let isTermOpen = false;

  document.addEventListener('keydown', (e) => {
    if (e.key === '`') {
      e.preventDefault();
      isTermOpen = !isTermOpen;
      if (isTermOpen) {
        term.classList.remove('hidden');
        // Force reflow
        void term.offsetWidth;
        term.style.transform = 'translateY(0)';
        termInput.focus();
        if (window.playClickSound) window.playClickSound();
      } else {
        term.style.transform = 'translateY(-100%)';
        setTimeout(() => term.classList.add('hidden'), 300);
      }
    }
  });

  function printLine(text, color = 'var(--primary)') {
    const div = document.createElement('div');
    div.style.color = color;
    div.textContent = text;
    termOutput.appendChild(div);
    termOutput.scrollTop = termOutput.scrollHeight;
  }

  termInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const val = termInput.value.trim();
      termInput.value = '';
      if (!val) return;

      printLine(`root@ctf:~# ${val}`, '#fff');

      const args = val.split(' ');
      const cmd = args[0].toLowerCase();

      switch (cmd) {
        case 'help':
          printLine('Available commands:');
          printLine('  help   - Show this message');
          printLine('  clear  - Clear terminal output');
          printLine('  status - View global network integrity');
          printLine('  top    - View live top 5 teams');
          break;
        case 'clear':
          termOutput.innerHTML = '';
          break;
        case 'status':
          try {
            const res = await fetch('/api/challenges/health');
            const data = await res.json();
            printLine(`[NETWORK INTEGRITY] ${data.health}%`, data.health < 50 ? 'var(--danger)' : 'var(--success)');
          } catch(e) { printLine('Error fetching status', 'var(--danger)'); }
          break;
        case 'top':
          try {
            const res = await fetch('/api/scoreboard');
            const data = await res.json();
            data.slice(0, 5).forEach((t, i) => {
              printLine(`[${i+1}] ${t.teamName.padEnd(20)} ${t.score} pts`, i===0 ? 'var(--warning)' : '#fff');
            });
          } catch(e) { printLine('Error fetching scoreboard', 'var(--danger)'); }
          break;
        default:
          printLine(`ctf-os: command not found: ${cmd}`, 'var(--danger)');
      }
    }
  });
})();
