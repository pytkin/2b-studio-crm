import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { ensurePrivateLocalDirectory } from './private-local-directory.mts';

export function protectBuildOutput(): Plugin {
  return {
    name: 'protect-build-output',
    apply: 'build',
    buildStart() {
      const { root, build } = this.environment.config;
      if (realpathSync(root) !== resolve(root))
        throw Error('Корень сборки должен быть реальным каталогом.');
      const path = relative(root, resolve(root, build.outDir));
      if (!path) throw Error('Каталог сборки совпадает с корнем проекта.');
      if (isAbsolute(path) || path === '..' || path.startsWith('..' + sep)) {
        // Vite can write an explicitly requested temporary build without emptying it.
        if (build.emptyOutDir) throw Error('Нельзя очищать каталог за пределами проекта.');
        return;
      }
      const parts = path.split(sep);
      if (parts[0] === '.local') ensurePrivateLocalDirectory(root);
      let current = root;
      for (const part of parts) {
        current = join(current, part);
        const entry = lstatSync(current, { throwIfNoEntry: false });
        if (entry && !entry.isDirectory())
          throw Error('Для сборки требуется реальный каталог проекта.');
      }
    },
  };
}
