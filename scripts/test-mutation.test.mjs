import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireDetections } from './test-mutation.mjs';

test('mutation pilot requires an assertion from the target test in both areas', () => {
  const killed = (fileName, testFile) => ({
    fileName,
    id: '1',
    status: 'Killed',
    statusReason: 'AssertionError [ERR_ASSERTION] at ' + testFile + ':31:12',
  });
  const key = killed('src/shared/public-config.ts', 'public-key.test.mjs');
  const guard = killed('scripts/local-read-access.mjs', 'read-guard.test.mjs');
  assert.doesNotThrow(() => requireDetections([key, guard]));
  assert.throws(() => requireDetections([key]), /Нет проверенных мутаций: scripts/);
  for (const incomplete of [
    { status: 'Timeout' },
    { status: 'RuntimeError' },
    { status: 'Survived' },
    { statusReason: 'Cannot find module' },
    { statusReason: key.statusReason },
  ]) {
    assert.throws(() => requireDetections([key, { ...guard, ...incomplete }]), /целевого теста/);
  }
});
