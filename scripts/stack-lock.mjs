import { createServer } from 'node:net';

// A short-lived loopback listener acts as a host-wide lock for each shared
// Docker project, across checkouts. Process exit releases it, even after a crash.
export async function withStackLock(target, action) {
  if (!['dev', 'test'].includes(target)) throw Error('Неизвестная локальная среда.');
  const port = target === 'dev' ? 56319 : 56419;
  const lock = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    lock.once('error', () =>
      reject(
        Error(
          `Не удалось занять порт блокировки ${port}. Проверьте, не выполняется ли другая команда ${target}.`,
        ),
      ),
    );
    lock.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  try {
    return await action();
  } finally {
    await new Promise((resolve) => lock.close(resolve));
  }
}
