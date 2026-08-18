const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SECRET_SALT = process.env.FLAG_SECRET || process.env.SESSION_SECRET || 'ctf-dynamic-session-flag-salt-2026';

/**
 * Generate a cryptographically signed dynamic flag tied to a challenge and team ID.
 * Supports:
 * - Admin base flag permutation: FLAG{<admin_keyword>_<hash>_team_<teamId>}
 * - Standard dynamic signature: FLAG{<hash>_team_<teamId>}
 */
function generateDynamicFlag(challengeId, teamId, baseFlag = null) {
  const chalId = typeof challengeId === 'object' && challengeId !== null ? challengeId.id : challengeId;
  const hash = crypto.createHmac('sha256', SECRET_SALT)
    .update(`chal_${chalId}_team_${teamId}`)
    .digest('hex');

  if (baseFlag && typeof baseFlag === 'string') {
    const cleanBase = baseFlag.replace(/^(flag|FLAG)\{/i, '').replace(/\}$/, '').trim();
    if (cleanBase) {
      return `FLAG{${cleanBase}_${hash.substring(0, 8)}_team_${teamId}}`;
    }
  }

  return `FLAG{${hash.substring(0, 16)}_team_${teamId}}`;
}

/**
 * Verify a submitted flag against dynamic team flag and static DB hash.
 * Also detects cross-team flag sharing (e.g. Discord flag leaks).
 */
function verifyFlag(submittedFlag, challenge, teamId) {
  if (!submittedFlag || !challenge) return { valid: false };
  const trimmed = submittedFlag.trim();

  // 1. Check Team's Dynamic Flags (both standard and base-permuted)
  const expectedStandard = generateDynamicFlag(challenge.id, teamId);
  const expectedPermuted = generateDynamicFlag(challenge.id, teamId, challenge.flag || challenge.base_flag);

  if (trimmed === expectedStandard || trimmed.toLowerCase() === expectedStandard.toLowerCase()) {
    return { valid: true, type: 'dynamic', flag: expectedStandard };
  }
  if (expectedPermuted && (trimmed === expectedPermuted || trimmed.toLowerCase() === expectedPermuted.toLowerCase())) {
    return { valid: true, type: 'dynamic', flag: expectedPermuted };
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
  const match = trimmed.match(/^FLAG\{.*_team_(\d+)\}$/i);
  if (match) {
    const otherTeamId = Number(match[1]);
    if (otherTeamId && otherTeamId !== Number(teamId)) {
      const otherStandard = generateDynamicFlag(challenge.id, otherTeamId);
      const otherPermuted = generateDynamicFlag(challenge.id, otherTeamId, challenge.flag || challenge.base_flag);

      if (trimmed.toLowerCase() === otherStandard.toLowerCase() || 
          (otherPermuted && trimmed.toLowerCase() === otherPermuted.toLowerCase())) {
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
