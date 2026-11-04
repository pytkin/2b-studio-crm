import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const localAccounts = '.local/demo-accounts.json';
const sharedAccounts = 'state/2b-studio-crm-dev/demo-accounts.json';
const password = 'private-synthetic-' + 'passphrase';
const sharedPassword = 'private-shared-' + 'passphrase';

function scannerFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'crm-artifact-scan-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (path, content) => {
    mkdirSync(join(cwd, dirname(path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  // Isolate the credential stores and keep inherited Git index overrides out of the test.
  const env = {
    PATH: process.env.PATH,
    HOME: join(cwd, 'home'),
    XDG_STATE_HOME: join(cwd, 'state'),
  };
  const options = { cwd, encoding: 'utf8', env };
  execFileSync('git', ['init', '--quiet'], options);
  write('tracked.txt', 'public content');
  execFileSync('git', ['add', '--', 'tracked.txt'], options);
  const scanner = fileURLToPath(new URL('./artifact-secrets.mjs', import.meta.url));
  const scan = (environment = env) =>
    spawnSync(process.execPath, [scanner], { ...options, env: environment });
  return { cwd, env, write, scan };
}

test('artifact command reads shared demo passwords even in a fresh checkout without creating credentials', (t) => {
  const { cwd, env, write, scan } = scannerFixture(t);
  assert.equal(scan().status, 0);
  assert.equal(existsSync(join(cwd, localAccounts)), false);
  assert.equal(existsSync(env.XDG_STATE_HOME), false);
  write('tracked.txt', 'logged ' + sharedPassword);
  for (const [source, environment] of [
    [sharedAccounts, env],
    ['home/.local/state/2b-studio-crm-dev/demo-accounts.json', { PATH: env.PATH, HOME: env.HOME }],
  ]) {
    write(source, JSON.stringify([{ password: sharedPassword }]));
    const result = scan(environment);
    assert.equal(result.status, 1, 'another checkout has already provisioned these accounts');
    assert.match(result.stderr, /tracked\.txt/);
    assert.equal((result.stdout + result.stderr).includes(sharedPassword), false);
    assert.equal(existsSync(join(cwd, localAccounts)), false);
    rmSync(join(cwd, source));
  }
});

test('artifact command flags both sets of demo credentials in tracked files, bundles and reports by path only', (t) => {
  const { write, scan } = scannerFixture(t);
  write(localAccounts, JSON.stringify([{ password }]));
  write(sharedAccounts, JSON.stringify([{ password: sharedPassword }]));
  const paths = [
    'tracked.txt',
    'dist/app.js',
    '.local/demo-dist/app.js',
    '.local/e2e-dist/app.js',
    'test-results/failure/log.txt',
    'playwright-report/data/detail.txt',
  ];
  for (const path of paths) write(path, 'sb_publishable_example');
  const clean = scan();
  assert.equal(clean.status, 0, clean.stderr);
  for (const path of paths)
    write(path, 'logged ' + (path === 'tracked.txt' ? sharedPassword : password));
  const leaked = scan();
  assert.equal(leaked.status, 1);
  for (const path of paths) assert.ok(leaked.stderr.split(/\s+/).includes(path), path);
  for (const value of [password, sharedPassword])
    assert.equal((leaked.stdout + leaked.stderr).includes(value), false);
});

test('artifact command fails closed without exposing malformed private credential files', (t) => {
  const { write, scan } = scannerFixture(t);
  for (const [path, invalid] of [
    [localAccounts, '[{"password":"' + password + '"},]'],
    [sharedAccounts, '[{"password":"' + password + '"},]'],
    [localAccounts, JSON.stringify({ password })],
    [sharedAccounts, JSON.stringify([{ password }, {}])],
    [localAccounts, '[]'],
  ]) {
    write(localAccounts, JSON.stringify([{ password }]));
    write(sharedAccounts, JSON.stringify([{ password }]));
    write(path, invalid);
    const malformed = scan();
    assert.equal(malformed.status, 1, 'credential discovery must fail closed');
    assert.equal(
      (malformed.stdout + malformed.stderr).includes(password),
      false,
      'malformed private credentials must never be echoed',
    );
    assert.match(malformed.stderr, /Не удалось прочитать файл демо-доступов/);
  }
});
