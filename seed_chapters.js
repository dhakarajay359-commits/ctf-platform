const db = require('./db.js');

(async () => {
  await db.initDb();

  const insertChapter = db.prepare('INSERT INTO campaign_chapters (title, content, required_challenge_id, order_index) VALUES (?, ?, ?, ?)');

  try {
    insertChapter.run(
      'CHAPTER 2: Deep Dive',
      'We have analyzed the environment variables from the Target Alpha server.\n\nThey revealed a hidden subnet used for internal OmniCorp development. We need you to pivot into this network.\n\nYour next set of challenges involves cracking their legacy cryptographic implementations. Prove you can break their encryption, and we will give you the keys to the kingdom.',
      null,
      3
    );

    insertChapter.run(
      'CHAPTER 3: Checkmate',
      'The cryptography is broken. The network is ours.\n\nYou have successfully compromised OmniCorp\'s core database. The files you extracted contain proof of their illegal surveillance programs.\n\nWe are preparing to leak this to the press. You have done a great service to the network today. Stay sharp, initiate.',
      null,
      4
    );
    console.log("Chapters added!");
    process.exit(0);
  } catch (e) {
    console.log("Error or already added.");
    process.exit(1);
  }
})();
