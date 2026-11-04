import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPublicKey } from '../src/shared/public-config.ts';

// Only the public-config classifier is under test. These unsigned samples
// cannot authenticate a request; no local Supabase credentials are needed.
const legacyKey = (claims) =>
  'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';

test('allows publishable keys and legacy anon payloads using the URL-safe alphabet', () => {
  assert.equal(isPublicKey('sb_publishable_example'), true);
  // This payload contains both "-" and "_" in its base64url encoding.
  assert.equal(isPublicKey(legacyKey({ role: 'anon', ref: '???~~~???' })), true);
});

test('refuses private keys, non-anonymous roles and unreadable payloads', () => {
  for (const role of ['service_role', 'authenticated', 'admin', null]) {
    assert.equal(isPublicKey(legacyKey({ role })), false, 'denied role: ' + role);
  }
  for (const key of ['sb_secret_example', legacyKey({}), 'header.**.signature', '']) {
    assert.equal(isPublicKey(key), false);
  }
});
