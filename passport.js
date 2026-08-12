const GoogleStrategy = require('passport-google-oauth20').Strategy;

module.exports = function(passport, db) {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/api/auth/google/callback"
      },
      function(accessToken, refreshToken, profile, cb) {
        try {
          // Find if a team with this Google ID already exists
          let team = db.prepare('SELECT * FROM teams WHERE google_id = ?').get(profile.id);
          
          if (!team) {
            // If they don't have a team, create one based on their Google Name
            // Check if name is taken
            let baseName = profile.displayName || "Google User";
            let teamName = baseName;
            let counter = 1;
            while (db.prepare('SELECT id FROM teams WHERE name = ?').get(teamName)) {
              teamName = `${baseName} ${counter}`;
              counter++;
            }
            
            const info = db.prepare('INSERT INTO teams (name, password_hash, google_id, operative_type, members_count) VALUES (?, ?, ?, ?, ?)').run(teamName, '', profile.id, 'Lone Wolf', 1);
            team = { id: info.lastInsertRowid, name: teamName, google_id: profile.id, operative_type: 'Lone Wolf', members_count: 1 };
          }
          
          return cb(null, team);
        } catch (err) {
          return cb(err);
        }
      }
    ));
  }
};
