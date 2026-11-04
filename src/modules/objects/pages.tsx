import { useVisitRead } from '../../shared/useVisitRead';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Building2, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react';
import { PageHeading } from '../../shared/ui/PageHeading';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useSession } from '../auth';
import { CreateTaskButton } from '../tasks';
import { ObjectDialog } from './ObjectDialog';
import { objectKey, objectListKey, readObject, readObjects } from './api';

const taskPlural = new Intl.PluralRules('ru');
function taskCount(count: number) {
  const ending = taskPlural.select(count);
  return count + ' ' + (ending === 'one' ? 'задача' : ending === 'few' ? 'задачи' : 'задач');
}

function ReadProblem({ retry }: { retry: () => void }) {
  return (
    <section className="panel">
      <p role="alert">Не удалось загрузить данные. Проверьте соединение.</p>
      <button className="button" type="button" onClick={retry}>
        Повторить
      </button>
    </section>
  );
}

export function ObjectsPage() {
  const { profile, checkSession } = useSession();
  const query = useQuery({
    queryKey: objectListKey(profile.id),
    queryFn: ({ signal }) => readObjects(signal, checkSession),
  });
  const confirmed = useVisitRead(profile.id, query);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="Реестр объектов"
        actions={
          profile.role === 'manager' && (
            <button type="button" className="button primary" onClick={() => setCreating(true)}>
              <Plus size={18} aria-hidden="true" />
              Создать объект
            </button>
          )
        }
      >
        Объекты
      </PageHeading>
      {creating && profile.role === 'manager' && (
        <ObjectDialog intent={{ mode: 'create' }} onClose={() => setCreating(false)} />
      )}
      {query.isPending || (!confirmed && !query.isError) ? (
        <p role="status">Загружаем объекты…</p>
      ) : query.isError ? (
        <ReadProblem retry={() => void query.refetch()} />
      ) : !query.data.length ? (
        <section className="panel">
          <h2>Объектов пока нет</h2>
          <p>
            {profile.role === 'manager'
              ? 'Создайте первый объект, чтобы назначать по нему задачи.'
              : 'У вас ещё нет назначенных задач. Здесь появятся их объекты.'}
          </p>
        </section>
      ) : (
        <div className="record-grid">
          {query.data.map((item) => (
            <Link
              key={item.id}
              className="record-card"
              to="/objects/$objectId"
              params={{ objectId: item.id }}
            >
              <Building2 size={23} aria-hidden="true" />
              <h2>{item.name}</h2>
              <span className="record-address">{item.address}</span>
              <span className="record-meta">
                {taskCount(item.tasks[0]?.count ?? 0)} <ArrowUpRight size={16} aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function ObjectPage({ objectId }: { objectId: string }) {
  const { profile, checkSession } = useSession();
  const query = useQuery({
    queryKey: objectKey(profile.id, objectId),
    queryFn: ({ signal }) => readObject(objectId, signal, checkSession),
  });
  const confirmed = useVisitRead(objectId, query);
  if (query.isError && (!confirmed || !query.data))
    return <ReadProblem retry={() => void query.refetch()} />;
  if (!confirmed || query.isPending) return <p role="status">Загружаем объект…</p>;
  if (!query.data) return <UnavailableObject key={objectId} />;
  return (
    <ObjectDetail
      key={objectId}
      item={query.data}
      readProblem={query.isError ? <ReadProblem retry={() => void query.refetch()} /> : null}
    />
  );
}

// The detail may disappear while the list read is offline. Drop protected data immediately.
function UnavailableObject() {
  const { profile, checkSession } = useSession();
  const cache = useQueryClient();
  const refreshList = useEffectEvent(() => {
    cache.removeQueries({ queryKey: ['user', profile.id], type: 'inactive' });
    void cache
      .fetchQuery({
        queryKey: objectListKey(profile.id),
        queryFn: ({ signal }) => readObjects(signal, checkSession),
      })
      .catch(() => undefined);
  });
  useEffect(() => {
    refreshList();
  }, []);
  return (
    <>
      <PageHeading>Запись недоступна</PageHeading>
      <div className="panel">
        <p>По этой ссылке нет доступных вам данных. Перейдите к списку, чтобы продолжить работу.</p>
        <Link to={profile.role === 'manager' ? '/objects' : '/my-tasks'} className="button">
          {profile.role === 'manager' ? 'К списку объектов' : 'К моим задачам'}
        </Link>
      </div>
    </>
  );
}

function ObjectDetail({
  item,
  readProblem,
}: {
  item: NonNullable<Awaited<ReturnType<typeof readObject>>>;
  readProblem: ReactNode;
}) {
  const { profile } = useSession();
  const [mode, setMode] = useState<'edit' | 'delete' | null>(null);
  return (
    <>
      <Link to="/objects">К списку объектов</Link>
      <PageHeading
        eyebrow="Карточка объекта"
        actions={
          profile.role === 'manager' && (
            <>
              <button type="button" className="button" onClick={() => setMode('edit')}>
                <Pencil size={16} aria-hidden="true" />
                Редактировать
              </button>
              <button type="button" className="button danger" onClick={() => setMode('delete')}>
                <Trash2 size={16} aria-hidden="true" />
                Удалить объект
              </button>
            </>
          )
        }
      >
        {item.name}
      </PageHeading>
      {readProblem}
      {mode && profile.role === 'manager' && (
        <ObjectDialog intent={{ mode, record: item }} onClose={() => setMode(null)} />
      )}
      <div className="panel">
        <p className="record-address">
          <MapPin size={18} aria-hidden="true" /> {item.address}
        </p>
      </div>
      <section>
        <header className="page-heading">
          <h2>{profile.role === 'manager' ? 'Задачи объекта' : 'Мои задачи на объекте'}</h2>
          {profile.role === 'manager' && <CreateTaskButton objectId={item.id} />}
        </header>
        {item.tasks.length === 0 ? (
          <div className="panel">
            <p>Задач пока нет.</p>
          </div>
        ) : (
          <ul aria-label="Задачи объекта" className="task-list">
            {item.tasks.map((task) => (
              <li key={task.id}>
                <Link className="task-row" to="/tasks/$taskId" params={{ taskId: task.id }}>
                  <span>{task.title}</span>
                  <StatusBadge status={task.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
