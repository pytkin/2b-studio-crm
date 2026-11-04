import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';
import {
  api,
  base,
  client,
  ids,
  objectRow,
  openPage,
  registerServer,
  server,
  signIn,
  submitLogin,
  taskRow,
} from '../../test/fixtures';

vi.mock('../../shared/supabase', () => ({ getSupabase: () => client }));
registerServer();

it('S3-01 guest on a protected link sees only login and returns to the authorized destination', async () => {
  const path = `/tasks/${ids.task}`;
  const authorizedReads: boolean[] = [];
  server.use(
    http.get(`${api}/tasks`, async ({ request }) => {
      const { data } = await client.auth.getSession();
      const authorized =
        data.session?.user.id === ids.executor &&
        request.headers.get('authorization') === `Bearer ${data.session.access_token}`;
      authorizedReads.push(authorized);
      return authorized
        ? HttpResponse.json([{ ...taskRow, objects: objectRow, task_status_history: [] }])
        : HttpResponse.json([], { status: 401 });
    }),
  );
  const { router, user } = openPage(path);
  expect(await screen.findByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: taskRow.title })).not.toBeInTheDocument();
  expect(authorizedReads).toEqual([]);
  await submitLogin(user, 'executor');
  expect(await screen.findByRole('heading', { name: taskRow.title })).toBeVisible();
  expect(router.state.location.pathname).toBe(path);
  expect(authorizedReads).toContain(true);
  expect(authorizedReads).not.toContain(false);
});
it('S3-02 old account cache and its late response are removed before a new login', async () => {
  await signIn('executor');
  const { user, cache } = openPage('/my-tasks');
  const exitButton = await screen.findByRole('button', { name: 'Выйти' });
  const oldKey = ['user', ids.executor, 'old-record'];
  cache.setQueryData(oldKey, 'Данные первого аккаунта');
  let release!: (value: string) => void;
  const pending = cache
    .fetchQuery({
      queryKey: ['user', ids.executor, 'pending'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    })
    .catch(() => undefined);
  await user.click(exitButton);
  expect(await screen.findByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(cache.getQueryData(oldKey)).toBeUndefined();
  await submitLogin(user, 'manager');
  expect(await screen.findByRole('heading', { name: 'Объекты' })).toBeVisible();
  release('Старый ответ');
  await pending;
  expect(cache.getQueryData(['user', ids.executor, 'pending'])).toBeUndefined();
  expect(screen.queryByText('Старый ответ')).not.toBeInTheDocument();
});

it('does not send empty credentials and hides backend messages for invalid login', async () => {
  const auth = vi.fn(() =>
    HttpResponse.json(
      { error: 'invalid_grant', error_description: 'private-debug' },
      { status: 400 },
    ),
  );
  server.use(http.post(`${base}/auth/v1/token`, auth));
  const { user } = openPage('/login');
  await user.click(await screen.findByRole('button', { name: 'Войти' }));
  expect(await screen.findByText('Введите пароль')).toBeVisible();
  expect(auth).not.toHaveBeenCalled();
  await submitLogin(user, 'executor');
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Проверьте электронную почту и пароль',
  );
  expect(screen.queryByText(/private-debug/)).not.toBeInTheDocument();
  expect(auth).toHaveBeenCalledTimes(1);
});
it('does not mount business screens without an active profile', async () => {
  await signIn('executor');
  server.use(http.get(`${api}/profiles`, () => HttpResponse.json([])));
  openPage('/my-tasks');
  expect(await screen.findByRole('heading', { name: 'Профиль недоступен' })).toBeVisible();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});
it('confirmed invalid session on a profile read returns to login and clears cache', async () => {
  await signIn('executor');
  const { cache } = openPage('/my-tasks');
  expect(await screen.findByRole('button', { name: 'Выйти' })).toBeVisible();
  cache.setQueryData(['user', ids.executor, 'draft'], 'Защищённый текст');
  server.use(
    http.get(`${api}/profiles`, () => HttpResponse.json({ code: 'PGRST301' }, { status: 401 })),
    http.get(`${base}/auth/v1/user`, () =>
      HttpResponse.json({ error: 'invalid_token' }, { status: 401 }),
    ),
  );
  await cache.invalidateQueries({ queryKey: ['user', ids.executor, 'profile'] });
  expect(await screen.findByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(cache.getQueryData(['user', ids.executor, 'draft'])).toBeUndefined();
});

it('confirmed session loss hides the previous account while remote sign-out is still pending', async () => {
  await signIn('executor');
  const { cache } = openPage('/my-tasks');
  expect(await screen.findByText('Подготовить чертёж')).toBeVisible();
  cache.setQueryData(['user', ids.executor, 'draft'], 'Защищённый текст');
  let release!: () => void;
  const logout = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get(`${api}/tasks`, () => HttpResponse.json({ code: 'PGRST301' }, { status: 401 })),
    http.get(`${base}/auth/v1/user`, () =>
      HttpResponse.json({ error: 'invalid_token' }, { status: 401 }),
    ),
    http.post(`${base}/auth/v1/logout`, async () => {
      await logout;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  try {
    await act(() => cache.invalidateQueries({ queryKey: ['user', ids.executor, 'my-tasks'] }));
    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeVisible();
    expect(cache.getQueryData(['user', ids.executor, 'draft'])).toBeUndefined();
  } finally {
    release();
  }
});

it('preserves the current draft across a failed background profile check and a successful retry', async () => {
  await signIn('manager');
  const { cache, user } = openPage(`/objects/${ids.object}`);
  await user.click(await screen.findByRole('button', { name: 'Редактировать' }));
  await user.type(within(screen.getByRole('dialog')).getByLabelText('Название'), ' черновик');
  server.use(http.get(`${api}/profiles`, () => HttpResponse.error()));
  await act(() => cache.invalidateQueries({ queryKey: ['user', ids.manager, 'profile'] }));
  expect(await screen.findByRole('heading', { name: 'Не удалось проверить доступ' })).toBeVisible();
  expect(screen.queryByRole('dialog', { name: 'Редактировать объект' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Проверить снова' })).toHaveFocus();
  await user.tab();
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Выйти' })).toHaveFocus();
  server.resetHandlers();
  await user.click(screen.getByRole('button', { name: 'Проверить снова' }));
  const restored = within(await screen.findByRole('dialog'));
  expect(restored.getByLabelText('Название')).toHaveValue('Корпус А черновик');
  expect(restored.getByLabelText('Название')).toHaveFocus();
});

it('a background profile outage does not abort a submitted object write or lose its receipt', async () => {
  await signIn('manager');
  const { cache, user, router } = openPage('/objects');
  await user.click(await screen.findByRole('button', { name: 'Создать объект' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Название'), 'Павильон');
  await user.type(dialog.getByLabelText('Адрес'), 'Проспект, 5');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let id = '';
  const create = vi.fn(async ({ request }: { request: Request }) => {
    id = (await request.json()).p_id;
    await held;
    return HttpResponse.json({
      object: { id, name: 'Павильон', address: 'Проспект, 5', version: 1 },
    });
  });
  server.use(http.post(`${api}/rpc/create_object`, create));
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  try {
    server.use(http.get(`${api}/profiles`, () => HttpResponse.error()));
    await act(() => cache.invalidateQueries({ queryKey: ['user', ids.manager, 'profile'] }));
    expect(
      await screen.findByRole('heading', { name: 'Не удалось проверить доступ' }),
    ).toBeVisible();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Проверить снова' }));
  } finally {
    release();
  }
  await waitFor(() => expect(router.state.location.pathname).toBe(`/objects/${id}`));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(create).toHaveBeenCalledTimes(1);
});
