import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';
import { api, ids, openPage, registerServer, server, signIn } from '../../test/fixtures';

vi.mock('../../shared/supabase', async () => {
  const fixture = await import('../../test/fixtures');
  return { getSupabase: () => fixture.client };
});
registerServer();

it.each([
  { role: 'executor' as const, to: '/my-tasks', name: 'К моим задачам', heading: 'Мои задачи' },
  { role: 'manager' as const, to: '/objects', name: 'К списку объектов', heading: 'Объекты' },
])(
  'S5-03 unavailable task guides $role to an available list',
  async ({ role, to, name, heading }) => {
    server.use(http.get(`${api}/tasks`, () => HttpResponse.json([])));
    await signIn(role);
    const { user } = openPage(`/tasks/${ids.task}`);

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
