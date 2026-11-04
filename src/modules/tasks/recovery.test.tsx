import { onlineManager } from '@tanstack/react-query';
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

it.each(['inactive', 'executor'])(
  "FORBIDDEN on task create rechecks the same employee's %s profile and removes manager draft and directory",
  async (next) => {
    await signIn('manager');
    const { user, cache } = openPage(`/objects/${ids.object}`);
    await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Название'), 'Секретный черновик');
    await user.selectOptions(dialog.getByLabelText('Исполнитель'), ids.executor);
    const denied = vi.fn(() =>
      HttpResponse.json({ message: 'FORBIDDEN', code: 'P0001' }, { status: 400 }),
    );
    server.use(
      http.post(`${api}/rpc/create_task`, denied),
      http.get(`${api}/profiles`, () =>
        HttpResponse.json(
          next === 'inactive'
            ? []
            : [{ id: ids.manager, role: 'executor', active: true, display_name: 'Ирина' }],
        ),
      ),
    );
    await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(denied).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue('Секретный черновик')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать задачу' })).not.toBeInTheDocument();
    expect(cache.getQueryData(['user', ids.manager, 'task-choices'])).toBeUndefined();
    if (next === 'inactive')
      expect(screen.getByRole('heading', { name: 'Профиль недоступен' })).toBeVisible();
    else expect(await screen.findByText(/Ирина · Исполнитель/)).toBeVisible();
  },
);
it('forbidden single transition refreshes authorization and retains a still-authorized task', async () => {
  server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
  await signIn('executor');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.type(await screen.findByLabelText('Комментарий'), 'Проверить позже');
  const check = vi.fn(() =>
    HttpResponse.json([
      { id: ids.executor, role: 'executor', active: true, display_name: 'Евгений' },
    ]),
  );
  server.use(
    http.get(`${api}/profiles`, check),
    http.post(`${api}/rpc/transition_task`, () =>
      HttpResponse.json({ message: 'FORBIDDEN', code: 'P0001' }, { status: 400 }),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Взять в работу' }));
  await waitFor(() => expect(check).toHaveBeenCalled());
  expect(await screen.findByText('Это действие недоступно для вашей роли.')).toBeVisible();
  expect(screen.getByRole('heading', { name: newTask.title })).toBeVisible();
  expect(screen.getByLabelText('Комментарий')).toHaveValue('Проверить позже');
});

it('offline action exposes read-only recovery without enqueuing a write for reconnect', async () => {
  server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
  await signIn('executor');
  const { user } = openPage(`/tasks/${ids.task}`);
  const start = await screen.findByRole('button', { name: 'Взять в работу' });
  const transition = vi.fn(() => HttpResponse.json({}));
  server.use(
    http.get(`${api}/tasks`, () => HttpResponse.error()),
    http.post(`${api}/rpc/transition_task`, transition),
  );
  onlineManager.setOnline(false);
  try {
    await user.click(start);
    expect(await screen.findByRole('button', { name: 'Проверить результат' })).toBeEnabled();
    expect(transition).not.toHaveBeenCalled();
  } finally {
    onlineManager.setOnline(true);
  }
  server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
  fireEvent(window, new Event('online'));
  await user.click(screen.getByRole('button', { name: 'Проверить результат' }));
  expect(await screen.findByRole('button', { name: 'Взять в работу' })).toBeEnabled();
  expect(transition).not.toHaveBeenCalled();
});

it('reconciles an in-flight first create that commits between an empty read and explicit retry', async () => {
  await signIn('manager');
  const { user, router } = openPage(`/objects/${ids.object}`);
  await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Название'), 'Запоздавшая запись');
  await user.selectOptions(dialog.getByLabelText('Исполнитель'), ids.executor);
  const sent: string[] = [];
  server.use(
    http.post(`${api}/rpc/create_task`, async ({ request }: { request: Request }) => {
      sent.push(String((await request.json()).p_id));
      return sent.length === 1
        ? HttpResponse.error()
        : HttpResponse.json({ message: 'ID_UNAVAILABLE', code: 'P0001' }, { status: 400 });
    }),
    http.get(`${api}/tasks`, () =>
      HttpResponse.json(
        sent.length < 2 ? [] : [{ ...newTask, title: 'Запоздавшая запись', id: sent[0] }],
      ),
    ),
  );
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  await user.click(await dialog.findByRole('button', { name: 'Повторить создание' }));
  expect(await screen.findByRole('heading', { name: 'Запоздавшая запись' })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/tasks/${sent[0]}`);
  expect(sent).toEqual([sent[0], sent[0]]);
});

it('a readback matching the submitted edit returns to the saved fields without inviting a duplicate write', async () => {
  let saved = false;
  const update = vi.fn(() => {
    saved = true;
    return HttpResponse.error();
  });
  server.use(
    http.post(`${api}/rpc/update_task`, update),
    http.get(`${api}/tasks`, () =>
      HttpResponse.json([
        { ...newTask, title: saved ? 'Фактическая правка' : newTask.title, version: saved ? 4 : 3 },
      ]),
    ),
  );
  await signIn('manager');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.click(await screen.findByRole('button', { name: 'Редактировать' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.clear(dialog.getByLabelText('Название'));
  await user.type(dialog.getByLabelText('Название'), 'Фактическая правка');
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('heading', { name: 'Фактическая правка' })).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(update).toHaveBeenCalledTimes(1);
});

it('a lost delete response requires detail and list readback before another deletion', async () => {
  const remove = vi.fn(() => HttpResponse.error());
  const list = vi
    .fn()
    .mockImplementationOnce(() => HttpResponse.error())
    .mockImplementation(() => HttpResponse.json([{ ...objectRow, tasks: [newTask] }]));
  server.use(http.post(`${api}/rpc/delete_task`, remove), http.get(`${api}/objects`, list));
  await signIn('manager');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.click(await screen.findByRole('button', { name: 'Удалить задачу' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: 'Удалить задачу' }));
  await user.click(await dialog.findByRole('button', { name: 'Проверить результат' }));
  expect(await dialog.findByRole('button', { name: 'Удалить задачу' })).toBeEnabled();
  expect(list).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(1);
});

it('manual transition readback disables repeat clicks while the single read is pending', async () => {
  server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
  await signIn('executor');
  const { user } = openPage(`/tasks/${ids.task}`);
  const start = await screen.findByRole('button', { name: 'Взять в работу' });
  server.use(http.get(`${api}/tasks`, () => HttpResponse.error()));
  await user.click(start);
  const retry = await screen.findByRole('button', { name: 'Проверить результат' });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.fn(async () => {
    await pending;
    return HttpResponse.json([newTask]);
  });
  server.use(http.get(`${api}/tasks`, read));
  try {
    await user.dblClick(retry);
    expect(retry).toBeDisabled();
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    release();
  }
  expect(await screen.findByRole('button', { name: 'Взять в работу' })).toBeEnabled();
});

it.each(['revoked', 'authorized', 'still offline'])(
  'reopening a blocked workspace waits for the task readback when access is %s',
  async (outcome) => {
    server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
    await signIn('executor');
    const { user } = openPage(`/tasks/${ids.task}`);
    await user.type(await screen.findByLabelText('Комментарий'), 'Рабочий черновик');
    server.use(
      http.get(`${api}/profiles`, () => HttpResponse.error()),
      http.get(`${api}/tasks`, () => HttpResponse.error()),
    );
    fireEvent(window, new Event('focus'));
    expect(
      await screen.findByRole('heading', { name: 'Не удалось проверить доступ' }),
    ).toBeVisible();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.fn(async () => {
      await held;
      return outcome === 'still offline'
        ? HttpResponse.error()
        : HttpResponse.json(outcome === 'authorized' ? [newTask] : []);
    });
    server.resetHandlers();
    server.use(http.get(`${api}/tasks`, read));
    try {
      await user.click(screen.getByRole('button', { name: 'Проверить снова' }));
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('heading', { name: newTask.title })).toBeNull();
      expect(screen.queryByRole('list', { name: 'История статусов' })).toBeNull();
      expect(screen.queryByRole('textbox', { name: 'Комментарий' })).toBeNull();
    } finally {
      release();
    }
    if (outcome === 'still offline') {
      expect(await screen.findByRole('button', { name: 'Проверить снова' })).toBeEnabled();
      expect(screen.queryByRole('heading', { name: newTask.title })).toBeNull();
      server.use(http.get(`${api}/tasks`, () => HttpResponse.json([newTask])));
      await user.click(screen.getByRole('button', { name: 'Проверить снова' }));
    }
    if (outcome === 'revoked') {
      expect(await screen.findByRole('heading', { name: 'Запись недоступна' })).toBeVisible();
      expect(screen.queryByDisplayValue('Рабочий черновик')).toBeNull();
      expect(screen.queryByText(firstEvent.comment)).toBeNull();
    } else {
      expect(await screen.findByRole('textbox', { name: 'Комментарий' })).toHaveValue(
        'Рабочий черновик',
      );
    }
  },
);

it.each(['create', 'update'])(
  'refreshes a deactivated assignee on %s_task INVALID_INPUT without replaying the draft',
  async (operation) => {
    const create = operation === 'create';
    await signIn('manager');
    const { user } = openPage(create ? `/objects/${ids.object}` : `/tasks/${ids.task}`);
    await user.click(
      await screen.findByRole('button', { name: create ? 'Создать задачу' : 'Редактировать' }),
    );
    const form = within(screen.getByRole('dialog'));
    await user.clear(form.getByLabelText('Название'));
    await user.type(form.getByLabelText('Название'), 'Уточнение фасада');
    await user.selectOptions(form.getByLabelText('Исполнитель'), ids.executor);
    const replacement = 'e0000000-0000-4000-8000-000000000009';
    const assignments: string[] = [];
    server.use(
      http.get(`${api}/profiles`, () =>
        HttpResponse.json([{ id: replacement, display_name: 'Анна' }]),
      ),
      http.post(`${api}/rpc/${operation}_task`, async ({ request }: { request: Request }) => {
        assignments.push((await request.json()).p_assignee_id);
        return assignments.length === 1
          ? HttpResponse.json({ message: 'INVALID_INPUT', code: 'P0001' }, { status: 400 })
          : HttpResponse.json({});
      }),
    );
    await user.click(form.getByRole('button', { name: 'Сохранить' }));
    expect(await form.findByRole('option', { name: 'Анна' })).toBeInTheDocument();
    expect(form.queryByRole('option', { name: 'Евгений' })).toBeNull();
    expect(form.getByLabelText('Исполнитель')).toHaveValue('');
    expect(form.getByLabelText('Название')).toHaveValue('Уточнение фасада');
    expect(form.getByText(/исполнитель больше недоступен/i)).toBeVisible();
    await user.selectOptions(form.getByLabelText('Исполнитель'), replacement);
    expect(assignments).toEqual([ids.executor]);
    await user.click(
      form.getByRole('button', { name: create ? 'Сохранить' : 'Подтвердить правку' }),
    );
    await waitFor(() => expect(assignments).toEqual([ids.executor, replacement]));
  },
);

it('keeps ordinary field validation when INVALID_INPUT leaves both task choices available', async () => {
  await signIn('manager');
  const { user } = openPage(`/objects/${ids.object}`);
  await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
  const form = within(screen.getByRole('dialog'));
  await user.type(form.getByLabelText('Название'), 'Подготовить форму');
  await user.selectOptions(form.getByLabelText('Исполнитель'), ids.executor);
  const people = vi.fn(() => HttpResponse.json([{ id: ids.executor, display_name: 'Евгений' }]));
  const create = vi.fn(() =>
    HttpResponse.json({ message: 'INVALID_INPUT', code: 'P0001' }, { status: 400 }),
  );
  server.use(http.post(`${api}/rpc/create_task`, create), http.get(`${api}/profiles`, people));
  await user.click(form.getByRole('button', { name: 'Сохранить' }));
  expect(await form.findByText('Проверьте поля и повторите сохранение.')).toBeVisible();
  expect(people).toHaveBeenCalledTimes(1);
  expect(form.getByLabelText('Исполнитель')).toHaveValue(ids.executor);
  expect(create).toHaveBeenCalledTimes(1);
});
