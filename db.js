const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'ctf.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_banned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hint_reveals (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  hint_id INTEGER NOT NULL REFERENCES hints(id) ON DELETE CASCADE,
  revealed_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, hint_id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  comments TEXT,
  submitted_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS solves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  awarded_points INTEGER,
  streak INTEGER DEFAULT 0,
  solved_at TEXT DEFAULT (datetime('now')),
  UNIQUE(team_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS wrong_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  attempted_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS campaign_chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  required_challenge_id INTEGER REFERENCES challenges(id) ON DELETE SET NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'anomaly',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  is_from_admin INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Migrations for existing databases
try {
  db.prepare('SELECT requires FROM challenges LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE challenges ADD COLUMN requires INTEGER REFERENCES challenges(id) ON DELETE SET NULL');
}

try {
  db.prepare('SELECT awarded_points FROM solves LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE solves ADD COLUMN awarded_points INTEGER');
  db.exec('ALTER TABLE solves ADD COLUMN streak INTEGER DEFAULT 0');
  db.exec(`
    UPDATE solves 
    SET awarded_points = (SELECT points FROM challenges WHERE challenges.id = solves.challenge_id)
    WHERE awarded_points IS NULL
  `);
}

try {
  db.prepare('SELECT is_banned FROM teams LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE teams ADD COLUMN is_banned INTEGER DEFAULT 0');
}

try {
  db.prepare('SELECT docker_image FROM challenges LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE challenges ADD COLUMN docker_image TEXT');
  db.exec(`UPDATE challenges SET docker_image = 'ctf-hard-sandbox' WHERE title = 'The Architect''s Profile'`);
}

// KoTH Migrations
try {
  db.prepare('SELECT is_koth FROM challenges LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE challenges ADD COLUMN is_koth INTEGER DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS koth_control (
      challenge_id INTEGER PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      claimed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS koth_points (
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      points INTEGER DEFAULT 0,
      PRIMARY KEY (team_id)
    )
  `);
}


try {
  db.prepare('SELECT stealth_score FROM teams LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE teams ADD COLUMN stealth_score INTEGER DEFAULT 100');
}

try {
  db.prepare('SELECT operative_type FROM teams LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE teams ADD COLUMN operative_type TEXT DEFAULT 'Syndicate'");
  db.exec("ALTER TABLE teams ADD COLUMN members_count INTEGER DEFAULT 2");
}

// Student Registration Fields Migration
try {
  db.prepare('SELECT full_name FROM teams LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE teams ADD COLUMN full_name TEXT DEFAULT ''");
  db.exec("ALTER TABLE teams ADD COLUMN student_id TEXT DEFAULT ''");
  db.exec("ALTER TABLE teams ADD COLUMN college_id TEXT DEFAULT ''");
}

// Practice Mode Migration
try {
  db.prepare('SELECT is_practice FROM challenges LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE challenges ADD COLUMN is_practice INTEGER DEFAULT 0");
}

// Live Registration Migrations
try {
  db.prepare('SELECT id FROM live_registration_submissions LIMIT 1').get();
} catch (e) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_registration_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      submitted_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// seed default settings (event name, start/end time, freeze time)
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
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) insertSetting.run(k, v);

// seed a default category if none exist
const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
if (catCount === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
  ['Web', 'Crypto', 'Forensics', 'Pwn', 'Reverse Engineering', 'Misc', 'OSINT'].forEach(c => insertCat.run(c));
}

// Seed Target Alpha Sandbox
const targetAlphaExists = db.prepare('SELECT 1 FROM challenges WHERE title = ?').get('Target Alpha (Sandbox)');
if (!targetAlphaExists) {
  const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get('Web');
  const catId = cat ? cat.id : null;
  const flagHash = bcrypt.hashSync('flag{sqL_1nj3ct10n_m4st3r}', 10);
  
  db.prepare(`
    INSERT INTO challenges (title, category_id, description, points, flag_hash, difficulty, link)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Target Alpha (Sandbox)', 
    catId, 
    'Our recon team found an exposed corporate admin portal for OmniCorp.\\n\\nYour mission:\\n1. Bypass the authentication portal.\\n2. Gain Remote Code Execution (RCE) on their internal diagnostic tool.\\n\\nHint: You will need multiple payloads from the Payloads tab to complete this.',
    250, 
    flagHash, 
    'hard', 
    '/target-alpha.html'
  );
}

// Seed Campaign Chapters
const chapterCount = db.prepare('SELECT COUNT(*) AS c FROM campaign_chapters').get().c;
if (chapterCount === 0) {
  const insertChapter = db.prepare('INSERT INTO campaign_chapters (title, content, required_challenge_id, order_index) VALUES (?, ?, ?, ?)');
  
  insertChapter.run(
    'PROLOGUE: The Awakening',
    'Welcome to the network, initiate.\n\nFor years, mega-corporations like OmniCorp have operated in the shadows, believing their internal networks are impenetrable. We are here to prove them wrong.\n\nYour first assignment is simple: complete the basic training challenges to prove you understand the fundamentals of web exploitation.\n\nOnce you demonstrate competence, we will give you a real target.',
    null,
    1
  );
  
  const targetAlpha = db.prepare('SELECT id FROM challenges WHERE title = ?').get('Target Alpha (Sandbox)');
  if (targetAlpha) {
    insertChapter.run(
      'CHAPTER 1: The Breach',
      'Excellent work taking down Target Alpha.\n\nBy exploiting the SQL Injection vulnerability and achieving Remote Code Execution, you have granted us our first foothold into OmniCorp\'s internal infrastructure.\n\nWe are currently analyzing the system environment variables you dumped. We suspect this server has trust relationships with their internal billing department.\n\nStand by for your next objective.',
      targetAlpha.id,
      2
    );
  }
}

// Seed Easter Egg Challenges
const easterEggsExist = db.prepare('SELECT 1 FROM challenges WHERE title = ?').get('Easter Egg: The Crawler');
if (!easterEggsExist) {
  const miscCat = db.prepare('SELECT id FROM categories WHERE name = ?').get('Misc');
  const catId = miscCat ? miscCat.id : null;
  
  const eggs = [
    { title: 'Easter Egg: The Crawler', desc: 'There are things hidden in the shadows of this platform. Check where the robots look.', flag: 'flag{robot_uprising_2026}' },
    { title: 'Easter Egg: Inspector Gadget', desc: 'Sometimes the server headers contain secrets.', flag: 'flag{headers_are_cool_1337}' },
    { title: 'Easter Egg: Hackerman', desc: 'Console warnings are just suggestions. Hack the planet.', flag: 'flag{console_hacker_99}' }
  ];
  
  const insertChal = db.prepare(`
    INSERT INTO challenges (title, category_id, description, points, flag_hash, difficulty, visible)
    VALUES (?, ?, ?, 50, ?, 'easy', 1)
  `);
  
  eggs.forEach(egg => {
    insertChal.run(egg.title, catId, egg.desc, bcrypt.hashSync(egg.flag, 10));
  });
}

module.exports = db;
