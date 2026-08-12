const db = require('better-sqlite3')('data/ctf.db');
await db.prepare("UPDATE challenges SET title = 'Target Alpha', difficulty = 'medium' WHERE title = 'Target Alpha (Sandbox)'").run();
console.log('Fixed Target Alpha difficulty and title.');