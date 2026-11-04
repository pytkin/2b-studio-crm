import { afterEach, expect, test, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
test('отсутствующий URL останавливает создание клиента до сетевого обращения', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'synthetic-secret-marker');
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    const { getSupabase } = await import('./supabase');
    expect(() => getSupabase()).toThrowError(/^Задайте публичные параметры Supabase\.$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});
test('валидная конфигурация даёт один клиент, привилегированный ключ отвергается', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:56321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_marker');
  const { getSupabase } = await import('./supabase');
  expect(() => getSupabase()).toThrowError('Требуется публичный ключ Supabase.');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_demo');
  const client = getSupabase();
  expect(client).toBeDefined();
  expect(getSupabase()).toBe(client);
});

test.each([false, true])(
  'ссылка не устанавливает чужую сессию (сохранён вход: %s)',
  async (signedIn) => {
    const project = signedIn ? 'session-saved' : 'session-guest';
    const url = 'https://' + project + '.example';
    const storageKey = 'sb-' + project + '-auth-token';
    vi.stubEnv('VITE_SUPABASE_URL', url);
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_demo');
    const passwordSession = {
      access_token: 'access-owner-a',
      refresh_token: 'refresh-owner-a',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: { id: 'owner-a' },
    };
    const attacker = { id: 'sender-b' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (
        String(input) === url + '/auth/v1/user' &&
        new Headers(init?.headers).get('authorization') === 'Bearer access-sender-b'
      )
        return Response.json(attacker);
      if (
        String(input) === url + '/auth/v1/token?grant_type=password' &&
        JSON.parse(String(init?.body)).email === 'owner@example.test'
      )
        return Response.json(passwordSession);
      throw Error('Неизвестный запрос Auth');
    });

    if (signedIn) localStorage.setItem(storageKey, JSON.stringify(passwordSession));
    window.history.replaceState(
      null,
      '',
      '/login#access_token=access-sender-b&refresh_token=refresh-sender-b&token_type=bearer&expires_in=3600',
    );
    const { getSupabase } = await import('./supabase');
    const { auth } = getSupabase();
    try {
      const before = await auth.getSession();
      expect(before.error).toBeNull();
      expect(before.data.session?.user.id ?? null).toBe(signedIn ? 'owner-a' : null);
      expect(JSON.parse(localStorage.getItem(storageKey) ?? 'null')?.user.id ?? null).toBe(
        signedIn ? 'owner-a' : null,
      );
      expect(fetchSpy).not.toHaveBeenCalled();

      const login = await auth.signInWithPassword({
        email: 'owner@example.test',
        password: 'test-password',
      });
      expect(login.error).toBeNull();
      expect((await auth.getSession()).data.session?.user.id).toBe('owner-a');
    } finally {
      await auth.dispose();
      localStorage.removeItem(storageKey);
      window.history.replaceState(null, '', '/');
      fetchSpy.mockRestore();
    }
  },
);

test.each([
  'postgresql://postgres:private-marker@db.example/postgres',
  'https://admin:private-marker@project.example',
  'https://project.example/?key=private-marker',
  'https://project.example/#private-marker',
  'http://public.example/private-marker',
  'http://127.0.0.1.example/private-marker',
  'private-marker',
  'https://@project.example',
  'https://project.example?',
  'https://project.example#',
])('небезопасный API URL отвергается до создания клиента и запроса (%#)', async (url) => {
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_demo');
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    const { getSupabase } = await import('./supabase');
    expect(() => getSupabase()).toThrowError(/^Проверьте публичный URL API Supabase\.$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});
