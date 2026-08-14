const GoogleStrategy = require('passport-google-oauth20').Strategy;
module.exports = function (passport, db) {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/api/auth/google/callback",
      proxy: true
    }, async function (accessToken, refreshToken, profile, cb) {
      try {
        const userEmail = (profile.emails && profile.emails[0]?.value) || null;
        let isLiveCandidate = false;
        let registeredFullName = null;

        // Check if this Google email is in live_registration_submissions
        if (userEmail) {
          const allSubs = await db.prepare('SELECT data FROM live_registration_submissions').all();
          for (const sub of allSubs) {
            try {
              const parsed = typeof sub.data === 'string' ? JSON.parse(sub.data) : sub.data;
              const regEmail = parsed['Email ID'] || parsed['Email'] || parsed['email'] || '';
              if (regEmail && regEmail.toLowerCase() === userEmail.toLowerCase()) {
                isLiveCandidate = true;
                registeredFullName = parsed['Full Name'] || parsed['teamName'] || parsed['Name'] || null;
                break;
              }
            } catch (e) {}
          }
        }

        // Find if a team with this Google ID already exists
        let team = await db.prepare('SELECT * FROM teams WHERE google_id = ?').get(profile.id);
        if (team) {
          // If candidate is registered for live, ensure team has is_live = 1
          if (isLiveCandidate && team.is_live !== 1) {
            await db.prepare('UPDATE teams SET is_live = 1 WHERE id = ?').run(team.id);
            team.is_live = 1;
          }
        } else {
          // Check if there is an existing team matching this name/registration
          let baseName = registeredFullName || profile.displayName || "Google Operative";
          let teamName = baseName;
          let existing = await db.prepare('SELECT * FROM teams WHERE name = ?').get(teamName);
          if (existing && !existing.google_id) {
            // Link Google ID to existing team
            await db.prepare('UPDATE teams SET google_id = ?, is_live = ? WHERE id = ?').run(profile.id, isLiveCandidate ? 1 : existing.is_live, existing.id);
            team = await db.prepare('SELECT * FROM teams WHERE id = ?').get(existing.id);
          } else {
            let counter = 1;
            while (await db.prepare('SELECT id FROM teams WHERE name = ?').get(teamName)) {
              teamName = `${baseName} ${counter}`;
              counter++;
            }
            const isLiveVal = isLiveCandidate ? 1 : 0;
            const opType = isLiveCandidate ? 'Syndicate' : 'Lone Wolf';
            const info = await db.prepare('INSERT INTO teams (name, password_hash, google_id, operative_type, members_count, full_name, is_live) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
              teamName, '', profile.id, opType, 1, registeredFullName || teamName, isLiveVal
            );
            team = {
              id: info.lastInsertRowid,
              name: teamName,
              google_id: profile.id,
              operative_type: opType,
              members_count: 1,
              is_live: isLiveVal
            };
          }
        }
        return cb(null, team);
      } catch (err) {
        return cb(err);
      }
    }));
  }
};