import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function chromiumFixture(t, body) {
  const root = join(import.meta.dirname, '..');
  const cwd = mkdtempSync(join(tmpdir(), 'crm-report-regression-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir');
  copyFileSync(join(root, 'playwright.config.ts'), join(cwd, 'project.config.ts'));
  symlinkSync(join(root, 'scripts'), join(cwd, 'scripts'), 'dir');
  mkdirSync(join(cwd, 'private'), { mode: 0o700 });
  const password = randomUUID();
  const accounts = join(cwd, 'private/credentials.json');
  writeFileSync(accounts, JSON.stringify({ accounts: [{ password }] }), { mode: 0o600 });
  writeFileSync(
    join(cwd, 'playwright.config.ts'),
    `
    import project from './project.config';
    export default { ...project, testDir: '.', testMatch: 'login.spec.ts', webServer: undefined };
  `,
  );
  writeFileSync(
    join(cwd, 'login.spec.ts'),
    `
    import { test } from '@playwright/test';
    import { readFileSync, writeFileSync } from 'node:fs';
    test('login regression', async ({ page }, info) => {
      const { accounts } = JSON.parse(readFileSync(process.env.CRM_E2E_ACCOUNTS, 'utf8'));
      await page.setContent('<label>Password<input type="password"></label>');
      await page.getByLabel('Password').fill(accounts[0].password);
      ${body}
    });
  `,
  );
  const run = () =>
    spawnSync(
      join(root, 'node_modules/.bin/playwright'),
      ['test', '--project=desktop', '--trace=on'],
      {
        cwd,
        timeout: 25_000,
        encoding: 'utf8',
        env: { ...process.env, CRM_E2E_ACCOUNTS: accounts },
      },
    );
  return { cwd, password, run };
}

test('a failed Chromium login exports a diagnostic but no fixture password or trace', (t) => {
  const { cwd, password, run } = chromiumFixture(
    t,
    `
      await info.attach('crm-snapshot-example', { contentType: 'image/png', body: await page.screenshot() });
      console.log(accounts[0].password);
      throw Error('intentional login failure ' + accounts[0].password);
  `,
  );
  const result = run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const log = result.stdout + result.stderr;
  assert.ok(log.includes('intentional login failure'), 'preserve the failure diagnosis');
  assert.equal(log.includes(password), false);
  const published = join(cwd, 'test-results');
  const report = files(published);
  assert.ok(
    report.every((path) => !readFileSync(path).includes(password)),
    'no report file may contain the password',
  );
  assert.ok(
    report.every((path) => !path.endsWith('.zip')),
    'raw trace is private',
  );
  assert.ok(
    report.some((path) => readFileSync(path).includes('intentional login failure [скрыто]')),
  );
  assert.ok(report.some((path) => path.endsWith('example.png') && readFileSync(path)[0] === 0x89));
  const privateFiles = files(join(cwd, 'private'));
  const context = privateFiles.find((path) => path.endsWith('error-context.md'));
  assert.ok(
    context && readFileSync(context).includes(password),
    'positive control: Playwright produced the sensitive snapshot privately',
  );
  assert.ok(privateFiles.some((path) => path.endsWith('trace.zip')));
  assert.equal(existsSync(join(cwd, 'playwright-report')), false);
});

test('an interrupted Playwright process never exposes an unfinished raw artifact', {
  skip: process.platform === 'win32',
}, (t) => {
  const { cwd, password, run } = chromiumFixture(
    t,
    `
    writeFileSync(info.outputPath('partial.log'), accounts[0].password);
    process.kill(process.ppid, 'SIGKILL');
  `,
  );
  const result = run();
  assert.equal(result.error, undefined);
  assert.equal(result.signal, 'SIGKILL');
  const partial = files(join(cwd, 'private')).find((path) => path.endsWith('partial.log'));
  assert.ok(
    partial && readFileSync(partial).includes(password),
    'raw output really existed before interruption',
  );
  assert.equal(existsSync(join(cwd, 'test-results')), false);
  assert.equal(existsSync(join(cwd, 'playwright-report')), false);
});

test('a tainted PNG attachment prevents publication of the whole run', (t) => {
  const { cwd, password, run } = chromiumFixture(
    t,
    `
    const body = Buffer.concat([await page.screenshot(), Buffer.from(accounts[0].password)]);
    await info.attach('crm-snapshot-tainted', { contentType: 'image/png', body });
  `,
  );
  const result = run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Не удалось проверить и сохранить отчёт Playwright/);
  assert.equal((result.stdout + result.stderr).includes(password), false);
  assert.equal(existsSync(join(cwd, 'test-results')), false);
});
