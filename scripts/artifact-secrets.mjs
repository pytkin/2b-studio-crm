import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
function ordinaryPath(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)) return;
  return stat;
}
function* filesIn(path) {
  const stat = ordinaryPath(path);
  if (stat?.isFile()) yield path;
  else if (stat?.isDirectory())
    for (const name of readdirSync(path)) yield* filesIn(join(path, name));
}

function gitBytes(args, input) {
  return execFileSync('git', args, {
    input,
    stdio: ['pipe', 'pipe', 'ignore'],
    maxBuffer: 128 * 1024 * 1024,
  });
}

function* indexEntries(tracked) {
  // Only the header is text. A blob can contain any byte, including newlines and NUL.
  for (let start = 0; start < tracked.length; start += 32) {
    const batch = tracked.slice(start, start + 32);
    const bytes = gitBytes(
      ['--no-replace-objects', 'cat-file', '--batch'],
      batch.map(({ oid }) => oid + '\n').join(''),
    );
    let offset = 0;
    for (const { path, oid } of batch) {
      const newline = bytes.indexOf(10, offset);
      const header = /^([a-f0-9]+) blob (\d+)$/.exec(bytes.toString('ascii', offset, newline));
      if (!header || header[1] !== oid) throw Error();
      const end = newline + 1 + Number(header[2]);
      if (bytes[end] !== 10) throw Error();
      yield [path, bytes.subarray(newline + 1, end)];
      offset = end + 1;
    }
    if (offset !== bytes.length) throw Error();
  }
}

function scan() {
  const index = new TextDecoder('utf-8', { fatal: true }).decode(
    gitBytes(['ls-files', '--stage', '-z']),
  );
  const tracked = [];
  const paths = new Set();
  for (const record of index.split('\0').filter(Boolean)) {
    const [, mode, oid, stage, path] = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(record);
    if (stage === '0' && ['100644', '100755'].includes(mode)) tracked.push({ path, oid });
    if (ordinaryPath(path)?.isFile()) paths.add(path);
  }
  for (const directory of [
    'dist',
    '.local/demo-dist',
    '.local/e2e-dist',
    'test-results',
    'playwright-report',
  ])
    for (const path of filesIn(directory)) paths.add(path);
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
    yield* indexEntries(tracked);
    for (const path of paths) yield [path, readFileSync(path)];
  };
  const findings = [...new Set(inspectArtifacts(entries(), sensitive))];
  if (findings.length) {
    console.error(
      'Обнаружены конфиденциальные значения в файлах:',
      ...findings.map((path) => {
        if (sensitive.some((value) => path.includes(value)) || privileged(path))
          return '[скрытое имя]';
        return /[\p{Cc}]/u.test(path) ? JSON.stringify(path) : path;
      }),
    );
    process.exitCode = 1;
  } else
    console.log(
      'Проверка ключей, токенов сессии и известных демо-паролей пройдена. Файлов:',
      new Set([...paths, ...tracked.map(({ path }) => path)]).size,
    );
}

if (import.meta.main) {
  try {
    scan();
  } catch {
    // A child process exception can retain the raw Git output.
    console.error('Не удалось полностью проверить индекс Git и файлы проекта.');
    process.exitCode = 1;
  }
}
