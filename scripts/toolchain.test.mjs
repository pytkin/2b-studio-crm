import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function installForNode(t, nodeVersion) {
  const directory = mkdtempSync(join(tmpdir(), 'crm-engine-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { engines } = JSON.parse(readFileSync('package.json', 'utf8'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'crm-engine-fixture', version: '0.0.0', private: true, engines: { node: engines.node },
  }));
  // pnpm's nodeVersion simulates the host used for engine checks. No runtime or
  // dependency is downloaded, and the real checkout's lockfile stays untouched.
  return spawnSync('pnpm', [
    'install', '--lockfile-only', '--ignore-scripts', '--offline', '--no-frozen-lockfile',
    '--config.engine-strict=true', `--config.node-version=${nodeVersion}`,
  ], { cwd: directory, encoding: 'utf8' });
}

test('the project installs with a newer Node 26 patch selected by the hosting provider', (t) => {
  const result = installForNode(t, '26.13.0');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('engine checks still reject an older patch and a different major', (t) => {
  for (const version of ['26.12.0', '27.0.0']) {
    const result = installForNode(t, version);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /ERR_PNPM_UNSUPPORTED_ENGINE/);
  }
});

test('the actual project settings allow compatible dependencies and reject incompatible dependencies', (t) => {
  for (const version of ['26.12.1', '27.0.0']) {
    const directory = mkdtempSync(join(tmpdir(), 'crm-engine-settings-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, 'dependency'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name: 'crm-engine-settings', version: '0.0.0', private: true,
      dependencies: { 'engine-fixture': 'file:./dependency' },
    }));
    writeFileSync(join(directory, 'dependency/package.json'), JSON.stringify({
      name: 'engine-fixture', version: '1.0.0', engines: { node: version },
    }));
    for (const config of ['.npmrc', 'pnpm-workspace.yaml']) {
      if (existsSync(config)) writeFileSync(join(directory, config), readFileSync(config));
    }
    const result = spawnSync('pnpm', [
      'install', '--ignore-scripts', '--offline', '--no-frozen-lockfile',
      '--config.node-version=26.12.1', '--store-dir', join(directory, 'store'),
    ], { cwd: directory, encoding: 'utf8' });
    if (version === '26.12.1') assert.equal(result.status, 0, result.stdout + result.stderr);
    else {
      assert.notEqual(result.status, 0, 'must reject dependencies needing Node 27');
      assert.match(result.stdout + result.stderr, /ERR_PNPM_UNSUPPORTED_ENGINE/);
    }
  }
});
