import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { getSupabase } from '../../shared/supabase';
import { Modal } from '../../shared/ui/Modal';
import type { Task } from './data';
import { domainMessage, useTaskReadback } from './useTaskReadback';

export function DeleteTask({ task, onClose }: { task: Task; onClose: () => void }) {
  const navigate = useNavigate();
  const [version, setVersion] = useState(task.version);
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [note, setNote] = useState('');
  const verify = useTaskReadback(task.id);
  async function confirm() {
    setBusy(true);
    setNote('');
    try {
      const current = await verify.read();
      if (!current || !verify.alive.current) return;
      if (readOnly || current.version !== version) {
        setVersion(current.version);
        setReadOnly(false);
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
      const domain = domainMessage(error.message);
      if (domain) {
        setNote(domain);
        return;
      }
      setReadOnly(true);
      const after = await verify.read();
      if (after) {
        setVersion(after.version);
        setReadOnly(false);
        setNote('Задача остаётся доступна. Проверьте данные и подтвердите удаление ещё раз.');
      }
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
