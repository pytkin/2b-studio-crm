import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';
import {
  api,
  base,
  client,
  ids,
  openPage,
  registerServer,
  server,
  signIn,
  submitLogin,
} from '../../test/fixtures';

vi.mock('../../shared/supabase', () => ({ getSupabase: () => client }));
registerServer();

it('S3-01 guest on a protected link sees only login and returns to the authorized destination', async () => {
  const path = `/tasks/${ids.task}`;
  const { router, user } = openPage(path);
  expect(await screen.findByRole('heading', { name: 'Вход' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Задача' })).not.toBeInTheDocument();
  await submitLogin(user, 'executor');
  await waitFor(() => expect(router.state.location.pathname).toBe(path));
  expect(await screen.findByRole('button', { name: 'Выйти' })).toBeVisible();
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
