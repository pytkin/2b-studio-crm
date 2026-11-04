import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('../../shared/supabase', () => ({ getSupabase: () => client }));
registerServer();
const newTask = {
  ...taskRow,
  status: 'new',
  objects: objectRow,
  task_status_history: [firstEvent],
};
it.each(['online', 'focus', 'action', 'navigation'])(
  'confirmed access loss on %s clears data/history/draft and never sends a transition',
  async (event) => {
    server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
    await signIn('executor');
    const { user, router, cache } = openPage(`/tasks/${ids.task}`);
    await user.type(await screen.findByLabelText('Комментарий'), 'Закрытый черновик');
    const writes = vi.fn(() => HttpResponse.json({}));
    server.use(
      http.get(`${api}/tasks`, () => HttpResponse.json([])),
      http.post(`${api}/rpc/transition_task`, writes),
    );
    if (event === 'navigation') {
      await router.navigate({ to: '/my-tasks' });
      await router.navigate({ to: '/tasks/$taskId', params: { taskId: ids.task } });
    } else if (event === 'action')
      await user.click(screen.getByRole('button', { name: 'Взять в работу' }));
    else fireEvent(window, new Event(event));
    expect(await screen.findByText('Запись недоступна')).toBeVisible();
    expect(screen.queryByText(firstEvent.comment)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Закрытый черновик')).not.toBeInTheDocument();
    expect(cache.getQueryData(['user', ids.executor, 'task', ids.task])).toBeNull();
    expect(writes).not.toHaveBeenCalled();
  },
);
it('late read started before reassignment cannot restore inaccessible task and draft', async () => {
  server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
  await signIn('executor');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.type(await screen.findByLabelText('Комментарий'), 'Старый ввод');
  let release!: () => void;
  const delayed = new Promise<void>((r) => {
    release = r;
  });
  const old = vi.fn(async () => {
    await delayed;
    return HttpResponse.json([newTask]);
  });
  server.use(http.get(`${api}/tasks`, old));
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(old).toHaveBeenCalled());
  server.use(http.get(`${api}/tasks`, () => HttpResponse.json([])));
  fireEvent(window, new Event('online'));
  expect(await screen.findByText('Запись недоступна')).toBeVisible();
  release();
  await delayed;
  expect(screen.queryByText(firstEvent.comment)).not.toBeInTheDocument();
});
it('failed focus read reports a network failure and retains the authorized draft', async () => {
  server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
  await signIn('executor');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.type(await screen.findByLabelText('Комментарий'), 'Черновик');
  server.use(http.get(`${api}/tasks`, () => HttpResponse.error()));
  fireEvent(window, new Event('focus'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить данные');
  expect(screen.getByLabelText('Комментарий')).toHaveValue('Черновик');
});
it('unknown create blocks writes until readback and reuses the original UUID', async () => {
  await signIn('manager');
  const { user } = openPage(`/objects/${ids.object}`);
  await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
  const form = within(screen.getByRole('dialog'));
  await user.type(form.getByLabelText('Название'), 'Геодезия');
  await user.selectOptions(form.getByLabelText('Исполнитель'), ids.executor);
  const sent: string[] = [];
  let reads = 0;
  server.use(
    http.post(`${api}/rpc/create_task`, async ({ request }) => {
      sent.push(JSON.stringify(await request.json()));
      return HttpResponse.error();
    }),
    http.get(`${api}/tasks`, () => {
      reads++;
      return reads === 1 ? HttpResponse.error() : HttpResponse.json([]);
    }),
  );
  await user.click(form.getByRole('button', { name: 'Сохранить' }));
  await user.click(await form.findByRole('button', { name: 'Проверить результат' }));
  expect(sent).toHaveLength(1);
  await user.click(await form.findByRole('button', { name: 'Повторить создание' }));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toBe(sent[0]);
});
it('a concurrent edit retains the draft and requires fresh explicit confirmation', async () => {
  await signIn('manager');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.click(await screen.findByRole('button', { name: 'Редактировать' }));
  const form = within(screen.getByRole('dialog'));
  await user.clear(form.getByLabelText('Название'));
  await user.type(form.getByLabelText('Название'), 'Мой вариант');
  server.use(
    http.get(`${api}/tasks`, () =>
      HttpResponse.json([{ ...newTask, title: 'Правка коллеги', version: 9 }]),
    ),
  );
  const update = vi.fn(() =>
    HttpResponse.json({ task: { ...newTask, title: 'Мой вариант', version: 10 } }),
  );
  server.use(http.post(`${api}/rpc/update_task`, update));
  await user.click(form.getByRole('button', { name: 'Сохранить' }));
  expect(await form.findByText(/Сейчас в карточке.*Правка коллеги/)).toBeVisible();
  expect(form.getByLabelText('Название')).toHaveValue('Мой вариант');
  expect(update).not.toHaveBeenCalled();
  await user.click(form.getByRole('button', { name: 'Подтвердить правку' }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
});

it.each(['transition', 'delete'])(
  'definitive %s RPC UNAVAILABLE purges task, draft and history without waiting for GET',
  async (operation) => {
    let revoked = false;
    let release!: () => void;
    const readback = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${api}/tasks`, async () => {
        if (revoked) await readback;
        return HttpResponse.json(revoked ? [] : [newTask]);
      }),
    );
    const rpc = vi.fn(() => {
      revoked = true;
      return HttpResponse.json({ message: 'UNAVAILABLE', code: 'P0001' }, { status: 400 });
    });
    server.use(
      http.post(`${api}/rpc/${operation === 'delete' ? 'delete_task' : 'transition_task'}`, rpc),
    );
    await signIn(operation === 'delete' ? 'manager' : 'executor');
    const { user } = openPage(`/tasks/${ids.task}`);
    expect(await screen.findByText(firstEvent.comment)).toBeVisible();
    if (operation === 'delete') {
      await user.click(screen.getByRole('button', { name: 'Удалить задачу' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить задачу' }),
      );
    } else {
      await user.type(screen.getByLabelText('Комментарий'), 'Закрытый текст');
      await user.click(screen.getByRole('button', { name: 'Взять в работу' }));
    }
    try {
      expect(await screen.findByText('Запись недоступна')).toBeVisible();
      expect(screen.queryByText(taskRow.title)).not.toBeInTheDocument();
      expect(screen.queryByText(firstEvent.comment)).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue('Закрытый текст')).not.toBeInTheDocument();
      expect(rpc).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
  },
);

it('successful delete clears detail cache even if Back cannot read the server', async () => {
  let deleted = false;
  server.use(
    http.get(`${api}/tasks`, () => (deleted ? HttpResponse.error() : HttpResponse.json([newTask]))),
    http.post(`${api}/rpc/delete_task`, () => {
      deleted = true;
      return HttpResponse.json({ id: ids.task, version: 4 });
    }),
  );
  await signIn('manager');
  const { user, router, cache } = openPage(`/tasks/${ids.task}`);
  await user.click(await screen.findByRole('button', { name: 'Удалить задачу' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить задачу' }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe(`/objects/${ids.object}`));
  expect(cache.getQueryData(['user', ids.manager, 'task', ids.task])).toBeNull();
  router.history.back();
  await screen.findByRole('alert');
  expect(screen.queryByText(taskRow.title)).not.toBeInTheDocument();
});
it('create_task UNAVAILABLE reloads the target picker and preserves editable fields', async () => {
  await signIn('manager');
  const { user } = openPage(`/objects/${ids.object}`);
  await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Название'), 'Сверка');
  await user.selectOptions(dialog.getByLabelText('Исполнитель'), ids.executor);
  const rpc = vi.fn(() =>
    HttpResponse.json({ message: 'UNAVAILABLE', code: 'P0001' }, { status: 400 }),
  );
  server.use(
    http.post(`${api}/rpc/create_task`, rpc),
    http.get(`${api}/tasks`, () => HttpResponse.json([])),
    http.get(`${api}/objects`, () =>
      HttpResponse.json([{ id: 'replacement', name: 'Другой корпус' }]),
    ),
  );
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(await dialog.findByRole('option', { name: 'Другой корпус' })).toBeInTheDocument();
  expect(dialog.getByLabelText('Название')).toHaveValue('Сверка');
  expect(dialog.getByLabelText('Объект')).toBeEnabled();
  expect(dialog.queryByText('Повторить создание')).not.toBeInTheDocument();
  expect(rpc).toHaveBeenCalledTimes(1);
});

it('lost create response opens the original record only after reading its first history event', async () => {
  let savedId = '';
  const create = vi.fn(async ({ request }: { request: Request }) => {
    const values = await request.json();
    savedId = String(values.p_id);
    return HttpResponse.error();
  });
  server.use(
    http.post(`${api}/rpc/create_task`, create),
    http.get(`${api}/tasks`, () =>
      HttpResponse.json(
        savedId
          ? [
              {
                ...newTask,
                id: savedId,
                task_status_history: [{ ...firstEvent, comment: 'Первое событие' }],
              },
            ]
          : [],
      ),
    ),
  );
  await signIn('manager');
  const { user, router } = openPage(`/objects/${ids.object}`);
  await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Название'), 'Фасад');
  await user.selectOptions(dialog.getByLabelText('Исполнитель'), ids.executor);
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByText('Первое событие')).toBeVisible();
  expect(router.state.location.pathname).toBe(`/tasks/${savedId}`);
  expect(create).toHaveBeenCalledTimes(1);
});
it('uncertain transition reads authoritative status and actor, with no second write', async () => {
  let persisted = false;
  const perform = vi.fn(() => {
    persisted = true;
    return HttpResponse.error();
  });
  server.use(
    http.post(`${api}/rpc/transition_task`, perform),
    http.get(`${api}/tasks`, () =>
      HttpResponse.json([
        {
          ...newTask,
          status: persisted ? 'in_progress' : 'new',
          version: persisted ? 4 : 3,
          task_status_history: persisted
            ? [
                firstEvent,
                {
                  ...firstEvent,
                  id: 2,
                  from_status: 'new',
                  to_status: 'in_progress',
                  actor_name: 'Участник события',
                  comment: 'Принят чертёж',
                },
              ]
            : [firstEvent],
        },
      ]),
    ),
  );
  await signIn('executor');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.click(await screen.findByRole('button', { name: 'Взять в работу' }));
  expect(await screen.findByText('Принят чертёж')).toBeVisible();
  expect(screen.getByText(/Участник события/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Отправить на проверку' })).toBeEnabled();
  expect(perform).toHaveBeenCalledTimes(1);
});
it('unknown delete followed by an empty read reports only unavailability', async () => {
  let gone = false;
  const remove = vi.fn(() => {
    gone = true;
    return HttpResponse.error();
  });
  server.use(
    http.post(`${api}/rpc/delete_task`, remove),
    http.get(`${api}/tasks`, () => HttpResponse.json(gone ? [] : [newTask])),
  );
  await signIn('manager');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.click(await screen.findByRole('button', { name: 'Удалить задачу' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Удалить задачу' }),
  );
  expect(await screen.findByText('Запись недоступна')).toBeVisible();
  expect(screen.queryByText(/успешно удалена/i)).not.toBeInTheDocument();
  expect(remove).toHaveBeenCalledTimes(1);
});
