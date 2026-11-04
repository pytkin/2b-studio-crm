import { execFileSync, fork } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));

const script = fileURLToPath(import.meta.url);
const pidFile = join(root, '.local/demo-preview.pid');
const marker = `${process.execPath} ${script} serve`;

function ownPid() {
  let pid;
  try {
    pid = Number(readFileSync(pidFile, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  if (!Number.isSafeInteger(pid) || pid < 2) return;
  try {
    if (
      execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === marker
    )
      return pid;
  } catch (e) {
    if (e.status !== 1) throw e;
  }
}

export async function startPreview() {
  if (ownPid()) return;
  const child = fork(script, ['serve'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: [],
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(Error('Не удалось открыть порт приложения.')));
    child.once('message', (message) => {
      if (message !== 'ready') return reject(Error('Сервер не подтвердил запуск.'));
      child.disconnect();
      child.unref();
      resolve();
    });
  });
}

export async function stopPreview() {
  const pid = ownPid();
  if (!pid) return;
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 50; i++) {
    if (!ownPid()) return;
    await delay(100);
  }
  throw Error('Процесс приложения не завершился.');
}

if (import.meta.main && process.argv[2] === 'serve') {
  const { preview } = await import('vite');
  const server = await preview({
    root,
    configFile: false,
    build: { outDir: '.local/demo-dist' },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  });
  writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
  process.once('SIGTERM', () => {
    server.httpServer.closeAllConnections();
    server.httpServer.close(() => {
      rmSync(pidFile, { force: true });
      process.exit(0);
    });
  });
  process.send?.('ready');
}
