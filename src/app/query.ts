import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        retry: false,
        staleTime: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

export function observeReadAccess(cache: QueryClient) {
  const refresh = async () => {
    if (document.visibilityState === 'hidden') return;
    const active = {
      type: 'active' as const,
      predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === 'user',
    };
    await cache.cancelQueries(active);
    await cache.refetchQueries(active);
  };
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
  return () => {
    window.removeEventListener('focus', refresh);
    window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}
