import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectArtifacts } from './artifact-secrets.mjs';
test('flags privileged tokens and known demo credentials by filename only', () => {
  const secret = 'sb_' + 'secret_' + 'Z'.repeat(38);
  const jwt =
    'eyJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') +
    '.' +
    'S'.repeat(33);
  const known = 'temporary-' + 'passphrase';
  for (const value of [secret, jwt, known]) {
    const result = inspectArtifacts(
      [['dist/app.js', Buffer.from('before ' + value + ' after')]],
      [known],
    );
    assert.deepEqual(result, ['dist/app.js']);
    assert.equal(JSON.stringify(result).includes(value), false);
  }
  assert.deepEqual(
    inspectArtifacts([['public.js', Buffer.from('sb_publishable_example')]], []),
    [],
  );
});

test('rejects a bearer token of a signed-in user but allows a public anonymous JWT', () => {
  const token = (role) =>
    [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ role, sub: 'test-user' })).toString('base64url'),
      'synthetic-signature',
    ].join('.');
  const paths = inspectArtifacts(
    [
      ['public.js', Buffer.from(token('anon'))],
      ['failure.log', Buffer.from(token('authenticated'))],
    ],
    [],
  );
  assert.deepEqual(paths, ['failure.log']);
});
