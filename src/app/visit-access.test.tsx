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

it.each([
  { path: '/objects' as const, table: 'objects', title: 'Корпус А' },
  { path: '/my-tasks' as const, table: 'tasks', title: 'Подготовить чертёж' },
])(
  'returning to $path waits for the current list before showing cached records',
  async ({ path, table, title }) => {
    await signIn('executor');
    const { router } = openPage(path);
    expect(await screen.findByText(title)).toBeVisible();
    await act(() => router.navigate({ to: '/tasks/$taskId', params: { taskId: ids.task } }));
    expect(await screen.findByRole('heading', { name: 'История статусов' })).toBeVisible();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(api + '/' + table, async () => {
        await pending;
        return HttpResponse.json([]);
      }),
    );
    try {
      await act(() => router.navigate({ to: path }));
      expect(screen.queryByText(title)).not.toBeInTheDocument();
    } finally {
      release();
    }
    expect(await screen.findByRole('heading', { name: /пока нет/ })).toBeVisible();
  },
);
