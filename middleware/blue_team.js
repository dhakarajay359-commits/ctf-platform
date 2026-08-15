const db = require('../db');
const { exec } = require('child_process');

global.idsQuarantine = global.idsQuarantine || new Map();
const requestTracker = new Map(); // key -> Array<timestamp>
const violationTracker = new Map(); // key -> score

// Known automated scanners & fuzzer signatures
const SCANNER_UA_REGEX = /(nmap|dirb|dirbuster|gobuster|ffuf|nikto|sqlmap|wpscan|hydra|masscan|zgrab|acunetix|nessus|metasploit|burpcollaborator|havij|arachni|wfuzz|sublist3r|amass)/i;
const SCANNER_PROBE_REGEX = /(\/\.env|\/\.git\/|\/wp-config\.php|\/phpinfo\.php|\/cgi-bin\/|\/\.\.\/|\/etc\/passwd|\/etc\/shadow|cmd\.exe|UNION\s+SELECT|' OR 1=1|<script>)/i;

function getClientIp(req) {
  const raw = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || '';
  return typeof raw === 'string' ? raw.split(',')[0].trim() : String(raw);
}

function resetTeamSandbox(teamId, targetContainerId) {
  if (!global.activeSandboxes) return;
  for (const [cId, info] of global.activeSandboxes.entries()) {
    if ((targetContainerId && cId === targetContainerId) || (teamId && Number(info.teamId) === Number(teamId))) {
      exec(`docker restart ${cId}`, (err) => {
        if (err) console.warn(`[BLUE TEAM IDS] Docker restart notice for ${cId}:`, err.message);
        else console.log(`[BLUE TEAM IDS] Target container ${cId} actively reset.`);
      });
      info.quarantinedUntil = Date.now() + 5 * 60 * 1000;
    }
  }
}

function renderQuarantineHtml(record, remainingSec) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blue Team IDS Interception | Active Defense</title>
  <style>
    :root {
      --bg: #07090e;
      --card-bg: rgba(14, 18, 27, 0.95);
      --red: #ff3366;
      --blue: #00e5ff;
      --mono: 'JetBrains Mono', 'Fira Code', monospace;
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      box-sizing: border-box;
      background-image: 
        radial-gradient(circle at 50% 20%, rgba(255, 51, 102, 0.15), transparent 60%),
        radial-gradient(circle at 80% 80%, rgba(0, 229, 255, 0.08), transparent 50%);
    }
    .card {
      max-width: 680px;
      width: 90%;
      background: var(--card-bg);
      border: 1px solid rgba(255, 51, 102, 0.4);
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 0 35px rgba(255, 51, 102, 0.2), inset 0 0 15px rgba(255, 51, 102, 0.05);
      backdrop-filter: blur(10px);
      text-align: center;
    }
    .badge {
      display: inline-block;
      background: rgba(255, 51, 102, 0.15);
      color: var(--red);
      border: 1px solid var(--red);
      font-family: var(--mono);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      padding: 6px 14px;
      border-radius: 20px;
      margin-bottom: 20px;
      text-transform: uppercase;
      animation: pulse 2s infinite;
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }
    p {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.6;
      margin: 0 0 20px 0;
    }
    .timer-box {
      background: rgba(0, 0, 0, 0.6);
      border: 1px dashed rgba(255, 51, 102, 0.5);
      border-radius: 8px;
      padding: 16px;
      margin: 20px 0;
      font-family: var(--mono);
    }
    .countdown {
      font-size: 36px;
      font-weight: bold;
      color: var(--red);
      letter-spacing: 2px;
    }
    .details {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 14px 18px;
      text-align: left;
      font-family: var(--mono);
      font-size: 12px;
      margin-bottom: 20px;
    }
    .details div {
      margin: 6px 0;
      display: flex;
      justify-content: space-between;
    }
    .details span:first-child {
      color: #64748b;
    }
    .details span:last-child {
      color: #f1f5f9;
    }
    .tip {
      border-left: 3px solid var(--blue);
      background: rgba(0, 229, 255, 0.05);
      padding: 12px 16px;
      text-align: left;
      font-size: 13px;
      color: #cbd5e1;
      border-radius: 0 6px 6px 0;
    }
    .tip strong {
      color: var(--blue);
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">🚨 BLUE TEAM IDS / WAF INTERCEPTION</div>
    <h1>Target Instance Quarantined</h1>
    <p>The automated Intrusion Detection System (IDS) and Web Application Firewall detected aggressive, noisy scanning activity against the lab target.</p>
    
    <div class="timer-box">
      <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px;">Quarantine Cooldown Remaining</div>
      <div class="countdown" id="timerDisplay">${Math.floor(remainingSec / 60)}:${(remainingSec % 60).toString().padStart(2, '0')}</div>
      <div style="font-size: 11px; color: #ff3366; margin-top: 4px;">Target instance state reset & locked for 5 minutes</div>
    </div>

    <div class="details">
      <div><span>Rule Triggered:</span> <span>${escapeHtml(record.triggerRule || 'AGGRESSIVE_SCANNER_VELOCITY')}</span></div>
      <div><span>Reason:</span> <span>${escapeHtml(record.reason || 'High frequency multi-threaded requests')}</span></div>
      <div><span>Action Taken:</span> <span>Target Instance Reset & IP Quarantine</span></div>
    </div>

    <div class="tip">
      <strong>💡 Blue Team Lesson & Evasion Advice:</strong><br>
      Real production networks monitor traffic velocity and scanner signatures. Avoid loud multi-threaded scans (e.g. <code>dirb</code>, <code>ffuf -t 100</code>, <code>nmap -A</code>). Use rate-limiting (<code>--rate-limit</code>), stealth delays (<code>-T2</code> or <code>-p</code>), custom User-Agents, and targeted manual probing to evade SOC alerts.
    </div>
  </div>

  <script>
    let sec = ${remainingSec};
    const display = document.getElementById('timerDisplay');
    const interval = setInterval(() => {
      sec--;
      if (sec <= 0) {
        clearInterval(interval);
        display.textContent = '00:00';
        display.style.color = '#00e5ff';
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const m = Math.floor(sec / 60);
        const s = (sec % 60).toString().padStart(2, '0');
        display.textContent = m + ':' + s;
      }
    }, 1000);
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = function (io) {
  return async function blueTeamMiddleware(req, res, next) {
    // Skip static assets
    if (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/images/') || req.path.startsWith('/uploads/') || req.path === '/favicon.ico') {
      return next();
    }

    const ip = getClientIp(req);
    const session = req.session;
    const teamId = session && session.teamId ? session.teamId : null;
    const teamName = session && session.teamName ? session.teamName : `IP-${ip}`;
    const isAdmin = session && session.isAdmin;
    const now = Date.now();

    // Admins bypass IDS
    if (isAdmin) {
      return next();
    }

    // 1. Check if IP or Team is currently quarantined
    const quarantineKey = teamId ? `team_${teamId}` : `ip_${ip}`;
    let record = global.idsQuarantine.get(quarantineKey) || global.idsQuarantine.get(`ip_${ip}`);

    if (record) {
      if (now < record.expiresAt) {
        const remainingSec = Math.max(1, Math.ceil((record.expiresAt - now) / 1000));
        
        // Return rich HTML for browser sandbox visits
        if (req.headers.accept && req.headers.accept.includes('text/html') && (req.path.startsWith('/sandbox/') || req.path.startsWith('/target-alpha'))) {
          return res.status(429).send(renderQuarantineHtml(record, remainingSec));
        }

        return res.status(429).json({
          error: 'BLUE_TEAM_IDS_INTERCEPTION',
          quarantined: true,
          reason: record.reason,
          trigger_rule: record.triggerRule,
          quarantine_remaining_seconds: remainingSec,
          quarantine_until: new Date(record.expiresAt).toISOString(),
          message: 'Target instance quarantined for 5 minutes due to aggressive scanner activity. Reset and cooldown active.',
          evasion_tip: 'Standard automated scanners (nmap -A, dirb, ffuf) trigger active IDS/WAF. Use rate limiting (--rate-limit / -p), stealth flags, custom headers, and manual reconnaissance to evade detection.'
        });
      } else {
        // Quarantine expired
        global.idsQuarantine.delete(quarantineKey);
        global.idsQuarantine.delete(`ip_${ip}`);
      }
    }

    // 2. Active Intrusion Detection Heuristics
    const trackKey = teamId ? `team_${teamId}` : `ip_${ip}`;
    if (!requestTracker.has(trackKey)) {
      requestTracker.set(trackKey, []);
    }
    const times = requestTracker.get(trackKey);
    times.push(now);

    // Keep timestamps from last 10 seconds
    while (times.length > 0 && times[0] < now - 10000) {
      times.shift();
    }

    const ua = req.headers['user-agent'] || '';
    const fullUrl = req.originalUrl || req.url || '';
    const bodyStr = JSON.stringify(req.body || {});
    const queryStr = JSON.stringify(req.query || {});
    const payloadStr = fullUrl + ' ' + bodyStr + ' ' + queryStr;

    let triggered = false;
    let rule = '';
    let reason = '';

    // Check A: Scanner User-Agent signature (e.g. nmap, dirb, ffuf, gobuster, sqlmap)
    if (SCANNER_UA_REGEX.test(ua)) {
      triggered = true;
      rule = 'SCANNER_USER_AGENT_DETECTED';
      const matched = ua.match(SCANNER_UA_REGEX)[0];
      reason = `Automated security scanner detected in User-Agent header (${matched}).`;
    }

    // Check B: Multi-threaded / Burst Rate (e.g. dirb, ffuf, gobuster, nmap -A)
    const recent3Sec = times.filter(t => t > now - 3000).length;
    if (!triggered && recent3Sec >= 12) {
      triggered = true;
      rule = 'MULTI_THREADED_BURST_FLOOD';
      reason = `Excessive burst scanning velocity (${recent3Sec} requests in 3 seconds).`;
    } else if (!triggered && times.length >= 28) {
      triggered = true;
      rule = 'HIGH_FREQUENCY_SCANNING';
      reason = `High sustained request velocity (${times.length} requests in 10 seconds).`;
    }

    // Check C: Noisy probe patterns & fuzzing signatures
    if (!triggered && SCANNER_PROBE_REGEX.test(payloadStr)) {
      const currentViolations = (violationTracker.get(trackKey) || 0) + 1;
      violationTracker.set(trackKey, currentViolations);
      if (currentViolations >= 4) {
        triggered = true;
        rule = 'REPEATED_MALICIOUS_PROBING';
        reason = 'Repetitive noisy exploit / directory traversal probing detected.';
        violationTracker.delete(trackKey);
      }
    }

    // 3. Execute Active Defense Action if triggered
    if (triggered) {
      const durationMs = 5 * 60 * 1000; // 5 minutes
      const expiresAt = now + durationMs;

      const quarantineData = {
        expiresAt,
        teamId,
        teamName,
        ip,
        reason,
        triggerRule: rule,
        targetReset: true
      };

      global.idsQuarantine.set(quarantineKey, quarantineData);
      global.idsQuarantine.set(`ip_${ip}`, quarantineData);
      times.length = 0; // reset velocity buffer

      // Extract target container ID if targeting a sandbox
      let targetContainerId = null;
      if (req.params && req.params.containerId) {
        targetContainerId = req.params.containerId;
      } else if (req.path.startsWith('/sandbox/')) {
        targetContainerId = req.path.split('/')[2];
      }

      // Reset Docker target instance
      resetTeamSandbox(teamId, targetContainerId);

      // Penalize Stealth Score if logged in
      let currentStealth = 100;
      if (teamId) {
        try {
          await db.prepare('UPDATE teams SET stealth_score = GREATEST(0, stealth_score - 25) WHERE id = ?').run(teamId);
          const tRow = await db.prepare('SELECT stealth_score FROM teams WHERE id = ?').get(teamId);
          if (tRow) currentStealth = tRow.stealth_score;
        } catch (e) {
          console.error('Error updating stealth score:', e);
        }
      }

      // Record to IDS Log in Database
      try {
        await db.prepare('INSERT INTO ids_logs (team_id, team_name, ip, trigger_rule, details, action_taken) VALUES (?, ?, ?, ?, ?, ?)')
          .run(teamId, teamName, ip, rule, reason, '5-Min Quarantine & Target Reset');
      } catch (e) {
        console.error('Error recording IDS log:', e);
      }

      // Broadcast alerts in real-time
      if (io) {
        io.to('admin_room').emit('admin:alert', {
          type: 'BLUE_TEAM_IDS',
          message: `🚨 IDS QUARANTINE: Team "${teamName}" (${ip}) triggered rule [${rule}]: ${reason}. Target reset for 5 minutes. Stealth: ${currentStealth}%`,
          team: teamName,
          ip,
          rule,
          reason,
          quarantineUntil: new Date(expiresAt).toISOString(),
          timestamp: new Date().toISOString()
        });

        io.to('admin_room').emit('ids:update', {
          quarantine: Array.from(global.idsQuarantine.values())
        });

        if (teamId) {
          io.to(`room_team_${teamId}`).emit('notifications:receive', {
            id: Date.now(),
            title: '🚨 BLUE TEAM IDS INTERCEPTION',
            message: `Target instance quarantined for 5 minutes. Reason: ${reason} (Stealth score: ${currentStealth}%)`,
            type: 'danger'
          });

          io.to(`room_team_${teamId}`).emit('ids:quarantine', {
            quarantined: true,
            remainingMs: durationMs,
            reason,
            rule
          });
        }
      }

      // Return immediate block response
      if (req.headers.accept && req.headers.accept.includes('text/html') && (req.path.startsWith('/sandbox/') || req.path.startsWith('/target-alpha'))) {
        return res.status(429).send(renderQuarantineHtml(quarantineData, 300));
      }

      return res.status(429).json({
        error: 'BLUE_TEAM_IDS_INTERCEPTION',
        quarantined: true,
        reason,
        trigger_rule: rule,
        quarantine_remaining_seconds: 300,
        quarantine_until: new Date(expiresAt).toISOString(),
        message: 'Aggressive scanning detected. Target instance has been reset and your access is quarantined for 5 minutes.',
        evasion_tip: 'Real-world targets employ IDS/WAF. Reduce your tool thread count, add delay/rate limits, avoid default scanner User-Agents, and use stealth evasion.'
      });
    }

    next();
  };
};
