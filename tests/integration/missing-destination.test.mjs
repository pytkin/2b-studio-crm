import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { openFixtures } from './fixtures.mjs';

test('a destination created while a move waits must be locked before attaching a task', async () => {
  const f = await openFixtures();
  const { db, users } = f;
  const destinationLock = new pg.Client(db.connectionParameters);
  await destinationLock.connect();
  const source = randomUUID();
  const destination = randomUUID();
  const task = randomUUID();
  let pending;
  try {
    const create = (client, id) =>
      client.rpc('create_object', { p_id: id, p_name: 'Объект', p_address: 'Адрес' });
    assert.equal((await create(users.m1.client, source)).error, null);
    const fields = {
      p_id: task,
      p_title: 'Задача',
      p_object_id: source,
      p_assignee_id: users.e1.id,
      p_description: '',
    };
    assert.equal((await users.m1.client.rpc('create_task', fields)).error, null);
    await db.query('begin');
    await db.query('select id from public.objects where id=$1 for update', [source]);
    pending = Promise.resolve(
      users.m1.client
        .rpc('update_task', {
          ...fields,
          p_object_id: destination,
          p_expected_version: 1,
        })
        .abortSignal(AbortSignal.timeout(10000)),
    );
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (!blocked && Date.now() < deadline) {
      await db.query('select pg_stat_clear_snapshot()');
      const { rows } = await db.query(
        'select exists(select from pg_stat_activity where pg_backend_pid()=any(pg_blocking_pids(pid))) as blocked',
      );
      blocked = rows[0].blocked;
      if (!blocked) await delay(15);
    }
    assert.ok(blocked, 'move reached the parent locking query');
    assert.equal((await create(users.m2.client, destination)).error, null);
    await destinationLock.query('begin');
    // NO KEY UPDATE excludes the required parent FOR UPDATE lock while allowing
    // the FK's weaker KEY SHARE check. An FK wait must not masquerade as protection.
    await destinationLock.query('select id from public.objects where id=$1 for no key update', [
      destination,
    ]);
    await db.query('commit');
    const { error } = await pending;
    assert.equal(error?.message, 'UNAVAILABLE');
    const {
      rows: [saved],
    } = await db.query('select object_id, version from public.tasks where id=$1', [task]);
    assert.deepEqual(saved, { object_id: source, version: 1 });
  } finally {
    await db.query('rollback');
    await destinationLock.query('rollback');
    await destinationLock.end();
    if (pending) await pending;
    await db.query('delete from public.task_status_history where task_id=$1', [task]);
    await db.query('delete from public.tasks where id=$1', [task]);
    await db.query('delete from public.objects where id=any($1)', [[source, destination]]);
    await f.close();
  }
});
