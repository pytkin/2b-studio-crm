import { relative, sep } from 'node:path';

// Stryker's score counts some timeouts as detections; its command runner
// also labels any failing command "Killed". Neither proves our assertion ran.
export function requireDetections(mutants) {
  const targets = new Map([
    ['src/shared/public-config.ts', 'public-key.test.mjs'],
    ['scripts/local-read-access.mjs', 'read-guard.test.mjs'],
  ]);
  const seen = new Set();
  for (const { fileName, id, status, statusReason } of mutants) {
    const path = relative('.', fileName).split(sep).join('/');
    const test = targets.get(path);
    if (
      !test ||
      status !== 'Killed' ||
      !statusReason?.includes('AssertionError [ERR_ASSERTION]') ||
      !statusReason.includes(test + ':')
    ) {
      throw Error(`Мутация ${path}#${id}: нет подтверждённого падения целевого теста (${status}).`);
    }
    seen.add(path);
  }
  for (const path of targets.keys()) {
    if (!seen.has(path)) throw Error('Нет проверенных мутаций: ' + path);
  }
}

if (import.meta.main) {
  const { Stryker } = await import('@stryker-mutator/core');
  requireDetections(await new Stryker({}).runMutationTest());
}
