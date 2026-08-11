const db = require('../db');

const requestLog = new Map();

module.exports = function (io) {
  return function blueTeamMiddleware(req, res, next) {
    if (!req.session || !req.session.teamId || req.session.isAdmin) {
      return next();
    }

    const teamId = req.session.teamId;
    const now = Date.now();

    if (!requestLog.has(teamId)) {
      requestLog.set(teamId, []);
    }

    const times = requestLog.get(teamId);
    times.push(now);

    // Keep only last 10 seconds
    while (times.length > 0 && times[0] < now - 10000) {
      times.shift();
    }

    let penalty = 0;
    let reason = '';

    // If more than 20 requests in 10 seconds -> DirBuster/Scanner
    if (times.length > 20) {
      penalty = 5;
      reason = 'High frequency scanning detected.';
      times.length = 0; // Reset to avoid spam
    }

    // Check for obvious SQLi/XSS in query or body
    const payloadString = JSON.stringify(req.body || {}) + JSON.stringify(req.query || {});
    if (/(<script>|' OR 1=1|UNION SELECT|\/etc\/passwd)/i.test(payloadString)) {
      penalty = 10;
      reason = 'Malicious payload signature detected.';
    }

    if (penalty > 0) {
      db.prepare('UPDATE teams SET stealth_score = MAX(0, stealth_score - ?) WHERE id = ?').run(penalty, teamId);
      
      const updated = db.prepare('SELECT stealth_score FROM teams WHERE id = ?').get(teamId);
      
      io.to(`room_team_${teamId}`).emit('notifications:receive', {
        id: Date.now(),
        title: 'SOC ALERT: Anomalous Activity',
        message: `${reason} Stealth score reduced to ${updated.stealth_score}%.`,
        type: 'danger'
      });

      io.to('admin_room').emit('admin:alert', {
        type: 'BLUE_TEAM',
        message: `Team "${req.session.teamName}" triggered SOC. Reason: ${reason} New Stealth: ${updated.stealth_score}%`,
        timestamp: new Date().toISOString()
      });

      // If stealth score hits 0, maybe temporary block? We can just let it sit at 0 for now.
    }

    next();
  };
};
