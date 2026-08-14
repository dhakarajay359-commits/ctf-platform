require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const db = {
  pool,
  prepare: (sql) => {
    let cleanSql = sql;
    // Translate SQLite REPLACE INTO settings to Postgres ON CONFLICT
    if (/^REPLACE INTO settings/i.test(cleanSql.trim())) {
      cleanSql = cleanSql.replace(/^REPLACE INTO settings\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i, (match, cols, vals) => {
        return `INSERT INTO settings (${cols}) VALUES (${vals}) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`;
      });
    } else if (/^INSERT OR REPLACE INTO/i.test(cleanSql.trim())) {
      cleanSql = cleanSql.replace(/^INSERT OR REPLACE INTO/i, 'INSERT INTO');
    }
    let index = 1;
    const pgSql = cleanSql.replace(/\?/g, () => `$${index++}`);
    return {
      get: async (...params) => {
        try {
          const res = await pool.query(pgSql, params);
          return res.rows[0];
        } catch(e) { console.error('DB GET ERROR:', e); throw e; }
      },
      all: async (...params) => {
        try {
          const res = await pool.query(pgSql, params);
          return res.rows;
        } catch(e) { console.error('DB ALL ERROR:', e); throw e; }
      },
      run: async (...params) => {
        try {
          let finalSql = pgSql;
          if (finalSql.trim().toUpperCase().startsWith('INSERT') && !finalSql.toUpperCase().includes('RETURNING')) {
            if (finalSql.toUpperCase().includes('INTO SETTINGS')) {
              finalSql = finalSql + ' RETURNING key';
            } else {
              finalSql = finalSql + ' RETURNING id';
            }
          }
          const res = await pool.query(finalSql, params);
          return { lastInsertRowid: res.rows[0]?.id || res.rows[0]?.key, changes: res.rowCount };
        } catch(e) { console.error('DB RUN ERROR:', e); throw e; }
      }
    };
  },
  exec: async (sql) => {
    try {
      return await pool.query(sql);
    } catch(e) { console.error('DB EXEC ERROR:', e); throw e; }
  },
  initDb: async () => {
    console.log("Initializing Supabase Postgres Database...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        google_id TEXT UNIQUE,
        is_banned INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        stealth_score INTEGER DEFAULT 100,
        operative_type TEXT DEFAULT 'Syndicate',
        members_count INTEGER DEFAULT 2,
        full_name TEXT DEFAULT '',
        student_id TEXT DEFAULT '',
        college_id TEXT DEFAULT '',
        roster TEXT,
        is_live INTEGER DEFAULT 0,
        team_code TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS challenges (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 100,
        flag_hash TEXT NOT NULL,
        difficulty TEXT DEFAULT 'medium',
        link TEXT,
        visible INTEGER NOT NULL DEFAULT 1,
        requires INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
        docker_image TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_koth INTEGER DEFAULT 0,
        is_practice INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS hints (
        id SERIAL PRIMARY KEY,
        challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        cost INTEGER NOT NULL DEFAULT 0,
        order_index INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS hint_reveals (
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        hint_id INTEGER NOT NULL REFERENCES hints(id) ON DELETE CASCADE,
        revealed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (team_id, hint_id)
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL,
        comments TEXT,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS solves (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        awarded_points INTEGER,
        streak INTEGER DEFAULT 0,
        solved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(team_id, challenge_id)
      );

      CREATE TABLE IF NOT EXISTS wrong_attempts (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS campaign_chapters (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        required_challenge_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        image_url TEXT,
        glitch_text TEXT,
        unlock_message TEXT
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        is_from_admin INTEGER DEFAULT 0,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS challenge_claims (
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
        operative_alias TEXT,
        claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(team_id, challenge_id)
      );

      CREATE TABLE IF NOT EXISTS koth_control (
        challenge_id INTEGER PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS koth_points (
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        points INTEGER DEFAULT 0,
        PRIMARY KEY (team_id)
      );

      CREATE TABLE IF NOT EXISTS live_registration_submissions (
        id SERIAL PRIMARY KEY,
        data TEXT NOT NULL,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    // Add columns if they don't exist (for existing deployments)
    try {
      await pool.query('ALTER TABLE teams ADD COLUMN IF NOT EXISTS is_live INTEGER DEFAULT 0');
      await pool.query('ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_code TEXT UNIQUE');
      await pool.query('ALTER TABLE challenges ADD COLUMN IF NOT EXISTS is_koth INTEGER DEFAULT 0');
      await pool.query('ALTER TABLE challenges ADD COLUMN IF NOT EXISTS is_practice INTEGER DEFAULT 0');
    } catch(e) {
      console.error('Error adding columns:', e);
    }

    // seed default settings
    const defaultSettings = {
      event_name: 'ajay ctf 2026',
      start_time: '',
      end_time: '',
      freeze_time: '',
      registration_open: '1',
      ctf_status: 'practice',
      live_registration_active: '1',
      live_registration_schema: '[{"label":"Full Name","type":"text","required":true},{"label":"Email ID","type":"email","required":true},{"label":"Mobile Number","type":"number","required":true},{"label":"B.Tech Semester","type":"text","required":true},{"label":"College Name","type":"text","required":true}]',
      live_registration_start: '2026-08-12T05:02:00.000Z',
      live_registration_end: '2026-08-13T05:05:00.000Z',
      live_ctf_event_start: '2026-08-14T04:30:00.000Z',
      live_ctf_event_end: '2026-08-14T06:30:00.000Z',
      live_registration_title: 'Live CTF Registration',
      live_registration_description: 'Please fill out the form below to register for the live event.'
    };
    for (const [k, v] of Object.entries(defaultSettings)) {
      await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
    }

    // seed a default category if none exist
    const catRes = await pool.query('SELECT COUNT(*) AS c FROM categories');
    if (parseInt(catRes.rows[0].c) === 0) {
      const cats = ['Web', 'Crypto', 'Forensics', 'Pwn', 'Reverse Engineering', 'Misc', 'OSINT'];
      for (const c of cats) {
        await pool.query('INSERT INTO categories (name) VALUES ($1)', [c]);
      }
    }
  }
};

module.exports = db;
