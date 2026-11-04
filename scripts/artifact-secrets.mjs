import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sharedAccountsPath } from './demo-accounts.mjs';
function privileged(text) {
  if (/\bsb_secret_[\w-]{24,}/.test(text)) return true;
  for (const match of text.matchAll(/\beyJ[\w-]+\.([\w-]+)\.[\w-]+/g)) {
    try {
      if (
        ['service_role', 'authenticated'].includes(
          JSON.parse(Buffer.from(match[1], 'base64url').toString()).role,
        )
      )
        return true;
    } catch {
      /* Not a JWT payload. */
    }
  }
  return false;
}
export function inspectArtifacts(entries, known) {
  const found = [];
  for (const [path, bytes] of entries) {
    if (known.some((value) => bytes.includes(value)) || privileged(bytes.toString('utf8')))
      found.push(path);
  }
  return found;
}
function* filesIn(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) yield path;
  else if (stat.isDirectory())
    for (const name of readdirSync(path)) yield* filesIn(join(path, name));
}
if (import.meta.main) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const paths = new Set([
    ...tracked.filter((path) => existsSync(path) && lstatSync(path).isFile()),
    ...filesIn('dist'),
    ...filesIn('.local/demo-dist'),
    ...filesIn('.local/e2e-dist'),
    ...filesIn('test-results'),
    ...filesIn('playwright-report'),
  ]);
  const sensitive = [];
  for (const path of ['.local/demo-accounts.json', sharedAccountsPath()]) {
    try {
      const accounts = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(accounts) || !accounts.length) throw Error();
      for (const item of accounts) {
        if (typeof item?.password !== 'string' || !item.password) throw Error();
        sensitive.push(item.password);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Parser diagnostics can quote the contents of this private file.
        console.error('Не удалось прочитать файл демо-доступов. Проверка остановлена.');
        process.exit(1);
      }
    }
  }
  const entries = function* () {
    for (const path of paths) yield [path, readFileSync(path)];
  };
  const findings = inspectArtifacts(entries(), sensitive);
  if (findings.length) {
    console.error('Обнаружены конфиденциальные значения в файлах:', ...findings);
    process.exitCode = 1;
  } else
    console.log(
      'Проверка ключей, токенов сессии и известных демо-паролей пройдена. Файлов:',
      paths.size,
    );
}
