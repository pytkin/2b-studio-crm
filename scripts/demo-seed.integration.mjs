import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { newAccounts } from './demo-accounts.mjs';
import { localConfig } from './demo.mjs';
import { provision, seedRows } from './fixtures-local.mjs';

// Execute in a rolled-back transaction; the test command only targets the local test DB.
export async function verifySeed(db) {
  const accounts = newAccounts('seed-test');
  await db.query('begin');
  try {
    for (const { id } of accounts) await db.query('insert into auth.users(id) values($1)', [id]);
    const preexisting = 'd1523064-b61b-4b8d-91c3-16a3d1732451';
    await db.query('insert into public.objects(id,name,address,version) values($1,$2,$3,8)', [
      preexisting,
      'Изменённое название',
      'Адрес сотрудника',
    ]);
    // A partial previous run already created the manager and one edited object.
    await db.query('insert into public.profiles(id,display_name,role) values ($1,$2,$3)', [
      accounts[0].id,
      'Новое имя',
      'manager',
    ]);
    await seedRows(db, accounts, true);
    const tasks = async () =>
      (
        await db.query('select * from public.tasks where author_id=$1 order by id', [
          accounts[0].id,
        ])
      ).rows;
    const empty = await db.query(
      "select o.id from public.objects o where o.name='Павильон на набережной' and not exists (select 1 from public.tasks t where t.object_id=o.id)",
    );
    assert.equal(empty.rowCount, 1, 'third sample object should be empty');
    const rows = await tasks();
    assert.equal(rows.length, 3, 'missing tasks were seeded');
    assert.equal(new Set(rows.map((t) => t.status)).size, 3);
    assert.equal(new Set(rows.map((t) => t.object_id)).size, 2);
    assert.equal(new Set(rows.map((t) => t.assignee_id)).size, 2);
    assert.ok(rows.every((t) => t.author_name === 'Новое имя'));
    const objects = async () =>
      (await db.query('select * from public.objects where id=$1', [preexisting])).rows;
    assert.equal((await objects())[0].version, 8);
    assert.equal((await objects())[0].name, 'Изменённое название');
    const history = async () =>
      (
        await db.query(
          'select * from public.task_status_history where task_id=any($1) order by id',
          [rows.map((t) => t.id)],
        )
      ).rows;
    const before = await history();
    for (const row of rows) {
      const events = before.filter((e) => e.task_id === row.id);
      assert.equal(events.length, row.version);
      assert.equal(events[0].from_status, null);
      assert.equal(events.at(-1).to_status, row.status);
    }
    await db.query('update public.tasks set title=$1, version=version+1 where id=$2', [
      'Правка сотрудника',
      rows[0].id,
    ]);
    await db.query('update public.tasks set deleted_at=now() where id=$1', [rows[1].id]);
    await db.query('update public.profiles set active=false where id=$1', [accounts[2].id]);
    const changed = await tasks();
    await seedRows(db, accounts, true);
    assert.deepEqual(await tasks(), changed, 'restart preserves edited and soft-deleted tasks');
    assert.deepEqual(await history(), before, 'restart preserves event count, IDs and contents');
    assert.equal(
      (await db.query('select active from public.profiles where id=$1', [accounts[2].id])).rows[0]
        .active,
      false,
    );
  } finally {
    await db.query('rollback');
  }
}

async function verifyAuthRecovery(db, config) {
  const accounts = newAccounts(`partial-${randomUUID()}`);
  const prior = accounts[0];
  const auth = { persistSession: false, autoRefreshToken: false };
  const admin = createClient(config.url, config.adminKey, { auth });
  try {
    // GoTrue commits individual accounts even if a previous provision stopped subsequently.
    const created = await admin.auth.admin.createUser({
      id: prior.id,
      email: prior.email,
      password: prior.password,
      email_confirm: true,
    });
    assert.ok(!created.error, 'prepare the existing real Auth account');
    await db.query('insert into public.profiles(id,role,display_name) values ($1,$2,$3)', [
      prior.id,
      prior.role,
      'Своя подпись',
    ]);
    await provision(config, accounts, false);
    assert.equal(
      (await db.query('select display_name from public.profiles where id=$1', [prior.id])).rows[0]
        .display_name,
      'Своя подпись',
    );
    const ids = accounts.map((a) => a.id);
    assert.equal(
      (await db.query('select id from public.profiles where id=any($1)', [ids])).rowCount,
      3,
    );
    const conflicting = [
      { ...prior, id: randomUUID(), password: randomUUID() },
      ...accounts.slice(1),
    ];
    await assert.rejects(provision(config, conflicting, false), /другому набору/);
    for (const account of accounts) {
      const client = createClient(config.url, config.key, { auth });
      const { data, error } = await client.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      assert.ok(
        !error && data.user?.id === account.id,
        'existing or recovered account can sign in',
      );
    }
  } finally {
    const ids = accounts.map((a) => a.id);
    await db.query('delete from public.profiles where id=any($1)', [ids]);
    await db.query('delete from auth.users where id=any($1)', [ids]);
  }
}

if (import.meta.main) {
  const config = localConfig('test');
  const db = new pg.Client({ connectionString: config.db });
  await db.connect();
  try {
    await verifySeed(db);
    await verifyAuthRecovery(db, config);
    console.log('Demo seed: partial recovery, data preservation and event history passed.');
  } finally {
    await db.end();
  }
}
