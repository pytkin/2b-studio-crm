import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { openFixtures } from './fixtures.mjs';

async function value(request) {
  const { data, error } = await request;
  assert.ok(!error, 'request must succeed');
  return data;
}
async function denied(request, message) {
  const { error } = await request;
  assert.ok(error, 'expected a denied request');
  if (message) assert.equal(error.message, message);
}

test('API-01: real GoTrue sessions, closed signup, logout, expiry and revoked refresh', {
  timeout: 160000,
}, async () => {
  const f = await openFixtures();
  try {
    const { m1 } = f.users;
    await denied(
      f.guest.auth.signUp({
        email: `signup-${randomUUID()}@example.invalid`,
        password: randomUUID(),
      }),
    );
    await denied(f.guest.auth.signInWithPassword({ email: m1.email, password: randomUUID() }));
    const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
    const browser = createClient(f.url, f.publicKey, { auth });
    const { data, error } = await browser.auth.signInWithPassword({
      email: m1.email,
      password: m1.password,
    });
    assert.ok(!error, 'sign-in must succeed');
    const restored = createClient(f.url, f.publicKey, { auth });
    const restoredResult = await restored.auth.setSession(data.session);
    assert.equal(restoredResult.data.user?.id, m1.id);
    const session = restoredResult.data.session;
    const headers = { apikey: f.publicKey, Authorization: `Bearer ${session.access_token}` };
    const select = () => fetch(`${f.url}/rest/v1/profiles?select=id&id=eq.${m1.id}`, { headers });
    const active = await select();
    assert.equal(active.status, 200);
    assert.deepEqual(await active.json(), [{ id: m1.id }]);
    assert.ok(!(await restored.auth.signOut()).error, 'logout must succeed');
    assert.ok(
      (await restored.auth.getSession()).data.session === null,
      'logout must clear the session',
    );
    await denied(restored.auth.refreshSession({ refresh_token: session.refresh_token }));
    const before = await select();
    assert.equal(before.status, 200, 'signed access token is still valid until expiration');
    assert.ok(session.expires_in <= 60, 'expected 60s test-only GoTrue token TTL');
    await delay(Math.max(0, session.expires_at * 1000 - Date.now() + 1100));
    // The gateway may allow clock skew. Require an actual denial of the same token.
    const deadline = Date.now() + 45000;
    let response = await select();
    while (response.status === 200 && Date.now() < deadline) {
      await delay(1000);
      response = await select();
    }
    assert.equal(response.status, 401, 'the expired token is refused by the real REST API');
  } finally {
    await f.close();
  }
});

