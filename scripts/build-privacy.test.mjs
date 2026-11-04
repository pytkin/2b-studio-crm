import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('production build rejects a privileged key in the public configuration', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-build-check-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const marker = 'sb_secret_synthetic_build_canary';
  const result = spawnSync('node_modules/.bin/vite', ['build', '--outDir', dir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'http://127.0.0.1:56321',
      VITE_SUPABASE_PUBLISHABLE_KEY: marker,
    },
  });
  assert.notEqual(result.status, 0, 'must reject before writing the bundle');
  assert.match(result.stderr, /Требуется публичный ключ Supabase/);
  assert.equal((result.stderr + result.stdout).includes(marker), false);
});
