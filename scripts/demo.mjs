import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openAccounts, sharedAccountsPath } from './demo-accounts.mjs';
import { withStackLock } from './stack-lock.mjs';
import { cliEnv, root, openLocalStack } from './supabase-local.mjs';

class DemoFailure extends Error {}

export async function runDemo(action, ops) {
  if (action === 'stop') {
    const results = [];
    let failed = false;
    for (const [name, stop] of [
      ['Веб-сервер', ops.shutdown],
      ['Supabase', ops.stop],
    ]) {
      try {
        await stop();
        results.push(`${name} остановлен.`);
      } catch {
        failed = true;
        results.push(`${name}: остановка не подтверждена.`);
      }
    }
    if (failed) throw new DemoFailure(results.join(' '));
    return;
  }
  if (action !== 'start') throw new DemoFailure('Используйте demo:start или demo:stop.');
  await ops.install();
  const alreadyRunning = await ops.isRunning();
  for (const step of ['start', 'migrate', 'activate', 'provision', 'build', 'serve']) {
    try {
      await ops[step]();
    } catch {
      let state =
        'Ранее запущенный Supabase сохранён. Проверьте привязки портов. Для остановки выполните pnpm db:dev stop.';
      if (!alreadyRunning) {
        try {
          if (await ops.isRunning()) await ops.stop();
          if (await ops.isRunning()) throw Error('Контейнеры активны.');
          state = 'Supabase остановлен с сохранением данных.';
        } catch {
          state =
            'Остановка Supabase не подтверждена. Проверьте Docker и выполните pnpm demo:stop.';
        }
      }
      throw new DemoFailure(`Сбой на шаге «${step}». ${state}`);
    }
  }
}

if (import.meta.main) {
  const dir = join(root, '.local');
  let config;
  let step;
  let pinned;
  const stack = () => (pinned ??= openLocalStack('dev'));
  const operations = {
    install: () =>
      execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit' }),
    isRunning: () => stack().isRunning(),
    start: () => stack().run('start'),
    migrate: () => stack().migrate(),
    activate: async () =>
      (await import('./local-read-access.mjs')).activateLocalReads(stack().config()),
    provision: async () => {
      const { ensurePrivateLocalDirectory } = await import('./private-local-directory.mts');
      ensurePrivateLocalDirectory(root);
      config = stack().config();
      const { provision } = await import('./fixtures-local.mjs');
      const shared = sharedAccountsPath();
      mkdirSync(dirname(shared), { recursive: true, mode: 0o700 });
      await provision(config, openAccounts(join(dir, 'demo-accounts.json'), shared), true);
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
    stop: () => stack().run('stop'),
  };
  try {
    await withStackLock('dev', () =>
      runDemo(
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
      ),
    );
  } catch (error) {
    console.error(
      error instanceof DemoFailure
        ? error.message
        : `Демо: сбой на шаге «${step || 'блокировка команд'}». Проверьте локальные сервисы, порты и права на .local.`,
    );
    process.exitCode = 1;
  }
}
