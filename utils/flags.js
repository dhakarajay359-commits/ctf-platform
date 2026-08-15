const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SECRET_SALT = process.env.FLAG_SECRET || process.env.SESSION_SECRET || 'ctf-dynamic-session-flag-salt-2026';

/**
 * Generate a cryptographically signed dynamic flag tied to a challenge and team ID.
 * Example format: FLAG{a8f9c1b3e4d29107_team_42}
 */
function generateDynamicFlag(challengeId, teamId) {
  const hash = crypto.createHmac('sha256', SECRET_SALT)
    .update(`chal_${challengeId}_team_${teamId}`)
    .digest('hex')
    .substring(0, 16);
  return `FLAG{${hash}_team_${teamId}}`;
}

/**
 * Verify a submitted flag against dynamic team flag and static DB hash.
 * Also detects cross-team flag sharing (e.g. Discord flag leaks).
 */
function verifyFlag(submittedFlag, challenge, teamId) {
  if (!submittedFlag || !challenge) return { valid: false };
  const trimmed = submittedFlag.trim();

  // 1. Check Team's Dynamic Flag
  const expectedDynamic = generateDynamicFlag(challenge.id, teamId);
  if (trimmed === expectedDynamic || trimmed.toLowerCase() === expectedDynamic.toLowerCase()) {
    return { valid: true, type: 'dynamic', flag: expectedDynamic };
  }

  // 2. Check Static Flag
  if (challenge.flag_hash) {
    try {
      const isStatic = bcrypt.compareSync(trimmed, challenge.flag_hash);
      if (isStatic) {
        return { valid: true, type: 'static', flag: trimmed };
      }
    } catch (err) {
      // Invalid bcrypt hash format fallback
      if (challenge.flag_hash === trimmed) {
        return { valid: true, type: 'static', flag: trimmed };
      }
    }
  }

  // 3. Anti-Cheat: Detect cross-team flag sharing (Discord flag leaks)
  const match = trimmed.match(/^FLAG\{([a-f0-9]{16})_team_(\d+)\}$/i);
  if (match) {
    const otherTeamId = Number(match[2]);
    if (otherTeamId && otherTeamId !== Number(teamId)) {
      const otherExpected = generateDynamicFlag(challenge.id, otherTeamId);
      if (trimmed.toLowerCase() === otherExpected.toLowerCase()) {
        return {
          valid: false,
          flagSharingDetected: true,
          sourceTeamId: otherTeamId
        };
      }
    }
  }

  return { valid: false };
}

module.exports = {
  generateDynamicFlag,
  verifyFlag
};
