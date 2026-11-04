import type { QueryClient } from '@tanstack/react-query';
import { collectPages, pageSize } from '../../shared/pagination';
import { getSupabase } from '../../shared/supabase';

export function taskKey(user: string, id: string) {
  return ['user', user, 'task', id] as const;
}
export function mineKey(user: string) {
  return ['user', user, 'my-tasks'] as const;
}
async function taskPage(id: string, from: number, to: number, signal?: AbortSignal) {
  let query = getSupabase()
    .from('tasks')
    .select(
      '*,objects(id,name),assignee:profiles!tasks_assignee_id_fkey(display_name),task_status_history(*)',
    )
    .eq('id', id)
    .order('id', { referencedTable: 'task_status_history', ascending: true })
    .range(from, to, { referencedTable: 'task_status_history' })
    .retry(false);
  if (signal) query = query.abortSignal(signal);
  const { data, error, status } = await query.maybeSingle();
  if (error) throw new ReadFailure(status);
  return data;
}
export async function readTask(id: string, signal?: AbortSignal) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return null;
  const first = await taskPage(id, 0, pageSize - 1, signal);
  if (!first || first.task_status_history.length < pageSize) return first;
  let visible = true;
  const history = await collectPages(async (from, to) => {
    if (from === 0) return first.task_status_history;
    const next = await taskPage(id, from, to, signal);
    if (!next) {
      visible = false;
      return [];
    }
    if (next.version !== first.version) throw new ReadFailure(409);
    return next.task_status_history;
  });
  return visible ? { ...first, task_status_history: history } : null;
}
export class ReadFailure extends Error {
  constructor(public readonly status: number) {
    super('Не удалось загрузить данные.');
  }
}
export type Task = NonNullable<Awaited<ReturnType<typeof readTask>>>;
export async function readMine(user: string, signal: AbortSignal) {
  return collectPages(async (from, to) => {
    const { data, error, status } = await getSupabase()
      .from('tasks')
      .select('id,title,status,objects(id,name)')
      .eq('assignee_id', user)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)
      .abortSignal(signal)
      .retry(false);
    if (error) throw new ReadFailure(status);
    return data;
  });
}
export function refreshLists(cache: QueryClient, user: string) {
  const affected = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === 'user' &&
      query.queryKey[1] === user &&
      ['objects', 'object', 'my-tasks', 'task-choices'].includes(String(query.queryKey[2])),
  };
  cache.removeQueries({ ...affected, type: 'inactive' });
  return cache.invalidateQueries(affected);
}
export const formatTime = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
