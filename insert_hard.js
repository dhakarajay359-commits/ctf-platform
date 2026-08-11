const db = require('./db');
const bcrypt = require('bcryptjs');

const chalExists = db.prepare('SELECT 1 FROM challenges WHERE title = ?').get("The Architect's Profile");
if (!chalExists) {
  const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get('Web');
  const catId = cat ? cat.id : null;
  const flagHash = bcrypt.hashSync('FLAG{d3s3r1al1z4t10n_m4st3rm1nd}', 10);
  
  db.prepare(`
    INSERT INTO challenges (title, category_id, description, points, flag_hash, difficulty, link, docker_image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "The Architect's Profile", 
    catId, 
    'I built a custom profile engine that serializes state into cookies. I hear the Node.js `node-serialize` library has a fatal flaw though. Can you break out of the object context and gain Remote Code Execution (RCE)?\n\nTarget: [http://localhost:8081](http://localhost:8081)\n\n*Note: This is a sandboxed Docker demonstration.*',
    500, 
    flagHash, 
    'hard', 
    'http://localhost:8081',
    'ctf-hard-sandbox'
  );
  console.log('Successfully inserted Hard Challenge!');
} else {
  console.log('Challenge already exists.');
}
