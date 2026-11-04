import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { api, ids, objectRow, registerServer, server, taskRow } from '../../test/fixtures';
import { readObject, readObjects } from './api';
vi.mock('../../shared/supabase', async () => ({ getSupabase: () => fixture.client }));
import * as fixture from '../../test/fixtures';
registerServer();
const items = Array.from({ length: 1001 }, (_, i) => ({
  ...taskRow,
  title: 'Работа ' + i,
  id: String(i),
}));
function page<T>(params: URLSearchParams, rows: T[], prefix = '') {
  const offset = Number(params.get(prefix + 'offset') || 0);
  const limit = Math.min(1000, Number(params.get(prefix + 'limit') || 1000));
  return rows.slice(offset, offset + limit);
}
it('loads the last visible object and the last permitted task beyond the API row cap', async () => {
  server.use(
    http.get(api + '/objects', ({ request }) => {
      const params = new URL(request.url).searchParams;
      return HttpResponse.json(
        params.has('id')
          ? [{ ...objectRow, tasks: page(params, items, 'tasks.') }]
          : page(
              params,
              items.map((t) => ({ ...objectRow, id: t.id, name: t.title, tasks: [{ count: 1 }] })),
            ),
      );
    }),
  );
  const signal = new AbortController().signal;
  const all = await readObjects(signal, async () => {});
  expect(all).toHaveLength(1001);
  const object = await readObject(ids.object, signal, async () => {});
  expect(object?.tasks.at(-1)?.title).toBe('Работа 1000');
});
