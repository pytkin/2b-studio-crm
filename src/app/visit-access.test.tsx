import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { api, client, ids, openPage, registerServer, server, signIn } from '../test/fixtures';
vi.mock('../shared/supabase', () => ({ getSupabase: () => client }));
registerServer();
it.each([
  {
    table: 'objects',
    path: '/objects/$objectId' as const,
    params: { objectId: ids.object },
    heading: 'Корпус А',
  },
  {
    table: 'tasks',
    path: '/tasks/$taskId' as const,
    params: { taskId: ids.task },
    heading: 'Подготовить чертёж',
  },
])(
  'a failed first read on a return visit to $table cannot disclose previously cached details',
  async ({ table, path, params, heading }) => {
    await signIn('executor');
    const url = '/' + table + '/' + (table === 'tasks' ? ids.task : ids.object);
    const { router } = openPage(url);
    expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
    await act(() => router.navigate({ to: '/my-tasks' }));
    expect(await screen.findByRole('heading', { name: 'Мои задачи' })).toBeVisible();
    server.use(http.get(api + '/' + table, () => HttpResponse.error()));
    await act(() => router.navigate({ to: path, params }));
    await waitFor(() => expect(screen.getByText(/Не удалось загрузить данные/)).toBeVisible());
    expect(screen.queryByRole('heading', { name: heading })).toBeNull();
  },
);
