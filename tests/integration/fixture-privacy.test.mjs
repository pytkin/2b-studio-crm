import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('fixture diagnostics discard raw CLI stdout, stderr and invalid database URLs', () => {
  const root = mkdtempSync(join(tmpdir(), 'crm-fixture-test-'));
  const deps = fileURLToPath(new URL('../../node_modules/', import.meta.url));
  const marker = 'fixture-privacy-synthetic-canary';
  try {
    mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
    mkdirSync(join(root, 'tests/integration'), { recursive: true });
    for (const name of ['pg', '@supabase'])
      symlinkSync(join(deps, name), join(root, 'node_modules', name));
    copyFileSync(
      new URL('./fixtures.mjs', import.meta.url),
      join(root, 'tests/integration/fixtures.mjs'),
    );
    mkdirSync(join(root, 'scripts'));
    for (const file of ['supabase-local.mjs'])
      copyFileSync(new URL('../../scripts/' + file, import.meta.url), join(root, 'scripts', file));
    // Only use synthetic executables, including for the local socket branch.
    const reached = join(root, 'cli-called');
    writeFileSync(
      join(root, 'node_modules/.bin/supabase'),
      '#!/bin/sh\ntouch cli-called\nexit 1\n',
      { mode: 0o700 },
    );
    const runFixture = (host) =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import {openFixtures} from './tests/integration/fixtures.mjs'; await openFixtures();",
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, DOCKER_CONTEXT: '', DOCKER_HOST: host },
        },
      );
    const remote = runFixture('tcp://remote.invalid:2375');
    assert.notEqual(remote.status, 0);
    assert.equal(
      existsSync(reached),
      false,
      'must refuse before running status on a remote engine',
    );
    for (const status of [1, 0]) {
      writeFileSync(
        join(root, 'node_modules/.bin/supabase'),
        `#!/bin/sh\nprintf '%s\\n' 'DB_URL="${marker}"' >&1\nprintf '%s\\n' '${marker}' >&2\nexit ${status}\n`,
        { mode: 0o700 },
      );
      const result = runFixture('unix:///tmp/fixture-privacy-unused.sock');
      assert.notEqual(result.status, 0, 'fixture setup must refuse a broken configuration');
      const diagnostic = result.stdout + result.stderr;
      assert.ok(
        !diagnostic.includes(marker),
        'CLI failure diagnostics revealed the synthetic marker',
      );
      assert.ok(
        diagnostic.includes('Не удалось прочитать параметры локального Supabase (test).'),
        'missing safe diagnostic',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
