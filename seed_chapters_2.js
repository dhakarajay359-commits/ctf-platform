const db = require('./db.js');
(async () => {
  await db.initDb();

const insertChapter = db.prepare('INSERT INTO campaign_chapters (title, content, required_challenge_id, order_index) VALUES (?, ?, ?, ?)');

try {
  insertChapter.run(
    'CHAPTER 4: The Insider Threat',
    'We intercepted an encrypted email from an OmniCorp whistleblower. They have provided us with a memory dump of a compromised workstation.\n\nYour next objective is Forensics. Analyze the memory dump and extract the hidden credentials. We need those credentials to access the secure vault.\n\nRemember: In forensics, every byte leaves a trace.',
    null,
    5
  );

  insertChapter.run(
    'CHAPTER 5: Ghost in the Machine',
    'Excellent work recovering those credentials.\n\nWe have successfully infiltrated the OmniCorp secure vault, but it is protected by a custom compiled binary. We need to find a vulnerability in their code to bypass the final security layer.\n\nYour task is Reverse Engineering. Disassemble the provided executable, understand its logic, and find the master override password.\n\nDo not fail us now. We are too close.',
    null,
    6
  );

  insertChapter.run(
    'CHAPTER 6: Digital Footprints',
    'The master override is ours. We have full access to the mainframe.\n\nBefore we execute the final data exfiltration, we need to locate the physical server farm. OmniCorp wiped all internal records of its location.\n\nWe need your OSINT (Open Source Intelligence) skills. Track down the CEO\'s recent digital footprint on social media to geolocate the secret data center. The truth is out there.',
    null,
    7
  );

  insertChapter.run(
    'EPILOGUE: System Offline',
    'Target acquired. Data exfiltration complete.\n\nOmniCorp\'s deepest secrets have been broadcasted to every major news outlet globally. Their stock is plummeting, and authorities are moving in.\n\nYou have proven yourself to be a master of the digital realm. The network thanks you for your service.\n\nMISSION ACCOMPLISHED.',
    null,
    8
  );

  console.log("New campaign chapters added successfully!");
  process.exit(0);
} catch (e) {
  console.error("Error adding chapters:", e);
  process.exit(1);
}
})();
