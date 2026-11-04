import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { actor, fixture } from './session';

export async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw Error(`Fixture RPC ${name}: ${error.code}/${error.message}`);
  return data;
}
export async function samples(label: string, statuses: string[]) {
  const { accounts, run } = fixture();
  const [manager, first, second] = await Promise.all(accounts.slice(0, 3).map(actor));
  const createObject = async (suffix: string) =>
    (
      await rpc(manager, 'create_object', {
        p_id: randomUUID(),
        p_name: `${run} ${label} ${suffix}`,
        p_address: 'Улица Строителей, 4',
      })
    ).object;
  const object = await createObject('мастерская');
  const destination = await createObject('офис');
  const rows = [];
  for (const [i, status] of statuses.entries()) {
    const assignee = (i % 2) + 1;
    let { task } = await rpc(manager, 'create_task', {
      p_id: randomUUID(),
      p_object_id: object.id,
      p_assignee_id: accounts[assignee].id,
      p_title: `${label} · ${i + 1}`,
      p_description: 'Проверить отделку',
      p_comment: 'Начальная запись',
    });
    const executor = assignee === 1 ? first : second;
    const steps =
      status === 'new'
        ? []
        : [
            'in_progress',
            ...(status === 'in_progress' ? [] : ['in_review']),
            ...(['accepted', 'rework'].includes(status) ? [status] : []),
          ];
    for (const next of steps) {
      const reviewer = ['accepted', 'rework'].includes(next);
      ({ task } = await rpc(reviewer ? manager : executor, 'transition_task', {
        p_id: task.id,
        p_expected_version: task.version,
        p_to_status: next,
        p_comment: next === 'rework' ? 'Уточнить размеры' : null,
      }));
    }
    rows.push(task);
  }
  return { manager, object, destination, rows };
}
