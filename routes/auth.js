const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

router.post('/register', (req, res) => {
  const { teamName, password, operativeType, membersCount } = req.body;

  if (getSetting('registration_open') !== '1') {
    return res.status(403).json({ error: 'Registration is currently closed.' });
  }
  if (!teamName || !password || teamName.trim().length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Team name must be 3+ characters and password 6+ characters.' });
  }

  const existing = db.prepare('SELECT id FROM teams WHERE name = ?').get(teamName.trim());
  if (existing) {
    return res.status(409).json({ error: 'That team name is already taken.' });
  }

  const opType = operativeType === 'Lone Wolf' ? 'Lone Wolf' : 'Syndicate';
  const memCount = opType === 'Lone Wolf' ? 1 : (parseInt(membersCount) || 2);

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO teams (name, password_hash, operative_type, members_count) VALUES (?, ?, ?, ?)').run(teamName.trim(), hash, opType, memCount);

  req.session.teamId = info.lastInsertRowid;
  req.session.teamName = teamName.trim();
  res.json({ id: info.lastInsertRowid, name: teamName.trim() });
});

router.post('/login', (req, res) => {
  const { teamName, password } = req.body;
  const team = db.prepare('SELECT * FROM teams WHERE name = ?').get((teamName || '').trim());

  if (!team || !bcrypt.compareSync(password || '', team.password_hash)) {
    return res.status(401).json({ error: 'Incorrect team name or password.' });
  }

  if (team.is_banned === 1) {
    return res.status(403).json({ error: 'This account has been banned from the CTF.' });
  }

  req.session.teamId = team.id;
  req.session.teamName = team.name;
  res.json({ id: team.id, name: team.name });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/public-settings', (req, res) => {
  res.json({
    event_name: getSetting('event_name') || 'CTF',
    start_time: getSetting('start_time') || '',
    end_time: getSetting('end_time') || '',
    headline: getSetting('headline') || '',
    registration_open: getSetting('registration_open') === '1'
  });
});

router.get('/me', (req, res) => {
  if (req.session.teamId) {
    const team = db.prepare('SELECT name, operative_type, members_count, roster FROM teams WHERE id = ?').get(req.session.teamId);
    if (!team) return res.json({ team: null, isAdmin: !!req.session.isAdmin });
    
    return res.json({ 
      team: { 
        id: req.session.teamId, 
        name: team.name,
        operative_type: team.operative_type,
        members_count: team.members_count,
        roster: team.roster ? JSON.parse(team.roster) : []
      }, 
      isAdmin: !!req.session.isAdmin 
    });
  }
  res.json({ team: null, isAdmin: !!req.session.isAdmin });
});

router.post('/roster', (req, res) => {
  if (!req.session.teamId) return res.status(401).json({ error: 'Not logged in' });
  const { roster } = req.body;
  if (!Array.isArray(roster)) return res.status(400).json({ error: 'Roster must be an array' });
  
  db.prepare('UPDATE teams SET roster = ? WHERE id = ?').run(JSON.stringify(roster), req.session.teamId);
  res.json({ ok: true });
});

router.get('/profile', (req, res) => {
  if (!req.session.teamId) return res.status(401).json({ error: 'Not logged in' });
  const solves = db.prepare(`
    SELECT cat.name as category, COUNT(s.id) as solves
    FROM solves s
    JOIN challenges c ON s.challenge_id = c.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE s.team_id = ?
    GROUP BY cat.id
  `).all(req.session.teamId);
  
  res.json(solves);
});

router.get('/analysis', (req, res) => {
  if (!req.session.teamId) return res.status(401).json({ error: 'Not logged in' });
  const teamId = req.session.teamId;

  const activeCategories = db.prepare(`
    SELECT DISTINCT cat.id, cat.name
    FROM categories cat
    JOIN challenges c ON c.category_id = cat.id
    WHERE c.visible = 1
  `).all();

  const solvedChallenges = db.prepare(`
    SELECT s.challenge_id, c.category_id, cat.name as category, s.awarded_points
    FROM solves s
    JOIN challenges c ON s.challenge_id = c.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE s.team_id = ?
  `).all(teamId);
  
  const solvedIds = new Set(solvedChallenges.map(s => s.challenge_id));

  const wrongAttempts = db.prepare(`
    SELECT challenge_id, COUNT(*) as count, MIN(attempted_at) as first_attempt, MAX(attempted_at) as last_attempt
    FROM wrong_attempts
    WHERE team_id = ?
    GROUP BY challenge_id
  `).all(teamId);

  // Calculate Interactions
  const interactedCategories = new Set();
  solvedChallenges.forEach(s => interactedCategories.add(s.category_id));
  
  wrongAttempts.forEach(w => {
    const chal = db.prepare('SELECT category_id FROM challenges WHERE id = ?').get(w.challenge_id);
    if (chal) interactedCategories.add(chal.category_id);
  });

  // Sharp Knowledge Gaps: Only flag if they have a decent amount of solves overall (not a total beginner)
  let knowledgeGaps = [];
  if (solvedChallenges.length >= 3) {
    knowledgeGaps = activeCategories
      .filter(c => !interactedCategories.has(c.id))
      .map(c => c.name);
  }

  // Sharp Stuck Analysis: Factor in time spent, not just raw attempt count
  const stuckChallenges = [];
  wrongAttempts.forEach(w => {
    if (!solvedIds.has(w.challenge_id)) {
      const first = new Date(w.first_attempt).getTime();
      const last = new Date(w.last_attempt).getTime();
      const timeSpentMins = (last - first) / 60000;
      
      // True struggle: 5+ attempts OR (3+ attempts and spanning over 10 minutes)
      if (w.count >= 5 || (w.count >= 3 && timeSpentMins > 10)) {
        const chal = db.prepare('SELECT title FROM challenges WHERE id = ?').get(w.challenge_id);
        if (chal) stuckChallenges.push(chal.title);
      }
    }
  });

  // Sharp Strong Domains: Rank by total points earned, not just number of solves
  const pointsPerCategory = {};
  solvedChallenges.forEach(s => {
    const catName = s.category || 'Uncategorized';
    pointsPerCategory[catName] = (pointsPerCategory[catName] || 0) + (s.awarded_points || 0);
  });
  const strongDomains = Object.keys(pointsPerCategory).sort((a,b) => pointsPerCategory[b] - pointsPerCategory[a]);

  res.json({
    stuck: stuckChallenges,
    gaps: knowledgeGaps,
    strong: strongDomains
  });
});

module.exports = router;
