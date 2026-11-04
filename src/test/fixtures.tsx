import { createClient } from '@supabase/supabase-js';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { makeQueryClient } from '../app/query';
import { makeRouter } from '../app/router';

export const base = 'http://crm.example.test';
export const api = `${base}/rest/v1`;
export const ids = {
  manager: 'e0000000-0000-4000-8000-000000000001',
  executor: 'e0000000-0000-4000-8000-000000000002',
  object: 'a0000000-0000-4000-8000-000000000001',
  task: 'b0000000-0000-4000-8000-000000000001',
};
export const objectRow = {
  id: ids.object,
  name: 'Корпус А',
  address: 'Большая улица, 4',
  version: 1,
};
export const taskRow = {
  id: ids.task,
  title: 'Подготовить чертёж',
  description: 'Узел фасада',
  object_id: ids.object,
  assignee_id: ids.executor,
  status: 'accepted',
  author_id: ids.manager,
  author_name: 'Ирина',
  created_at: '2026-11-01T09:00:00Z',
  version: 3,
};
export const firstEvent = {
  id: 1,
  task_id: ids.task,
  actor_id: ids.manager,
  actor_name: 'Ирина',
  occurred_at: taskRow.created_at,
  from_status: null,
  to_status: 'new',
  comment: 'По эскизу',
};
export const lastEvent = {
  ...firstEvent,
  id: 2,
  to_status: 'accepted',
  from_status: 'in_review',
  comment: 'Согласовано',
};
type Role = 'manager' | 'executor';
export let client: ReturnType<typeof createClient>;
let role: Role = 'executor';
function token(role: Role) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('/', '_').replaceAll('+', '-');
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: ids[role], role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
    encode('fixture'),
  ].join('.');
}
const profile = (r: Role) => ({
  id: ids[r],
  display_name: r === 'manager' ? 'Ирина' : 'Евгений',
  role: r,
  active: true,
});
export const server = setupServer(
  http.post(`${base}/auth/v1/token`, () =>
    HttpResponse.json({
      access_token: token(role),
      refresh_token: crypto.randomUUID(),
      expires_in: 3600,
      token_type: 'bearer',
      user: {
        id: ids[role],
        aud: 'authenticated',
        email: `${role}@example.test`,
        user_metadata: {},
        app_metadata: {},
      },
    }),
  ),
  http.post(`${base}/auth/v1/logout`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${api}/profiles`, ({ request }) =>
    HttpResponse.json([profile(new URL(request.url).searchParams.has('role') ? 'executor' : role)]),
  ),
  http.get(`${api}/objects`, ({ request }) =>
    HttpResponse.json([
      {
        ...objectRow,
        tasks: new URL(request.url).searchParams.has('id') ? [taskRow] : [{ count: 1 }],
      },
    ]),
  ),
  http.get(`${api}/tasks`, () =>
    HttpResponse.json([
      { ...taskRow, objects: objectRow, task_status_history: [firstEvent, lastEvent] },
    ]),
  ),
  http.get(`${api}/task_status_history`, () => HttpResponse.json([firstEvent, lastEvent])),
);
export function registerServer() {
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  beforeEach(() => {
    role = 'executor';
    client = createClient(base, 'fixture-public', {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: crypto.randomUUID() },
    });
  });
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}
export function setRole(value: Role) {
  role = value;
}
export async function signIn(r: Role) {
  role = r;
  const { error } = await client.auth.signInWithPassword({
    email: `${r}@example.test`,
    password: crypto.randomUUID(),
  });
  if (error) throw error;
}
export function openPage(path: string) {
  const router = makeRouter(createMemoryHistory({ initialEntries: [path] }));
  const cache = makeQueryClient();
  const view = render(
    <QueryClientProvider client={cache}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, cache, ...view, user: userEvent.setup() };
}
export async function submitLogin(user: ReturnType<typeof userEvent.setup>, r: Role) {
  role = r;
  await user.type(await screen.findByLabelText('Электронная почта'), `${r}@example.test`);
  await user.type(screen.getByLabelText('Пароль'), crypto.randomUUID());
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}
