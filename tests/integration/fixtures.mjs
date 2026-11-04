import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

import { localConfig } from '../../scripts/supabase-local.mjs';
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

export async function openFixtures() {
  const { url, key: publicKey, adminKey, db: connectionString } = localConfig('test');
  const guest = createClient(url, publicKey, { auth });
  const admin = createClient(url, adminKey, { auth });
  const db = new pg.Client({ connectionString });
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
