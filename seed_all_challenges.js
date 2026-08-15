const db = require('./db');
(async () => {
  await db.initDb();
const bcrypt = require('bcryptjs');
const challenges = [{
  title: "Caesar's Salad",
  category: "Crypto",
  description: "A field agent intercepted a cipher fragment from an off-site operative rendezvous. Analyze the ciphertext and extract the plain text authentication token: `SYNT{ebg13_vf_gbb_rnfl}`.",
  corporate_context: "The client **OmniCorp Global** recovered an encrypted physical message during an executive suite audit. Internal SOC suspects an initial operative handshake. Decipher the token to prove the legacy cipher flaw.",
  target_asset: "secops-intel.corp.local [Field Asset]",
  ticket_number: "INC-20419",
  points: 50,
  flag: "FLAG{rot13_is_too_easy}",
  difficulty: "easy",
  hints: [
    { text: "Level 1 (Architectural Context): The message uses classical monoalphabetic substitution ciphers from legacy operative communiques.", cost: 0 },
    { text: "Level 2 (Methodology Pointer): Inspect alphabet rotation algorithms with a fixed 13-character displacement.", cost: 5 },
    { text: "Level 3 (Direct Payload Syntax): Rotate each letter in SYNT{ebg13_vf_gbb_rnfl} by 13 positions (e.g. tr 'A-Za-z' 'N-ZA-Mn-za-m').", cost: 15 }
  ]
}, {
  title: "The RSA Oracle",
  category: "Crypto",
  description: "A client hired our firm to audit `corp-internal-dev.local`. Employees reported abnormal CPU usage on this server.\n\nSOC intercepted internal key-exchange traffic using textbook RSA without padding:\n`N = 3233`\n`e = 17`\n`c = 2790`\n\nCalculate the plaintext `m` and wrap it in `FLAG{m}`.",
  corporate_context: "Internal audit for **Apex Financial Networks** under Scope of Work **#INC-89211**. Employees reported suspicious CPU spikes on `corp-internal-dev.local`. An unpadded RSA oracle service is leaking transaction tokens across the DMZ.",
  target_asset: "corp-internal-dev.local [192.168.10.50]",
  ticket_number: "INC-89211",
  points: 400,
  flag: "FLAG{65}",
  difficulty: "hard",
  hints: [
    { text: "Level 1 (Architectural Context): This endpoint implements unpadded textbook RSA key exchange where c = m^e (mod N) with small public modulus N=3233.", cost: 0 },
    { text: "Level 2 (Methodology Pointer): Factor the small modulus N = p * q using trial division to compute Euler's totient phi(N) = (p-1)*(q-1).", cost: 15 },
    { text: "Level 3 (Direct Payload Syntax): Factors are p=53, q=61. Compute d = 17^(-1) mod 3120 = 2753. Plaintext is m = 2790^2753 mod 3233 = 65.", cost: 50 }
  ]
}, {
  title: "Magic Bytes",
  category: "Forensics",
  description: "During incident triage on executive workstation `finance-ws04.local`, forensics analysts extracted a corrupted file payload. Hex inspection shows initial magic header `89 50 4E 47`.\n\nIdentify the file format and wrap the 3-letter extension in `FLAG{ext}`.",
  corporate_context: "Emergency Incident Response ticket **#INC-44021** for **OmniCorp Medical Division**. Suspicious macro execution was logged on `finance-ws04.local`. Analyze the file header signature to verify the payload class.",
  target_asset: "finance-ws04.corp.local [Forensic Image]",
  ticket_number: "INC-44021",
  points: 200,
  flag: "FLAG{png}",
  difficulty: "medium",
  hints: [
    { text: "Level 1 (Architectural Context): Operating system file type detectors rely on file signature magic bytes at offset 0x00.", cost: 0 },
    { text: "Level 2 (Methodology Pointer): Look up hex bytes 89 50 4E 47 in standard file format signature tables.", cost: 10 },
    { text: "Level 3 (Direct Payload Syntax): 89 50 4E 47 corresponds to Portable Network Graphics (extension png). Wrap as FLAG{png}.", cost: 25 }
  ]
}, {
  title: "The Missing CEO",
  category: "OSINT",
  description: "OmniCorp Global legal council has initiated an authorized external OSINT assessment. The missing CEO is Alice Smith (ID `OCG-001`). Corporate standard format is `firstname.lastname.id@omnicorp.com`.\n\nReconstruct her verified corporate address and submit in `FLAG{...}`.",
  corporate_context: "Scope of Work **#INC-91002**: External Threat Intelligence reconnaissance against corporate identity structure of **OmniCorp Global**. Map executive email namespaces to test spear-phishing vulnerability.",
  target_asset: "omnicorp-global.org [Public Perimeter]",
  ticket_number: "INC-91002",
  points: 250,
  flag: "FLAG{alice.smith.ocg-001@omnicorp.com}",
  difficulty: "medium",
  hints: [
    { text: "Level 1 (Architectural Context): Corporate LDAP and email routing schemes enforce strict schema standards.", cost: 0 },
    { text: "Level 2 (Methodology Pointer): Extract the first name, last name, and employee ID components, converting all characters to lowercase.", cost: 10 },
    { text: "Level 3 (Direct Payload Syntax): Assemble schema firstname.lastname.id@omnicorp.com => alice.smith.ocg-001@omnicorp.com.", cost: 25 }
  ]
}, {
  title: "XOR Logic",
  category: "Reverse Engineering",
  description: "A proprietary telemetry agent was recovered from a DMZ server. Decompiled logic shows byte-level XOR transformation with static key `42`:\n```python\n# Intercepted stream:\n[34, 38, 27, 35, 81, 95, 85, 93, 73, 91, 74, 91, 66, 85, 93, 73, 85, 80, 85, 71, 95, 87, 85, 91, 92]\n```\nReverse the XOR transformation to recover the internal authorization flag.",
  corporate_context: "Security assessment for **Cyberdyne Health Networks** under ticket **#INC-31890**. An employee deployed a custom obfuscated script on production server `srv-telemetry.corp.local`. Reverse the XOR algorithm to audit the secret key.",
  target_asset: "srv-telemetry.corp.local [172.16.4.12]",
  ticket_number: "INC-31890",
  points: 300,
  flag: "FLAG{x0r_m4th_1s_r3v3rs1bl3}",
  difficulty: "medium",
  hints: [
    { text: "Level 1 (Architectural Context): The decompiled routine applies symmetric bitwise XOR with single-byte static key.", cost: 0 },
    { text: "Level 2 (Methodology Pointer): XOR is self-inverting (A ^ K ^ K = A). Applying key 42 to each byte in the stream recovers original characters.", cost: 15 },
    { text: "Level 3 (Direct Payload Syntax): In Python: bytes([b ^ 42 for b in [34, 38, 27, ...]]).decode()", cost: 35 }
  ]
}, {
  title: "Buffer Overflow 101",
  category: "Pwn",
  description: "Perform an authorized binary audit of vulnerable internal gateway daemon on `srv-gateway-bin.prod.local`:\n```c\nvoid vuln() {\n  char buffer[64];\n  gets(buffer);\n}\n```\nAssuming 32-bit x86 architecture with saved EBP, calculate the exact byte count required to reach and overwrite the return address (EIP). Submit in `FLAG{bytes}`.",
  corporate_context: "Scope of Work **#INC-77192**: Binary vulnerability assessment on legacy C daemon deployed on `srv-gateway-bin.prod.local`. Determine exact buffer offset to prove exploitable memory corruption.",
  target_asset: "srv-gateway-bin.prod.local:9001",
  ticket_number: "INC-77192",
  points: 450,
  flag: "FLAG{68}",
  difficulty: "hard",
  hints: [
    { text: "Level 1 (Architectural Context): In 32-bit x86 cdecl calling convention, the stack allocates local buffers, saved EBP (4 bytes), then Return Address (EIP).", cost: 0 },
    { text: "Level 2 (Methodology Pointer): Buffer size is 64 bytes. In 32-bit x86, saved EBP occupies 4 bytes immediately following the buffer.", cost: 20 },
    { text: "Level 3 (Direct Payload Syntax): Total bytes to reach EIP = sizeof(buffer) + sizeof(saved_ebp) = 64 + 4 = 68. Submit FLAG{68}.", cost: 50 }
  ]
}, {
  title: "Sanity Check",
  category: "Misc",
  description: "Welcome to the corporate penetration engagement! Read the Rules of Engagement and verify your comms channel to claim your initial credential:\n\n`FLAG{w3lc0m3_t0_th3_g4m3}`",
  corporate_context: "Initial engagement briefing for all authorized security auditors. Confirm connection to the engagement infrastructure and acknowledge platform Rules of Engagement.",
  target_asset: "secops-portal.corp.local",
  ticket_number: "INC-10001",
  points: 10,
  flag: "FLAG{w3lc0m3_t0_th3_g4m3}",
  difficulty: "easy",
  hints: [
    { text: "Level 1 (Architectural Context): The flag token is stated directly in the briefing description.", cost: 0 },
    { text: "Level 2 (Methodology Pointer): Copy the string enclosed inside FLAG{...}.", cost: 1 },
    { text: "Level 3 (Direct Payload Syntax): Submit FLAG{w3lc0m3_t0_th3_g4m3}.", cost: 2 }
  ]
}];

const insertChal = db.prepare(`
  INSERT INTO challenges (title, category_id, description, points, flag_hash, difficulty, corporate_context, target_asset, ticket_number, blue_team_postmortem, remediation_bonus_points, remediation_guide)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
let inserted = 0;
for (const c of challenges) {
  const existingChal = await db.prepare('SELECT id FROM challenges WHERE title = ?').get(c.title);
  const samplePm = JSON.stringify({
    summary: `Incident Post-Mortem & Defense Reconstruction for ${c.title}.\n\nDuring security assessment, Red Team exploited primitives on target asset \`${c.target_asset}\`. Blue Team SIEM and Sysmon sensors captured initial process execution, network sockets, and flag retrieval.`,
    sysmonLogs: [
      { eventId: 1, event: "Process Creation", image: "/usr/bin/node /app/server.js", cmdline: "node /app/server.js --stage=production", user: "www-data", time: "14:22:05" },
      { eventId: 3, event: "Network Connection", srcIp: "198.51.100.44", srcPort: "49152", destIp: "192.168.10.50", destPort: "8080", protocol: "TCP", time: "14:22:08" },
      { eventId: 11, event: "File Access", path: "/var/secret/flag.txt", hash: "SHA256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", time: "14:22:12" }
    ],
    pcapStream: `GET /api/exploit HTTP/1.1\r\nHost: ${c.target_asset.split(' ')[0]}\r\nUser-Agent: Mozilla/5.0 (Operative Security Probe)\r\nAuthorization: Bearer <Dynamic_Session_Token>\r\nAccept: */*\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n[+] Exploit verified. Dynamic Flag decrypted.`,
    detectionRule: `alert tcp $EXTERNAL_NET any -> $HOME_NET 8080 (msg:"[BLUE TEAM] Exploit Signature on ${c.target_asset.split(' ')[0]}"; flow:to_server,established; content:"FLAG{"; classtype:trojan-activity; sid:2026001; rev:1;)`
  });
  const remGuide = "1. Enforce strict input validation. 2. Apply security patch and disable vulnerable legacy primitives. 3. Deploy runtime host sensors and egress monitoring.";

  let chalId;
  if (!existingChal) {
    const cat = await db.prepare('SELECT id FROM categories WHERE name = ?').get(c.category);
    if (!cat) {
      console.log(`Category not found: ${c.category}`);
      continue;
    }
    const hash = bcrypt.hashSync(c.flag, 10);
    const info = await insertChal.run(c.title, cat.id, c.description, c.points, hash, c.difficulty, c.corporate_context, c.target_asset, c.ticket_number, samplePm, 25, remGuide);
    chalId = info.lastInsertRowid;
    inserted++;
  } else {
    chalId = existingChal.id;
    await db.prepare('UPDATE challenges SET corporate_context = ?, target_asset = ?, ticket_number = ?, blue_team_postmortem = ?, remediation_bonus_points = ?, remediation_guide = ? WHERE id = ?')
      .run(c.corporate_context, c.target_asset, c.ticket_number, samplePm, 25, remGuide, chalId);
  }

  // Sync Progressive Hints
  if (c.hints && chalId) {
    await db.prepare('DELETE FROM hints WHERE challenge_id = ?').run(chalId);
    for (let i = 0; i < c.hints.length; i++) {
      const h = c.hints[i];
      await db.prepare('INSERT INTO hints (challenge_id, text, cost, order_index) VALUES (?, ?, ?, ?)').run(chalId, h.text, h.cost, i);
    }
  }
}
console.log('Successfully injected ' + challenges.length + ' challenges with 3-Tier Progressive Hints!');
  process.exit(0);
})();