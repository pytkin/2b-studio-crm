import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { test } from 'node:test';
import { openFixtures } from './fixtures.mjs';

test('REST counts expose only RLS-visible rows, including raw preferences and range errors', async () => {
  const f = await openFixtures();
  const {
    db,
    users: { m1, e1, e2, inactive },
  } = f;
  const parent = randomUUID();
  try {
    await db.query("insert into public.objects(id,name,address) values($1,'Объект','Адрес')", [
      parent,
    ]);
    await db.query(
      `insert into public.tasks(id, object_id, title, author_name, author_id, assignee_id)
       select gen_random_uuid(), $1, 'Задача', 'Автор', $2, case when n=1 then $3::uuid else $4::uuid end
       from generate_series(1,4000) n`,
      [parent, m1.id, e1.id, e2.id],
    );
    // Populate planner statistics so a bypass discloses other employees' work.
    await db.query('analyze public.tasks');
    for (const [user, visible] of [
      [m1, 4000],
      [e1, 1],
      [e2, 3999],
      [inactive, 0],
    ]) {
      const { data, error } = await user.client
        .from('tasks')
        .select('count')
        .eq('object_id', parent)
        .single();
      assert.equal(error, null);
      assert.equal(data.count, visible);
    }
    const {
      data: { session },
    } = await e1.client.auth.getSession();
    async function read(method, path, headers) {
      const target = new URL(path, f.url);
      target.search = new URLSearchParams({ select: 'id', object_id: `eq.${parent}` });
      // node:http preserves repeated Prefer fields on the wire.
      return new Promise((resolve, reject) => {
        const req = request(
          target,
          {
            method,
            headers: {
              apikey: f.publicKey,
              Authorization: `Bearer ${session.access_token}`,
              ...headers,
            },
          },
          (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.once('end', () =>
              resolve({
                status: res.statusCode,
                range: res.headers['content-range'],
                body: Buffer.concat(chunks).toString(),
              }),
            );
          },
        );
        req.once('error', reject);
        req.end();
      });
    }
    for (const method of ['GET', 'HEAD']) {
      for (const prefer of [
        'count=planned',
        'count=estimated',
        'count=exact',
        'return=minimal, count=planned',
        'COUNT = ESTIMATED',
        ['count=planned', 'return=minimal'],
        ['return=minimal', 'count=planned'],
        ['count=planned', 'count=exact'],
        ['count=planned', ''],
      ]) {
        const result = await read(method, '/rest/v1/tasks', { PrEfEr: prefer });
        assert.equal(result.status, 400, `${method} ${prefer}: received ${result.range}`);
        assert.equal(result.range, undefined);
        if (method === 'GET')
          assert.equal(JSON.parse(result.body).message, 'UNSUPPORTED_READ_PREFERENCE');
      }
    }
    for (const path of ['/rest/v1/tasks/', '/rest/v1/%74asks']) {
      const variant = await read('GET', path, { Prefer: 'count=planned' });
      assert.ok(variant.status >= 400);
      assert.equal(variant.range, undefined);
    }
    const pastEnd = await read('GET', '/rest/v1/tasks', { Range: '10-11' });
    assert.equal(pastEnd.status, 200);
    assert.equal(pastEnd.range, '*/*');
    assert.deepEqual(JSON.parse(pastEnd.body), []);
    const invalid = await read('GET', '/rest/v1/tasks', { Range: '5-2', Prefer: 'count=planned' });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.range, undefined);
    const reason = JSON.parse(invalid.body);
    assert.equal(reason.code, 'PGRST103');
    assert.doesNotMatch(reason.details, /\d/);
  } finally {
    await db.query('delete from public.tasks where object_id=$1', [parent]);
    await db.query('delete from public.objects where id=$1', [parent]);
    await db.query('analyze public.tasks');
    await f.close();
  }
});
