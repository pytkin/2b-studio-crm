import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { openFixtures } from './fixtures.mjs';

test('install closes reads without replacing an existing hook, then activation separates config and grants', async () => {
  const f = await openFixtures();
  const { db } = f;
  const sql = (path) => readFileSync(new URL(`../../supabase/${path}`, import.meta.url), 'utf8');
  const guard = 'api_guard.check_read_preferences';
  const configured = async () =>
    (
      await db.query(
        `select setting from pg_db_role_setting, unnest(setconfig) setting
     where setrole='authenticator'::regrole and setdatabase=(select oid from pg_database where datname=current_database())
       and split_part(setting,'=',1)='pgrst.db_pre_request'`,
      )
    ).rows.map(({ setting }) => setting.split('=')[1]);
  async function checkReads(open) {
    const { rows } = await db.query(
      `select role,resource,has_any_column_privilege(role, resource, 'SELECT') as readable,
         has_table_privilege(role, resource, 'SELECT') as table_read
       from unnest(array['anon','authenticated']) role,
            unnest(array['public.profiles','public.objects','public.tasks','public.task_status_history']) resource`,
    );
    for (const row of rows) {
      assert.equal(
        row.readable,
        open && row.role === 'authenticated',
        row.role + ' ' + row.resource,
      );
      assert.equal(row.table_read, row.readable);
    }
  }
  try {
    await db.query('begin');
    await db.query('drop schema api_guard cascade');
    await db.query('grant select (id) on public.tasks to authenticated, anon');
    await db.query(
      "alter role authenticator in database postgres set pgrst.db_pre_request='custom.existing'",
    );
    await db.query(sql('migrations/20261104000009_rls_counts.sql'));
    assert.deepEqual(await configured(), ['custom.existing']);
    await checkReads(false);

    const setup = sql('activation/configure-read-guard.sql');
    await db.query('savepoint keep_hook');
    await assert.rejects(db.query(setup), /existing PostgREST pre-request hook/);
    await db.query('rollback to keep_hook');
    assert.deepEqual(await configured(), ['custom.existing']);
    await checkReads(false);

    await db.query('alter role authenticator in database postgres reset pgrst.db_pre_request');
    await db.query(setup);
    await db.query(setup);
    assert.deepEqual(await configured(), [guard]);
    await checkReads(false);
    await db.query(sql('activation/restore-read.sql'));
    await checkReads(true);
  } finally {
    await db.query('rollback');
    await f.close();
  }
});
