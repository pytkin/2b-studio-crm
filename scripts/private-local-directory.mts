import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

export function ensurePrivateLocalDirectory(root: string): string {
  if (realpathSync(root) !== resolve(root))
    throw Error('Корень проекта должен быть реальным каталогом.');
  const dir = join(root, '.local');
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if ((fstatSync(fd).mode & 0o777) !== 0o700) fchmodSync(fd, 0o700);
    } finally {
      closeSync(fd);
    }
  } catch {
    throw Error('Для .local требуется реальный приватный каталог проекта.');
  }
  return dir;
}
