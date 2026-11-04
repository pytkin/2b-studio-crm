import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

test('production build refuses a database URL before writing JS or disclosing credentials', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-build-url-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const marker = 'synthetic-build-url-' + crypto.randomUUID();
  const result = spawnSync('node_modules/.bin/vite', ['build', '--outDir', dir], {
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'postgresql://postgres:' + marker + '@db.example/postgres',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_demo',
    },
  });
  assert.notEqual(result.status, 0, 'must refuse the database URL');
  assert.match(result.stderr, /Проверьте публичный URL API Supabase/);
  assert.equal((result.stdout + result.stderr).includes(marker), false);
  assert.deepEqual(readdirSync(dir), []);
});

function localBuildFixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'crm-build-path-')));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const checkout = join(directory, 'checkout');
  const external = join(directory, 'outside');
  mkdirSync(checkout);
  mkdirSync(external);
  writeFileSync(join(checkout, 'index.html'), '<main>CRM fixture</main>');
  const marker = join(external, 'keep.txt');
  writeFileSync(marker, 'preserve');
  function build(outDir, url = '') {
    const options = outDir ? ['--outDir', outDir, '--emptyOutDir'] : [];
    return spawnSync(
      resolve('node_modules/.bin/vite'),
      ['build', '--config', resolve('vite.config.ts'), ...options],
      {
        cwd: checkout,
        encoding: 'utf8',
        env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: '' },
      },
    );
  }
  return { build, checkout, external, marker };
}

for (const [outDir, link] of [
  [undefined, 'dist'],
  ['.local/demo-dist', '.local/demo-dist'],
  ['.local/e2e-dist', '.local/e2e-dist'],
  ['.local/demo-dist', '.local'],
  ['.local/e2e-dist', '.local'],
]) {
  test(`Vite refuses ${outDir ?? 'dist'} when ${link} points outside the checkout`, (t) => {
    const { build, checkout, external, marker } = localBuildFixture(t);
    const target = join(checkout, link);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    symlinkSync(external, target);
    if (link === '.local') {
      const destination = join(external, outDir.slice('.local/'.length));
      mkdirSync(destination);
      writeFileSync(join(destination, 'keep.txt'), 'preserve');
    }
    const result = build(outDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /каталог/i);
    assert.equal(readFileSync(marker, 'utf8'), 'preserve');
    if (link === '.local') {
      const destination = join(external, outDir.slice('.local/'.length));
      assert.deepEqual(readdirSync(destination), ['keep.txt']);
    } else assert.deepEqual(readdirSync(external), ['keep.txt']);
  });
}

test('Vite cleans its own outputs and keeps local build directories private', (t) => {
  const { build, checkout } = localBuildFixture(t);
  for (const [outDir, url] of [
    [undefined, ''],
    ['.local/demo-dist', 'http://127.0.0.1:54321'],
    ['.local/e2e-dist', 'https://cloud.example'],
  ]) {
    const dir = join(checkout, outDir ?? 'dist');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'obsolete.txt'), 'previous build');
    const result = build(outDir, url);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(dir, 'obsolete.txt')), false);
    assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /CRM fixture/);
    if (outDir) assert.equal(statSync(join(checkout, '.local')).mode & 0o777, 0o700);
  }
});

test('Vite verifies the resolved deployment environment when the project root is explicit', (t) => {
  const { checkout } = localBuildFixture(t);
  const marker = 'synthetic-env-url-' + crypto.randomUUID();
  writeFileSync(
    join(checkout, '.env.production'),
    'VITE_SUPABASE_URL=https://user:' + marker + '@project.example\n',
  );
  const env = { ...process.env };
  delete env.VITE_SUPABASE_URL;
  delete env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const result = spawnSync(
    resolve('node_modules/.bin/vite'),
    ['build', checkout, '--config', resolve('vite.config.ts')],
    {
      encoding: 'utf8',
      env,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Проверьте публичный URL API Supabase/);
  assert.equal((result.stdout + result.stderr).includes(marker), false);
  assert.equal(existsSync(join(checkout, 'dist')), false);
});
