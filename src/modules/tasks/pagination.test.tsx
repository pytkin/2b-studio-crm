import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';
import {
  api,
  client,
  firstEvent,
  ids,
  objectRow,
  openPage,
  registerServer,
  server,
  signIn,
  taskRow,
} from '../../test/fixtures';
import { readMine, readTask } from './data';

vi.mock('../../shared/supabase', () => ({ getSupabase: () => client }));
registerServer();
const total = 1001;
function page<T>(request: Request, rows: T[]) {
  const search = new URL(request.url).searchParams;
  const start = Number(search.get('offset') ?? 0);
  const size = Math.min(1000, Number(search.get('limit') ?? 1000));
  return rows.slice(start, start + size);
}
it('readMine returns >1000 permitted tasks in stable pages', async () => {
  await signIn('executor');
  const rows = Array.from({ length: total }, (_, i) => ({
    ...taskRow,
    id: `task-${i}`,
    objects: objectRow,
  }));
  server.use(http.get(`${api}/tasks`, ({ request }) => HttpResponse.json(page(request, rows))));
  const result = await readMine(ids.executor, new AbortController().signal);
  expect(result.map((row) => row.id)).toEqual(rows.map((row) => row.id));
});
it('task history includes >1000 visible events without truncation', async () => {
  await signIn('executor');
  const events = Array.from({ length: total }, (_, i) => ({ ...firstEvent, id: i + 1 }));
  server.use(
    http.get(`${api}/tasks`, ({ request }) => {
      const search = new URL(request.url).searchParams;
      return HttpResponse.json([
        {
          ...taskRow,
          objects: objectRow,
          task_status_history: events.slice(
            Number(search.get('task_status_history.offset') ?? 0),
            Number(search.get('task_status_history.offset') ?? 0) +
              Math.min(Number(search.get('task_status_history.limit') ?? 1000), 1000),
          ),
        },
      ]);
    }),
    http.get(`${api}/task_status_history`, ({ request }) =>
      HttpResponse.json(page(request, events)),
    ),
  );
  expect((await readTask(ids.task))?.task_status_history.at(-1)?.id).toBe(total);
});
it('task assignment offers >1000 active executors and objects', async () => {
  await signIn('manager');
  const objects = Array.from({ length: total }, (_, i) => ({
    id: `object-${i}`,
    name: `Корпус ${i}`,
  }));
  const people = Array.from({ length: total }, (_, i) => ({
    id: `person-${i}`,
    display_name: `Сотрудник ${i}`,
  }));
  server.use(
    http.get(`${api}/objects`, ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('id')
          ? [{ ...objectRow, tasks: [] }]
          : page(request, objects),
      ),
    ),
    http.get(`${api}/profiles`, ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.has('role')
          ? page(request, people)
          : [{ id: ids.manager, role: 'manager', active: true, display_name: 'Ирина' }],
      ),
    ),
  );
  const { user } = openPage(`/objects/${ids.object}`);
  await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
  const dialog = within(screen.getByRole('dialog'));
  await waitFor(() =>
    expect((dialog.getByLabelText('Исполнитель') as HTMLSelectElement).options.length).toBe(
      total + 1,
    ),
  );
  expect((dialog.getByLabelText('Объект') as HTMLSelectElement).options.length).toBe(total + 1);
});
