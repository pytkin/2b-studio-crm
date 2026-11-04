import { isDeepStrictEqual } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

export function newAccounts(prefix = 'demo') {
  return [
    ['manager', 'Ирина Волкова'],
    ['executor', 'Анна Миронова'],
    ['executor', 'Михаил Лебедев'],
  ].map(([role, name], index) => ({
    id: randomUUID(),
    role,
    name,
    email: `${prefix}-${index + 1}@example.test`,
    password: randomBytes(24).toString('base64url'),
  }));
}

function readAccounts(path) {
  try {
    const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(file);
      if (!stat.isFile() || stat.mode & 0o077)
        throw Error('Защитите файл доступов командой chmod 600.');
      const accounts = JSON.parse(readFileSync(file, 'utf8'));
      if (
        !Array.isArray(accounts) ||
        accounts.length !== 3 ||
        !accounts.every(
          (a, i) =>
            typeof a.id === 'string' &&
            /^[0-9a-f-]{36}$/i.test(a.id) &&
            typeof a.name === 'string' &&
            a.email === `demo-${i + 1}@example.test` &&
            typeof a.password === 'string' &&
            a.password.length >= 24 &&
            a.role === (i === 0 ? 'manager' : 'executor'),
        )
      )
        throw Error('Неверный формат файла доступов.');
      return accounts;
    } finally {
      closeSync(file);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function publish(path, accounts) {
  // Publish all three passwords atomically before the first Auth request.
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    try {
      linkSync(temporary, path);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  } finally {
    rmSync(temporary, { force: true });
  }
  return readAccounts(path);
}

export function openAccounts(path, sharedPath = path) {
  const local = readAccounts(path);
  const shared = readAccounts(sharedPath) ?? publish(sharedPath, local ?? newAccounts());
  const copy = local ?? (path === sharedPath ? shared : publish(path, shared));
  if (!isDeepStrictEqual(shared, copy))
    throw Error('Наборы доступов проекта и рабочей копии различаются.');
  return copy;
}
