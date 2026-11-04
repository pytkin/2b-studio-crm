import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { getSupabase } from '../../shared/supabase';
import { Modal } from '../../shared/ui/Modal';
import { useSession } from '../auth';
import { objectKey, objectListKey, readObject, readObjects, type ObjectRecord } from './api';

const fieldsSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название'),
  address: z.string().trim().min(1, 'Укажите адрес'),
});
const savedObject = z.object({
  object: fieldsSchema.extend({ id: z.string(), version: z.number().int() }),
});
type Fields = z.infer<typeof fieldsSchema>;
type Intent = { mode: 'create' } | { mode: 'edit' | 'delete'; record: ObjectRecord };
type Check = 'before' | 'lost' | 'conflict';
type Phase = 'ready' | 'confirm' | 'verify' | 'repeat';
const titles = { create: 'Создать объект', edit: 'Редактировать объект', delete: 'Удалить объект' };

export function ObjectDialog({
  intent: initial,
  onClose,
}: {
  intent: Intent;
  onClose: () => void;
}) {
  const { profile, checkSession } = useSession();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [intent, setIntent] = useState(initial);
  const { mode } = intent;
  const expected = mode === 'create' ? undefined : intent.record;
  const [id] = useState(() => expected?.id ?? crypto.randomUUID());
  const form = useForm<Fields>({
    resolver: zodResolver(fieldsSchema),
    defaultValues: {
      name: expected?.name ?? '',
      address: expected?.address ?? '',
    },
  });
  const [phase, setPhase] = useState<Phase>('ready');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const lastCheck = useRef<Check>('before');
  const submitted = useRef<Fields>({ name: '', address: '' });
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const key = objectKey(profile.id, id);
  function refreshRecords() {
    void cache.invalidateQueries({
      queryKey: ['user', profile.id],
      predicate: (q) => q.queryKey[2] !== 'profile',
    });
  }
  function openRecord() {
    refreshRecords();
    onClose();
    void navigate({ to: '/objects/$objectId', params: { objectId: id } });
  }

  // A fresh version becomes eligible for writing only after the user sees and accepts it.
  async function inspect(reason: Check, signal: AbortSignal) {
    lastCheck.current = reason;
    let record: Awaited<ReturnType<typeof readObject>>;
    try {
      record = await readObject(id, signal, checkSession);
      if (signal.aborted) return false;
      if (record && mode === 'delete' && reason === 'lost') {
        const list = await readObjects(signal, checkSession);
        if (signal.aborted) return false;
        cache.setQueryData(objectListKey(profile.id), list);
      }
    } catch {
      if (!signal.aborted) {
        setPhase('verify');
        setMessage(
          reason === 'before'
            ? 'Не удалось проверить актуальные данные. Проверьте соединение и повторите чтение.'
            : 'Результат пока неизвестен. Проверьте соединение и запросите данные ещё раз.',
        );
      }
      return false;
    }

    if (mode === 'create') {
      if (record) openRecord();
      else {
        setMessage('Объект пока не виден. Можно повторить создание с теми же данными.');
        setPhase('repeat');
      }
      return false;
    }

    await cache.cancelQueries({ queryKey: key, exact: true });
    if (signal.aborted) return false;
    cache.setQueryData(key, record);
    if (!record) {
      cache.removeQueries({ queryKey: ['user', profile.id], type: 'inactive' });
      return false;
    }
    if (
      reason === 'lost' &&
      mode === 'edit' &&
      record.name === submitted.current.name &&
      record.address === submitted.current.address
    ) {
      refreshRecords();
      onClose();
      return false;
    }
    if (record.version !== expected?.version || reason !== 'before') {
      setIntent({ mode, record });
      setPhase('confirm');
      setMessage(
        reason === 'lost'
          ? 'Получены текущие данные. Проверьте их и подтвердите действие ещё раз.'
          : 'Объект изменился. Сверьте текущие данные с черновиком и подтвердите действие ещё раз.',
      );
      return false;
    }
    return true;
  }

  async function run(fields: Fields, verifyOnly = false) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || pending.current || (phase === 'verify' && !verifyOnly)) return;
    pending.current = true;
    setBusy(true);
    try {
      if (verifyOnly) {
        if (await inspect(lastCheck.current, signal)) {
          setPhase('ready');
          setMessage('Доступ проверен. Можно подтвердить действие.');
        }
        return;
      }
      submitted.current = fields;
      if (mode !== 'create' && !(await inspect('before', signal))) return;
      if (signal.aborted) return;
      const values = { p_id: id, p_name: fields.name, p_address: fields.address };
      const db = getSupabase();
      const request =
        mode === 'create'
          ? db.rpc('create_object', values)
          : mode === 'edit'
            ? db.rpc('update_object', { ...values, p_expected_version: intent.record.version })
            : db.rpc('delete_object', { p_id: id, p_expected_version: intent.record.version });
      const result = await request.abortSignal(signal).retry(false);
      if (signal.aborted) return;
      if (!result.error) {
        if (mode === 'create') openRecord();
        else if (mode === 'delete') {
          await cache.cancelQueries({
            queryKey: ['user', profile.id],
            predicate: (q) => q.queryKey[2] !== 'profile',
          });
          if (signal.aborted) return;
          cache.removeQueries({ queryKey: ['user', profile.id], type: 'inactive' });
          cache.setQueryData(key, null);
          void navigate({ to: '/objects' });
        } else {
          const saved = savedObject.safeParse(result.data);
          if (saved.success && saved.data.object.id === id) {
            cache.setQueryData<Awaited<ReturnType<typeof readObject>>>(key, (current) =>
              current ? { ...current, ...saved.data.object } : current,
            );
          }
          refreshRecords();
          onClose();
        }
        return;
      }
      if (result.status === 401) {
        await checkSession();
        if (!signal.aborted) setMessage('Не удалось подтвердить права на изменение.');
      } else if (result.error.message === 'CONFLICT') {
        await inspect('conflict', signal);
      } else if (result.error.message === 'UNAVAILABLE') {
        await cache.cancelQueries({ queryKey: key, exact: true });
        if (!signal.aborted) {
          cache.setQueryData(key, null);
          cache.removeQueries({ queryKey: ['user', profile.id], type: 'inactive' });
        }
      } else if (result.error.message === 'FORBIDDEN') {
        void cache.invalidateQueries({ queryKey: ['user', profile.id, 'profile'] });
        setMessage('Для этого действия нужны права постановщика.');
      } else if (result.error.message === 'INVALID_INPUT') {
        setMessage('Проверьте название и адрес объекта.');
      } else if (result.error.message === 'ID_UNAVAILABLE' && phase !== 'repeat') {
        setMessage('Этот идентификатор уже занят. Закройте форму и начните создание заново.');
      } else {
        await inspect('lost', signal);
      }
    } catch {
      if (!signal.aborted) await inspect('lost', signal);
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  const locked = busy || phase === 'verify' || phase === 'repeat';
  const close = () => {
    if (!pending.current) onClose();
  };
  return (
    <Modal
      title={titles[mode]}
      onClose={close}
      description={
        mode === 'delete'
          ? 'Объект «' + expected?.name + '» и все его задачи исчезнут из рабочих списков.'
          : mode === 'create'
            ? 'Укажите название и адрес нового объекта.'
            : 'Измените название или адрес объекта.'
      }
    >
      <form
        noValidate
        onSubmit={
          mode === 'delete'
            ? (event) => {
                event.preventDefault();
                void run(submitted.current);
              }
            : form.handleSubmit((fields) => run(fields))
        }
      >
        {mode !== 'delete' && (
          <>
            <div className="field">
              <label htmlFor="object-name">Название</label>
              <input
                id="object-name"
                {...form.register('name')}
                readOnly={locked}
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={form.formState.errors.name ? 'object-name-error' : undefined}
              />
              {form.formState.errors.name && (
                <p role="alert" id="object-name-error">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="object-address">Адрес</label>
              <input
                id="object-address"
                {...form.register('address')}
                readOnly={locked}
                aria-invalid={!!form.formState.errors.address}
                aria-describedby={
                  form.formState.errors.address ? 'object-address-error' : undefined
                }
              />
              {form.formState.errors.address && (
                <p role="alert" id="object-address-error">
                  {form.formState.errors.address.message}
                </p>
              )}
            </div>
          </>
        )}
        {message && <p role="status">{message}</p>}
        {phase === 'confirm' && expected && (
          <div className="panel">
            <h3>Текущие данные</h3>
            <p>{expected.name}</p>
            <p>{expected.address}</p>
          </div>
        )}
        <div className="form-actions">
          <button className="button" type="button" disabled={busy} onClick={close}>
            Отмена
          </button>
          {phase === 'verify' ? (
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={() => void run(submitted.current, true)}
            >
              {busy ? 'Проверяем…' : 'Проверить результат'}
            </button>
          ) : (
            <button
              className={'button ' + (mode === 'delete' ? 'danger' : 'primary')}
              type="submit"
              disabled={busy}
            >
              {busy
                ? 'Проверяем данные…'
                : mode === 'delete'
                  ? 'Удалить объект'
                  : phase === 'repeat'
                    ? 'Повторить создание'
                    : phase === 'confirm'
                      ? 'Подтвердить изменения'
                      : 'Сохранить'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
