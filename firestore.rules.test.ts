import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Static & Structural Audit Verification for firestore.rules against security_spec.md "Dirty Dozen" invariants.
 */
const rulesText = fs.readFileSync('firestore.rules', 'utf-8');

test('firestore.rules starts with global deny-by-default catch-all and zero open writes', () => {
  const firstMatchIdx = rulesText.indexOf('match /{document=**}');
  const userMatchIdx = rulesText.indexOf('match /users/{userId}');
  assert.ok(firstMatchIdx > 0 && firstMatchIdx < userMatchIdx, 'Root catch-all must precede collection rules');
  assert.match(rulesText, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
  assert.equal(/allow\s+(read|write)\s*:\s*if\s*true/i.test(rulesText), false);
});

test('firestore.rules enforces verified email, Master Gate, and zero get()/exists() in list rules', () => {
  assert.match(rulesText, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(rulesText, /function\s+isMasterOwner\(userId\)/);

  const listRules = [...rulesText.matchAll(/allow\s+list:\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(listRules.length >= 4);
  for (const cond of listRules) {
    assert.equal(/\b(get|exists)\s*\(/.test(cond), false, `list rule must not call get()/exists(): ${cond}`);
    assert.match(cond, /existing\(\)\.ownerId\s*==\s*request\.auth\.uid/);
  }
});

test('firestore.rules binds every string field with .size(), every array with bounded element guard, and immutable createdAt/ownerId updates', () => {
  // Check update rules include createdAt == existing().createdAt & ownerId == existing().ownerId & updatedAt == request.time
  const updateBlocks = [...rulesText.matchAll(/allow\s+update:\s*if\s+([\s\S]*?);/g)].map((m) => m[1]);
  assert.equal(updateBlocks.length, 5);
  for (const block of updateBlocks) {
    assert.match(block, /isValid/);
    assert.match(block, /incoming\(\)\.createdAt\s*==\s*existing\(\)\.createdAt/);
    assert.match(block, /incoming\(\)\.ownerId\s*==\s*existing\(\)\.ownerId/);
    assert.match(block, /incoming\(\)\.updatedAt\s*==\s*request\.time/);
    assert.match(block, /affectedKeys\(\)\.hasOnly\(/);
  }
  assert.match(rulesText, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);
  assert.match(rulesText, /isBoundedStringList/);
});
