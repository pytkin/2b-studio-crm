import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAccounts } from './demo-accounts.mjs';
import { runLocalSupabase } from './supabase-local.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const cliEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith('SUPABASE_') && !key.startsWith('VITE_'),
  ),
);
cliEnv.SUPABASE_EXPERIMENTAL_STACK = '0';

export function localConfig(target, read = execFileSync) {
  if (!['dev', 'test'].includes(target)) throw Error('Неизвестная локальная среда.');
  const workdir = target === 'dev' ? root : join(root, 'local/test');
  try {
    const output = read(
      join(root, 'node_modules/.bin/supabase'),
      ['status', '--workdir', workdir, '-o', 'env'],
      { env: cliEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const values = Object.fromEntries(
      Array.from(output.matchAll(/^([A-Z_]+)="([^"\n]*)"$/gm), (m) => [m[1], m[2]]),
    );
    const port = target === 'dev' ? 56321 : 56421;
    const url = `http://127.0.0.1:${port}`;
    const db = new URL(values.DB_URL);
    if (
      values.API_URL !== url ||
      !['postgres:', 'postgresql:'].includes(db.protocol) ||
      db.hostname !== '127.0.0.1' ||
      db.port !== String(port + 1) ||
      db.pathname !== '/postgres' ||
      db.search ||
      db.hash ||
      !values.PUBLISHABLE_KEY ||
      !values.SECRET_KEY
    ) {
      throw Error('Параметры локального Supabase не соответствуют выбранной среде.');
    }
    return { url, db: values.DB_URL, key: values.PUBLISHABLE_KEY, adminKey: values.SECRET_KEY };
  } catch {
    // A CLI exception retains stdout and a URL parser exception retains its input.
    throw Error(`Не удалось прочитать параметры локального Supabase (${target}).`);
  }
}

export async function runDemo(action, ops) {
  if (action === 'stop') {
    await ops.shutdown();
    await ops.stop();
  } else if (action === 'start') {
    await ops.install();
    await ops.start();
    await ops.migrate();
    await ops.provision();
    await ops.build();
    await ops.serve();
  } else throw Error('Используйте demo:start или demo:stop.');
}

if (import.meta.main) {
  const dir = join(root, '.local');
  let config;
  let step;
  const operations = {
    install: () =>
      execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit' }),
    start: () => runLocalSupabase(['dev', 'start']),
    migrate: () =>
      execFileSync(
        join(root, 'node_modules/.bin/supabase'),
        ['migration', 'up', '--workdir', root],
        { env: cliEnv, stdio: 'ignore' },
      ),
    provision: async () => {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      config = localConfig('dev');
      const { provision } = await import('./fixtures-local.mjs');
      const projectState = join(
        process.env.XDG_STATE_HOME || join(homedir(), '.local/state'),
        '2b-studio-crm-dev',
      );
      mkdirSync(projectState, { recursive: true, mode: 0o700 });
      await provision(
        config,
        openAccounts(join(dir, 'demo-accounts.json'), join(projectState, 'demo-accounts.json')),
        true,
      );
    },
    build: () =>
      execFileSync('pnpm', ['build', '--outDir', '.local/demo-dist', '--emptyOutDir'], {
        cwd: root,
        env: {
          ...cliEnv,
          VITE_SUPABASE_URL: config.url,
          VITE_SUPABASE_PUBLISHABLE_KEY: config.key,
        },
        stdio: 'inherit',
      }),
    serve: async () => {
      const { startPreview } = await import('./demo-preview.mjs');
      await startPreview();
      console.log(
        'Демо открыто на http://127.0.0.1:5173. Доступы находятся в .local/demo-accounts.json.',
      );
    },
    shutdown: async () => (await import('./demo-preview.mjs')).stopPreview(),
    stop: () => runLocalSupabase(['dev', 'stop']),
  };
  try {
    await runDemo(
      process.argv[2],
      Object.fromEntries(
        Object.entries(operations).map(([name, fn]) => [
          name,
          () => {
            step = name;
            return fn();
          },
        ]),
      ),
    );
  } catch {
    console.error(
      `Демо: сбой на шаге «${step || 'выбор команды'}». Проверьте локальные сервисы, порты и права на .local. Пароли и ключи не выводятся.`,
    );
    process.exitCode = 1;
  }
}
