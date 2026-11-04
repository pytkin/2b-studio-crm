import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { collectPages } from '../../shared/pagination';
import { getSupabase } from '../../shared/supabase';
import { Modal } from '../../shared/ui/Modal';
import { useSession } from '../auth';
import type { Task } from './data';
import { domainMessage, useTaskReadback } from './useTaskReadback';

const schema = z.object({
  title: z.string().trim().min(1, 'Укажите название'),
  object_id: z.string().min(1, 'Выберите объект'),
  assignee_id: z.string().min(1, 'Выберите исполнителя'),
  description: z.string(),
  comment: z.string(),
});
type Values = z.infer<typeof schema>;
function Field({
  name,
  label,
  error,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {error && (
        <span id={`${name}-error`} className="form-error">
          {error}
        </span>
      )}
    </div>
  );
}
export function CreateTaskButton({ objectId }: { objectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button primary" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Создать задачу
      </button>
      {open && <TaskForm objectId={objectId} onClose={() => setOpen(false)} />}
    </>
  );
}
export function TaskForm({
  task,
  objectId,
  onClose,
}: {
  task?: Task;
  objectId: string;
  onClose: () => void;
}) {
  const { profile } = useSession();
  const navigate = useNavigate();
  const [id] = useState(() => task?.id ?? crypto.randomUUID());
  const [base, setBase] = useState(task);
  const [unknown, setUnknown] = useState<Values | null>(null);
  const [needsRead, setNeedsRead] = useState(false);
  const [note, setNote] = useState('');
  const verify = useTaskReadback(id);
  const choices = useQuery({
    queryKey: ['user', profile.id, 'task-choices'],
    queryFn: async ({ signal }) => {
      const db = getSupabase();
      const [objects, people] = await Promise.all([
        collectPages(async (from, to) => {
          const { data, error } = await db
            .from('objects')
            .select('id,name')
            .order('name')
            .order('id')
            .range(from, to)
            .abortSignal(signal)
            .retry(false);
          if (error) throw Error('Не удалось загрузить объекты.');
          return data;
        }),
        collectPages(async (from, to) => {
          const { data, error } = await db
            .from('profiles')
            .select('id,display_name')
            .eq('role', 'executor')
            .eq('active', true)
            .order('display_name')
            .order('id')
            .range(from, to)
            .abortSignal(signal)
            .retry(false);
          if (error) throw Error('Не удалось загрузить исполнителей.');
          return data;
        }),
      ]);
      return { objects, people };
    },
  });
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      object_id: objectId,
      assignee_id: task?.assignee_id ?? '',
      comment: '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const unavailable =
    choices.data &&
    (!choices.data.objects.length
      ? 'Нет доступных объектов.'
      : !choices.data.people.length
        ? 'Нет доступных исполнителей.'
        : '');
  function attrs(key: keyof Values) {
    return {
      ...form.register(key),
      id: `task-${key}`,
      required: key === 'title' || key === 'object_id' || key === 'assignee_id',
      'aria-invalid': !!errors[key],
      'aria-describedby': errors[key] ? `task-${key}-error` : undefined,
    };
  }
  async function refreshChoices() {
    const fresh = await choices.refetch();
    if (!verify.alive.current || fresh.isError || !fresh.data) return;
    const values = form.getValues();
    const missingObject =
      values.object_id && !fresh.data.objects.some((o) => o.id === values.object_id);
    const missingPerson =
      values.assignee_id && !fresh.data.people.some((p) => p.id === values.assignee_id);
    if (missingObject) form.setValue('object_id', '');
    if (missingPerson) form.setValue('assignee_id', '');
    if (missingObject || missingPerson) {
      setNote(
        'Объект или исполнитель больше недоступен. Проверьте выбор и подтвердите сохранение.',
      );
    }
  }
  async function saved() {
    if (!verify.alive.current) return;
    await verify.refresh();
    if (!verify.alive.current) return;
    onClose();
    await navigate({ to: '/tasks/$taskId', params: { taskId: id } });
  }
  async function reconcile(values: Values) {
    setNeedsRead(true);
    try {
      const row = await verify.read();
      if (!verify.alive.current) return;
      if (
        !task &&
        row &&
        row.task_status_history.some((e) => e.from_status === null && e.to_status === 'new')
      ) {
        await saved();
        return;
      }
      if (task && row) {
        const same =
          row.title === values.title &&
          row.description === values.description &&
          row.assignee_id === values.assignee_id &&
          row.object_id === values.object_id;
        if (same) {
          await saved();
          return;
        }
        setBase(row);
        setUnknown(null);
        setNote('Данные изменились. Сверьте текущие поля и подтвердите правку.');
      } else if (!task && !row) {
        setUnknown(values);
        setNote('Запись пока не найдена. Можно повторить создание с прежними полями.');
      } else {
        setNote('Не удалось подтвердить сохранение. Проверьте результат ещё раз.');
        return;
      }
      setNeedsRead(false);
    } catch {
      setNote('Результат неизвестен. Восстановите соединение и проверьте результат.');
    }
  }
  const submit = form.handleSubmit(async (values) => {
    setNote('');
    if (needsRead) {
      await reconcile(unknown ?? values);
      return;
    }
    const args = unknown ?? values;
    try {
      if (base) {
        const current = await verify.read();
        if (!current || !verify.alive.current) return;
        if (current.version !== base.version) {
          setBase(current);
          setNote('Данные изменились. Сверьте текущие поля и подтвердите правку.');
          return;
        }
      }
      if (!(await verify.canSend())) return;
      const fields = {
        p_id: id,
        p_title: args.title,
        p_object_id: args.object_id,
        p_assignee_id: args.assignee_id,
        p_description: args.description,
      };
      const { error, status } = base
        ? await getSupabase()
            .rpc('update_task', { ...fields, p_expected_version: base.version })
            .retry(false)
        : await getSupabase()
            .rpc('create_task', { ...fields, p_comment: args.comment })
            .retry(false);
      if (!verify.alive.current) return;
      if (!error) {
        if (base) await verify.read();
        await saved();
        return;
      }
      if (status === 401) {
        await verify.checkSession();
        setNote('Не удалось подтвердить сессию.');
        return;
      }
      if (error.message === 'UNAVAILABLE' || error.message === 'INVALID_INPUT') {
        if (error.message === 'UNAVAILABLE' && task && !(await verify.read())) return;
        setUnknown(null);
        setNeedsRead(false);
        setNote(
          error.message === 'INVALID_INPUT'
            ? 'Проверьте поля и повторите сохранение.'
            : 'Объект или исполнитель больше недоступен. Проверьте выбор и подтвердите сохранение.',
        );
        await refreshChoices();
        return;
      }
      if (error.message === 'FORBIDDEN') {
        setNote('Это действие недоступно для вашей роли.');
        await verify.recheckAccess();
        return;
      }
      if (!task && unknown && error.message === 'ID_UNAVAILABLE') {
        await reconcile(args);
        return;
      }
      const domain = domainMessage(error.message);
      if (domain) {
        setNote(domain);
        return;
      }
      setUnknown(args);
      await reconcile(args);
    } catch {
      setUnknown(args);
      await reconcile(args);
    }
  });
  return (
    <Modal
      title={task ? 'Редактировать задачу' : 'Создать задачу'}
      description="Заполните название, объект и исполнителя. Остальные поля необязательны."
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <form onSubmit={submit} noValidate>
        <fieldset disabled={isSubmitting || !!unknown || needsRead}>
          <Field name="task-title" label="Название" error={errors.title?.message}>
            <input {...attrs('title')} />
          </Field>
          <Field name="task-description" label="Описание">
            <textarea {...attrs('description')} />
          </Field>
          <Field name="task-object_id" label="Объект" error={errors.object_id?.message}>
            <select {...attrs('object_id')} key={choices.data ? 'ready' : 'loading'}>
              <option value="">Выберите объект</option>
              {choices.data?.objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field name="task-assignee_id" label="Исполнитель" error={errors.assignee_id?.message}>
            <select {...attrs('assignee_id')} key={choices.data ? 'ready' : 'loading'}>
              <option value="">Не выбран</option>
              {choices.data?.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </Field>
          {!task && (
            <Field name="task-comment" label="Комментарий к созданию">
              <textarea {...attrs('comment')} />
            </Field>
          )}
        </fieldset>
        {choices.isPending && <p role="status">Загружаем объекты и исполнителей…</p>}
        {unavailable && !choices.isError && (
          <div>
            <p role="status">{unavailable}</p>
            <button type="button" className="button" onClick={() => void refreshChoices()}>
              Обновить список
            </button>
          </div>
        )}
        {choices.isError && (
          <p role="alert">
            Не удалось загрузить объекты и исполнителей.{' '}
            <button type="button" className="button" onClick={() => void refreshChoices()}>
              Повторить чтение
            </button>
          </p>
        )}
        {note && (
          <div role="alert">
            <p>{note}</p>
            {base && (
              <p>
                Сейчас в карточке: {base.title} · {base.description || 'Без описания'} ·{' '}
                {base.objects?.name} · {base.assignee?.display_name}
              </p>
            )}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              isSubmitting || (!needsRead && (choices.isError || !choices.data || !!unavailable))
            }
          >
            {isSubmitting
              ? 'Проверяем…'
              : needsRead
                ? 'Проверить результат'
                : unknown
                  ? 'Повторить создание'
                  : note && base
                    ? 'Подтвердить правку'
                    : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
