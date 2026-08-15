const express = require('express');
const db = require('../db');
const {
  requireTeam
} = require('../middleware/auth');
module.exports = function (io) {
  const router = express.Router();

  // Get chat history for the logged-in team
  router.get('/messages', requireTeam, async (req, res) => {
    try {
      const messages = await db.prepare('SELECT * FROM messages WHERE team_id = ? ORDER BY created_at ASC').all(req.session.teamId);
      res.json(messages);
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: 'Failed to fetch messages'
      });
    }
  });

  // Wipe chat history for the logged-in team
  router.delete('/messages', requireTeam, async (req, res) => {
    try {
      await db.prepare('DELETE FROM messages WHERE team_id = ?').run(req.session.teamId);
      res.json({ ok: true, message: 'Chat history wiped successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: 'Failed to wipe messages'
      });
    }
  });

  return router;
};