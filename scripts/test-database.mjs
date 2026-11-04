import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

import { localDockerEnv } from './supabase-local.mjs';

const env = localDockerEnv();
const directory = new URL('../tests/database/', import.meta.url);
const subjects = process.argv.slice(2);
const files = readdirSync(directory).filter(
  (name) =>
    /^\d\d-.+\.sql$/.test(name) && (!subjects.length || subjects.includes(name.slice(0, 2))),
);
if (files.length === 0) throw new Error('No matching database checks.');
for (const file of files) {
  const setup = readFileSync(new URL('setup.sql', directory), 'utf8');
  const fixture = file.startsWith('01-')
    ? ''
    : readFileSync(new URL('fixtures.sql', directory), 'utf8');
  const checks = readFileSync(new URL(file, directory), 'utf8');
  const input = [setup, fixture, checks, 'reset role; select * from finish(); rollback;'].join(
    '\n',
  );
  const output = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_2b-studio-crm-test',
      'psql',
      '-XqAt',
      '-U',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, env, encoding: 'utf8' },
  );
  const plan = output.match(/^1\.\.(\d+)$/m);
  const results = output.match(/^(?:not )?ok \d+\b/gm) ?? [];
  if (
    !plan ||
    results.length !== Number(plan[1]) ||
    results.some((line) => line.startsWith('not'))
  ) {
    process.stderr.write(output);
    process.exitCode = 1;
  } else {
    console.log(`${file}: ${results.length} assertions passed`);
  }
}
