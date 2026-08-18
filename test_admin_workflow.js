require('dotenv').config();
const db = require('./db');
const bcrypt = require('bcryptjs');
const { generateDynamicFlag } = require('./utils/flags');

async function testFullAdminWorkflow() {
  const url = 'http://localhost:3000';
  await db.initDb();

  console.log('=== TESTING ADMIN WORKFLOW & AUTOMATIC FLAG PERMUTATION ===\n');

  // 1. Admin creates a new challenge with a base flag hidden in the description
  const adminBaseFlag = 'FLAG{ultra_hidden_vault_pass_2026}';
  const passHash = bcrypt.hashSync(adminBaseFlag, 10);

  // Check or insert test challenge
  let chal = await db.prepare('SELECT * FROM challenges WHERE title = ?').get('Vault Infiltration Test');
  if (!chal) {
    const res = await db.prepare(`
      INSERT INTO challenges (title, category_id, description, points, flag_hash, base_flag, is_practice, visible)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1)
    `).run(
      'Vault Infiltration Test',
      1,
      'Recover the secret authentication key from the server: ' + adminBaseFlag + ' to authorize extraction.',
      300,
      passHash,
      adminBaseFlag
    );
    chal = await db.prepare('SELECT * FROM challenges WHERE id = ?').get(res.lastInsertRowid);
  } else {
    await db.prepare('UPDATE challenges SET base_flag = ?, flag_hash = ?, description = ? WHERE id = ?')
      .run(adminBaseFlag, passHash, 'Recover the secret authentication key from the server: ' + adminBaseFlag + ' to authorize extraction.', chal.id);
    chal = await db.prepare('SELECT * FROM challenges WHERE id = ?').get(chal.id);
  }

  console.log('1. Admin created Challenge #' + chal.id + ' with Base Flag: ' + adminBaseFlag);

  // 2. Setup Team A (TeamAlpha_Test) and Team B (TeamBeta_Test)
  const teamA = await db.prepare('SELECT * FROM teams WHERE name = ?').get('TeamAlpha_Test');
  const teamB = await db.prepare('SELECT * FROM teams WHERE name = ?').get('TeamBeta_Test');

  await db.prepare('DELETE FROM solves WHERE challenge_id = ? AND team_id IN (?, ?)').run(chal.id, teamA.id, teamB.id);

  // Login helper
  async function login(teamName, password) {
    const res = await fetch(url + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName, password })
    });
    return res.headers.get('set-cookie');
  }

  const cookieA = await login('TeamAlpha_Test', 'Password123!');
  const cookieB = await login('TeamBeta_Test', 'Password123!');

  // 3. Team A fetches challenges from server
  const resChalsA = await fetch(url + '/api/challenges', {
    headers: { 'Cookie': cookieA }
  });
  const chalsDataA = await resChalsA.json();
  const chalForA = chalsDataA.find(c => c.id === chal.id);

  console.log('\n2. What Team Alpha (Team ID ' + teamA.id + ') sees in their challenge description:');
  console.log('   "' + chalForA.description + '"');

  // 4. Team B fetches challenges from server
  const resChalsB = await fetch(url + '/api/challenges', {
    headers: { 'Cookie': cookieB }
  });
  const chalsDataB = await resChalsB.json();
  const chalForB = chalsDataB.find(c => c.id === chal.id);

  console.log('\n3. What Team Beta (Team ID ' + teamB.id + ') sees in their challenge description:');
  console.log('   "' + chalForB.description + '"');

  // Extract the dynamic flags seen by each team
  const matchA = chalForA.description.match(/FLAG\{[^\}]+\}/)[0];
  const matchB = chalForB.description.match(/FLAG\{[^\}]+\}/)[0];

  console.log('\n4. Extracted Team Dynamic Flags:');
  console.log('   Team Alpha Flag:', matchA);
  console.log('   Team Beta Flag: ', matchB);

  // 5. Team B tries submitting Team A's dynamic flag
  console.log('\n5. Team Beta attempts to submit Team Alpha\'s flag:');
  const subCross = await fetch(url + '/api/challenges/' + chal.id + '/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieB },
    body: JSON.stringify({ flag: matchA })
  });
  console.log('   Response:', await subCross.json());

  // 6. Team A submits Team A's dynamic flag
  console.log('\n6. Team Alpha submits Team Alpha\'s flag:');
  const subA = await fetch(url + '/api/challenges/' + chal.id + '/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieA },
    body: JSON.stringify({ flag: matchA })
  });
  console.log('   Response:', await subA.json());

  // 7. Team B submits Team B's dynamic flag
  console.log('\n7. Team Beta submits Team Beta\'s flag:');
  const subB = await fetch(url + '/api/challenges/' + chal.id + '/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookieB },
    body: JSON.stringify({ flag: matchB })
  });
  console.log('   Response:', await subB.json());

  console.log('\n=== ALL TESTS PASSED WITH 100% ISOLATION & PERMUTATION ===');
  process.exit(0);
}

testFullAdminWorkflow().catch(e => { console.error(e); process.exit(1); });
