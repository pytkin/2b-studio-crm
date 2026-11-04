import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('checks staged blob bytes even when a partially staged file was cleaned or removed', (t) => {
  const { cwd, env, write, scan } = scannerFixture(t);
  const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
  const binaryName = 'staged file\twith-newline\n.bin';
  // Invalid UTF-8, NUL and a fake batch header must not disrupt the next object.
  write('a.bin', Buffer.from([255, 0, 10, 128]));
  write(
    binaryName,
    Buffer.concat([Buffer.from([0, 255]), Buffer.from(password + '\nabc blob 4\n')]),
  );
  write(localAccounts, JSON.stringify([{ password }]));
  git('add', '--', 'a.bin', binaryName);
  write(binaryName, 'clean working copy');
  for (const remove of [false, true]) {
    if (remove) rmSync(join(cwd, binaryName));
    const result = scan();
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('staged file'));
    assert.equal((result.stderr + result.stdout).includes(password), false);
  }
  git('rm', '--cached', '--', binaryName);
  assert.equal(scan().status, 0);
});

test('never follows indexed symlinks, gitlinks, or symlinked working-tree directories', (t) => {
  const { cwd, env, write, scan } = scannerFixture(t);
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' });
  write(localAccounts, JSON.stringify([{ password }]));
  write('elsewhere/secret', password);
  symlinkSync('elsewhere/secret', join(cwd, 'link'));
  symlinkSync(password, join(cwd, 'dangling-link'));
  write('old/secret', 'public');
  git('add', '--', 'link', 'dangling-link', 'old/secret');
  const tree = git('write-tree').trim();
  const commit = git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit-tree',
    tree,
    '-m',
    'fixture',
  ).trim();
  git('update-index', '--add', '--cacheinfo', `160000,${commit},embedded`);
  write('embedded/private', password);
  rmSync(join(cwd, 'old'), { recursive: true });
  symlinkSync('elsewhere', join(cwd, 'old'));
  const clean = scan();
  assert.equal(clean.status, 0, clean.stderr);
});

test('staged blob scan reads the stored object even with a local Git replacement', (t) => {
  const { cwd, env, write, scan } = scannerFixture(t);
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  write(localAccounts, JSON.stringify([{ password }]));
  write('partial.txt', password);
  git('add', '--', 'partial.txt');
  const staged = git('rev-parse', ':partial.txt');
  write('partial.txt', 'clean');
  const clean = git('hash-object', '-w', 'partial.txt');
  git('replace', staged, clean);
  const result = scan();
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('partial.txt'));
  assert.equal((result.stdout + result.stderr).includes(password), false);
});
