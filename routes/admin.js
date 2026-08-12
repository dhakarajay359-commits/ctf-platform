const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  requireAdmin
} = require('../middleware/auth');
const {
  broadcastScoreboard
} = require('./scoreboard');
const state = require('../state');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, {
    recursive: true
  });
}
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage: storage
});
module.exports = function (io) {
  const router = express.Router();

  // --- Brute Force Protection ---
  const loginAttempts = new Map();
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MINUTES = 15;
  function checkBruteForce(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = LOCKOUT_MINUTES * 60 * 1000;
    let attempts = loginAttempts.get(ip);
    if (!attempts) {
      attempts = {
        count: 0,
        firstAttempt: now,
        lockedUntil: null
      };
      loginAttempts.set(ip, attempts);
    }
    if (attempts.lockedUntil) {
      if (now < attempts.lockedUntil) {
        const remaining = Math.ceil((attempts.lockedUntil - now) / 60000);
        return res.status(429).json({
          error: `Too many failed attempts. Locked out for ${remaining} minutes.`
        });
      } else {
        attempts.lockedUntil = null;
        attempts.count = 0;
        attempts.firstAttempt = now;
      }
    }
    if (now - attempts.firstAttempt > windowMs) {
      attempts.count = 0;
      attempts.firstAttempt = now;
    }
    next();
  }
  function recordFailedLogin(ip) {
    const attempts = loginAttempts.get(ip);
    if (attempts) {
      attempts.count += 1;
      if (attempts.count >= MAX_ATTEMPTS) {
        attempts.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
      }
    }
  }
  router.post('/login', checkBruteForce, (req, res) => {
    const {
      password
    } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    if (password && password === adminPass) {
      req.session.isAdmin = true;
      loginAttempts.delete(ip); // Reset on success
      return res.json({
        ok: true
      });
    }
    recordFailedLogin(ip);
    res.status(401).json({
      error: 'Incorrect admin password.'
    });
  });
  router.post('/logout', (req, res) => {
    req.session.isAdmin = false;
    res.json({
      ok: true
    });
  });
  router.use(requireAdmin);

  // ---- Change Admin Password ----
  router.post('/password', (req, res) => {
    const {
      currentPassword,
      newPassword
    } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({
      error: 'Missing fields'
    });
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    if (currentPassword !== adminPass) {
      return res.status(401).json({
        error: 'Incorrect current password'
      });
    }
    process.env.ADMIN_PASSWORD = newPassword;
    try {
      const envPath = path.join(__dirname, '..', '.env');
      let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (env.includes('ADMIN_PASSWORD=')) {
        env = env.replace(/ADMIN_PASSWORD=.*/g, `ADMIN_PASSWORD=${newPassword}`);
      } else {
        env += `\nADMIN_PASSWORD=${newPassword}\n`;
      }
      fs.writeFileSync(envPath, env);
      res.json({
        ok: true
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({
        error: 'Failed to write to .env file'
      });
    }
  });

  // ---- Categories ----
  router.get('/categories', async (req, res) => {
    res.json(await db.prepare('SELECT * FROM categories ORDER BY name').all());
  });
  router.post('/categories', async (req, res) => {
    const {
      name
    } = req.body;
    if (!name || !name.trim()) return res.status(400).json({
      error: 'Category name required.'
    });
    try {
      const info = await db.prepare('INSERT INTO categories (name) VALUES (?)').run(name.trim());
      res.json({
        id: info.lastInsertRowid,
        name: name.trim()
      });
    } catch (e) {
      res.status(409).json({
        error: 'Category already exists.'
      });
    }
  });
  router.delete('/categories/:id', async (req, res) => {
    await db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
    res.json({
      ok: true
    });
  });

  // ---- Challenges ----
  router.get('/challenges', async (req, res) => {
    const challenges = await db.prepare(`
      SELECT c.*, cat.name AS category
      FROM challenges c LEFT JOIN categories cat ON cat.id = c.category_id
      ORDER BY c.created_at DESC
    `).all();
    const hints = await db.prepare('SELECT * FROM hints ORDER BY order_index ASC').all();
    const solveCounts = await db.prepare('SELECT challenge_id, COUNT(*) AS n FROM solves GROUP BY challenge_id').all();
    const solveMap = new Map(solveCounts.map(r => [r.challenge_id, r.n]));
    const result = challenges.map(c => ({
      ...c,
      flag_hash: undefined,
      solveCount: solveMap.get(c.id) || 0,
      hints: hints.filter(h => h.challenge_id === c.id)
    }));
    res.json(result);
  });
  router.post('/challenges', async (req, res) => {
    const {
      title,
      categoryId,
      description,
      points,
      flag,
      difficulty,
      link,
      visible,
      hints,
      requires,
      isPractice
    } = req.body;
    if (!title || !description || !flag || !points) {
      return res.status(400).json({
        error: 'Title, description, points, and flag are required.'
      });
    }
    const flagHash = bcrypt.hashSync(String(flag).trim(), 10);
    const info = await db.prepare(`
      INSERT INTO challenges (title, category_id, description, points, flag_hash, difficulty, link, visible, requires, is_practice)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title.trim(), categoryId || null, description, Number(points), flagHash, difficulty || 'medium', link || null, visible === false ? 0 : 1, requires ? Number(requires) : null, isPractice ? 1 : 0);
    const challengeId = info.lastInsertRowid;
    if (Array.isArray(hints)) {
      const insertHint = db.prepare('INSERT INTO hints (challenge_id, text, cost, order_index) VALUES (?, ?, ?, ?)');
      hints.forEach((h, i) => {
        if (h.text && h.text.trim()) insertHint.run(challengeId, h.text.trim(), Number(h.cost) || 0, i);
      });
    }
    res.json({
      id: challengeId
    });
  });
  router.put('/challenges/:id', async (req, res) => {
    const id = Number(req.params.id);
    const {
      title,
      categoryId,
      description,
      points,
      flag,
      difficulty,
      link,
      visible,
      requires,
      isPractice
    } = req.body;
    const existing = await db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({
      error: 'Challenge not found.'
    });
    const flagHash = flag && flag.trim() ? bcrypt.hashSync(flag.trim(), 10) : existing.flag_hash;
    await db.prepare(`
      UPDATE challenges SET title = ?, category_id = ?, description = ?, points = ?,
        flag_hash = ?, difficulty = ?, link = ?, visible = ?, requires = ?, is_practice = ?
      WHERE id = ?
    `).run(title ?? existing.title, categoryId ?? existing.category_id, description ?? existing.description, points !== undefined ? Number(points) : existing.points, flagHash, difficulty ?? existing.difficulty, link ?? existing.link, visible === false ? 0 : 1, requires !== undefined ? requires ? Number(requires) : null : existing.requires, isPractice !== undefined ? isPractice ? 1 : 0 : existing.is_practice, id);
    res.json({
      ok: true
    });
  });
  router.delete('/challenges/:id', async (req, res) => {
    await db.prepare('DELETE FROM challenges WHERE id = ?').run(Number(req.params.id));
    broadcastScoreboard(io);
    res.json({
      ok: true
    });
  });

  // ---- Hints ----
  router.post('/challenges/:id/hints', async (req, res) => {
    const challengeId = Number(req.params.id);
    const {
      text,
      cost
    } = req.body;
    if (!text || !text.trim()) return res.status(400).json({
      error: 'Hint text required.'
    });
    const maxOrder = (await db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM hints WHERE challenge_id = ?').get(challengeId)).m;
    const info = await db.prepare('INSERT INTO hints (challenge_id, text, cost, order_index) VALUES (?, ?, ?, ?)').run(challengeId, text.trim(), Number(cost) || 0, maxOrder + 1);
    res.json({
      id: info.lastInsertRowid
    });
  });
  router.delete('/hints/:id', async (req, res) => {
    await db.prepare('DELETE FROM hints WHERE id = ?').run(Number(req.params.id));
    res.json({
      ok: true
    });
  });

  // ---- Teams ----
  router.get('/teams', async (req, res) => {
    const teams = await db.prepare('SELECT id, name, full_name, student_id, college_id, operative_type, members_count, is_banned, created_at FROM teams ORDER BY id ASC').all();
    res.json(teams);
  });
  router.post('/teams/:id/ban', async (req, res) => {
    await db.prepare('UPDATE teams SET is_banned = 1 WHERE id = ?').run(req.params.id);
    res.json({
      ok: true
    });
  });
  router.post('/teams/:id/unban', async (req, res) => {
    await db.prepare('UPDATE teams SET is_banned = 0 WHERE id = ?').run(req.params.id);
    res.json({
      ok: true
    });
  });
  router.delete('/teams/:id', async (req, res) => {
    await db.prepare('DELETE FROM teams WHERE id = ?').run(Number(req.params.id));
    broadcastScoreboard(io);
    res.json({
      ok: true
    });
  });

  // ---- Settings ----
  router.get('/settings', async (req, res) => {
    const rows = await db.prepare('SELECT key, value FROM settings').all();
    const obj = {};
    rows.forEach(r => obj[r.key] = r.value);
    res.json(obj);
  });
  router.put('/settings', (req, res) => {
    const update = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(req.body || {})) update.run(k, String(v));
    res.json({
      ok: true
    });
  });

  // ---- Live Registration Submissions ----
  router.get('/registration-submissions', async (req, res) => {
    const submissions = await db.prepare('SELECT * FROM live_registration_submissions ORDER BY submitted_at DESC').all();
    const result = submissions.map(s => {
      let data = {};
      try {
        data = JSON.parse(s.data);
      } catch (e) {}
      return {
        id: s.id,
        submitted_at: s.submitted_at,
        data
      };
    });
    res.json(result);
  });
  router.delete('/registration-submissions', async (req, res) => {
    await db.prepare('DELETE FROM live_registration_submissions').run();
    res.json({
      ok: true
    });
  });

  // ---- Feedback System ----
  router.get('/feedback', async (req, res) => {
    const fb = await db.prepare(`
      SELECT f.id, f.rating, f.comments, f.submitted_at, t.name as team_name 
      FROM feedback f 
      JOIN teams t ON f.team_id = t.id 
      ORDER BY f.submitted_at DESC
    `).all();
    res.json(fb);
  });

  // ---- Anomaly ----
  router.get('/anomaly', (req, res) => {
    res.json(state.anomaly || {
      active: false
    });
  });
  router.post('/anomaly', async (req, res) => {
    const {
      categoryId,
      multiplier,
      durationMinutes
    } = req.body;
    if (!categoryId || !multiplier || !durationMinutes) {
      return res.status(400).json({
        error: 'Missing anomaly parameters.'
      });
    }
    const cat = await db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId);
    if (!cat) return res.status(400).json({
      error: 'Invalid category'
    });
    state.anomaly = {
      active: true,
      categoryId: Number(categoryId),
      categoryName: cat.name,
      multiplier: Number(multiplier),
      endTime: Date.now() + Number(durationMinutes) * 60000
    };
    const msg = `SURGE ANOMALY: A ${multiplier}x multiplier has been detected for ${durationMinutes} minutes for ${cat.name}!`;
    await db.prepare("INSERT INTO notifications (message, type) VALUES (?, 'anomaly')").run(msg);
    io.emit('anomaly:start', state.anomaly);
    io.emit('anomaly_alert', {
      message: msg,
      timestamp: new Date().toISOString()
    });
    const discord = require('../utils/discord');
    discord.sendAnomaly(cat.name, multiplier, durationMinutes);
    res.json(state.anomaly);
  });
  router.post('/anomaly/clear', (req, res) => {
    state.anomaly = null;
    io.emit('anomaly:end');
    res.json({
      ok: true
    });
  });

  // ---- Media Uploads ----
  router.post('/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded.'
      });
    }
    // Return the public URL to the uploaded file
    res.json({
      url: `/uploads/${req.file.filename}`
    });
  });

  // ---- Chat ----
  router.get('/chat/teams', async (req, res) => {
    // Get list of teams that have sent or received messages
    const teams = await db.prepare(`
      SELECT DISTINCT t.id, t.name 
      FROM teams t
      JOIN messages m ON m.team_id = t.id
    `).all();
    res.json(teams);
  });
  router.get('/chat/messages/:teamId', async (req, res) => {
    const messages = await db.prepare('SELECT * FROM messages WHERE team_id = ? ORDER BY created_at ASC').all(req.params.teamId);
    res.json(messages);
  });

  // ---- Timer ----
  router.post('/timer', async (req, res) => {
    const {
      durationMinutes,
      startTimestamp
    } = req.body;
    let endTime = null;
    let startTime = null;
    if (startTimestamp) {
      startTime = Number(startTimestamp);
      await db.prepare("REPLACE INTO settings (key, value) VALUES ('ctf_start_time', ?)").run(startTime);
    } else {
      await db.prepare("REPLACE INTO settings (key, value) VALUES ('ctf_start_time', NULL)").run();
    }
    if (durationMinutes) {
      endTime = (startTime || Date.now()) + Number(durationMinutes) * 60000;
      await db.prepare("REPLACE INTO settings (key, value) VALUES ('ctf_end_time', ?)").run(endTime);
    } else {
      await db.prepare("REPLACE INTO settings (key, value) VALUES ('ctf_end_time', NULL)").run();
    }
    io.emit('timer:update', {
      startTime,
      endTime
    });
    res.json({
      ok: true,
      startTime,
      endTime
    });
  });
  router.get('/timer', async (req, res) => {
    const endRow = await db.prepare("SELECT value FROM settings WHERE key = 'ctf_end_time'").get();
    const startRow = await db.prepare("SELECT value FROM settings WHERE key = 'ctf_start_time'").get();
    res.json({
      endTime: endRow && endRow.value ? Number(endRow.value) : null,
      startTime: startRow && startRow.value ? Number(startRow.value) : null
    });
  });

  // ---- Factory Reset ----
  router.post('/reset', async (req, res) => {
    // Delete user generated data, keep configurations and challenges
    await db.prepare('DELETE FROM teams').run();
    await db.prepare('DELETE FROM solves').run();
    await db.prepare('DELETE FROM wrong_attempts').run();
    await db.prepare('DELETE FROM messages').run();
    await db.prepare('DELETE FROM notifications').run();
    await db.prepare('DELETE FROM hint_reveals').run();

    // Clear anomaly and timer states in memory and db
    state.anomaly = null;
    await db.prepare("REPLACE INTO settings (key, value) VALUES ('ctf_start_time', NULL)").run();
    await db.prepare("REPLACE INTO settings (key, value) VALUES ('ctf_end_time', NULL)").run();

    // Broadcast state changes
    io.emit('anomaly:end');
    io.emit('timer:update', {
      startTime: null,
      endTime: null
    });
    broadcastScoreboard(io);
    io.emit('activity'); // force challenge reload for all clients

    res.json({
      ok: true
    });
  });
  return router;
};