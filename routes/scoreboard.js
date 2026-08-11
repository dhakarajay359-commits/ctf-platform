const express = require('express');
const db = require('../db');

const router = express.Router();

function computeScoreboard() {
  const teams = db.prepare('SELECT id, name, operative_type, members_count FROM teams').all();

  const solvePoints = db.prepare(`
    SELECT s.team_id AS team_id, SUM(COALESCE(s.awarded_points, c.points)) AS earned, MAX(s.solved_at) AS last_solve
    FROM solves s JOIN challenges c ON c.id = s.challenge_id
    GROUP BY s.team_id
  `).all();
  const solveMap = new Map(solvePoints.map(r => [r.team_id, r]));

  const hintCosts = db.prepare(`
    SELECT hr.team_id AS team_id, SUM(h.cost) AS spent
    FROM hint_reveals hr JOIN hints h ON h.id = hr.hint_id
    GROUP BY hr.team_id
  `).all();
  const hintMap = new Map(hintCosts.map(r => [r.team_id, r.spent]));

  const kothPoints = db.prepare('SELECT team_id, points FROM koth_points').all();
  const kothMap = new Map(kothPoints.map(r => [r.team_id, r.points]));

  const solveCounts = db.prepare(`
    SELECT team_id, COUNT(*) AS n FROM solves GROUP BY team_id
  `).all();
  const solveCountMap = new Map(solveCounts.map(r => [r.team_id, r.n]));

  // Badge Data Gathering
  const allSolves = db.prepare('SELECT team_id, challenge_id, solved_at, streak FROM solves ORDER BY solved_at ASC').all();
  const wrongAttempts = db.prepare('SELECT team_id FROM wrong_attempts').all();
  const wrongSet = new Set(wrongAttempts.map(w => w.team_id));
  
  const firstBloods = new Set();
  const seenChallenges = new Set();
  for (const s of allSolves) {
    if (!seenChallenges.has(s.challenge_id)) {
      seenChallenges.add(s.challenge_id);
      firstBloods.add(s.team_id);
    }
  }

  const rows = teams.map(t => {
    const earned = solveMap.get(t.id)?.earned || 0;
    const spent = hintMap.get(t.id) || 0;
    const koth = kothMap.get(t.id) || 0;
    const score = earned - spent + koth;
    
    // Compute badges
    const badges = [];
    if (firstBloods.has(t.id)) badges.push('🩸'); // First Blood
    
    const teamSolves = allSolves.filter(s => s.team_id === t.id);
    if (teamSolves.some(s => {
      const h = new Date(s.solved_at + 'Z').getUTCHours();
      return h >= 2 && h <= 5;
    })) {
      badges.push('🦉'); // Night Owl
    }
    
    if (teamSolves.some(s => s.streak >= 3)) badges.push('⚡'); // Speed Demon
    
    if (teamSolves.length > 0 && !wrongSet.has(t.id)) badges.push('✨'); // Flawless
    
    return {
      teamId: t.id,
      team: t.name,
      operativeType: t.operative_type || 'Syndicate',
      membersCount: t.members_count || 2,
      score,
      solves: solveCountMap.get(t.id) || 0,
      lastSolve: solveMap.get(t.id)?.last_solve || null,
      badges
    };
  });

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.lastSolve ? new Date(a.lastSolve).getTime() : Infinity;
    const bt = b.lastSolve ? new Date(b.lastSolve).getTime() : Infinity;
    return at - bt; // earlier reach of the score ranks higher
  });

  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

router.get('/', (req, res) => {
  res.json(computeScoreboard());
});

function broadcastScoreboard(io) {
  io.emit('scoreboard:data', computeScoreboard());
}

router.get('/report/:teamId', (req, res) => {
  const teamId = Number(req.params.teamId);
  
  const board = computeScoreboard();
  const teamRank = board.find(t => t.teamId === teamId);
  if (!teamRank) return res.status(404).json({ error: 'Team not found or has no score' });

  // Get points per category for this team
  const catPoints = db.prepare(`
    SELECT cat.name AS category, SUM(COALESCE(s.awarded_points, c.points)) AS points
    FROM solves s
    JOIN challenges c ON c.id = s.challenge_id
    LEFT JOIN categories cat ON cat.id = c.category_id
    WHERE s.team_id = ?
    GROUP BY cat.id
  `).all(teamId);

  res.json({
    team: teamRank.team,
    rank: teamRank.rank,
    score: teamRank.score,
    categories: catPoints.map(c => ({ category: c.category || 'Uncategorized', points: c.points }))
  });
});

router.get('/graph', (req, res) => {
  const board = computeScoreboard();
  const top10 = board.slice(0, 10);
  
  if (top10.length === 0) return res.json({});

  const teamIds = top10.map(t => t.teamId);
  const placeholders = teamIds.map(() => '?').join(',');

  // Get all solves and hints for these teams
  const solves = db.prepare(`
    SELECT s.team_id, COALESCE(s.awarded_points, c.points) AS points, s.solved_at AS time, 'solve' AS type
    FROM solves s
    JOIN challenges c ON c.id = s.challenge_id
    WHERE s.team_id IN (${placeholders})
  `).all(...teamIds);

  const hints = db.prepare(`
    SELECT hr.team_id, -h.cost AS points, hr.revealed_at AS time, 'hint' AS type
    FROM hint_reveals hr
    JOIN hints h ON h.id = hr.hint_id
    WHERE hr.team_id IN (${placeholders})
  `).all(...teamIds);

  const events = [...solves, ...hints].sort((a, b) => {
    return new Date(a.time + 'Z').getTime() - new Date(b.time + 'Z').getTime();
  });

  // Calculate cumulative scores
  const datasets = {};
  top10.forEach(t => {
    datasets[t.teamId] = {
      label: t.team,
      data: [{ x: 0, y: 0 }] // Will update x later, or just start at 0
    };
  });

  const currentScores = {};
  top10.forEach(t => currentScores[t.teamId] = 0);

  // We need a baseline start time for the chart. Let's use the first event time.
  const startTimeStr = events.length > 0 ? events[0].time : new Date().toISOString();
  const startTimestamp = new Date(startTimeStr + 'Z').getTime();

  top10.forEach(t => {
    datasets[t.teamId].data[0].x = startTimestamp - 60000; // 1 min before first event
  });

  events.forEach(ev => {
    currentScores[ev.team_id] += ev.points;
    datasets[ev.team_id].data.push({
      x: new Date(ev.time + 'Z').getTime(),
      y: currentScores[ev.team_id]
    });
  });

  res.json(datasets);
});

module.exports = { router, computeScoreboard, broadcastScoreboard };
