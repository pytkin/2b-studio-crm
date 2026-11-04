import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeading } from '../../shared/ui/PageHeading';
import { StatusBadge, statusLabels } from '../../shared/ui/StatusBadge';
import { useVisitRead } from '../../shared/useVisitRead';
import { useSession } from '../auth';
import { DeleteTask } from './DeleteTask';
import {
  formatTime,
  mineKey,
  ReadFailure,
  readMine,
  readTask,
  refreshLists,
  type Task,
  taskKey,
} from './data';
import { TaskForm } from './TaskForm';
import { Transitions } from './Transitions';

function ReadProblem({ error, retry }: { error: Error; retry: () => void }) {
  const { checkSession } = useSession();
  useEffect(() => {
    if (error instanceof ReadFailure && error.status === 401) void checkSession();
  }, [error, checkSession]);
  return (
    <div className="panel" role="alert">
      <p>Не удалось загрузить данные. Проверьте соединение.</p>
      <button className="button" type="button" onClick={retry}>
        Повторить чтение
      </button>
    </div>
  );
}
export function MyTasksPage() {
  const { profile } = useSession();
  const query = useQuery({
    queryKey: mineKey(profile.id),
    queryFn: ({ signal }) => readMine(profile.id, signal),
  });
  const confirmed = useVisitRead(profile.id, query);
  return (
    <>
      <PageHeading eyebrow="Рабочий журнал">Мои задачи</PageHeading>
      {query.isPending || (!confirmed && !query.isError) ? (
        <p role="status">Загружаем задачи…</p>
      ) : query.isError ? (
        <ReadProblem error={query.error} retry={() => void query.refetch()} />
      ) : query.data.length ? (
        <div className="task-list">
          {query.data.map((row) => (
            <Link key={row.id} className="task-row" to="/tasks/$taskId" params={{ taskId: row.id }}>
              <div>
                <strong>{row.title}</strong>
                <p>{row.objects?.name}</p>
              </div>
              <StatusBadge status={row.status} />
              <ArrowUpRight size={16} />
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel">
          <h2>Назначенных задач пока нет</h2>
          <p>Здесь появятся задачи, которые вам поручит постановщик.</p>
        </div>
      )}
    </>
  );
}
export function TaskPage({ taskId }: { taskId: string }) {
  const { profile } = useSession();
  const query = useQuery({
    queryKey: taskKey(profile.id, taskId),
    queryFn: ({ signal }) => readTask(taskId, signal),
    refetchOnMount: 'always',
  });
  const cache = useQueryClient();
  useEffect(() => {
    if (query.data === null) void refreshLists(cache, profile.id);
  }, [query.data, cache, profile.id]);
  const confirmed = useVisitRead(taskId, query);
  if (query.isError && (!confirmed || !query.data))
    return <ReadProblem error={query.error} retry={() => void query.refetch()} />;
  if (!confirmed || query.isPending) return <p role="status">Загружаем задачу…</p>;
  if (!query.data) return <PageHeading>Запись недоступна</PageHeading>;
  return (
    <>
      {query.isError && <ReadProblem error={query.error} retry={() => void query.refetch()} />}
      <TaskDetail task={query.data} />
    </>
  );
}
function TaskDetail({ task }: { task: Task }) {
  const { profile } = useSession();
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  return (
    <>
      <Link to="/objects/$objectId" params={{ objectId: task.object_id }}>
        ← {task.objects?.name ?? 'К объекту'}
      </Link>
      <PageHeading
        eyebrow="Карточка задачи"
        actions={
          profile.role === 'manager' && (
            <>
              <button className="button" type="button" onClick={() => setEdit(true)}>
                <Pencil size={16} aria-hidden="true" />
                Редактировать
              </button>
              <button type="button" className="button danger" onClick={() => setRemove(true)}>
                <Trash2 size={16} aria-hidden="true" />
                Удалить задачу
              </button>
            </>
          )
        }
      >
        {task.title}
      </PageHeading>
      {remove && <DeleteTask task={task} onClose={() => setRemove(false)} />}
      {edit && <TaskForm task={task} objectId={task.object_id} onClose={() => setEdit(false)} />}
      <section className="panel">
        <StatusBadge status={task.status} />
        <h2>Сведения о задаче</h2>
        <dl className="detail-grid">
          <div>
            <dt>Постановщик</dt>
            <dd>{task.author_name}</dd>
          </div>
          <div>
            <dt>Исполнитель</dt>
            <dd>
              {task.assignee?.display_name ??
                (task.assignee_id === profile.id ? profile.display_name : 'Профиль недоступен')}
            </dd>
          </div>
          <div>
            <dt>Создана</dt>
            <dd>
              <time dateTime={task.created_at}>{formatTime(task.created_at)}</time>
            </dd>
          </div>
          <div>
            <dt>Объект</dt>
            <dd>{task.objects?.name}</dd>
          </div>
        </dl>
        {task.description && (
          <div>
            <h3>Описание</h3>
            <p>{task.description}</p>
          </div>
        )}
      </section>
      <Transitions task={task} />
      <section className="panel">
        <h2>История статусов</h2>
        <ol className="history" aria-label="История статусов">
          {task.task_status_history.map((event) => (
            <li key={event.id}>
              <strong>
                {event.from_status ? `${statusLabels[event.from_status]} → ` : 'Создание → '}
                {statusLabels[event.to_status]}
              </strong>
              <p>
                {event.actor_name} ·{' '}
                <time dateTime={event.occurred_at}>{formatTime(event.occurred_at)}</time>
              </p>
              {event.comment && <p>{event.comment}</p>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
