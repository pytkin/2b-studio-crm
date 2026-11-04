import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, DraftingCompass } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { getSupabase } from '../../shared/supabase';

const schema = z.object({
  email: z.email('Введите корректную электронную почту'),
  password: z.string().min(1, 'Введите пароль'),
});
export function Login({ configurationError }: { configurationError?: boolean }) {
  const [failure, setFailure] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async (values) => {
    setFailure('');
    try {
      const { error } = await getSupabase().auth.signInWithPassword(values);
      if (error)
        setFailure(
          error.status === 400 || error.status === 401
            ? 'Проверьте электронную почту и пароль.'
            : 'Не удалось войти. Проверьте соединение и попробуйте снова.',
        );
    } catch {
      setFailure('Не удалось войти. Проверьте соединение и попробуйте снова.');
    }
  });
  return (
    <main className="login-page">
      <section className="login-visual" aria-label="Бюро">
        <span className="brand">
          <DraftingCompass aria-hidden="true" />
          Бюро
        </span>
        <div>
          <p className="eyebrow">Строительное бюро</p>
          <h2>Объекты и задачи</h2>
        </div>
      </section>
      <section className="login-panel">
        <p className="eyebrow">Рабочее пространство</p>
        <h1>Вход</h1>
        <p>Войдите с рабочей учётной записью.</p>
        <form className="login-form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="login-email">Электронная почта</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              placeholder="name@company.ru"
              {...register('email')}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            {errors.email && (
              <span className="form-error" id="email-error">
                {errors.email.message}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="login-password">Пароль</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
            />
            {errors.password && (
              <span className="form-error" id="password-error">
                {errors.password.message}
              </span>
            )}
          </div>
          {(configurationError || failure) && (
            <p role="alert" className="form-error">
              {configurationError ? 'Для входа требуется настроить подключение к базе.' : failure}
            </p>
          )}
          <button
            className="button primary"
            type="submit"
            disabled={isSubmitting || configurationError}
          >
            {isSubmitting ? 'Входим…' : 'Войти'}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </form>
      </section>
    </main>
  );
}
