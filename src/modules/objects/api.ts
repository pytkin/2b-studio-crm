import { collectPages, pageSize } from '../../shared/pagination';
import type { Tables } from '../../shared/database.types';
import { getSupabase } from '../../shared/supabase';

export type ObjectRecord = Pick<Tables<'objects'>, 'id' | 'name' | 'address' | 'version'>;
type CheckSession = () => Promise<void>;

export const objectListKey = (userId: string) => ['user', userId, 'objects'] as const;
export const objectKey = (userId: string, objectId: string) =>
  ['user', userId, 'object', objectId] as const;

export async function readObjects(signal: AbortSignal, checkSession: CheckSession) {
  return collectPages(async (from, to) => {
    const { data, error, status } = await getSupabase()
      .from('objects')
      .select('id,name,address,version,tasks(count)')
      .order('name')
      .order('id')
      .range(from, to)
      .abortSignal(signal)
      .retry(false);
    if (status === 401 && !signal.aborted) await checkSession();
    if (error) throw error;
    return data;
  });
}

async function objectPage(
  from: number,
  to: number,
  objectId: string,
  signal: AbortSignal,
  checkSession: CheckSession,
) {
  const { data, error, status } = await getSupabase()
    .from('objects')
    .select('id,name,address,version,tasks(id,title,status)')
    .eq('id', objectId)
    .order('title', { referencedTable: 'tasks' })
    .order('id', { referencedTable: 'tasks' })
    .range(from, to, { referencedTable: 'tasks' })
    .limit(1)
    .abortSignal(signal)
    .retry(false);
  if (status === 401 && !signal.aborted) await checkSession();
  if (error?.code === '22P02') return null;
  if (error) throw error;
  return data[0] ?? null;
}

export async function readObject(
  objectId: string,
  signal: AbortSignal,
  checkSession: CheckSession,
) {
  const first = await objectPage(0, pageSize - 1, objectId, signal, checkSession);
  if (!first || first.tasks.length < pageSize) return first;
  let visible = true;
  const tasks = await collectPages(async (from, to) => {
    if (from === 0) return first.tasks;
    const next = await objectPage(from, to, objectId, signal, checkSession);
    if (!next) visible = false;
    return next?.tasks ?? [];
  });
  return visible ? { ...first, tasks } : null;
}
