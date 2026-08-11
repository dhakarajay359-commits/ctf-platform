const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/heat', (req, res) => {
  // Return aggregate stats for each challenge
  const challenges = db.prepare(`
    SELECT c.id, c.title, c.category_id, cat.name AS category
    FROM challenges c
    LEFT JOIN categories cat ON cat.id = c.category_id
    WHERE c.visible = 1
  `).all();

  const solves = db.prepare('SELECT challenge_id, COUNT(*) as count FROM solves GROUP BY challenge_id').all();
  const solveMap = new Map(solves.map(s => [s.challenge_id, s.count]));

  const attempts = db.prepare('SELECT challenge_id, COUNT(*) as count FROM wrong_attempts GROUP BY challenge_id').all();
  const attemptMap = new Map(attempts.map(a => [a.challenge_id, a.count]));

  const result = challenges.map(c => ({
    id: c.id,
    title: c.title,
    category: c.category || 'Uncategorized',
    solves: solveMap.get(c.id) || 0,
    attempts: attemptMap.get(c.id) || 0
  }));

  res.json(result);
});

module.exports = router;
