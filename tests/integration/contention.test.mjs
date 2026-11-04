import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { openFixtures } from './fixtures.mjs';

async function success(promise) {
  const { data, error } = await promise;
  assert.equal(error?.message, undefined, error?.message);
  return data;
}

async function withWorld(run) {
  const f = await openFixtures();
  const ids = [];
  const object = async () => {
    const id = randomUUID();
    ids.push(id);
    await success(
      f.users.m1.client.rpc('create_object', { p_id: id, p_name: 'Секция', p_address: 'Адрес' }),
    );
    return id;
  };
  const createArgs = (parent) => ({
    p_id: randomUUID(),
    p_title: 'Проверка',
    p_description: '',
    p_object_id: parent,
    p_assignee_id: f.users.e1.id,
  });
  try {
    await run({ ...f, object, createArgs });
  } finally {
    try {
      await f.db.query(
        'delete from public.task_status_history where task_id in(select id from public.tasks where object_id=any($1))',
        [ids],
      );
      await f.db.query('delete from public.tasks where object_id=any($1)', [ids]);
      await f.db.query('delete from public.objects where id=any($1)', [ids]);
    } finally {
      await f.close();
    }
  }
}

// One test operator owns this DB. Count only waiters in our lock chain.
async function waitForQueue(db, size) {
  const deadline = Date.now() + 6500;
  while (Date.now() < deadline) {
    await db.query('select pg_stat_clear_snapshot()');
    const { rows } = await db.query(`with recursive waiting(pid) as (
      select pg_backend_pid() union
      select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))
    ) select count(*)::int-1 as n from waiting`);
    if (rows[0].n >= size) return;
    await delay(20);
  }
  throw new Error('DB-08: missing blocked request ' + size);
}

