const db = require('./db');
const bcrypt = require('bcryptjs');

const leakyDownloadsExists = db.prepare('SELECT 1 FROM challenges WHERE title = ?').get('Leaky Downloads');
if (!leakyDownloadsExists) {
  const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get('Web');
  const catId = cat ? cat.id : null;
  const flagHash = bcrypt.hashSync('FLAG{docker_sandboxing_is_highly_secure}', 10);
  
  db.prepare(`
    INSERT INTO challenges (title, category_id, description, points, flag_hash, difficulty, link)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'Leaky Downloads', 
    catId, 
    'I built a file sharing site, but I think it leaks data. Can you find the flag?\n\nTarget: [http://localhost:8080](http://localhost:8080)\n\n*Note: This is a sandboxed Docker demonstration.*',
    50, 
    flagHash, 
    'easy', 
    'http://localhost:8080'
  );
  console.log('Successfully inserted Leaky Downloads challenge!');
} else {
  console.log('Challenge already exists.');
}
