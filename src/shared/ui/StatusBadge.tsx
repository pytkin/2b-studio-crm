import type { Enums } from '../database.types';
export const statusLabels: Record<Enums<'task_status'>, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  in_review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
};
export function StatusBadge({ status }: { status: Enums<'task_status'> }) {
  return (
    <span className="badge" data-status={status}>
      {statusLabels[status]}
    </span>
  );
}
