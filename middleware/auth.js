const db = require('../db');

async function requireTeam(req, res, next) {
  if (!req.session || !req.session.teamId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  
  try {
    const team = await db.prepare('SELECT is_banned FROM teams WHERE id = ?').get(req.session.teamId);
    if (!team || team.is_banned === 1) {
      req.session.destroy();
      return res.status(403).json({ error: 'This account has been banned from the CTF.' });
    }
    next();
  } catch (err) {
    console.error('requireTeam error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireTeam, requireAdmin };