test('API-02/03: RLS, exact counts, no direct writes or impersonation, revocation under live sessions', async () => {
  const f = await openFixtures();
  const {
    db,
    guest,
    users: { m1, m2, e1, e2, inactive, missing },
  } = f;
  const [a, b, c, deleted, t1, t2, t3, t4] = Array.from({ length: 8 }, () => randomUUID());
  const parentIds = [a, b, c, deleted];
  try {
    await db.query(
      `insert into public.objects(id,name,address,deleted_at) values
      ($1,'A','Addr',null),($2,'B','Addr',null),($3,'C','Addr',null),($4,'D','Addr',now())`,
      parentIds,
    );
    for (const [id, parent, owner, tombstone] of [
      [t1, a, e1, false],
      [t2, a, e2, false],
      [t3, b, e2, false],
      [t4, a, e1, true],
    ]) {
      await db.query(
        `insert into public.tasks(id,title,object_id,assignee_id,author_id,author_name,deleted_at)
        values($1,'Fixture',$2,$3,$4,'m1',case when $5 then now() end)`,
        [id, parent, owner.id, m1.id, tombstone],
      );
      await db.query(
        `insert into public.task_status_history(task_id,actor_id,actor_name,to_status)
        values($1,$2,'m1','new')`,
        [id, m1.id],
      );
    }
    const objects = async (client) =>
      (
        await value(
          client
            .from('objects')
            .select('id,tasks(id,task_status_history(actor_name))')
            .in('id', parentIds),
        )
      ).sort((x, y) => x.id.localeCompare(y.id));
    for (const manager of [m1, m2]) {
      const rows = await objects(manager.client);
      assert.deepEqual(rows.map((r) => r.id).sort(), [a, b, c].sort());
      assert.equal(rows.find((r) => r.id === a).tasks.length, 2);
      assert.equal(rows.find((r) => r.id === c).tasks.length, 0);
    }
    assert.deepEqual(await objects(e1.client), [
      { id: a, tasks: [{ id: t1, task_status_history: [{ actor_name: 'm1' }] }] },
    ]);
    assert.deepEqual((await objects(e2.client)).map((r) => r.id).sort(), [a, b].sort());
    const counted = await e1.client
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('object_id', a);
    assert.equal(counted.count, 1);
    for (const id of [t2, t4, randomUUID()]) {
      assert.deepEqual(await value(e1.client.from('tasks').select('*').eq('id', id)), []);
      assert.deepEqual(
        await value(e1.client.from('task_status_history').select('*').eq('task_id', id)),
        [],
      );
    }
    for (const user of [inactive, missing]) {
      for (const name of ['objects', 'tasks', 'profiles', 'task_status_history'])
        assert.deepEqual(await value(user.client.from(name).select('*')), []);
      await denied(
        user.client.rpc('delete_object', { p_id: a, p_expected_version: 1 }),
        'FORBIDDEN',
      );
    }
    for (const name of ['objects', 'tasks', 'profiles', 'task_status_history']) {
      await denied(guest.from(name).select('*'));
    }
    assert.deepEqual(await value(e1.client.from('profiles').select('id')), [{ id: e1.id }]);
    const profileIds = await value(
      m1.client.from('profiles').select('id').in('id', [m1.id, m2.id, e1.id, e2.id, inactive.id]),
    );
    assert.deepEqual(profileIds.map((p) => p.id).sort(), [m1.id, e1.id, e2.id].sort());

    // Supply even valid rows: lack of privilege must deny every operation.
    for (const name of ['profiles', 'objects', 'tasks', 'task_status_history']) {
      const sample = (await value(m1.client.from(name).select('*').limit(1)))[0];
      const { id, ...fields } = sample;
      for (const user of [m1, e1]) {
        for (const op of [
          user.client.from(name).insert(name === 'task_status_history' ? fields : sample),
          user.client.from(name).update(fields).eq('id', id),
          user.client.from(name).delete().eq('id', id),
        ]) {
          const result = await op;
          assert.equal(result.error?.code, '42501', `direct DML on ${name}`);
        }
      }
    }
    await denied(
      missing.client
        .from('profiles')
        .insert({ id: missing.id, active: true, role: 'manager', display_name: 'Fake' }),
    );
    await value(e1.client.auth.updateUser({ data: { role: 'manager', active: true } }));
    const elevated = await e1.client.auth.refreshSession();
    assert.ok(!elevated.error, 'refresh must succeed');
    const objArgs = { p_id: randomUUID(), p_name: 'Title', p_address: 'Address' };
    const taskArgs = {
      p_id: randomUUID(),
      p_object_id: a,
      p_assignee_id: e1.id,
      p_title: 'Title',
      p_description: '',
    };
    for (const [name, args] of [
      ['create_object', objArgs],
      ['update_object', { ...objArgs, p_expected_version: 1 }],
      ['delete_object', { p_id: a, p_expected_version: 1 }],
      ['create_task', taskArgs],
      ['update_task', { ...taskArgs, p_expected_version: 1 }],
      ['delete_task', { p_id: t1, p_expected_version: 1 }],
    ])
      await denied(e1.client.rpc(name, args), 'FORBIDDEN');
    for (const extra of [
      { p_status: 'accepted' },
      { p_author_id: e1.id },
      { p_created_at: '2000-01-01' },
      { p_role: 'manager' },
    ]) {
      assert.equal(
        (await m1.client.rpc('create_task', { ...taskArgs, ...extra })).error?.code,
        'PGRST202',
      );
    }
    for (const extra of [
      { p_actor_id: e2.id },
      { p_occurred_at: '2000-01-01' },
      { p_from_status: 'in_review' },
    ]) {
      assert.equal(
        (
          await e1.client.rpc('transition_task', {
            p_id: t1,
            p_expected_version: 1,
            p_to_status: 'in_progress',
            ...extra,
          })
        ).error?.code,
        'PGRST202',
      );
    }
    for (const helper of ['actor', 'assigned_here', 'lock_task', 'add_event', 'current_role']) {
      assert.equal((await e1.client.rpc(helper, {})).error?.code, 'PGRST202');
    }
    await denied(
      m1.client.rpc('create_object', { ...objArgs, p_address: '\t\n ' }),
      'INVALID_INPUT',
    );
    await denied(m1.client.rpc('create_object', { ...objArgs, p_id: deleted }), 'ID_UNAVAILABLE');
    await denied(
      m1.client.rpc('create_task', { ...taskArgs, p_assignee_id: inactive.id }),
      'INVALID_INPUT',
    );
    await denied(
      m1.client.rpc('create_task', { ...taskArgs, p_object_id: deleted }),
      'UNAVAILABLE',
    );
    await denied(
      e2.client.rpc('transition_task', {
        p_id: t1,
        p_expected_version: 42,
        p_to_status: 'accepted',
      }),
      'UNAVAILABLE',
    );
    assert.equal(
      (await db.query('select count(*)::int n from public.tasks where id=$1', [taskArgs.p_id]))
        .rows[0].n,
      0,
    );
    const edit = {
      p_id: t1,
      p_expected_version: 1,
      p_object_id: c,
      p_assignee_id: e2.id,
      p_title: 'Moved',
      p_description: '',
    };
    await value(m2.client.rpc('update_task', edit));
    assert.deepEqual(await objects(e1.client), []);
    assert.deepEqual(
      await value(e1.client.from('task_status_history').select('id').eq('task_id', t1)),
      [],
    );
    assert.equal(
      (await value(e2.client.from('task_status_history').select('id').eq('task_id', t1))).length,
      1,
    );
    await value(m1.client.rpc('delete_object', { p_id: c, p_expected_version: 1 }));
    assert.equal(
      (await objects(e2.client)).some((r) => r.id === c),
      false,
    );
    assert.deepEqual(
      await value(m1.client.from('task_status_history').select('id').eq('task_id', t1)),
      [],
    );
    await db.query('update public.profiles set active=false where id=$1', [m2.id]);
    assert.deepEqual(await objects(m2.client), []);
    await denied(m2.client.rpc('delete_object', { p_id: a, p_expected_version: 1 }), 'FORBIDDEN');
  } finally {
    await db.query(
      'delete from public.task_status_history where task_id in(select id from public.tasks where object_id=any($1))',
      [parentIds],
    );
    await db.query('delete from public.tasks where object_id=any($1)', [parentIds]);
    await db.query('delete from public.objects where id=any($1)', [parentIds]);
    await f.close();
  }
});
