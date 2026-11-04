import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';

test('dev server serves routes but refuses private local handoff files', async (t) => {
  mkdirSync('.local', { recursive: true });
  const directory = mkdtempSync('.local/privacy-check-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = directory + '/accounts.json';
  writeFileSync(path, '{"canary":"private-local-only"}', { mode: 0o600 });
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  t.after(() => server.close());
  await server.listen();
  const base = 'http://127.0.0.1:' + server.httpServer.address().port;
  assert.equal((await fetch(base + '/login')).status, 200);
  for (const route of ['/' + path, '/@fs/' + resolve(path)]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 403);
    assert.equal((await response.text()).includes('private-local-only'), false);
  }
});
