import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useRouter } from '@tanstack/react-router';
import { Building2, DraftingCompass, ListChecks, LogOut } from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import type { Tables } from '../../shared/database.types';
import { getSupabase } from '../../shared/supabase';
import { Login } from './Login';

type Access = {
  profile: Tables<'profiles'>;
  signOut: () => Promise<void>;
  checkSession: () => Promise<void>;
};
const Context = createContext<Access | null>(null);
export function useSession() {
  const value = useContext(Context);
  if (!value) throw Error('Требуется активный профиль');
  return value;
}
const allowedPath = /^\/(?:objects(?:\/[^/]+)?|tasks\/[^/]+|my-tasks)$/;

export function SessionBoundary({ children }: { children: ReactNode }) {
  const path = useLocation({ select: (s) => s.pathname });
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [fault, setFault] = useState(false);
  const [message, setMessage] = useState('');
  const intended = useRef('');
  const exiting = useRef(false);
  const userId = session?.user.id;
  const cache = useQueryClient();
  const identity = useRef<string | undefined>(undefined);
  useEffect(() => {
    try {
      const {
        data: { subscription },
      } = getSupabase().auth.onAuthStateChange((_event, next) => {
        if (identity.current !== next?.user.id) {
          if (identity.current) {
            void cache.cancelQueries();
            cache.clear();
          }
          identity.current = next?.user.id;
        }
        setSession(next);
      });
      return () => subscription.unsubscribe();
    } catch {
      setFault(true);
      setSession(null);
    }
  }, [cache]);
  const profile = useQuery({
    queryKey: ['user', userId, 'profile'],
    enabled: !!userId,
    queryFn: async ({ signal }) => {
      if (!userId) return null;
      const { data, error, status } = await getSupabase()
        .from('profiles')
        .select('id,display_name,role,active')
        .eq('id', userId)
        .eq('active', true)
        .abortSignal(signal)
        .retry(false)
        .maybeSingle();
      if (status === 401 && identity.current === userId) await checkSession();
      if (error) throw Error('Не удалось проверить профиль.');
      return data;
    },
  });
  useEffect(() => {
    if (userId && profile.data === null) {
      cache.removeQueries({
        predicate: (q) =>
          q.queryKey[0] === 'user' && q.queryKey[1] === userId && q.queryKey[2] !== 'profile',
      });
    }
  }, [userId, profile.data, cache]);
  async function signOut() {
    setMessage('');
    exiting.current = true;
    intended.current = '';
    try {
      const { error } = await getSupabase().auth.signOut({ scope: 'local' });
      if (error) throw error;
      await router.navigate({ to: '/login', replace: true });
    } catch {
      setMessage('Не удалось выйти. Проверьте соединение и повторите.');
      exiting.current = false;
    }
  }
  async function checkSession() {
    const { error } = await getSupabase().auth.getUser();
    if (identity.current === userId && error && [401, 403].includes(error.status ?? 0)) {
      await signOut();
    }
  }
  useEffect(() => {
    if (!session && session !== undefined && path !== '/login') {
      if (!exiting.current && allowedPath.test(path)) intended.current = path;
      void router.navigate({ to: '/login', replace: true });
    }
    if (session && profile.data && (path === '/login' || path === '/')) {
      const destination = intended.current;
      intended.current = '';
      exiting.current = false;
      if (destination && destination !== '/my-tasks') router.history.replace(destination);
      else
        void router.navigate({
          to: profile.data.role === 'manager' ? '/objects' : '/my-tasks',
          replace: true,
        });
    }
  }, [session, profile.data, path, router]);
  if (session === undefined || (userId && profile.isPending))
    return (
      <main className="main-content" role="status">
        Проверяем доступ…
      </main>
    );
  if (!session) return <Login configurationError={fault} />;
  if (!profile.data || profile.isError)
    return (
      <main className="main-content">
        <h1>{profile.isError ? 'Не удалось проверить доступ' : 'Профиль недоступен'}</h1>
        <p>
          {profile.isError
            ? 'Проверьте соединение и повторите проверку.'
            : 'Для работы нужен активный профиль сотрудника.'}
        </p>
        <button type="button" className="button" onClick={() => void profile.refetch()}>
          Проверить снова
        </button>
        <button type="button" className="button" onClick={() => void signOut()}>
          Выйти
        </button>
        {message && <p role="alert">{message}</p>}
      </main>
    );
  if (path === '/login' || path === '/')
    return <main role="status">Открываем рабочее пространство…</main>;
  if (path === '/my-tasks' && profile.data.role === 'manager')
    return <Navigate to="/objects" replace />;
  const active = profile.data;
  return (
    <Context.Provider key={active.id} value={{ profile: active, signOut, checkSession }}>
      <div className="app-shell">
        <aside className="sidebar">
          <span className="brand">
            <DraftingCompass aria-hidden="true" />
            Бюро
          </span>
          <nav aria-label="Основная навигация">
            <Link to="/objects">
              <Building2 size={18} />
              Объекты
            </Link>
            {active.role === 'executor' && (
              <Link to="/my-tasks">
                <ListChecks size={18} />
                Мои задачи
              </Link>
            )}
          </nav>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <span>
              {active.display_name} · {active.role === 'manager' ? 'Постановщик' : 'Исполнитель'}
            </span>
            <button type="button" className="button" onClick={() => void signOut()}>
              <LogOut size={16} />
              Выйти
            </button>
          </header>
          <main className="main-content">
            {message && <p role="alert">{message}</p>}
            {children}
          </main>
        </div>
      </div>
    </Context.Provider>
  );
}
