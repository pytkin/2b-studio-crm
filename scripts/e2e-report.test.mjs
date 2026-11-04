import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('the E2E command refuses alternate report destinations before preparing credentials', () => {
  for (const args of [
    ['--output=/tmp/unused'],
    ['--reporter', 'html'],
    ['--add-reporter=blob'],
    ['-cunsafe.config.ts'],
    ['-xc', 'other.config.cjs'],
    ['-xc/path/other.config.cjs'],
    ['--ui'],
    ['--last-failed-file=/tmp/unused'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/demo-e2e.mjs', ...args], {
      encoding: 'utf8',
      env: { ...process.env, DOCKER_HOST: 'tcp://invalid' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /каталог и формат отчёта/);
  }
});

test('the E2E command rejects a temporary directory in the checkout before preparing credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/demo-e2e.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TMPDIR: process.cwd(),
      TEMP: process.cwd(),
      TMP: process.cwd(),
      DOCKER_HOST: 'tcp://invalid',
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /временный каталог за пределами проекта/);
});

test('project, trace and grep filters still reach the E2E setup', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/demo-e2e.mjs', '-g', 'login', '--project=desktop', '--trace=on', 'login.spec.ts'],
    {
      encoding: 'utf8',
      env: { ...process.env, DOCKER_HOST: 'tcp://invalid' },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Не удалось прочитать параметры локального Supabase/);
});
