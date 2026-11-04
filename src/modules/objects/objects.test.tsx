import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import {
  api,
  ids,
  objectRow,
  openPage,
  server,
  signIn,
  taskRow,
  registerServer,
} from '../../test/fixtures';

vi.mock('../../shared/supabase', async () => {
  const fixture = await import('../../test/fixtures');
  return { getSupabase: () => fixture.client };
});
registerServer();

function objectsRead(tasks: (typeof taskRow)[] = [taskRow]) {
  server.use(
    http.get(api + '/objects', ({ request }) => {
      const params = new URL(request.url).searchParams;
      return HttpResponse.json([
        { ...objectRow, tasks: params.has('id') ? tasks : [{ count: tasks.length }] },
      ]);
    }),
  );
}

it('S4-01 renders the visible objects, their RLS counts, and only permitted task rows', async () => {
  objectsRead();
  await signIn('executor');
  const { user } = openPage('/objects');
  const objectLink = await screen.findByRole('link', { name: /Корпус А/ });
  expect(objectLink).toHaveTextContent(/1 задача/);
  expect(screen.queryByText('Корпус Б')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Создать объект' })).not.toBeInTheDocument();
  await user.click(objectLink);
  expect(await screen.findByRole('heading', { name: objectRow.name })).toHaveFocus();
  for (const name of ['Редактировать', 'Удалить объект', 'Создать задачу'])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  expect(await screen.findByRole('link', { name: new RegExp(taskRow.title) })).toBeVisible();
  expect(screen.queryByText('Чужая задача')).not.toBeInTheDocument();
  expect(screen.getByText('Принята')).toBeVisible();
  expect(screen.getByRole('link', { name: new RegExp(taskRow.title) })).toHaveAttribute(
    'href',
    '/tasks/' + ids.task,
  );
});

it('S4-01 manager can see an empty object and its empty state', async () => {
  objectsRead([]);
  await signIn('manager');
  openPage('/objects/' + ids.object);
  expect(await screen.findByText(/Нет задач|Задач пока нет/)).toBeVisible();
});
it('S4-02 empty address leaves the name, valid submission calls create once and opens the record', async () => {
  const requests: Record<string, unknown>[] = [];
  server.use(
    http.post(api + '/rpc/create_object', async ({ request }) => {
      const args = (await request.json()) as Record<string, unknown>;
      requests.push(args);
      return HttpResponse.json({ object: { ...objectRow, id: args.p_id } });
    }),
  );
  await signIn('manager');
  const { user, router } = openPage('/objects');
  await user.click(await screen.findByRole('button', { name: 'Создать объект' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Название'), 'Фасад');
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(await dialog.findByText('Укажите адрес')).toBeVisible();
  expect(dialog.getByLabelText('Название')).toHaveValue('Фасад');
  expect(requests).toHaveLength(0);
  await user.type(dialog.getByLabelText('Адрес'), 'Проспект, 7');
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  await waitFor(() => expect(router.state.location.pathname).toBe('/objects/' + requests[0].p_id));
});
it('S4-03 cancel deletion restores trigger focus without RPC', async () => {
  const deletion = vi.fn(() => HttpResponse.json({ id: ids.object, version: 2 }));
  server.use(http.post(api + '/rpc/delete_object', deletion));
  await signIn('manager');
  const { user } = openPage('/objects/' + ids.object);
  const trigger = await screen.findByRole('button', { name: 'Удалить объект' });
  await user.click(trigger);
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/Корпус А/)).toBeVisible();
  await user.click(dialog.getByRole('button', { name: 'Отмена' }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(deletion).not.toHaveBeenCalled();
});

it('S4-02 lost create keeps its UUID and original values; retry first verifies visibility', async () => {
  let readbacks = 0;
  const submissions: unknown[] = [];
  server.use(
    http.post(api + '/rpc/create_object', async ({ request }) => {
      submissions.push(await request.json());
      return submissions.length === 1
        ? HttpResponse.error()
        : HttpResponse.json({ object: objectRow });
    }),
    http.get(api + '/objects', ({ request }) => {
      if (new URL(request.url).searchParams.has('id')) {
        readbacks++;
        if (readbacks === 1) return HttpResponse.error();
      }
      return HttpResponse.json([]);
    }),
  );
  await signIn('manager');
  const { user, router } = openPage('/objects');
  await user.click(await screen.findByRole('button', { name: 'Создать объект' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Название'), 'Новый корпус');
  await user.type(dialog.getByLabelText('Адрес'), 'Садовая, 1');
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  const check = await dialog.findByRole('button', { name: 'Проверить результат' });
  expect(submissions).toHaveLength(1);
  expect(dialog.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument();
  await user.click(check);
  await user.click(await dialog.findByRole('button', { name: 'Повторить создание' }));
  await waitFor(() => expect(submissions).toHaveLength(2));
  expect(submissions[1]).toEqual(submissions[0]);
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/objects\/[\w-]+$/));
});

it('S4-02 version conflict exposes current fields and requires a second confirmation', async () => {
  let version = 1;
  let address = objectRow.address;
  const writes: Record<string, unknown>[] = [];
  server.use(
    http.get(api + '/objects', () =>
      HttpResponse.json([{ ...objectRow, address, version, tasks: [] }]),
    ),
    http.post(api + '/rpc/update_object', async ({ request }) => {
      const fields = (await request.json()) as Record<string, unknown>;
      writes.push(fields);
      address = String(fields.p_address);
      version++;
      return HttpResponse.json({ object: { ...objectRow, address, version } });
    }),
  );
  await signIn('manager');
  const { user } = openPage('/objects/' + ids.object);
  await user.click(await screen.findByRole('button', { name: 'Редактировать' }));
  const dialog = within(screen.getByRole('dialog'));
  const field = dialog.getByLabelText('Адрес');
  await user.clear(field);
  await user.type(field, 'Мой адрес');
  version = 2;
  address = 'Актуальный адрес';
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(await dialog.findByText('Актуальный адрес')).toBeVisible();
  expect(writes).toHaveLength(0);
  expect(field).toHaveValue('Мой адрес');
  await user.click(dialog.getByRole('button', { name: /Подтвердить|Применить/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(writes).toEqual([
    { p_id: ids.object, p_expected_version: 2, p_address: 'Мой адрес', p_name: objectRow.name },
  ]);
  expect(await screen.findByText('Мой адрес')).toBeVisible();
});

it('S4-03 lost delete reads the list and detail, never labels invisibility successful deletion', async () => {
  let removed = false;
  let detailRead = false;
  let listRead = false;
  server.use(
    http.get(api + '/objects', ({ request }) => {
      if (!removed) return HttpResponse.json([{ ...objectRow, tasks: [] }]);
      if (new URL(request.url).searchParams.has('id')) detailRead = true;
      else listRead = true;
      return HttpResponse.json([]);
    }),
    http.post(api + '/rpc/delete_object', () => {
      removed = true;
      return HttpResponse.error();
    }),
  );
  await signIn('manager');
  const { user } = openPage('/objects/' + ids.object);
  await user.click(await screen.findByRole('button', { name: 'Удалить объект' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Удалить объект' }));
  expect(await screen.findByText('Запись недоступна', { exact: true })).toBeVisible();
  await waitFor(() => expect([detailRead, listRead]).toEqual([true, true]));
  expect(screen.queryByText(/объект удалён|объект удален/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('S4-01 a failed read can be retried without leaving the route', async () => {
  let failed = true;
  server.use(
    http.get(api + '/objects', () =>
      failed
        ? HttpResponse.json({ message: 'INTERNAL SQL DETAILS' }, { status: 503 })
        : HttpResponse.json([]),
    ),
  );
  await signIn('executor');
  const { user } = openPage('/objects');
  const again = await screen.findByRole('button', { name: 'Повторить' });
  expect(screen.queryByText(/INTERNAL SQL DETAILS/)).not.toBeInTheDocument();
  failed = false;
  await user.click(again);
  expect(await screen.findByText(/ещё нет назначенных задач/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Создать объект' })).not.toBeInTheDocument();
});

it('S4-01 the refreshed unavailable record drops the old name and task links', async () => {
  let allowed = true;
  server.use(
    http.get(api + '/objects', () =>
      HttpResponse.json(allowed ? [{ ...objectRow, tasks: [taskRow] }] : []),
    ),
  );
  await signIn('executor');
  openPage('/objects/' + ids.object);
  expect(await screen.findByRole('heading', { name: objectRow.name })).toBeVisible();
  allowed = false;
  window.dispatchEvent(new Event('focus'));
  expect(await screen.findByText('Запись недоступна')).toBeVisible();
  expect(screen.queryByText(objectRow.name)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: new RegExp(taskRow.title) })).not.toBeInTheDocument();
});

it.each([
  { role: 'executor' as const, to: '/my-tasks', name: 'К моим задачам', heading: 'Мои задачи' },
  { role: 'manager' as const, to: '/objects', name: 'К списку объектов', heading: 'Объекты' },
])(
  'S4-01 unavailable object guides $role to an available list',
  async ({ role, to, name, heading }) => {
    server.use(http.get(`${api}/objects`, () => HttpResponse.json([])));
    await signIn(role);
    const { user } = openPage(`/objects/${ids.object}`);

    expect(await screen.findByRole('heading', { name: 'Запись недоступна' })).toBeVisible();
    expect(
      screen.getByText(
        'По этой ссылке нет доступных вам данных. Перейдите к списку, чтобы продолжить работу.',
      ),
    ).toBeVisible();
    const back = screen.getByRole('link', { name });
    expect(back).toHaveAttribute('href', to);
    await user.click(back);
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
  },
);

it('S4-03 a failed list refresh cannot restore an object confirmed unavailable by the detail read', async () => {
  let removed = false;
  server.use(
    http.get(api + '/objects', ({ request }) => {
      if (!removed) return HttpResponse.json([{ ...objectRow, tasks: [] }]);
      return new URL(request.url).searchParams.has('id')
        ? HttpResponse.json([])
        : HttpResponse.error();
    }),
    http.post(api + '/rpc/delete_object', () => {
      removed = true;
      return HttpResponse.error();
    }),
  );
  await signIn('manager');
  const { user } = openPage('/objects/' + ids.object);
  await user.click(await screen.findByRole('button', { name: 'Удалить объект' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить объект' }),
  );
  expect(await screen.findByText('Запись недоступна')).toBeVisible();
  expect(screen.queryByText(objectRow.name)).not.toBeInTheDocument();
});

it('S4-02 keeps confirmed server fields visible when the next read fails', async () => {
  let saved = false;
  const address = 'Подтверждённый адрес';
  server.use(
    http.get(api + '/objects', () =>
      saved ? HttpResponse.error() : HttpResponse.json([{ ...objectRow, tasks: [] }]),
    ),
    http.post(api + '/rpc/update_object', () => {
      saved = true;
      return HttpResponse.json({ object: { ...objectRow, address, version: 2 } });
    }),
  );
  await signIn('manager');
  const { user } = openPage('/objects/' + ids.object);
  await user.click(await screen.findByRole('button', { name: 'Редактировать' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.clear(dialog.getByLabelText('Адрес'));
  await user.type(dialog.getByLabelText('Адрес'), address);
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('button', { name: 'Повторить' })).toBeVisible();
  expect(screen.getByText(address)).toBeVisible();
});

it('S4-02 a lost creation response opens the object read by the original UUID', async () => {
  let createdId = '';
  let writes = 0;
  server.use(
    http.get(api + '/objects', ({ request }) => {
      const filter = new URL(request.url).searchParams.get('id');
      return HttpResponse.json(
        createdId && filter === 'eq.' + createdId
          ? [{ ...objectRow, id: createdId, tasks: [] }]
          : [],
      );
    }),
    http.post(api + '/rpc/create_object', async ({ request }) => {
      createdId = ((await request.json()) as { p_id: string }).p_id;
      writes++;
      return HttpResponse.error();
    }),
  );
  await signIn('manager');
  const { user, router } = openPage('/objects');
  await user.click(await screen.findByRole('button', { name: 'Создать объект' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Название'), objectRow.name);
  await user.type(dialog.getByLabelText('Адрес'), objectRow.address);
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('heading', { name: objectRow.name })).toBeVisible();
  expect(router.state.location.pathname).toBe('/objects/' + createdId);
  expect(writes).toBe(1);
});
