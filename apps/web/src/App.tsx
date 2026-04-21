import { useEffect, useState } from 'react';
import { TodoList } from './components/TodoList';

interface Me {
  id: string;
  email: string;
  displayName: string;
  pictureUrl: string | null;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

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
    return <main className="flex min-h-full items-center justify-center text-slate-400">Loading…</main>;
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
        <h1 className="text-xl font-semibold">home-os</h1>
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
      <TodoList currentUserId={me.id} />
    </main>
  );
}
