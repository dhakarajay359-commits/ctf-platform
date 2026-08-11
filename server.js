require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const db = require('./db'); // ensures DB + tables exist
const { router: scoreboardRouter, computeScoreboard, broadcastScoreboard } = require('./routes/scoreboard');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

global.activeSandboxes = new Map();
const { createProxyMiddleware } = require('http-proxy-middleware');

const sandboxProxy = createProxyMiddleware({
  target: 'http://127.0.0.1',
  changeOrigin: true,
  router: function (req) {
    const cId = req.params.containerId || req.url.split('/')[2];
    if (global.activeSandboxes && global.activeSandboxes.has(cId)) {
      return `http://127.0.0.1:\${global.activeSandboxes.get(cId).port}`;
    }
    return null;
  },
  pathRewrite: function (path, req) {
    const cId = req.params.containerId || req.url.split('/')[2];
    return path.replace(`/sandbox/\${cId}`, '');
  }
});

app.use('/sandbox/:containerId', sandboxProxy);

app.use(express.json());

// Easter Egg Header
app.use((req, res, next) => {
  res.setHeader('X-OmniCorp-Secret', 'flag{headers_are_cool_1337}');
  next();
});
// Sessions are kept in memory. This is fine for a single-process deployment
// (the normal way to run a CTF for one event). If you need multiple server
// processes/instances sharing sessions, swap in a store like connect-redis.
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
});
app.use(sessionMiddleware);

const blueTeam = require('./middleware/blue_team')(io);
app.use('/api', blueTeam);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin')(io));
app.use('/api/challenges', require('./routes/challenges')(io));
app.use('/api/scoreboard', scoreboardRouter);
app.use('/api/spectator', require('./routes/spectator'));
app.use('/api/payloads', require('./routes/payloads'));
app.use('/api/targets', require('./routes/targets')());
app.use('/api/campaign', require('./routes/campaign')());
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/chat', require('./routes/chat')(io));

app.get('/api/timer', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ctf_end_time'").get();
  res.json({ endTime: row && row.value ? Number(row.value) : null });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

const teamIpTracker = {}; // teamId -> Map<ip, count>

io.on('connection', (socket) => {
  const session = socket.request.session;
  if (session && session.isAdmin) {
    socket.join('admin_room');
  } else if (session && session.teamId) {
    const teamId = session.teamId;
    socket.join(`room_team_${teamId}`);

    // IP Tracking Logic
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    if (!teamIpTracker[teamId]) teamIpTracker[teamId] = new Map();
    
    const count = teamIpTracker[teamId].get(ip) || 0;
    teamIpTracker[teamId].set(ip, count + 1);

    if (teamIpTracker[teamId].size > 1) {
      io.to('admin_room').emit('admin:alert', {
        type: 'ACCOUNT_SHARING',
        message: `Team "${session.teamName}" has active connections from multiple IPs: ${Array.from(teamIpTracker[teamId].keys()).join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    socket.on('disconnect', () => {
      if (teamIpTracker[teamId]) {
        const newCount = teamIpTracker[teamId].get(ip) - 1;
        if (newCount <= 0) {
          teamIpTracker[teamId].delete(ip);
        } else {
          teamIpTracker[teamId].set(ip, newCount);
        }
      }
    });
  }

  socket.emit('scoreboard:data', computeScoreboard());
  socket.on('scoreboard:request', () => {
    socket.emit('scoreboard:data', computeScoreboard());
  });

  socket.on('chat:send', (data) => {
    // data: { text: string, toTeamId?: number }
    if (!data.text || !data.text.trim()) return;
    const text = data.text.trim();

    if (session && session.isAdmin) {
      if (!data.toTeamId) return; // Admin must specify who to send to
      db.prepare('INSERT INTO messages (team_id, is_from_admin, text) VALUES (?, 1, ?)').run(data.toTeamId, text);
      const msg = { team_id: data.toTeamId, is_from_admin: 1, text, created_at: new Date().toISOString() };
      io.to(`room_team_${data.toTeamId}`).emit('chat:receive', msg);
      io.to('admin_room').emit('chat:receive', msg);
    } else if (session && session.teamId) {
      db.prepare('INSERT INTO messages (team_id, is_from_admin, text) VALUES (?, 0, ?)').run(session.teamId, text);
      const msg = { team_id: session.teamId, is_from_admin: 0, text, created_at: new Date().toISOString() };
      io.to(`room_team_${session.teamId}`).emit('chat:receive', msg);
      io.to('admin_room').emit('chat:receive', msg);
    }
  });

  socket.on('challenge:claim', (data) => {
    if (session && session.teamId) {
      db.prepare('INSERT INTO challenge_claims (team_id, challenge_id, operative_alias) VALUES (?, ?, ?) ON CONFLICT(team_id, challenge_id) DO UPDATE SET operative_alias = excluded.operative_alias').run(session.teamId, data.challengeId, data.alias);
      io.to(`room_team_${session.teamId}`).emit('claim:update', { challengeId: data.challengeId, alias: data.alias });
    }
  });

  socket.on('challenge:unclaim', (data) => {
    if (session && session.teamId) {
      db.prepare('DELETE FROM challenge_claims WHERE team_id = ? AND challenge_id = ?').run(session.teamId, data.challengeId);
      io.to(`room_team_${session.teamId}`).emit('claim:update', { challengeId: data.challengeId, alias: null });
    }
  });

  socket.on('cheat:alert', (data) => {
    if (session && session.teamId) {
      // Relay to admins only
      io.to('admin_room').emit('admin:alert', {
        ...data,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Terminal Integration
  let ptyProcess = null;
  socket.on('terminal:start', () => {
    if (!session || !session.teamId) return;
    try {
      const pty = require('node-pty');
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME || process.env.USERPROFILE,
        env: process.env
      });

      ptyProcess.onData((data) => {
        socket.emit('terminal:data', data);
      });
    } catch (e) {
      socket.emit('terminal:data', '\\r\\n\\x1b[31m[ERROR] Native node-pty module failed to load. Terminal is in fallback mode.\\x1b[0m\\r\\n');
    }
  });

  socket.on('terminal:data', (data) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  socket.on('disconnect', () => {
    if (ptyProcess) {
      ptyProcess.kill();
    }
  });
});

// KoTH Point Awards (Runs every 1 minute)
setInterval(() => {
  const controls = db.prepare('SELECT team_id FROM koth_control').all();
  if (controls.length > 0) {
    const awardStmt = db.prepare('INSERT INTO koth_points (team_id, points) VALUES (?, 5) ON CONFLICT(team_id) DO UPDATE SET points = points + 5');
    const getTeam = db.prepare('SELECT name FROM teams WHERE id = ?');
    
    db.transaction(() => {
      controls.forEach(c => {
        awardStmt.run(c.team_id);
        const team = getTeam.get(c.team_id);
        if (team) {
          io.to(`room_team_${c.team_id}`).emit('notifications:receive', {
            id: Date.now(),
            title: 'KoTH Income',
            message: 'Your team received +5 points for holding an active node.',
            type: 'info'
          });
        }
      });
    })();
    broadcastScoreboard(io);
  }
}, 60000);

// Sandbox Cleanup Job (Runs every 1 minute)
setInterval(() => {
  const now = Date.now();
  for (const [cId, info] of global.activeSandboxes.entries()) {
    if (now > info.expiresAt) {
      require('child_process').exec(`docker rm -f ${cId}`, () => {});
      global.activeSandboxes.delete(cId);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`CTF platform running on http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('WARNING: ADMIN_PASSWORD not set in .env — set one before hosting publicly!');
  }
});
