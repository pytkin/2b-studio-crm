import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openAccounts } from './demo-accounts.mjs';
import { cliEnv, root, localConfig, migrateLocal, runLocalSupabase } from './supabase-local.mjs';

export async function runDemo(action, ops) {
  if (action === 'stop') {
    await ops.shutdown();
    await ops.stop();
  } else if (action === 'start') {
    await ops.install();
    await ops.start();
    await ops.migrate();
    await ops.activate();
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
    migrate: () => migrateLocal('dev'),
    activate: async () => (await import('./local-read-access.mjs')).activateLocalReads(localConfig('dev')),
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
