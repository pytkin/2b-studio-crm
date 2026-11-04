import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { client, ids, openPage, registerServer, signIn } from '../../test/fixtures';

vi.mock('../../shared/supabase', () => ({ getSupabase: () => client }));
registerServer();
it('an open page locks at token expiry even when the SDK has not emitted SIGNED_OUT', async () => {
  await signIn('executor');
  const subscribe = client.auth.onAuthStateChange.bind(client.auth);
  vi.spyOn(client.auth, 'onAuthStateChange').mockImplementation((callback) =>
    subscribe((event, session) =>
      callback(event, session ? { ...session, expires_at: (Date.now() + 400) / 1000 } : null),
    ),
  );
  const { cache } = openPage('/my-tasks');
  expect(await screen.findByRole('button', { name: 'Выйти' })).toBeVisible();
  cache.setQueryData(['user', ids.executor, 'private'], 'private-draft-marker');
  vi.spyOn(client.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null });
  expect(await screen.findByRole('heading', { name: 'Вход' }, { timeout: 1800 })).toBeVisible();
  expect(cache.getQueryData(['user', ids.executor, 'private'])).toBeUndefined();
});
