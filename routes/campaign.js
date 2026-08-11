const express = require('express');
const db = require('../db');

module.exports = function () {
  const router = express.Router();

  // Middleware to ensure team is logged in
  function requireTeam(req, res, next) {
    if (!req.session.teamId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  }

  router.get('/', requireTeam, (req, res) => {
    const teamId = req.session.teamId;

    // Get all solves for this team
    const solvedIds = new Set(
      db.prepare('SELECT challenge_id FROM solves WHERE team_id = ?').all(teamId).map(r => r.challenge_id)
    );

    const chapters = db.prepare('SELECT * FROM campaign_chapters ORDER BY order_index ASC').all();
    
    const result = chapters.map(ch => {
      const unlocked = !ch.required_challenge_id || solvedIds.has(ch.required_challenge_id);
      return {
        id: ch.id,
        title: ch.title,
        unlocked: unlocked,
        content: unlocked ? ch.content : 'This chapter is currently classified. Complete the required mission to unlock.',
        required_challenge_id: ch.required_challenge_id
      };
    });

    res.json(result);
  });

  return router;
};
