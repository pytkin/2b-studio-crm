import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    for (const status of [1, 0]) {
      writeFileSync(
        join(root, 'node_modules/.bin/supabase'),
        `#!/bin/sh\nprintf '%s\\n' 'DB_URL="${marker}"' >&1\nprintf '%s\\n' '${marker}' >&2\nexit ${status}\n`,
        { mode: 0o700 },
      );
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import {openFixtures} from './tests/integration/fixtures.mjs'; await openFixtures();",
        ],
        { cwd: root, encoding: 'utf8' },
      );
      assert.notEqual(result.status, 0, 'fixture setup must refuse a broken configuration');
      const diagnostic = result.stdout + result.stderr;
      assert.ok(
        !diagnostic.includes(marker),
        'CLI failure diagnostics revealed the synthetic marker',
      );
      assert.ok(
        diagnostic.includes('Could not read the isolated test configuration.'),
        'missing safe diagnostic',
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
