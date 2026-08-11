const db = require('../db');

function requireTeam(req, res, next) {
  if (!req.session.teamId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  
  const team = db.prepare('SELECT is_banned FROM teams WHERE id = ?').get(req.session.teamId);
  if (!team || team.is_banned === 1) {
    req.session.destroy();
    return res.status(403).json({ error: 'This account has been banned from the CTF.' });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireTeam, requireAdmin };
