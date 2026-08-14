const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  requireTeam
} = require('../middleware/auth');
const {
  broadcastScoreboard
} = require('./scoreboard');
const state = require('../state');
const discord = require('../utils/discord');
const {
  exec
} = require('child_process');
module.exports = function (io) {
  const router = express.Router();
  const bruteForceTracker = {};

  // Get current anomaly state
  router.get('/anomaly/current', (req, res) => {
    res.json(state.anomaly || {
      active: false
    });
  });

  // Global Network Health
  router.get('/health', async (req, res) => {
    const totalSolvesRes = await db.prepare('SELECT count(*) as count FROM solves').get();
    const totalTeamsRes = await db.prepare('SELECT count(*) as count FROM teams').get();
    const totalChalsRes = await db.prepare('SELECT count(*) as count FROM challenges WHERE visible = 1').get();
    const solves = totalSolvesRes.count;
    const maxSolves = totalTeamsRes.count * totalChalsRes.count;
    let health = 100;
    if (maxSolves > 0) {
      health = Math.max(0, 100 - solves / maxSolves * 100);
    }
    res.json({
      health: health.toFixed(1)
    });
  });

  const checkCTFStarted = async (req, res, next) => {
    const isGlobal = !req.params.id && !req.params.hintId;
    if (isGlobal) return next(); // Let GET / and GET /graph filter themselves

    let isPractice = false;
    if (req.params.id) {
       const chal = await db.prepare('SELECT is_practice FROM challenges WHERE id = ?').get(req.params.id);
       if (chal && chal.is_practice === 1) isPractice = true;
    } else if (req.params.hintId) {
       const chal = await db.prepare('SELECT c.is_practice FROM challenges c JOIN hints h ON h.challenge_id = c.id WHERE h.id = ?').get(req.params.hintId);
       if (chal && chal.is_practice === 1) isPractice = true;
    }

    if (isPractice) return next(); // Practice challenges are always accessible

    // Now check Live CTF timing
    const liveStartRow = await db.prepare("SELECT value FROM settings WHERE key = 'live_ctf_event_start'").get();
    const liveEndRow = await db.prepare("SELECT value FROM settings WHERE key = 'live_ctf_event_end'").get();
    const statusRow = await db.prepare("SELECT value FROM settings WHERE key = 'ctf_status'").get();
    const isManualLive = statusRow && statusRow.value === 'live';

    if (!isManualLive && liveStartRow && liveStartRow.value) {
      const liveStartTime = new Date(liveStartRow.value).getTime();
      if (Date.now() < liveStartTime) {
        return res.status(403).json({
          error: 'Live CTF has not started yet.',
          upcoming: true,
          startTime: liveStartTime
        });
      }
    }
    
    // Check if team is a Live team
    if (req.session.teamId) {
       const team = await db.prepare('SELECT is_live FROM teams WHERE id = ?').get(req.session.teamId);
       if (!team || team.is_live !== 1) {
           return res.status(403).json({
               error: 'You must register for the Live CTF to access this challenge.'
           });
       }
    }

    next();
  };

  // List all visible challenges, with per-team solve/hint state
  router.get('/', checkCTFStarted, async (req, res) => {
    const teamId = req.session.teamId || null;
    let isLiveTeam = false;
    if (teamId) {
      const team = await db.prepare('SELECT is_live FROM teams WHERE id = ?').get(teamId);
      if (team && team.is_live === 1) isLiveTeam = true;
    }
    
    // Check if Live CTF has started (either time has arrived or admin forced live)
    let liveStarted = false;
    const liveStartRow = await db.prepare("SELECT value FROM settings WHERE key = 'live_ctf_event_start'").get();
    const statusRow = await db.prepare("SELECT value FROM settings WHERE key = 'ctf_status'").get();
    
    if (statusRow && statusRow.value === 'live') {
      liveStarted = true;
    } else if (liveStartRow && liveStartRow.value) {
      const liveStartTime = new Date(liveStartRow.value).getTime();
      if (Date.now() >= liveStartTime) {
        liveStarted = true;
      }
    } else {
      liveStarted = true;
    }

    const challenges = await db.prepare(`
      SELECT c.id, c.title, c.category_id, cat.name AS category, c.description,
             c.points, c.difficulty, c.link, c.requires, c.docker_image, c.is_practice
          FROM challenges c
          LEFT JOIN categories cat ON cat.id = c.category_id
          WHERE c.visible = 1
          ORDER BY cat.name, c.points ASC
        `).all();
        
        // Filter challenges based on rules
        const visibleChallenges = challenges.filter(c => {
          if (c.is_practice === 1) return true; // Practice always visible
          if (c.is_practice === 0) {
            // Live challenges only visible to Live Teams after CTF has started
            return isLiveTeam && liveStarted;
          }
          return false;
        });

    const solvedIds = teamId ? new Set((await db.prepare('SELECT challenge_id FROM solves WHERE team_id = ?').all(teamId)).map(r => r.challenge_id)) : new Set();
    const claims = teamId ? (await db.prepare('SELECT challenge_id, operative_alias FROM challenge_claims WHERE team_id = ?').all(teamId)).reduce((acc, row) => {
      acc[row.challenge_id] = row.operative_alias;
      return acc;
    }, {}) : {};
    const revealedHintIds = teamId ? new Set((await db.prepare('SELECT hint_id FROM hint_reveals WHERE team_id = ?').all(teamId)).map(r => r.hint_id)) : new Set();
    const hintsByChallenge = await db.prepare('SELECT * FROM hints ORDER BY order_index ASC').all();
    const result = visibleChallenges.map(c => {
      const hints = hintsByChallenge.filter(h => h.challenge_id === c.id).map(h => ({
        id: h.id,
        cost: h.cost,
        revealed: revealedHintIds.has(h.id),
        text: revealedHintIds.has(h.id) ? h.text : null
      }));
      return {
        ...c,
        solved: solvedIds.has(c.id),
        claimed_by: claims[c.id] || null,
        hints
      };
    });
    res.json(result);
  });

  // Return network graph data for the Lateral Movement visualizer
  router.get('/graph', requireTeam, checkCTFStarted, async (req, res) => {
    const teamId = req.session.teamId;
    const challenges = await db.prepare(`
      SELECT c.id, c.title, c.category_id, cat.name AS category, c.requires
      FROM challenges c
      LEFT JOIN categories cat ON cat.id = c.category_id
      WHERE c.visible = 1
    `).all();
    const solvedIds = new Set((await db.prepare('SELECT challenge_id FROM solves WHERE team_id = ?').all(teamId)).map(r => r.challenge_id));
    const nodes = [];
    const edges = [];
    challenges.forEach(c => {
      const isSolved = solvedIds.has(c.id);
      let group = 'locked';
      if (isSolved) {
        group = 'solved';
      } else if (!c.requires || solvedIds.has(c.requires)) {
        group = 'unlocked';
      }
      nodes.push({
        id: c.id,
        label: c.title,
        group: group,
        title: `${c.category} (Requires: ${c.requires || 'None'})`
      });
      if (c.requires) {
        edges.push({
          from: c.requires,
          to: c.id,
          arrows: 'to'
        });
      }
    });
    res.json({
      nodes,
      edges
    });
  });

  // Submit a flag
  router.post('/:id/submit', requireTeam, checkCTFStarted, async (req, res) => {
    const challengeId = Number(req.params.id);
    const {
      flag
    } = req.body;
    const teamId = req.session.teamId;
    const challenge = await db.prepare('SELECT * FROM challenges WHERE id = ? AND visible = 1').get(challengeId);
    if (!challenge) return res.status(404).json({
      error: 'Challenge not found.'
    });
    if (flag && /(<script>|' OR 1=1|UNION SELECT|alert\()/i.test(flag.trim())) {
      io.to('admin_room').emit('admin:alert', {
        type: 'PLATFORM_ATTACK',
        message: `Team "${req.session.teamName}" attempted to attack the platform via flag submission! Payload: ${flag.substring(0, 50)}`,
        timestamp: new Date().toISOString()
      });
      return res.status(400).json({
        error: 'Attack payload detected. This incident has been logged.'
      });
    }
    if (!flag || !/^(flag|FLAG)\{.*\}$/.test(flag.trim())) {
      return res.status(400).json({
        error: 'Invalid format: Flags must match flag{...}'
      });
    }
    const already = await db.prepare('SELECT 1 FROM solves WHERE team_id = ? AND challenge_id = ?').get(teamId, challengeId);
    if (already) return res.status(409).json({
      error: 'Already solved.'
    });
    const now = new Date();
    const settings = await db.prepare("SELECT value FROM settings WHERE key = 'end_time'").get();
    if (settings && settings.value) {
      if (now > new Date(settings.value)) {
        return res.status(403).json({
          error: 'Event has ended. Practice mode is read-only.'
        });
      }
    }
    if (challenge.requires) {
      const reqSolved = await db.prepare('SELECT 1 FROM solves WHERE team_id = ? AND challenge_id = ?').get(teamId, challenge.requires);
      if (!reqSolved) {
        return res.status(403).json({
          error: 'Prerequisite challenge not solved.'
        });
      }
    }
    const correct = bcrypt.compareSync((flag || '').trim(), challenge.flag_hash);
    if (!correct) {
      await db.prepare('INSERT INTO wrong_attempts (team_id, challenge_id) VALUES (?, ?)').run(teamId, challengeId);
      io.emit('heat:update', {
        type: 'attempt',
        challengeId
      });

      // Brute-force detection
      const nowTs = Date.now();
      if (!bruteForceTracker[teamId]) bruteForceTracker[teamId] = [];
      bruteForceTracker[teamId].push(nowTs);

      // Keep only last 10 seconds
      bruteForceTracker[teamId] = bruteForceTracker[teamId].filter(ts => nowTs - ts < 10000);
      if (bruteForceTracker[teamId].length >= 5) {
        io.to('admin_room').emit('admin:alert', {
          type: 'BRUTE_FORCE_ATTACK',
          message: `Team "${req.session.teamName}" submitted ${bruteForceTracker[teamId].length} incorrect flags in 10 seconds! Possible script detected.`,
          timestamp: new Date().toISOString()
        });
        bruteForceTracker[teamId] = []; // reset to avoid spamming
      }
      return res.status(200).json({
        correct: false
      });
    }

    // First Blood Check & Dynamic Scoring Decay
    const solveCount = (await db.prepare('SELECT COUNT(*) as count FROM solves WHERE challenge_id = ?').get(challengeId)).count;
    let isFirstBlood = solveCount === 0;

    // Decay multiplier drops 5% per solve, bottoming out at 20% of original points
    const decayMultiplier = Math.max(0.2, 1 - solveCount * 0.05);
    const basePoints = Math.floor(challenge.points * decayMultiplier);

    // Momentum scoring logic
    let streak = 0;
    const lastSolve = await db.prepare('SELECT solved_at, streak FROM solves WHERE team_id = ? ORDER BY solved_at DESC LIMIT 1').get(teamId);
    const lastWrong = await db.prepare('SELECT attempted_at FROM wrong_attempts WHERE team_id = ? ORDER BY attempted_at DESC LIMIT 1').get(teamId);
    let lastSolveTime = 0;
    let lastWrongTime = 0;
    if (lastSolve) lastSolveTime = new Date(lastSolve.solved_at).getTime();
    if (lastWrong) lastWrongTime = new Date(lastWrong.attempted_at).getTime();
    if (lastSolve && lastSolveTime > lastWrongTime) {
      const diffMins = (now.getTime() - lastSolveTime) / (1000 * 60);
      if (diffMins <= 30) {
        streak = (lastSolve.streak || 0) + 1;
      }
    }
    let multiplier = 1 + Math.min(streak * 0.05, 0.25);
    let anomalySurge = false;
    if (state.anomaly && state.anomaly.categoryId === challenge.category_id && state.anomaly.endTime > Date.now()) {
      multiplier *= state.anomaly.multiplier;
      anomalySurge = true;
    }
    let awarded_points = Math.floor(basePoints * multiplier);

    // First Blood Bounty Bonus (+50 flat)
    if (isFirstBlood) {
      awarded_points += 50;
    }
    await db.prepare('INSERT INTO solves (team_id, challenge_id, awarded_points, streak) VALUES (?, ?, ?, ?)').run(teamId, challengeId, awarded_points, streak);
    if (isFirstBlood) {
      io.emit('first_blood', {
        team: req.session.teamName,
        challenge: challenge.title,
        bounty: 50
      });
      discord.sendFirstBlood(req.session.teamName, challenge.title, awarded_points);
    }
    broadcastScoreboard(io);
    io.emit('activity', {
      team: req.session.teamName,
      challenge: challenge.title,
      points: awarded_points,
      at: now.toISOString(),
      anomalySurge,
      streak
    });
    io.emit('heat:update', {
      type: 'solve',
      challengeId
    });
    res.json({
      correct: true,
      points: awarded_points,
      streak
    });
  });

  // Deploy Docker Sandbox
  router.post('/:id/deploy', requireTeam, checkCTFStarted, async (req, res) => {
    const challengeId = Number(req.params.id);
    const challenge = await db.prepare('SELECT * FROM challenges WHERE id = ? AND visible = 1').get(challengeId);
    if (!challenge) return res.status(404).json({
      error: 'Challenge not found.'
    });
    if (challenge.difficulty !== 'hard') {
      return res.status(400).json({
        error: 'Only hard challenges have isolated sandboxes.'
      });
    }
    const image = challenge.docker_image;
    if (!image) {
      return res.status(400).json({
        error: 'This challenge does not use a Docker sandbox. Please read the description carefully to solve it.'
      });
    }

    // Attempt to spawn docker
    exec(`docker run -d -P ${image}`, (error, stdout, stderr) => {
      if (error) {
        console.error('Docker run error:', error.message, stderr);
        if (error.message.includes('not recognized') || error.message.includes('not found') || error.message.includes('ENOENT') || stderr && stderr.includes('not recognized')) {
          return res.status(500).json({
            error: 'Docker is not installed or running on the host server. Please install Docker to use real sandboxes.'
          });
        }
        return res.status(500).json({
          error: `Failed to provision container. Make sure the ${image} image is built.`
        });
      }
      const containerId = stdout.trim();
      exec(`docker port ${containerId}`, (err, out, serr) => {
        if (err) {
          return res.status(500).json({
            error: 'Container spawned but failed to map ports.'
          });
        }
        try {
          const port = out.split(':')[1].trim();
          global.activeSandboxes.set(containerId, {
            port,
            expiresAt: Date.now() + 30 * 60000
          });
          res.json({
            proxyUrl: `/sandbox/${containerId}`,
            containerId
          });
        } catch (e) {
          res.status(500).json({
            error: 'Failed to parse exposed port.'
          });
        }
      });
    });
  });

  // KoTH Submission
  router.post('/:id/koth-submit', requireTeam, checkCTFStarted, async (req, res) => {
    const challengeId = Number(req.params.id);
    const {
      token
    } = req.body;
    const teamId = req.session.teamId;
    const challenge = await db.prepare('SELECT * FROM challenges WHERE id = ? AND visible = 1 AND is_koth = 1').get(challengeId);
    if (!challenge) return res.status(404).json({
      error: 'KoTH Node not found.'
    });
    const correct = bcrypt.compareSync((token || '').trim(), challenge.flag_hash);
    if (!correct) return res.status(403).json({
      error: 'Access Denied.'
    });
    await db.prepare('INSERT INTO koth_control (challenge_id, team_id, claimed_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(challenge_id) DO UPDATE SET team_id = EXCLUDED.team_id, claimed_at = CURRENT_TIMESTAMP').run(challengeId, teamId);
    io.emit('activity', {
      team: req.session.teamName,
      challenge: challenge.title + ' (Area Secured)',
      points: 0,
      at: new Date().toISOString(),
      anomalySurge: false
    });
    res.json({
      success: true,
      message: 'Node Controlled!'
    });
  });

  // Reveal a hint (deducts points by marking a "cost" — enforced at scoreboard calc time)
  router.post('/hints/:hintId/reveal', requireTeam, checkCTFStarted, async (req, res) => {
    const hintId = Number(req.params.hintId);
    const teamId = req.session.teamId;
    const hint = await db.prepare('SELECT * FROM hints WHERE id = ?').get(hintId);
    if (!hint) return res.status(404).json({
      error: 'Hint not found.'
    });
    const already = await db.prepare('SELECT 1 FROM hint_reveals WHERE team_id = ? AND hint_id = ?').get(teamId, hintId);
    if (already) return res.json({
      text: hint.text
    });
    await db.prepare('INSERT INTO hint_reveals (team_id, hint_id) VALUES (?, ?) RETURNING team_id').run(teamId, hintId);
    if (hint.cost > 0) broadcastScoreboard(io);
    res.json({
      text: hint.text
    });
  });

  // Ghost replay route
  router.get('/:id/ghosts', async (req, res) => {
    const challengeId = Number(req.params.id);
    const settings = await db.prepare("SELECT value FROM settings WHERE key = 'end_time'").get();
    if (!settings || !settings.value || new Date() <= new Date(settings.value)) {
      return res.status(403).json({
        error: 'Ghost replay only available after event ends.'
      });
    }

    // Get top 5 teams based on current scoreboard computation
    // Actually, computeScoreboard is somewhat expensive, but ghost replay only happens post-event.
    const {
      computeScoreboard
    } = require('./scoreboard');
    const board = computeScoreboard();
    const top5TeamIds = board.slice(0, 5).map(t => t.teamId);
    if (top5TeamIds.length === 0) return res.json([]);
    const placeholders = top5TeamIds.map(() => '?').join(',');
    const solves = await db.prepare(`
      SELECT s.solved_at, t.name as team
      FROM solves s
      JOIN teams t ON t.id = s.team_id
      WHERE s.challenge_id = ? AND s.team_id IN (${placeholders})
      ORDER BY s.solved_at ASC
    `).all(challengeId, ...top5TeamIds);
    res.json(solves);
  });

  // ---- Feedback System ----
  router.get('/feedback/status', async (req, res) => {
    const existing = await db.prepare('SELECT id FROM feedback WHERE team_id = ?').get(req.session.teamId);
    res.json({
      submitted: !!existing
    });
  });
  router.post('/feedback', async (req, res) => {
    const {
      rating,
      comments
    } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        error: 'Rating must be between 1 and 5 stars.'
      });
    }
    const existing = await db.prepare('SELECT id FROM feedback WHERE team_id = ?').get(req.session.teamId);
    if (existing) {
      return res.status(400).json({
        error: 'You have already submitted feedback!'
      });
    }
    await db.prepare('INSERT INTO feedback (team_id, rating, comments) VALUES (?, ?, ?)').run(req.session.teamId, rating, comments || '');
    res.json({
      ok: true
    });
  });
  return router;
};