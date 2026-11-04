import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('Kit delegates each application operation and propagates its exit code', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-command-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'pnpm'), '#!/bin/sh\necho "$*"\nexit 7\n', { mode: 0o700 });
  for (const op of ['dev', 'test', 'build']) {
    const res = spawnSync('./bin/project', [op], {
      encoding: 'utf8',
      env: { ...process.env, PATH: dir + ':' + process.env.PATH },
    });
    assert.equal(res.status, 7, op + ' must propagate application failure');
    assert.equal(res.stdout.trim(), op);
  }
});
