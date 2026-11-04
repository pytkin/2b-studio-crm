import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';
import {
  api,
  client,
  firstEvent,
  ids,
  lastEvent,
  objectRow,
  openPage,
  registerServer,
  server,
  signIn,
  taskRow,
} from '../../test/fixtures';

vi.mock('../../shared/supabase', () => ({ getSupabase: () => client }));
registerServer();
it('S5-01 includes accepted work and opens its chronological history', async () => {
  await signIn('executor');
  const { user } = openPage('/my-tasks');
  const task = await screen.findByRole('link', { name: new RegExp(taskRow.title) });
  expect(screen.getByText('Принята')).toBeVisible();
  await user.click(task);
  expect(await screen.findByRole('heading', { name: taskRow.title })).toHaveFocus();
  const history = within(await screen.findByRole('list', { name: 'История статусов' }));
  const rows = history.getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent(firstEvent.comment);
  expect(rows[1]).toHaveTextContent(lastEvent.comment);
});

it('S5-02 task creation starts at the current object and validates before its single RPC', async () => {
  const create = vi.fn(async ({ request }: { request: Request }) => {
    const args = (await request.json()) as Record<string, string>;
    return HttpResponse.json({
      task: { ...taskRow, id: args.p_id, status: 'new' },
      event: firstEvent,
    });
  });
  server.use(http.post(`${api}/rpc/create_task`, create));
  await signIn('manager');
  const { user } = openPage(`/objects/${ids.object}`);
  await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(await dialog.findByLabelText('Объект')).toHaveValue(ids.object);
  for (const label of ['Название', 'Объект', 'Исполнитель'])
    expect(dialog.getByLabelText(label)).toBeRequired();
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  expect(await dialog.findByText('Укажите название')).toBeVisible();
  expect(dialog.getByText('Выберите исполнителя')).toBeVisible();
  expect(create).not.toHaveBeenCalled();
  await user.type(dialog.getByLabelText('Название'), 'Проверить бетон');
  await user.selectOptions(dialog.getByLabelText('Исполнитель'), ids.executor);
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
});

it('S5-03 focus rechecks and removes the task and its history after reassignment', async () => {
  await signIn('executor');
  openPage(`/tasks/${ids.task}`);
  expect(await screen.findByText(firstEvent.comment)).toBeVisible();
  server.use(
    http.get(`${api}/tasks`, () => HttpResponse.json([])),
    http.get(`${api}/task_status_history`, () => HttpResponse.json([])),
  );
  fireEvent(window, new Event('focus'));
  expect(await screen.findByText('Запись недоступна')).toBeVisible();
  expect(screen.queryByText(firstEvent.comment)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: taskRow.title })).not.toBeInTheDocument();
});

it('S5-03 cancelled task deletion restores focus without changing the task', async () => {
  await signIn('manager');
  const { user } = openPage(`/tasks/${ids.task}`);
  const trigger = await screen.findByRole('button', { name: 'Удалить задачу' });
  await user.click(trigger);
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.getByText(/Подготовить чертёж/)).toBeVisible();
  await user.click(dialog.getByRole('button', { name: 'Отмена' }));
  await waitFor(() => expect(trigger).toHaveFocus());
});
it('S6-01 accepts a single pending transition and renders its confirmed status', async () => {
  let status = 'new';
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transition = vi.fn(async () => {
    await pending;
    status = 'in_progress';
    return HttpResponse.json({
      task: { ...taskRow, status, version: 4 },
      event: { ...lastEvent, to_status: status },
    });
  });
  server.use(
    http.get(`${api}/tasks`, () =>
      HttpResponse.json([
        { ...taskRow, status, objects: objectRow, task_status_history: [firstEvent] },
      ]),
    ),
    http.post(`${api}/rpc/transition_task`, transition),
  );
  await signIn('executor');
  const { user } = openPage(`/tasks/${ids.task}`);
  const begin = await screen.findByRole('button', { name: 'Взять в работу' });
  await user.dblClick(begin);
  await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
  expect(begin).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Сохраняем изменение статуса');
  release?.();
  expect(await screen.findByRole('button', { name: 'Отправить на проверку' })).toBeVisible();
  const receipt = await screen.findByText('В истории сохранён переход в статус «В работе».');
  await waitFor(() => expect(receipt).toHaveFocus());
});
it('S6-02 blank return reason focuses its field without transitioning', async () => {
  server.use(
    http.get(`${api}/tasks`, () =>
      HttpResponse.json([
        { ...taskRow, status: 'in_review', objects: objectRow, task_status_history: [firstEvent] },
      ]),
    ),
  );
  const transition = vi.fn();
  server.use(http.post(`${api}/rpc/transition_task`, transition));
  await signIn('manager');
  const { user } = openPage(`/tasks/${ids.task}`);
  await user.click(await screen.findByRole('button', { name: 'Вернуть на доработку' }));
  const dialog = within(screen.getByRole('dialog'));
  const reason = dialog.getByLabelText('Причина возврата');
  await user.type(reason, '   ');
  await user.click(dialog.getByRole('button', { name: 'Вернуть на доработку' }));
  expect(await dialog.findByText('Укажите причину возврата')).toBeVisible();
  expect(reason).toHaveFocus();
  expect(transition).not.toHaveBeenCalled();
});

it('S5-02 explains pending and empty choices and lets the manager refresh them', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let available = false;
  server.use(
    http.get(api + '/profiles', async ({ request }) => {
      if (!new URL(request.url).searchParams.has('role')) {
        return HttpResponse.json([
          { id: ids.manager, display_name: 'Ирина', role: 'manager', active: true },
        ]);
      }
      await pending;
      return HttpResponse.json(
        available ? [{ id: ids.executor, display_name: 'Исполнитель теста' }] : [],
      );
    }),
  );
  await signIn('manager');
  const { user } = openPage('/objects/' + ids.object);
  await user.click(await screen.findByRole('button', { name: 'Создать задачу' }));
  const dialog = within(screen.getByRole('dialog'));
  try {
    expect(dialog.getByRole('status')).toHaveTextContent('Загружаем объекты и исполнителей');
  } finally {
    release();
  }
  expect(await dialog.findByText('Нет доступных исполнителей.')).toBeVisible();
  expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  available = true;
  await user.click(dialog.getByRole('button', { name: 'Обновить список' }));
  expect(await dialog.findByRole('option', { name: 'Исполнитель теста' })).toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
});
