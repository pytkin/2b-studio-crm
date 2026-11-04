import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const root = new URL('../../', import.meta.url);
const url = 'http://127.0.0.1:56421';
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function readTestConfig() {
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('SUPABASE_')),
    );
    env.SUPABASE_EXPERIMENTAL_STACK = '0';
    const output = execFileSync(
      'node_modules/.bin/supabase',
      ['status', '--workdir', 'local/test', '-o', 'env'],
      {
        cwd: root,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const config = Object.fromEntries(
      [...output.matchAll(/^(\w+)="([^"]*)"$/gm)].map(([, k, v]) => [k, v]),
    );
    const target = new URL(config.DB_URL);
    if (
      config.API_URL !== url ||
      !['postgresql:', 'postgres:'].includes(target.protocol) ||
      target.search ||
      target.hostname !== '127.0.0.1' ||
      target.port !== '56422' ||
      target.pathname !== '/postgres'
    ) {
      throw new Error('Expected the isolated local test project.');
    }
    if (!config.PUBLISHABLE_KEY || !config.SERVICE_ROLE_KEY) throw new Error();
    return config;
  } catch {
    // ChildProcess errors include captured stdout; URL errors include the original input.
    throw new Error('Could not read the isolated test configuration.');
  }
}

export async function openFixtures() {
  const config = readTestConfig();
  const publicKey = config.PUBLISHABLE_KEY;
  const guest = createClient(url, publicKey, { auth });
  const admin = createClient(url, config.SERVICE_ROLE_KEY, { auth });
  const db = new pg.Client({ connectionString: config.DB_URL });
  await db.connect();
  const users = {};
  async function close() {
    const ids = Object.values(users).map(({ id }) => id);
    try {
      await db.query('begin');
      await db.query(
        'delete from public.task_status_history where task_id in (select id from public.tasks where author_id=any($1))',
        [ids],
      );
      await db.query('delete from public.tasks where author_id=any($1)', [ids]);
      await db.query('delete from public.profiles where id=any($1)', [ids]);
      await db.query('delete from auth.users where id=any($1)', [ids]);
      await db.query('commit');
    } finally {
      await db.end();
    }
  }
  try {
    for (const name of ['m1', 'm2', 'e1', 'e2', 'inactive', 'missing']) {
      const email = `test-${randomUUID()}@example.invalid`;
      const password = randomUUID();
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw new Error('Test Auth user creation failed');
      const id = created.data.user.id;
      const client = createClient(url, publicKey, { auth });
      users[name] = { id, email, password, client };
      if (name !== 'missing') {
        await db.query(
          'insert into public.profiles(id,display_name,role,active) values ($1,$2,$3,$4)',
          [id, name, name.startsWith('m') ? 'manager' : 'executor', name !== 'inactive'],
        );
      }
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error) throw new Error('Test Auth password sign-in failed');
    }
    return { db, users, guest, url, publicKey, close };
  } catch (error) {
    await close();
    throw error;
  }
}
