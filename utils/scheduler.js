const db = require('../db');
const notifier = require('./notifier');

let lastState = null;

function initScheduler(io) {
  console.log('[Scheduler] Initializing time-based automated event scheduler...');

  async function checkSchedule() {
    try {
      const rows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'live_%' OR key = 'ctf_status' OR key = 'auto_notify_start'").all();
      const config = {};
      rows.forEach(r => { config[r.key] = r.value; });

      const now = Date.now();
      const startTime = config.live_ctf_event_start ? new Date(config.live_ctf_event_start).getTime() : null;
      const endTime = config.live_ctf_event_end ? new Date(config.live_ctf_event_end).getTime() : null;
      
      const manualStatus = config.ctf_status; // 'auto', 'live', 'practice', 'ended'

      let computedStatus = manualStatus || 'practice';

      // If set to 'auto' (or if schedule times exist and status isn't forcibly locked)
      if (manualStatus === 'auto' || manualStatus === 'practice' || manualStatus === 'live') {
        if (startTime && endTime) {
          if (now >= startTime && now < endTime) {
            computedStatus = 'live';
          } else if (now >= endTime) {
            computedStatus = 'ended';
          } else if (now < startTime) {
            computedStatus = 'practice';
          }
        }
      }

      // If status changed or auto transitioned
      if (computedStatus !== lastState) {
        console.log(`[Scheduler] CTF Status is now: ${computedStatus.toUpperCase()} (Previous: ${lastState})`);
        lastState = computedStatus;

        // Update in database if in auto mode
        if (manualStatus === 'auto') {
          await db.prepare("INSERT INTO settings (key, value) VALUES ('ctf_status_computed', ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value").run(computedStatus);
        }

        // Notify connected clients
        io.emit('ctf:status_change', {
          status: computedStatus,
          startTime,
          endTime,
          timestamp: now
        });
        io.emit('activity'); // trigger challenge reload in active tabs

        // Auto-send alert to participants when live begins if enabled
        if (computedStatus === 'live' && config.auto_notify_start === '1' && !config.live_start_notified_at) {
          console.log('[Scheduler] CTF has gone LIVE! Automatically dispatching start alerts...');
          notifier.broadcastStartAlert().catch(e => console.error('[Scheduler] Auto alert error:', e));
        }
      }

    } catch (err) {
      console.error('[Scheduler] Error evaluating schedule:', err.message);
    }
  }

  // Check every 10 seconds
  setInterval(checkSchedule, 10000);
  // Run first check immediately
  checkSchedule();
}

module.exports = initScheduler;
