import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { newAccounts } from './demo-accounts.mjs';
import { cliEnv, localConfig, root } from './demo.mjs';
import { provision } from './fixtures-local.mjs';

const config = localConfig('test');
const run = `E2E-${randomUUID().slice(0, 12)}`;
const accounts = newAccounts(run.toLowerCase()).map((a) => ({ ...a, name: `${a.name} ${run}` }));
accounts.push({
  ...accounts[2],
  id: randomUUID(),
  name: `Новый сотрудник ${run}`,
  email: `empty-${run.toLowerCase()}@example.test`,
});
const dir = mkdtempSync(join(tmpdir(), 'crm-e2e-'));
const file = join(dir, 'credentials.json');
const db = new pg.Client({ connectionString: config.db });
await db.connect();
try {
  await provision(config, accounts, false);
  writeFileSync(file, JSON.stringify({ accounts, run }), { mode: 0o600 });
  execFileSync(join(root, 'node_modules/.bin/playwright'), ['test', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...cliEnv,
      CRM_E2E_ACCOUNTS: file,
      VITE_SUPABASE_URL: config.url,
      VITE_SUPABASE_PUBLISHABLE_KEY: config.key,
    },
  });
} catch {
  console.error('Браузерная проверка локального тестового проекта не завершилась успешно.');
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
  const ids = accounts.map((a) => a.id);
  try {
    await db.query('begin');
    await db.query(
      'delete from public.task_status_history where task_id in (select id from public.tasks where author_id=any($1))',
      [ids],
    );
    await db.query('delete from public.tasks where author_id=any($1)', [ids]);
    await db.query(
      'delete from public.objects where starts_with(name,$1) and not exists (select 1 from public.tasks where object_id=objects.id)',
      [run],
    );
    await db.query('delete from public.profiles where id=any($1)', [ids]);
    await db.query('delete from auth.users where id=any($1)', [ids]);
    await db.query('commit');
  } finally {
    await db.end();
  }
}
