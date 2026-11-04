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

export function migrateLocal(target, run = runWithLocalDocker) {
  if (!['dev', 'test'].includes(target)) throw Error('Неизвестная локальная среда.');
  run(cli, ['migration', 'up', '--workdir', target === 'dev' ? root : join(root, 'local/test')], { stdio: 'ignore' });
}

function readDocker(args, env) {
  return execFileSync('docker', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function stackIds(target, all, env, docker) {
  return docker(['ps', ...(all ? ['--all'] : []), '--quiet', '--filter',
    'label=com.supabase.cli.project=2b-studio-crm-' + target], env).trim().split(/\s+/).filter(Boolean);
}

// Acquire once inside the lifecycle lock. Every read, write and rollback must
// stay on this socket even when another terminal switches Docker contexts.
export function openLocalStack(target, { env = cliEnv, inspect = execFileSync, run = execFileSync, docker = readDocker } = {}) {
  if (!['dev', 'test'].includes(target)) throw Error('Неизвестная локальная среда.');
  const pinned = localDockerEnv(env, inspect);
  const runPinned = (file, args, options) => run(file, args, { ...options, env: pinned });
  return {
    isRunning: () => stackIds(target, false, pinned, docker).length > 0,
    run: (action) => runLocalSupabase([target, action], { env: pinned, run, docker }),
    migrate: () => migrateLocal(target, runPinned),
    config: () => localConfig(target, runPinned),
  };
}

// Read only non-secret fields. Saved bindings also matter for stopped containers
// because the CLI can start them without issuing docker create again.
function checkBindings(target, env, docker, requireEndpoints) {
  const ids = stackIds(target, true, env, docker);
  const format = '{"name":{{json .Name}},"running":{{json .State.Running}},"mode":{{json .HostConfig.NetworkMode}},' +
    '"publishAll":{{json .HostConfig.PublishAllPorts}},"requested":{{json .HostConfig.PortBindings}},"actual":{{json .NetworkSettings.Ports}}}';
  const rows = ids.length ? docker(['inspect', '--format', format, ...ids], env).trim().split('\n').map(JSON.parse) : [];
  const expected = new Map([
    ['/supabase_kong_2b-studio-crm-' + target, String(target === 'dev' ? 56321 : 56421)],
    ['/supabase_db_2b-studio-crm-' + target, String(target === 'dev' ? 56322 : 56422)],
  ]);
  for (const row of rows) {
    if (row.mode !== env.CRM_DOCKER_NETWORK || row.publishAll)
      throw Error('Unexpected container networking');
    for (const bindings of [row.requested, row.actual]) {
      for (const port of Object.values(bindings ?? {}).flat()) {
        if (port !== null && !['127.0.0.1', '::1'].includes(port.HostIp))
          throw Error('Non-loopback port binding');
      }
    }
    if (row.running && Object.values(row.actual ?? {}).flat().some((port) =>
      port?.HostIp === '127.0.0.1' && port.HostPort === expected.get(row.name))) expected.delete(row.name);
  }
  if (requireEndpoints && expected.size) throw Error('Missing published endpoints');
}

function validateCommand(args) {
  const [target, action] = args;
  if (args.length !== 2 || !['dev', 'test'].includes(target) || !['start', 'stop', 'status', 'reset'].includes(action)) {
    throw new Error('Usage: pnpm db:{dev|test} {start|stop|status}; pnpm db:test reset');
  }
  if (action === 'reset' && target !== 'test') {
    throw new Error('Reset is only allowed for test. Development data is retained.');
  }
  return [target, action];
}

export function runLocalSupabase(args, { run = execFileSync, env = process.env, inspect, docker = readDocker } = {}) {
  const [target, action] = validateCommand(args);
  // Local commands must not inherit CLI target overrides or hosted credentials.
  const localEnv = Object.fromEntries(Object.entries(localDockerEnv(env, inspect)).filter(([name]) => !name.startsWith('SUPABASE_')));
  localEnv.SUPABASE_EXPERIMENTAL_STACK = '0';
  const guard = action === 'start' || action === 'reset';
  const workdir = target === 'dev' ? root : `${root}local/test`;
  const command = action === 'reset' ? ['db', 'reset', '--yes'] : [action];
  const path = localEnv.PATH ?? '/usr/local/bin:/usr/bin:/bin';
  const guardedEnv = {
    ...localEnv,
    PATH: join(root, 'scripts/loopback-docker') + ':' + path,
    CRM_DOCKER_PATH: path,
    CRM_DOCKER_NETWORK: 'supabase_network_2b-studio-crm-' + target,
  };
  const invoke = (commands, env) => run(cli, [...commands, '--workdir', workdir], { cwd: root, env, stdio: 'ignore' });
  const isolationError = `Supabase ${target}: loopback isolation could not be verified. Inspect Docker (Engine 28+) and run pnpm db:${target} stop before retrying.`;
  if (guard) {
    try {
      // Older daemons can forward localhost-published ports to L2 peers.
      const version = docker(['--crm-loopback-preflight'], guardedEnv);
      if (!/^\d+\./.test(version) || Number(version.split('.')[0]) < 28) throw Error('Unsupported Docker version');
      checkBindings(target, guardedEnv, docker, false);
    } catch {
      throw Error(isolationError);
    }
  }
  try {
    invoke(command, guard ? guardedEnv : localEnv);
  } catch {
    throw new Error(`Supabase ${target}: ${action} failed. Check Docker, the configured ports and container health. Raw CLI output is suppressed because it can contain credentials.`);
  }
  if (guard) {
    try {
      checkBindings(target, guardedEnv, docker, true);
    } catch {
      throw Error(isolationError);
    }
  }
  return `Supabase ${target}: ${action} passed.`;
}

export async function prepareLocalStack(target, action, stack, activate = async (config) =>
  (await import('./local-read-access.mjs')).activateLocalReads(config)) {
  // The caller holds the shared lock. Roll back exactly once, including when
  // the CLI starts only a subset of the services or post-start activation fails.
  const alreadyRunning = stack.isRunning();
  try {
    const result = stack.run(action);
    if (action === 'start') stack.migrate();
    await activate(stack.config());
    return result;
  } catch (error) {
    if (!alreadyRunning) {
      try {
        if (stack.isRunning()) {
          stack.run('stop');
          if (stack.isRunning()) throw Error('Containers still running');
        }
      } catch {
        throw Error(`Supabase ${target}: automatic stop could not be confirmed. Inspect Docker and run pnpm db:${target} stop.`);
      }
    }
    throw error;
  }
}

if (import.meta.main) {
  try {
    const [target, action] = validateCommand(process.argv.slice(2));
    const perform = async () => {
      const stack = openLocalStack(target);
      return action === 'start' || action === 'reset' ? prepareLocalStack(target, action, stack) : stack.run(action);
    };
    const { withStackLock } = await import('./stack-lock.mjs');
    console.log(action === 'status' ? await perform() : await withStackLock(target, perform));
  } catch (error) {
    // Nested CLI/driver errors may include connection parameters.
    console.error(error instanceof Error && error.constructor === Error && !('cmd' in error)
      ? error.message : 'Не удалось подготовить локальный Supabase.');
    process.exitCode = 1;
  }
}
