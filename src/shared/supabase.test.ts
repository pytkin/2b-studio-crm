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
