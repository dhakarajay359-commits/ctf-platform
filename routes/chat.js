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

  // Post message from player team
  router.post('/messages', requireTeam, async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Message cannot be empty.' });
      }
      const teamId = req.session.teamId;
      const cleanText = text.trim();
      const insertRes = await db.prepare('INSERT INTO messages (team_id, is_from_admin, text) VALUES (?, 0, ?)').run(teamId, cleanText);
      const msg = {
        id: insertRes.lastInsertRowid,
        team_id: teamId,
        is_from_admin: 0,
        text: cleanText,
        created_at: new Date().toISOString()
      };

      if (io) {
        io.to(`room_team_${teamId}`).emit('chat:receive', msg);
        io.to('admin_room').emit('chat:receive', msg);
      }

      res.json(msg);
    } catch (err) {
      console.error('Error posting message:', err);
      res.status(500).json({ error: 'Failed to send message' });
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

  // Post reply from Admin
  router.post('/admin-reply', async (req, res) => {
    if (!req.session.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    try {
      const { teamId, text } = req.body;
      const targetTeamId = Number(teamId);
      if (!targetTeamId || !text || !text.trim()) {
        return res.status(400).json({ error: 'Invalid teamId or text' });
      }
      const cleanText = text.trim();
      const insertRes = await db.prepare('INSERT INTO messages (team_id, is_from_admin, text) VALUES (?, 1, ?)').run(targetTeamId, cleanText);
      const msg = {
        id: insertRes.lastInsertRowid,
        team_id: targetTeamId,
        is_from_admin: 1,
        text: cleanText,
        created_at: new Date().toISOString()
      };

      if (io) {
        io.to(`room_team_${targetTeamId}`).emit('chat:receive', msg);
        io.to('admin_room').emit('chat:receive', msg);
      }

      res.json(msg);
    } catch (err) {
      console.error('Error in admin-reply:', err);
      res.status(500).json({ error: 'Failed to send admin reply' });
    }
  });

  // Get all teams for Admin Chat Sidebar
  router.get('/admin/teams', async (req, res) => {
    if (!req.session.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    try {
      const teams = await db.prepare(`
        SELECT t.id, t.name, t.operative_type,
               (SELECT text FROM messages WHERE team_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message,
               (SELECT created_at FROM messages WHERE team_id = t.id ORDER BY created_at DESC LIMIT 1) as last_time,
               (SELECT COUNT(*) FROM messages WHERE team_id = t.id) as message_count
        FROM teams t
        ORDER BY last_time DESC NULLS LAST, t.name ASC
      `).all();
      res.json(teams);
    } catch (err) {
      console.error('Error fetching admin chat teams:', err);
      res.status(500).json({ error: 'Failed to fetch teams' });
    }
  });

  // Get messages for a specific team (Admin view)
  router.get('/admin/messages/:teamId', async (req, res) => {
    if (!req.session.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    try {
      const targetTeamId = Number(req.params.teamId);
      const messages = await db.prepare('SELECT * FROM messages WHERE team_id = ? ORDER BY created_at ASC').all(targetTeamId);
      res.json(messages);
    } catch (err) {
      console.error('Error fetching team messages for admin:', err);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  // Wipe all chats across all teams
  router.delete('/admin/wipe-all', async (req, res) => {
    if (!req.session.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    try {
      await db.prepare('DELETE FROM messages').run();
      if (io) {
        io.emit('chat:receive', {
          id: Date.now(),
          is_from_admin: 1,
          text: 'Support chat history has been reset by Admin.',
          created_at: new Date().toISOString()
        });
      }
      res.json({ ok: true, message: 'All chat history wiped successfully' });
    } catch (err) {
      console.error('Error wiping all chats:', err);
      res.status(500).json({ error: 'Failed to wipe all chats' });
    }
  });

  return router;
};