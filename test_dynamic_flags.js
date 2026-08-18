require('dotenv').config();
const db = require('./db');
const bcrypt = require('bcryptjs');
const { generateDynamicFlag } = require('./utils/flags');

async function runLiveTest() {
  const url = 'http://localhost:3000';
  
  // Make sure CTF is in practice or live mode so submission is allowed
  await db.prepare("UPDATE settings SET value = 'practice' WHERE key = 'ctf_status'").run();

  // Create or get Team A and Team B in DB
  const passHash = bcrypt.hashSync('Password123!', 10);
  
  let teamA = await db.prepare('SELECT * FROM teams WHERE name = ?').get('TeamAlpha_Test');
  if (!teamA) {
    const res = await db.prepare('INSERT INTO teams (name, password_hash, operative_type, members_count, is_live) VALUES (?, ?, ?, ?, ?)').run('TeamAlpha_Test', passHash, 'Syndicate', 2, 1);
    teamA = await db.prepare('SELECT * FROM teams WHERE id = ?').get(res.lastInsertRowid);
  }

  let teamB = await db.prepare('SELECT * FROM teams WHERE name = ?').get('TeamBeta_Test');
  if (!teamB) {
    const res = await db.prepare('INSERT INTO teams (name, password_hash, operative_type, members_count, is_live) VALUES (?, ?, ?, ?, ?)').run('TeamBeta_Test', passHash, 'Syndicate', 2, 1);
    teamB = await db.prepare('SELECT * FROM teams WHERE id = ?').get(res.lastInsertRowid);
  }

  // Clear previous test solves for challenge 1
  await db.prepare('DELETE FROM solves WHERE challenge_id = 1 AND team_id IN (?, ?)').run(teamA.id, teamB.id);
  await db.prepare('DELETE FROM wrong_attempts WHERE challenge_id = 1 AND team_id IN (?, ?)').run(teamA.id, teamB.id);

  console.log('Testing with Team A (ID: ' + teamA.id + ') and Team B (ID: ' + teamB.id + ')');

  // Helper for HTTP login and cookies
  async function login(teamName, password) {
    const res = await fetch(url + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName, password })
    });
    const cookie = res.headers.get('set-cookie');
    const json = await res.json();
    return { cookie, json, status: res.status };
  }

  const sessionA = await login('TeamAlpha_Test', 'Password123!');
  const sessionB = await login('TeamBeta_Test', 'Password123!');

  console.log('Team Alpha Login Status:', sessionA.status, sessionA.json.name);
  console.log('Team Beta Login Status:', sessionB.status, sessionB.json.name);

  const flagA = generateDynamicFlag(1, teamA.id);
  const flagB = generateDynamicFlag(1, teamB.id);

  console.log('\nCalculated Dynamic Flags for Challenge 1:');
  console.log('  Team Alpha Flag:', flagA);
  console.log('  Team Beta Flag: ', flagB);

  // 1. Team B tries submitting Team A's dynamic flag
  console.log('\n--> Step 1: Team B tries submitting Team Alpha\'s flag:');
  const resCross = await fetch(url + '/api/challenges/1/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionB.cookie
    },
    body: JSON.stringify({ flag: flagA })
  });
  const crossData = await resCross.json();
  console.log('Team B response:', crossData);

  // 2. Team A submits Team A's dynamic flag
  console.log('\n--> Step 2: Team A submits Team Alpha\'s flag:');
  const resA = await fetch(url + '/api/challenges/1/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionA.cookie
    },
    body: JSON.stringify({ flag: flagA })
  });
  const dataA = await resA.json();
  console.log('Team A response:', dataA);

  // 3. Team B submits Team B's dynamic flag
  console.log('\n--> Step 3: Team B submits Team Beta\'s flag:');
  const resB = await fetch(url + '/api/challenges/1/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionB.cookie
    },
    body: JSON.stringify({ flag: flagB })
  });
  const dataB = await resB.json();
  console.log('Team B response:', dataB);

  // 4. Verify in DB
  const solves = await db.prepare('SELECT s.id, s.team_id, s.challenge_id, s.solved_at, t.name FROM solves s JOIN teams t ON s.team_id = t.id WHERE s.challenge_id = 1 AND s.team_id IN (?, ?)').all(teamA.id, teamB.id);
  console.log('\nFinal DB Solves for Challenge 1:', solves);

  process.exit(0);
}

runLiveTest().catch(err => {
  console.error(err);
  process.exit(1);
});
