const db = require('./db');
const bcrypt = require('bcryptjs');

const challenges = [
  {
    title: "Caesar's Salad",
    category: "Crypto",
    description: "I found this weird string on a napkin in Rome: `SYNT{ebg13_vf_gbb_rnfl}`. Can you decode it?",
    points: 50,
    flag: "FLAG{rot13_is_too_easy}",
    difficulty: "easy"
  },
  {
    title: "The RSA Oracle",
    category: "Crypto",
    description: "We intercepted a communication from a rogue AI. It's using textbook RSA without padding.\n\n`N = 3233`\n`e = 17`\n`c = 2790`\n\nFind the plaintext `m` and wrap it in `FLAG{m}`.",
    points: 400,
    flag: "FLAG{65}",
    difficulty: "hard"
  },
  {
    title: "Magic Bytes",
    category: "Forensics",
    description: "We recovered a corrupted file from the suspect's hard drive. The hex editor shows the first 4 bytes are `89 50 4E 47`. What kind of file is this?\n\nWrap the 3-letter file extension in the flag format (e.g. `FLAG{txt}`).",
    points: 200,
    flag: "FLAG{png}",
    difficulty: "medium"
  },
  {
    title: "The Missing CEO",
    category: "OSINT",
    description: "The CEO of 'OmniCorp Global' has gone missing. Her employee ID is `OCG-001`. We know their internal emails follow the format `firstname.lastname.id@omnicorp.com`. Her name is Alice Smith.\n\nFind her internal email address and wrap it in the flag format.",
    points: 250,
    flag: "FLAG{alice.smith.ocg-001@omnicorp.com}",
    difficulty: "medium"
  },
  {
    title: "XOR Logic",
    category: "Reverse Engineering",
    description: "I wrote a secure encryption script:\n```python\nflag = '????'\nkey = 42\nencrypted = [ord(c) ^ key for c in flag]\nprint(encrypted)\n# Output: [34, 38, 27, 35, 81, 95, 85, 93, 73, 91, 74, 91, 66, 85, 93, 73, 85, 80, 85, 71, 95, 87, 85, 91, 92]\n```\nCan you reverse it to find the flag?",
    points: 300,
    flag: "FLAG{x0r_m4th_1s_r3v3rs1bl3}",
    difficulty: "medium"
  },
  {
    title: "Buffer Overflow 101",
    category: "Pwn",
    description: "Analyze this C snippet:\n```c\nvoid vuln() {\n  char buffer[64];\n  gets(buffer);\n}\n```\nAssuming a 32-bit architecture with no stack canaries, exactly how many bytes of padding do you need to write before you overwrite the return address (EIP)? \n\n*Hint: Consider the saved EBP.* Wrap the number in `FLAG{}`.",
    points: 450,
    flag: "FLAG{68}",
    difficulty: "hard"
  },
  {
    title: "Sanity Check",
    category: "Misc",
    description: "Welcome to the CTF! Did you read the rules? If so, here is a free flag to get you on the scoreboard!\n\n`FLAG{w3lc0m3_t0_th3_g4m3}`",
    points: 10,
    flag: "FLAG{w3lc0m3_t0_th3_g4m3}",
    difficulty: "easy"
  }
];

const insertChal = db.prepare(`
  INSERT INTO challenges (title, category_id, description, points, flag_hash, difficulty)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let inserted = 0;

for (const c of challenges) {
  const exists = db.prepare('SELECT 1 FROM challenges WHERE title = ?').get(c.title);
  if (!exists) {
    const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(c.category);
    if (!cat) {
      console.log(`Category not found: ${c.category}`);
      continue;
    }
    const hash = bcrypt.hashSync(c.flag, 10);
    insertChal.run(c.title, cat.id, c.description, c.points, hash, c.difficulty);
    inserted++;
  }
}

console.log(`Successfully injected ${inserted} challenges across all categories!`);
