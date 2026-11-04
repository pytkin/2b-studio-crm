import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { getSupabase } from '../../shared/supabase';
import { useSession } from '../auth';
import { ReadFailure, readTask, refreshLists, taskKey } from './data';

export function useTaskReadback(id: string) {
  const cache = useQueryClient();
  const { profile, checkSession, recheckAccess } = useSession();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function read() {
    const key = taskKey(profile.id, id);
    await cache.cancelQueries({ queryKey: key, exact: true });
    if (!alive.current) throw Error('Закрыто');
    try {
      const row = await cache.fetchQuery({
        queryKey: key,
        queryFn: ({ signal }) => readTask(id, signal),
        staleTime: 0,
      });
      if (!row && alive.current) await refreshLists(cache, profile.id);
      return row;
    } catch (e) {
      if (e instanceof ReadFailure && e.status === 401 && alive.current) await checkSession();
      throw e;
    }
  }
  async function canSend() {
    const {
      data: { session },
    } = await getSupabase().auth.getSession();
    return alive.current && session?.user.id === profile.id;
  }
  function revoke() {
    if (!alive.current) return;
    const key = taskKey(profile.id, id);
    void cache.cancelQueries({ queryKey: key, exact: true });
    cache.setQueryData(key, null);
    void refreshLists(cache, profile.id);
  }
  return {
    read,
    canSend,
    alive,
    revoke,
    refresh: () => refreshLists(cache, profile.id),
    checkSession,
    recheckAccess,
  };
}

export function domainMessage(message: string) {
  switch (message) {
    case 'INVALID_INPUT':
      return 'Проверьте поля и повторите сохранение.';
    case 'ID_UNAVAILABLE':
      return 'Этот идентификатор уже занят. Закройте форму и начните новое создание.';
    case 'FORBIDDEN':
      return 'Это действие недоступно для вашей роли.';
    case 'INVALID_TRANSITION':
      return 'Этот переход больше недоступен.';
    default:
      return undefined;
  }
}
