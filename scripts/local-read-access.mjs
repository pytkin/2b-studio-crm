import { readFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import pg from 'pg';

const restrict =
  'revoke select on public.profiles, public.objects, public.tasks, public.task_status_history from public, anon, authenticated';
const sql = (file) =>
  readFileSync(new URL('../supabase/activation/' + file, import.meta.url), 'utf8');

export async function enableVerifiedReads(ops) {
  // A repeated start leaves a healthy stack readable. An unprotected stack
  // stays closed, including when configuration, reload or the HTTP check fails.
  try {
    if (!(await ops.probe())) await ops.restrict();
    await ops.configure();
    for (let i = 0; i < 20; i++) {
      if (await ops.probe()) {
        await ops.restore();
        return;
      }
      await ops.wait();
    }
    throw Error('Guard not active');
  } catch {
    await ops.restrict();
    throw Error('Чтение CRM закрыто: не удалось подтвердить защиту PostgREST.');
  }
}

export async function guardVerifiedAtGateway(config) {
  try {
    const endpoint = config.url + '/rest/v1/tasks?select=id&limit=0';
    const request = (headers) =>
      fetch(endpoint, {
        headers: { apikey: config.key, ...headers },
        redirect: 'error',
        signal: AbortSignal.timeout(1500),
      });
    const denied = await request({ Prefer: 'count=planned' });
    const error = await denied.json();
    if (
      denied.status !== 400 ||
      error.code !== 'PT400' ||
      error.message !== 'UNSUPPORTED_READ_PREFERENCE'
    )
      return false;
    // Even without Prefer, enabling the dedicated plan media type would leak estimates.
    const plan = await request({ Accept: 'application/vnd.pgrst.plan+json' });
    return plan.status === 406 && (await plan.json()).code === 'PGRST107';
  } catch {
    return false;
  }
}

export async function activateLocalReads(config) {
  const db = new pg.Client({ connectionString: config.db, connectionTimeoutMillis: 3000 });
  await db.connect();
  try {
    await enableVerifiedReads({
      probe: () => guardVerifiedAtGateway(config),
      restrict: async () => {
        // An explicit transaction in an activation script may have failed.
        await db.query('rollback');
        await db.query(restrict);
      },
      configure: () => db.query(sql('configure-read-guard.sql')),
      restore: () => db.query(sql('restore-read.sql')),
      wait: () => wait(150),
    });
  } finally {
    await db.end();
  }
}
