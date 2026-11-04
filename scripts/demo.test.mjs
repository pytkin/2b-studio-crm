import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openAccounts } from './demo-accounts.mjs';
import { localConfig, runDemo } from './demo.mjs';

test('demo starts from a clean checkout and applies pending migrations without resetting', async () => {
  const calls = [];
  const operations = Object.fromEntries(
    ['install', 'start', 'migrate', 'provision', 'build', 'serve', 'shutdown', 'stop'].map(
      (name) => [
        name,
        () => {
          calls.push(name);
        },
      ],
    ),
  );
  await runDemo('start', operations);
  assert.deepEqual(calls, ['install', 'start', 'migrate', 'provision', 'build', 'serve']);
  calls.length = 0;
  await runDemo('stop', operations);
  assert.deepEqual(calls, ['shutdown', 'stop']);
  await assert.rejects(runDemo('reset', operations));
});

test('credentials exist privately before provisioning and survive restarts', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-credentials-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'demo-accounts.json');
  const accounts = openAccounts(path);
  assert.deepEqual(
    accounts.map((a) => a.role),
    ['manager', 'executor', 'executor'],
  );
  assert.equal(new Set(accounts.map((a) => a.password)).size, 3);
  assert.ok(accounts.every((a) => a.password.length >= 24));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(openAccounts(path), accounts);
});

test('two worktrees share credentials for the same local project and refuse conflicting private files', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-project-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const shared = join(dir, 'project-accounts.json');
  const first = join(dir, 'one.json');
  const second = join(dir, 'two.json');
  const a = openAccounts(first, shared);
  const b = openAccounts(second, shared);
  assert.deepEqual(
    a.map((u) => u.id),
    b.map((u) => u.id),
  );
  assert.deepEqual(
    a.map((u) => u.password === b.find((v) => v.id === u.id)?.password),
    [true, true, true],
  );
  assert.equal(statSync(second).mode & 0o777, 0o600);
  assert.equal(statSync(shared).mode & 0o777, 0o600);
  const outsider = join(dir, 'different.json');
  openAccounts(outsider);
  assert.throws(() => openAccounts(outsider, shared));
});

test('CLI failures and invalid DSNs never expose captured credentials in uncaught diagnostics', () => {
  const marker = 'synthetic-private-canary';
  const readError = () => {
    const e = Error('status failed');
    e.stdout = Buffer.from(marker);
    e.output = [null, e.stdout];
    throw e;
  };
  const invalidUrl = () => `DB_URL="${marker}"\n`;
  for (const read of [readError, invalidUrl]) {
    assert.throws(
      () => localConfig('test', read),
      (error) => {
        assert.equal(error.stdout, undefined);
        assert.equal(error.input, undefined);
        assert.equal(error.cause, undefined);
        assert.equal(error.message.includes(marker), false);
        return true;
      },
    );
  }
});

test('standalone entry point completes shutdown through the real preview module', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-demo-entry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'));
  for (const name of ['demo.mjs', 'demo-preview.mjs', 'demo-accounts.mjs']) {
    copyFileSync(new URL(name, import.meta.url), join(dir, 'scripts', name));
  }
  writeFileSync(
    join(dir, 'scripts', 'supabase-local.mjs'),
    'export function runLocalSupabase() {}',
  );
  const result = spawnSync(process.execPath, ['scripts/demo.mjs', 'stop'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
