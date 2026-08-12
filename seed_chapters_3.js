const db = require('./db.js');
(async () => {
  await db.initDb();
const insertChapter = db.prepare('INSERT INTO campaign_chapters (title, content, required_challenge_id, order_index) VALUES (?, ?, ?, ?)');
try {
  // We need to shift the Epilogue to order_index 11
  await db.prepare("UPDATE campaign_chapters SET order_index = 11 WHERE title = 'EPILOGUE: System Offline'").run();
  insertChapter.run('CHAPTER 7: Cryptographic Warfare', 'We traced the CEO\'s footprint to an off-the-books server facility. However, the exact coordinates are hidden within an encrypted communication channel.\n\nYour task is Cryptography. We\'ve intercepted a series of ciphertexts. You must identify the encryption algorithms used—ranging from classic substitution ciphers to modern AES implementations—and decrypt the messages.\n\nTime is of the essence. Break the crypto before they change the keys.', null, 8);
  insertChapter.run('CHAPTER 8: Packet Whispers', 'We decrypted the coordinates! The facility is located in an underground bunker. We have a team en route, but the bunker\'s automated defenses are active.\n\nYour task is Network Traffic Analysis (PCAP). We have tapped into the bunker\'s network switch. Analyze the captured packet logs to find the hardcoded deactivation sequence for the automated turrets.\n\nLook closely at the unencrypted HTTP traffic and abnormal DNS queries.', null, 9);
  insertChapter.run('CHAPTER 9: Hidden in Plain Sight', 'The turrets are down. Our team has breached the facility and secured the physical servers, but the core data drives are missing. They must have hidden them.\n\nYour task is Steganography. We recovered a suspiciously large image file from the CEO\'s personal drive. The data we need is embedded within the pixels of this image.\n\nExtract the hidden payload. This is the final piece of the puzzle.', null, 10);
  console.log("3 more campaign chapters added successfully!");
  process.exit(0);
} catch (e) {
  console.error("Error adding chapters:", e);
  process.exit(1);
}
})();