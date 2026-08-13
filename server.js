require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const {
  Server
} = require('socket.io');
const path = require('path');
const db = require('./db'); // ensures DB + tables exist
const {
  router: scoreboardRouter,
  computeScoreboard,
  broadcastScoreboard
} = require('./routes/scoreboard');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
global.activeSandboxes = new Map();
const {
  createProxyMiddleware
} = require('http-proxy-middleware');
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

const pgSession = require('connect-pg-simple')(session);

// Easter Egg Header
app.use((req, res, next) => {
  res.setHeader('X-OmniCorp-Secret', 'flag{headers_are_cool_1337}');
  next();
});
// Sessions are persisted in Postgres so they survive server restarts.
app.set('trust proxy', 1);
const sessionMiddleware = session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7,
    // 7 days
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
});
app.use(sessionMiddleware);
const passport = require('passport');
app.use(passport.initialize());
app.use(passport.session());

// Passport serialization
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
  done(null, team);
});
require('./passport')(passport, db);
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
app.use('/api/registration', require('./routes/registration')());
app.get('/api/timer', async (req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'ctf_end_time'").get();
  res.json({
    endTime: row && row.value ? Number(row.value) : null
  });
});
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});
const teamIpTracker = {}; // teamId -> Map<ip, count>

io.on('connection', socket => {
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
  computeScoreboard().then(data => socket.emit('scoreboard:data', data)).catch(e => console.error(e));
  socket.on('scoreboard:request', async () => {
    try {
      socket.emit('scoreboard:data', await computeScoreboard());
    } catch(e) {
      console.error(e);
    }
  });
  socket.on('chat:send', async data => {
    // data: { text: string, toTeamId?: number }
    if (!data.text || !data.text.trim()) return;
    const text = data.text.trim();
    if (session && session.isAdmin) {
      if (!data.toTeamId) return; // Admin must specify who to send to
      await db.prepare('INSERT INTO messages (team_id, is_from_admin, text) VALUES (?, 1, ?)').run(data.toTeamId, text);
      const msg = {
        team_id: data.toTeamId,
        is_from_admin: 1,
        text,
        created_at: new Date().toISOString()
      };
      io.to(`room_team_${data.toTeamId}`).emit('chat:receive', msg);
      io.to('admin_room').emit('chat:receive', msg);
    } else if (session && session.teamId) {
      await db.prepare('INSERT INTO messages (team_id, is_from_admin, text) VALUES (?, 0, ?)').run(session.teamId, text);
      const msg = {
        team_id: session.teamId,
        is_from_admin: 0,
        text,
        created_at: new Date().toISOString()
      };
      io.to(`room_team_${session.teamId}`).emit('chat:receive', msg);
      io.to('admin_room').emit('chat:receive', msg);
    }
  });
  socket.on('challenge:claim', async data => {
    if (session && session.teamId) {
      await db.prepare('INSERT INTO challenge_claims (team_id, challenge_id, operative_alias) VALUES (?, ?, ?) ON CONFLICT(team_id, challenge_id) DO UPDATE SET operative_alias = excluded.operative_alias').run(session.teamId, data.challengeId, data.alias);
      io.to(`room_team_${session.teamId}`).emit('claim:update', {
        challengeId: data.challengeId,
        alias: data.alias
      });
    }
  });
  socket.on('challenge:unclaim', async data => {
    if (session && session.teamId) {
      await db.prepare('DELETE FROM challenge_claims WHERE team_id = ? AND challenge_id = ?').run(session.teamId, data.challengeId);
      io.to(`room_team_${session.teamId}`).emit('claim:update', {
        challengeId: data.challengeId,
        alias: null
      });
    }
  });
  socket.on('cheat:alert', data => {
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
      ptyProcess.onData(data => {
        socket.emit('terminal:data', data);
      });
    } catch (e) {
      socket.emit('terminal:data', '\\r\\n\\x1b[31m[ERROR] Native node-pty module failed to load. Terminal is in fallback mode.\\x1b[0m\\r\\n');
    }
  });
  socket.on('terminal:data', data => {
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
setInterval(async () => {
  try {
    const controls = await db.prepare('SELECT team_id FROM koth_control').all();
    if (controls.length > 0) {
      const awardStmt = db.prepare('INSERT INTO koth_points (team_id, points) VALUES (?, 5) ON CONFLICT(team_id) DO UPDATE SET points = points + 5');
      const getTeam = db.prepare('SELECT name FROM teams WHERE id = ?');
      
      for (const c of controls) {
        await awardStmt.run(c.team_id);
        const team = await getTeam.get(c.team_id);
        if (team) {
          io.to(`room_team_${c.team_id}`).emit('notifications:receive', {
            id: Date.now(),
            title: 'KoTH Income',
            message: 'Your team received +5 points for holding an active node.',
            type: 'info'
          });
        }
      }
      broadcastScoreboard(io);
    }
  } catch (err) {
    console.error('KoTH interval error:', err);
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

// Auto-wipe Live Registration Data
setInterval(async () => {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'live_ctf_event_end'").get();
    if (row && row.value) {
      if (Date.now() > new Date(row.value).getTime()) {
        await db.prepare('DELETE FROM live_registration_submissions').run();
      }
    }
  } catch (e) {
    console.error('Error auto-wiping live registration data', e);
  }
}, 60 * 60 * 1000);
db.initDb().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CTF platform running on http://0.0.0.0:${PORT}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('WARNING: ADMIN_PASSWORD not set in .env — set one before hosting publicly!');
    }
  });
});