async function ordered(db, parent, one, two) {
  const pending = [];
  await db.query('begin');
  try {
    await db.query('select id from public.objects where id=$1 for update', [parent]);
    pending.push(Promise.resolve(one()));
    await waitForQueue(db, 1);
    pending.push(Promise.resolve(two()));
    await waitForQueue(db, 2);
  } finally {
    await db.query('rollback');
    await Promise.allSettled(pending);
  }
  return Promise.all(pending);
}
test(
  'DB-08: оба порядка ожидающих реальных RPC, состояние и история',
  { timeout: 180000 },
  async (t) =>
    withWorld(async (f) => {
      const { db, users } = f;
      const secondExecutor = createClient(f.url, f.publicKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await success(
        secondExecutor.auth.signInWithPassword({
          email: users.e1.email,
          password: users.e1.password,
        }),
      );
      for (const kind of [
        'two-transitions',
        'two-edits',
        'edit-transition',
        'assign-transition',
        'delete-create',
        'delete-move-in',
        'delete-move-out',
        'delete-transition',
      ]) {
        for (const reverse of [false, true])
          await t.test(kind + (reverse ? ' B→A' : ' A→B'), async () => {
            const parent = await f.object();
            const other = await f.object();
            const initialParent = kind === 'delete-move-in' ? other : parent;
            const args = f.createArgs(initialParent);
            const task = args.p_id;
            const m = users.m1.client,
              m2 = users.m2.client,
              e = users.e1.client;
            const edit = (client, title, objectId = initialParent, assignee = users.e1.id) =>
              client.rpc('update_task', {
                p_id: task,
                p_expected_version: 1,
                p_title: title,
                p_object_id: objectId,
                p_description: '',
                p_assignee_id: assignee,
              });
            const transition = () =>
              e.rpc('transition_task', {
                p_id: task,
                p_expected_version: 1,
                p_to_status: 'in_progress',
              });
            let a, b;
            if (kind !== 'delete-create') await success(m.rpc('create_task', args));
            if (kind.startsWith('delete-')) {
              a = () => m.rpc('delete_object', { p_id: parent, p_expected_version: 1 });
              if (kind === 'delete-create') b = () => m2.rpc('create_task', args);
              else if (kind === 'delete-transition') b = transition;
              else b = () => edit(m2, 'Перенос', kind === 'delete-move-in' ? parent : other);
            } else if (kind === 'two-transitions') {
              a = transition;
              b = () =>
                secondExecutor.rpc('transition_task', {
                  p_id: task,
                  p_expected_version: 1,
                  p_to_status: 'in_progress',
                });
            } else {
              a = () =>
                edit(
                  m,
                  'A',
                  initialParent,
                  kind === 'assign-transition' ? users.e2.id : users.e1.id,
                );
              b = kind === 'two-edits' ? () => edit(m2, 'B') : transition;
            }
            const [winner, second] = await ordered(db, parent, reverse ? b : a, reverse ? a : b);
            assert.equal(winner.error?.message, undefined);
            const deletion = kind.startsWith('delete-');
            const expectedError = deletion
              ? reverse
                ? undefined
                : 'UNAVAILABLE'
              : kind === 'assign-transition' && !reverse
                ? 'UNAVAILABLE'
                : 'CONFLICT';
            assert.equal(second.error?.message, expectedError);
            const {
              rows: [row],
            } = await db.query(
              'select status,version,title,object_id,assignee_id,deleted_at is not null as deleted from public.tasks where id=$1',
              [task],
            );
            const {
              rows: [count],
            } = await db.query(
              'select count(*)::int as n from public.task_status_history where task_id=$1',
              [task],
            );
            if (kind === 'delete-create' && !reverse) {
              assert.equal(row, undefined);
              assert.equal(count.n, 0);
              return;
            }
            const didTransition =
              kind === 'two-transitions' || (kind.endsWith('-transition') && reverse);
            assert.equal(count.n, 1 + Number(didTransition));
            assert.equal(row.status, didTransition ? 'in_progress' : 'new');
            const hidden =
              deletion &&
              !(kind === 'delete-move-out' && reverse) &&
              !(kind === 'delete-move-in' && !reverse);
            assert.equal(row.deleted, hidden);
            const changed = !(kind === 'delete-move-in' && !reverse);
            const doubleUpdate =
              deletion && reverse && (kind === 'delete-move-in' || kind === 'delete-transition');
            assert.equal(row.version, 1 + Number(changed) + Number(doubleUpdate));
            if (kind === 'two-edits') assert.equal(row.title, reverse ? 'B' : 'A');
            if (kind === 'assign-transition')
              assert.equal(row.assignee_id, reverse ? users.e1.id : users.e2.id);
            if (kind.startsWith('delete-move-'))
              assert.equal(
                row.object_id,
                reverse ? (kind === 'delete-move-in' ? parent : other) : initialParent,
              );
            if (deletion) {
              const {
                rows: [p],
              } = await db.query(
                'select version, deleted_at is not null as deleted from public.objects where id=$1',
                [parent],
              );
              assert.deepEqual(p, { version: 2, deleted: true });
            }
          });
      }
    }),
);
test(
  'API-04: ответ потерян после commit или запрос не дошёл, повторное чтение под JWT',
  { timeout: 90000 },
  async () =>
    withWorld(async (f) => {
      const m = f.users.m1.client;
      async function uncertain(client, name, args, delivered) {
        const {
          data: { session },
        } = await client.auth.getSession();
        let attempts = 0;
        const committed = [];
        const faulty = createClient(f.url, f.publicKey, {
          accessToken: async () => session.access_token,
          global: {
            fetch: async (input, init) => {
              attempts++;
              if (delivered) {
                const response = await fetch(input, init);
                await response.arrayBuffer();
                committed.push(response.ok);
              }
              throw new TypeError('Недоступен ответ');
            },
          },
        });
        const result = await faulty.rpc(name, args);
        assert.ok(result.error, 'SDK must report the failed request');
        assert.equal(attempts, 1, 'a mutation must not retry itself');
        assert.deepEqual(committed, delivered ? [true] : [], name + ' transport delivery');
      }
      const parent = await f.object();
      for (const delivered of [false, true]) {
        const createId = randomUUID();
        const objectArgs = { p_id: createId, p_name: 'Секция', p_address: 'Адрес' };
        await uncertain(m, 'create_object', objectArgs, delivered);
        const read = async (client, table, id) =>
          success(client.from(table).select('*').eq('id', id).maybeSingle());
        assert.equal(Boolean(await read(m, 'objects', createId)), delivered);
        const retry = await m.rpc('create_object', objectArgs);
        assert.equal(retry.error?.message, delivered ? 'ID_UNAVAILABLE' : undefined);
        const args = f.createArgs(parent);
        await uncertain(m, 'create_task', args, delivered);
        assert.equal(Boolean(await read(m, 'tasks', args.p_id)), delivered);
        assert.equal(
          (await m.rpc('create_task', args)).error?.message,
          delivered ? 'ID_UNAVAILABLE' : undefined,
        );
        const edit = {
          ...args,
          p_expected_version: 1,
          p_title: 'Переназначена',
          p_assignee_id: f.users.e2.id,
        };
        await uncertain(m, 'update_task', edit, delivered);
        const state = await read(m, 'tasks', args.p_id);
        assert.equal(state.version, delivered ? 2 : 1);
        assert.equal(state.assignee_id, delivered ? f.users.e2.id : f.users.e1.id);
        const executor = f.users[delivered ? 'e2' : 'e1'].client;
        const status = {
          p_id: args.p_id,
          p_expected_version: state.version,
          p_to_status: 'in_progress',
        };
        await uncertain(executor, 'transition_task', status, delivered);
        const current = await read(executor, 'tasks', args.p_id);
        assert.equal(current.status, delivered ? 'in_progress' : 'new');
        const events = await success(
          executor
            .from('task_status_history')
            .select('actor_id,to_status')
            .eq('task_id', args.p_id)
            .order('id'),
        );
        assert.equal(events.length, delivered ? 2 : 1);
        if (delivered) assert.equal(events.at(-1).actor_id, f.users.e2.id);
        await uncertain(
          m,
          'delete_task',
          { p_id: args.p_id, p_expected_version: current.version },
          delivered,
        );
        assert.equal(Boolean(await read(m, 'tasks', args.p_id)), !delivered);
        await uncertain(m, 'delete_object', { p_id: createId, p_expected_version: 1 }, delivered);
        assert.equal(Boolean(await read(m, 'objects', createId)), !delivered);
        await f.db.query('delete from public.objects where id=$1', [createId]);
      }
    }),
);
