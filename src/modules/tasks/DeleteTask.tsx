import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { getSupabase } from '../../shared/supabase';
import { Modal } from '../../shared/ui/Modal';
import { useSession } from '../auth';
import { objectKey, readObject } from '../objects/api';
import type { Task } from './data';
import { domainMessage, useTaskReadback } from './useTaskReadback';

export function DeleteTask({ task, onClose }: { task: Task; onClose: () => void }) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const { profile, checkSession } = useSession();
  const [version, setVersion] = useState(task.version);
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [note, setNote] = useState('');
  const verify = useTaskReadback(task.id);
  async function inspectDeletion() {
    setReadOnly(true);
    const [after] = await Promise.all([
      verify.read(),
      cache.fetchQuery({
        queryKey: objectKey(profile.id, task.object_id),
        queryFn: ({ signal }) => readObject(task.object_id, signal, checkSession),
      }),
    ]);
    if (after && verify.alive.current) {
      setVersion(after.version);
      setReadOnly(false);
      setNote('Задача остаётся доступна. Проверьте данные и подтвердите удаление ещё раз.');
    }
  }
  async function confirm() {
    setBusy(true);
    setNote('');
    try {
      if (readOnly) {
        await inspectDeletion();
        return;
      }
      const current = await verify.read();
      if (!current || !verify.alive.current) return;
      if (current.version !== version) {
        setVersion(current.version);
        setNote('Задача доступна. Сверьте название и подтвердите удаление ещё раз.');
        return;
      }
      if (!(await verify.canSend())) return;
      const { error, status } = await getSupabase()
        .rpc('delete_task', { p_id: task.id, p_expected_version: version })
        .retry(false);
      if (!verify.alive.current) return;
      if (!error) {
        verify.revoke();
        onClose();
        await navigate({ to: '/objects/$objectId', params: { objectId: current.object_id } });
        requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus());
        return;
      }
      if (error.message === 'UNAVAILABLE') {
        verify.revoke();
        return;
      }
      if (status === 401) {
        await verify.checkSession();
        setNote('Не удалось подтвердить сессию.');
        return;
      }
      if (error.message === 'FORBIDDEN') {
        setNote('Это действие недоступно для вашей роли.');
        await verify.recheckAccess();
        return;
      }
      const domain = domainMessage(error.message);
      if (domain) {
        setNote(domain);
        return;
      }
      await inspectDeletion();
    } catch {
      setReadOnly(true);
      setNote('Результат неизвестен. Проверьте соединение и перечитайте задачу.');
    } finally {
      if (verify.alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      title="Удалить задачу"
      description={`Задача «${task.title}» исчезнет из рабочих списков. История сохранится.`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {note && <p role="alert">{note}</p>}
      <div className="form-actions">
        <button type="button" className="button" disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          className="button danger"
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? 'Проверяем…' : readOnly ? 'Проверить результат' : 'Удалить задачу'}
        </button>
      </div>
    </Modal>
  );
}
