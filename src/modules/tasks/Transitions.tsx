import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { Enums } from '../../shared/database.types';
import { getSupabase } from '../../shared/supabase';
import { Modal } from '../../shared/ui/Modal';
import { useSession } from '../auth';
import type { Task } from './data';
import { domainMessage, useTaskReadback } from './useTaskReadback';

type Status = Enums<'task_status'>;
function actions(task: Task, user: string, role: string): { target: Status; label: string }[] {
  if (role === 'executor' && task.assignee_id === user) {
    if (task.status === 'new' || task.status === 'rework')
      return [{ target: 'in_progress', label: 'Взять в работу' }];
    if (task.status === 'in_progress')
      return [{ target: 'in_review', label: 'Отправить на проверку' }];
  }
  if (role === 'manager' && task.status === 'in_review')
    return [
      { target: 'accepted', label: 'Принять' },
      { target: 'rework', label: 'Вернуть на доработку' },
    ];
  return [];
}
export function Transitions({ task }: { task: Task }) {
  const { profile } = useSession();
  const verify = useTaskReadback(task.id);
  const [comment, setComment] = useState('');
  const [initialVersion, setInitialVersion] = useState<number>();
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  const allowed = actions(task, profile.id, profile.role);
  async function reconcile() {
    setUncertain(true);
    try {
      const row = await verify.read();
      if (!row || !verify.alive.current) return;
      setInitialVersion(row.version);
      setUncertain(false);
      setMessage('Карточка и история обновлены. Проверьте текущий статус.');
    } catch {
      setMessage('Результат неизвестен. Восстановите соединение и проверьте результат.');
    }
  }
  async function submit(target: Status, text = comment) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    try {
      const current = await verify.read();
      if (!current || !verify.alive.current) return;
      if (
        current.version !== (initialVersion ?? task.version) ||
        !actions(current, profile.id, profile.role).some((action) => action.target === target)
      ) {
        setInitialVersion(current.version);
        setMessage('Задача изменилась. Сверьте статус и подтвердите действие ещё раз.');
        return;
      }
      if (!(await verify.canSend())) return;
      const { error, status } = await getSupabase()
        .rpc('transition_task', {
          p_id: task.id,
          p_to_status: target,
          p_expected_version: current.version,
          p_comment: text.trim(),
        })
        .retry(false);
      if (!verify.alive.current) return;
      if (error) {
        if (error.message === 'UNAVAILABLE') {
          verify.revoke();
          return;
        }
        if (status === 401) {
          await verify.checkSession();
          setMessage('Не удалось подтвердить сессию.');
          return;
        }
        await reconcile();
        const domain = domainMessage(error.message);
        if (domain) setMessage(domain);
        return;
      }
      setComment('');
      setInitialVersion(undefined);
      await verify.refresh();
      await verify.read();
    } catch {
      await reconcile();
    } finally {
      locked.current = false;
      if (verify.alive.current) setBusy(false);
    }
  }
  if (!allowed.length && !message && !uncertain) return null;
  return (
    <section className="panel">
      <h2>Работа с задачей</h2>
      {allowed.length > 0 && (
        <div className="field">
          <label htmlFor="status-comment">Комментарий</label>
          <textarea
            id="status-comment"
            value={comment}
            disabled={busy || uncertain}
            onChange={(e) => {
              if (initialVersion === undefined) setInitialVersion(task.version);
              setComment(e.target.value);
            }}
          />
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <div className="actions">
        {uncertain ? (
          <button type="button" className="button" disabled={busy} onClick={() => void reconcile()}>
            Проверить результат
          </button>
        ) : (
          allowed.map((action) => (
            <button
              type="button"
              key={action.target}
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (action.target === 'rework') {
                  setInitialVersion(initialVersion ?? task.version);
                  setReturning(true);
                } else void submit(action.target);
              }}
            >
              {action.label}
            </button>
          ))
        )}
      </div>
      {returning && (
        <ReturnDialog
          initial={comment}
          onClose={() => setReturning(false)}
          onSubmit={(reason) => {
            setReturning(false);
            setComment(reason);
            void submit('rework', reason);
          }}
        />
      )}
    </section>
  );
}

const reasonSchema = z.object({ reason: z.string().trim().min(1, 'Укажите причину возврата') });
function ReturnDialog({
  initial,
  onClose,
  onSubmit,
}: {
  initial: string;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const form = useForm<z.infer<typeof reasonSchema>>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: initial },
  });
  const error = form.formState.errors.reason;
  return (
    <Modal
      title="Вернуть на доработку"
      description="Опишите, что исполнителю нужно исправить."
      onClose={onClose}
    >
      <form onSubmit={form.handleSubmit((values) => onSubmit(values.reason))} noValidate>
        <div className="field">
          <label htmlFor="return-reason">Причина возврата</label>
          <textarea
            id="return-reason"
            {...form.register('reason')}
            aria-invalid={!!error}
            aria-describedby={error ? 'return-error' : undefined}
          />
          {error && (
            <p id="return-error" className="form-error">
              {error.message}
            </p>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="button primary">
            Вернуть на доработку
          </button>
        </div>
      </form>
    </Modal>
  );
}
