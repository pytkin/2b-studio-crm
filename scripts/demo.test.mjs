import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openAccounts } from './demo-accounts.mjs';
import { runDemo } from './demo.mjs';
import { localConfig } from './supabase-local.mjs';

test('a failed start releases a newly opened stack, but preserves a running project', async () => {
  for (const alreadyRunning of [false, true]) {
    for (const failedStep of ['start', 'serve']) {
      const calls = [];
      let running = alreadyRunning;
      const ops = Object.fromEntries(
        ['install', 'start', 'migrate', 'activate', 'provision', 'build', 'serve', 'stop'].map(
          (name) => [
            name,
            () => {
              calls.push(name);
              if (name === 'start') running = true;
              if (name === 'stop') running = false;
              if (name === failedStep) throw Error('injected failure');
            },
          ],
        ),
      );
      ops.isRunning = () => running;
      await assert.rejects(runDemo('start', ops));
      assert.equal(calls.includes('stop'), !alreadyRunning, failedStep);
    }
  }
});

test('explicit stop attempts both resources even when preview shutdown fails', async () => {
  const calls = [];
  await assert.rejects(
    runDemo('stop', {
      shutdown() {
        calls.push('preview');
        throw Error('injected');
      },
      stop() {
        calls.push('db');
      },
    }),
  );
  assert.deepEqual(calls, ['preview', 'db']);
});

test('refusing a start before creating containers does not stop a project again', async () => {
  let stopped = false;
  await assert.rejects(
    runDemo('start', {
      install() {},
      isRunning: () => false,
      start() {
        throw Error('preflight refused');
      },
      stop() {
        stopped = true;
      },
    }),
  );
  assert.equal(stopped, false);
});

test('demo starts from a clean checkout and applies pending migrations without resetting', async () => {
  const calls = [];
  const operations = Object.fromEntries(
    [
      'install',
      'start',
      'migrate',
      'activate',
      'provision',
      'build',
      'serve',
      'shutdown',
      'stop',
    ].map((name) => [
      name,
      () => {
        calls.push(name);
      },
    ]),
  );
  const activation = Promise.withResolvers();
  operations.isRunning = () => true;
  operations.activate = () => {
    calls.push('activate');
    return activation.promise;
  };
  const started = runDemo('start', operations);
  await new Promise((resolve) => setImmediate(resolve));
  const beforeConfirmation = [...calls];
  activation.resolve();
  await started;
  assert.deepEqual(beforeConfirmation, ['install', 'start', 'migrate', 'activate']);
  assert.deepEqual(calls, [
    'install',
    'start',
    'migrate',
    'activate',
    'provision',
    'build',
    'serve',
  ]);
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

test('refuses existing credentials with public permissions, symlinks or inconsistent roles', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-credentials-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'accounts.json');
  const accounts = openAccounts(file);
  chmodSync(file, 0o644);
  assert.throws(() => openAccounts(file), /chmod 600/);
  chmodSync(file, 0o600);
  const link = join(dir, 'linked.json');
  symlinkSync(file, link);
  assert.throws(() => openAccounts(link), { code: 'ELOOP' });
  assert.deepEqual(openAccounts(file), accounts);
  accounts[1].role = 'manager';
  writeFileSync(file, JSON.stringify(accounts));
  assert.throws(() => openAccounts(file), /Неверный формат/);
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
    join(dir, 'scripts', 'stack-lock.mjs'),
    'export const withStackLock = (target, run) => run();',
  );
  writeFileSync(
    join(dir, 'scripts', 'supabase-local.mjs'),
    'export const cliEnv={},root=process.cwd(); export function openLocalStack() { return {run(){}}; }',
  );
  const result = spawnSync(process.execPath, ['scripts/demo.mjs', 'stop'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('demo cannot provision accounts or publish a URL before the REST read guard is confirmed', async () => {
  const events = [];
  const ops = Object.fromEntries(
    ['install', 'start', 'migrate', 'activate', 'provision', 'build', 'serve'].map((name) => [
      name,
      () => {
        events.push(name);
        if (name === 'activate') throw new Error('Guard did not reject the client');
      },
    ]),
  );
  ops.isRunning = () => true;
  await assert.rejects(runDemo('start', ops), /activate/);
  assert.deepEqual(events, ['install', 'start', 'migrate', 'activate']);
});

test('an unverified REST service cannot reopen CRM tables, including after a reload failure', async () => {
  const { enableVerifiedReads } = await import('./local-read-access.mjs');
  for (const fault of [
    'wrong-response',
    'configure-failed',
    'reloaded-without-hook',
    'delayed-reload',
    'ready',
  ]) {
    const changes = [];
    let probes = 0;
    const ops = {
      probe: async () => {
        probes++;
        return (
          fault === 'ready' ||
          (fault === 'reloaded-without-hook' && probes === 1) ||
          (fault === 'delayed-reload' && probes >= 3)
        );
      },
      wait: async () => {},
      restrict: async () => {
        changes.push('closed');
      },
      configure: async () => {
        changes.push('configure');
        if (fault === 'configure-failed') throw Error('cannot compose hook');
      },
      restore: async () => {
        changes.push('opened');
      },
    };
    if (fault === 'ready') {
      await enableVerifiedReads(ops);
      assert.deepEqual(changes, ['configure', 'opened']);
    } else if (fault === 'delayed-reload') {
      await enableVerifiedReads(ops);
      assert.deepEqual(changes, ['closed', 'configure', 'opened']);
    } else {
      await assert.rejects(enableVerifiedReads(ops), /Чтение CRM закрыто/);
      if (fault !== 'reloaded-without-hook')
        assert.deepEqual(changes.slice(0, 2), ['closed', 'configure']);
      assert.ok(!changes.includes('opened'));
      assert.equal(changes.at(-1), 'closed');
    }
  }
});
