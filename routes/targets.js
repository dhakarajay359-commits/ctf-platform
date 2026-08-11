const express = require('express');

module.exports = function () {
  const router = express.Router();

  // Target Alpha (SQL Injection Simulator)
  // Purposefully vulnerable endpoint that accepts common SQLi payloads
  router.post('/alpha/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username required' });
    }

    const payload = username.trim().toLowerCase();

    // Check for common SQL Injection bypass payloads
    // We are simulating what would happen if the backend had a vulnerable SQL query like:
    // SELECT * FROM users WHERE username = '${username}' AND password = '${password}'
    if (payload.includes("' or 1=1") || 
        payload.includes("' or '1'='1") || 
        payload.includes('" or 1=1') || 
        payload.includes('" or "1"="1') ||
        payload.includes("' or true") ||
        payload.includes("admin' --")) {
      
      // STAGE 1 HACK SUCCESSFUL!
      return res.json({ 
        success: true, 
        message: 'ACCESS GRANTED. WELCOME ADMIN.',
        redirect: '/target-alpha-dashboard.html' 
      });
    }

    // Normal or failed login
    res.status(401).json({ success: false, error: 'Invalid credentials. This incident will be reported.' });
  });

  // Target Alpha STAGE 2 (Command Injection Simulator)
  router.post('/alpha/ping', (req, res) => {
    const { ip } = req.body;
    
    if (!ip) {
      return res.status(400).json({ error: 'IP Address required' });
    }

    const payload = ip.toLowerCase();

    // Check for Command Injection characters (; | && `)
    if (payload.includes(';') || payload.includes('|') || payload.includes('&&') || payload.includes('`')) {
      // HACK SUCCESSFUL! (RCE achieved)
      const mockOutput = `PING ${ip.split(';')[0].split('|')[0].trim()} (127.0.0.1) 56(84) bytes of data.
64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.034 ms

--- ping statistics ---
1 packets transmitted, 1 received, 0% packet loss, time 0ms

[root@omnicorp-internal ~]# executed command: ${payload}
...
...
WARNING: UNAUTHORIZED ACCESS DETECTED
DUMPING SYSTEM ENVIRONMENT VARIABLES:
USER=root
HOME=/root
FLAG=flag{sqL_1nj3ct10n_m4st3r}
...
...
SYSTEM HALTED.`;

      return res.json({ 
        success: true, 
        glitch: true,
        output: mockOutput
      });
    }

    // Normal Ping
    const mockNormalOutput = `PING ${ip} 56(84) bytes of data.
64 bytes from ${ip}: icmp_seq=1 ttl=64 time=12.4 ms
64 bytes from ${ip}: icmp_seq=2 ttl=64 time=11.2 ms
64 bytes from ${ip}: icmp_seq=3 ttl=64 time=10.9 ms

--- ${ip} ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2003ms
rtt min/avg/max/mdev = 10.9/11.5/12.4/0.6 ms`;

    res.json({ success: true, glitch: false, output: mockNormalOutput });
  });

  return router;
};
