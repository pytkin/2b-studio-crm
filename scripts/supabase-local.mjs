import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const cliEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith('SUPABASE_') && !key.startsWith('VITE_'),
  ),
);
cliEnv.SUPABASE_EXPERIMENTAL_STACK = '0';

function runWithLocalDocker(file, args, options) {
  return execFileSync(file, args, { ...options, env: localDockerEnv(cliEnv) });
}

export function localConfig(target, read = runWithLocalDocker) {
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
const cli = fileURLToPath(new URL('../node_modules/.bin/supabase', import.meta.url));

// Inspecting a context reads local configuration only. Pin the socket for the
// child process so a context switch between the check and reset cannot redirect it.
export function localDockerEnv(env = process.env, inspect = execFileSync) {
  const message = 'Only a local Docker socket is allowed. Select a local Docker context.';
  const local = (host) => /^unix:\/\/\/[^\s?#]+$/.test(host) || host === 'npipe:////./pipe/docker_engine';
  if (env.DOCKER_HOST && !local(env.DOCKER_HOST)) throw new Error(message);
  let host = env.DOCKER_HOST;
  if (!host || env.DOCKER_CONTEXT) {
    try {
      host = inspect('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
        env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      throw new Error(message);
    }
  }
  if (!local(host)) throw new Error(message);
  const result = { ...env, DOCKER_HOST: host };
  delete result.DOCKER_CONTEXT;
  return result;
}

export function migrateLocal(target) {
  if (!['dev', 'test'].includes(target)) throw Error('Неизвестная локальная среда.');
  runWithLocalDocker(cli, ['migration', 'up', '--workdir', target === 'dev' ? root : join(root, 'local/test')], { stdio: 'ignore' });
}

export function runLocalSupabase(args, { run = execFileSync, env = process.env, inspect } = {}) {
  const [target, action] = args;
  if (args.length !== 2 || !['dev', 'test'].includes(target) || !['start', 'stop', 'status', 'reset'].includes(action)) {
    throw new Error('Usage: pnpm db:{dev|test} {start|stop|status}; pnpm db:test reset');
  }
  if (action === 'reset' && target !== 'test') {
    throw new Error('Reset is only allowed for test. Development data is retained.');
  }
  // Local commands must not inherit CLI target overrides or hosted credentials.
  const localEnv = Object.fromEntries(Object.entries(localDockerEnv(env, inspect)).filter(([name]) => !name.startsWith('SUPABASE_')));
  localEnv.SUPABASE_EXPERIMENTAL_STACK = '0';
  const workdir = target === 'dev' ? root : `${root}local/test`;
  const command = action === 'reset' ? ['db', 'reset', '--yes'] : [action];
  try {
    run(cli, [...command, '--workdir', workdir], { cwd: root, env: localEnv, stdio: 'ignore' });
  } catch {
    throw new Error(`Supabase ${target}: ${action} failed. Check Docker, the configured ports and container health. Raw CLI output is suppressed because it can contain credentials.`);
  }
  return `Supabase ${target}: ${action} passed.`;
}

if (import.meta.main) {
  const [target, action] = process.argv.slice(2);
  try {
    const result = runLocalSupabase(process.argv.slice(2));
    if (action === 'start' || action === 'reset') {
      if (action === 'start') migrateLocal(target);
      const { activateLocalReads } = await import('./local-read-access.mjs');
      await activateLocalReads(localConfig(target));
    }
    console.log(result);
  } catch (error) {
    // Nested CLI/driver errors may include connection parameters.
    console.error(error instanceof Error && error.constructor === Error && !('cmd' in error)
      ? error.message : 'Не удалось подготовить локальный Supabase.');
    process.exitCode = 1;
  }
}
