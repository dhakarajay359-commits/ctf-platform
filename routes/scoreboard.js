const express = require('express');
const db = require('../db');
const router = express.Router();
async function computeScoreboard(mode = 'live') {
  const isPracticeMode = mode === 'practice';
  const practiceFilter = isPracticeMode ? 1 : 0;
  
  // In Live mode, only show teams registered for Live CTF (is_live = 1)
  // In Practice mode, show practice teams (is_live = 0)
  const teams = isPracticeMode 
    ? await db.prepare('SELECT id, name, operative_type, members_count, is_live FROM teams WHERE COALESCE(is_live, 0) = 0').all()
    : await db.prepare('SELECT id, name, operative_type, members_count, is_live FROM teams WHERE is_live = 1').all();

  const solvePoints = await db.prepare(`
    SELECT s.team_id AS team_id, SUM(COALESCE(s.awarded_points, c.points)) AS earned, MAX(s.solved_at) AS last_solve
    FROM solves s JOIN challenges c ON c.id = s.challenge_id
    WHERE c.is_practice = ?
    GROUP BY s.team_id
  `).all(practiceFilter);
  const solveMap = new Map(solvePoints.map(r => [r.team_id, r]));
  const hintCosts = await db.prepare(`
    SELECT hr.team_id AS team_id, SUM(h.cost) AS spent
    FROM hint_reveals hr 
    JOIN hints h ON h.id = hr.hint_id
    JOIN challenges c ON c.id = h.challenge_id
    WHERE c.is_practice = ?
    GROUP BY hr.team_id
  `).all(practiceFilter);
  const hintMap = new Map(hintCosts.map(r => [r.team_id, r.spent]));
  const kothPoints = isPracticeMode ? [] : await db.prepare('SELECT team_id, points FROM koth_points').all();
  const kothMap = new Map(kothPoints.map(r => [r.team_id, r.points]));
  
  const remPoints = await db.prepare(`
    SELECT r.team_id AS team_id, SUM(r.awarded_points) AS bonus
    FROM remediations r
    JOIN challenges c ON c.id = r.challenge_id
    WHERE c.is_practice = ? AND r.status = 'approved'
    GROUP BY r.team_id
  `).all(practiceFilter);
  const remMap = new Map(remPoints.map(r => [r.team_id, r.bonus]));

  const solveCounts = await db.prepare(`
    SELECT s.team_id, COUNT(*) AS n 
    FROM solves s JOIN challenges c ON c.id = s.challenge_id
    WHERE c.is_practice = ?
    GROUP BY s.team_id
  `).all(practiceFilter);
  const solveCountMap = new Map(solveCounts.map(r => [r.team_id, r.n]));

  // Badge Data Gathering
  const allSolves = await db.prepare(`
    SELECT s.team_id, s.challenge_id, s.solved_at, s.streak 
    FROM solves s JOIN challenges c ON c.id = s.challenge_id
    WHERE c.is_practice = ?
    ORDER BY s.solved_at ASC
  `).all(practiceFilter);
  const wrongAttempts = await db.prepare(`
    SELECT w.team_id 
    FROM wrong_attempts w JOIN challenges c ON c.id = w.challenge_id
    WHERE c.is_practice = ?
  `).all(practiceFilter);
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
    const remBonus = remMap.get(t.id) || 0;
    const score = earned - spent + koth + remBonus;

    // Compute badges
    const badges = [];
    if (firstBloods.has(t.id)) badges.push('🩸'); // First Blood

    const teamSolves = allSolves.filter(s => s.team_id === t.id);
    if (teamSolves.some(s => {
      const h = new Date(s.solved_at).getUTCHours();
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
  return rows.map((r, i) => ({
    rank: i + 1,
    ...r
  }));
}
router.get('/', async (req, res) => {
  try {
    const mode = req.query.mode === 'practice' ? 'practice' : 'live';
    res.json(await computeScoreboard(mode));
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error computing scoreboard' });
  }
});
async function broadcastScoreboard(io) {
  try {
    io.emit('scoreboard:data', await computeScoreboard('live'));
    io.emit('scoreboard:data:practice', await computeScoreboard('practice'));
  } catch(e) {
    console.error(e);
  }
}
router.get('/report/:teamId', async (req, res) => {
  const teamId = Number(req.params.teamId);
  const board = await computeScoreboard('live');
  const teamRank = board.find(t => t.teamId === teamId);
  if (!teamRank) return res.status(404).json({
    error: 'Team not found or has no score'
  });

  // Get points per category for this team
  const catPoints = await db.prepare(`
    SELECT cat.name AS category, SUM(COALESCE(s.awarded_points, c.points)) AS points
    FROM solves s
    JOIN challenges c ON c.id = s.challenge_id
    LEFT JOIN categories cat ON cat.id = c.category_id
    WHERE s.team_id = ? AND c.is_practice = 0
    GROUP BY cat.id
  `).all(teamId);
  res.json({
    team: teamRank.team,
    rank: teamRank.rank,
    score: teamRank.score,
    categories: catPoints.map(c => ({
      category: c.category || 'Uncategorized',
      points: c.points
    }))
  });
});
router.get('/graph', async (req, res) => {
  const mode = req.query.mode === 'practice' ? 'practice' : 'live';
  const isPractice = mode === 'practice' ? 1 : 0;
  const board = await computeScoreboard(mode);
  const top10 = board.slice(0, 10);
  if (top10.length === 0) return res.json({});
  const teamIds = top10.map(t => t.teamId);
  const placeholders = teamIds.map(() => '?').join(',');

  // Get all solves and hints for these teams
  const solves = await db.prepare(`
    SELECT s.team_id, COALESCE(s.awarded_points, c.points) AS points, s.solved_at AS time, 'solve' AS type
    FROM solves s
    JOIN challenges c ON c.id = s.challenge_id
    WHERE s.team_id IN (${placeholders}) AND c.is_practice = ?
  `).all(...teamIds, isPractice);
  const hints = await db.prepare(`
    SELECT hr.team_id, -h.cost AS points, hr.revealed_at AS time, 'hint' AS type
    FROM hint_reveals hr
    JOIN hints h ON h.id = hr.hint_id
    JOIN challenges c ON c.id = h.challenge_id
    WHERE hr.team_id IN (${placeholders}) AND c.is_practice = ?
  `).all(...teamIds, isPractice);
  const events = [...solves, ...hints].sort((a, b) => {
    return new Date(a.time).getTime() - new Date(b.time).getTime();
  });

  // Calculate cumulative scores
  const datasets = {};
  top10.forEach(t => {
    datasets[t.teamId] = {
      label: t.team,
      data: [{
        x: 0,
        y: 0
      }]
    };
  });
  const currentScores = {};
  top10.forEach(t => currentScores[t.teamId] = 0);

  const startTimeStr = events.length > 0 ? events[0].time : new Date().toISOString();
  const startTimestamp = new Date(startTimeStr).getTime();
  top10.forEach(t => {
    datasets[t.teamId].data[0].x = startTimestamp - 60000; // 1 min before first event
  });
  events.forEach(ev => {
    currentScores[ev.team_id] += ev.points;
    datasets[ev.team_id].data.push({
      x: new Date(ev.time).getTime(),
      y: currentScores[ev.team_id]
    });
  });
  res.json(datasets);
});
module.exports = {
  router,
  computeScoreboard,
  broadcastScoreboard
};