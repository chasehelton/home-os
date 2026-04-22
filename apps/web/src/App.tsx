import { useEffect, useState } from 'react';
import { TodoList } from './components/TodoList';
import { Recipes } from './components/Recipes';
import { MealPlan } from './components/MealPlan';
import { Settings } from './components/Settings';
import { Calendar } from './components/Calendar';
import { Assistant } from './components/Assistant';

interface Me {
  id: string;
  email: string;
  displayName: string;
  pictureUrl: string | null;
}

type Tab = 'todos' | 'recipes' | 'meals' | 'calendar' | 'assistant' | 'settings';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    return t === 'recipes' ||
      t === 'meals' ||
      t === 'calendar' ||
      t === 'assistant' ||
      t === 'settings'
      ? t
      : 'todos';
  });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('tab', tab);
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
  }, [tab]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      setMe(res.ok ? ((await res.json()) as Me) : null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    setMe(null);
  }

  if (loading) {
    return (
      <main className="flex min-h-full items-center justify-center text-slate-400">Loading…</main>
    );
  }

  if (!me) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-6 p-8 text-center">
        <h1 className="text-4xl font-semibold">home-os</h1>
        <a
          href="/auth/google/login"
          className="rounded bg-blue-600 px-5 py-2 text-base font-medium hover:bg-blue-500"
        >
          Sign in with Google
        </a>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">home-os</h1>
          <nav className="flex gap-1 rounded bg-slate-800 p-1 text-sm">
            {(['todos', 'recipes', 'meals', 'calendar', 'assistant', 'settings'] as Tab[]).map(
              (t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-3 py-1 capitalize ${
                    tab === t ? 'bg-blue-600' : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {t}
                </button>
              ),
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {me.pictureUrl && (
            <img
              src={me.pictureUrl}
              alt=""
              className="h-8 w-8 rounded-full"
              referrerPolicy="no-referrer"
            />
          )}
          <span className="hidden text-slate-300 sm:inline">{me.displayName}</span>
          <button
            onClick={logout}
            className="rounded bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
          >
            Sign out
          </button>
        </div>
      </header>
      {tab === 'todos' ? (
        <TodoList currentUserId={me.id} />
      ) : tab === 'recipes' ? (
        <Recipes />
      ) : tab === 'meals' ? (
        <MealPlan />
      ) : tab === 'calendar' ? (
        <Calendar currentUserId={me.id} />
      ) : tab === 'assistant' ? (
        <Assistant />
      ) : (
        <Settings />
      )}
    </main>
  );
}
