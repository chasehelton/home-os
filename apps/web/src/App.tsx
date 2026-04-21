import { useEffect, useState } from 'react';

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

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold">home-os</h1>
      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : me ? (
        <div className="flex flex-col items-center gap-3">
          {me.pictureUrl && (
            <img
              src={me.pictureUrl}
              alt=""
              className="h-16 w-16 rounded-full"
              referrerPolicy="no-referrer"
            />
          )}
          <p className="text-lg">
            Signed in as <span className="font-semibold">{me.displayName}</span>
          </p>
          <p className="text-sm text-slate-400">{me.email}</p>
          <button
            onClick={logout}
            className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
          >
            Sign out
          </button>
        </div>
      ) : (
        <a
          href="/auth/google/login"
          className="rounded bg-blue-600 px-5 py-2 text-base font-medium hover:bg-blue-500"
        >
          Sign in with Google
        </a>
      )}
      <p className="max-w-md text-sm text-slate-400">
        Phase 1: identity. Todos, calendar, recipes, meal plan, and the AI assistant arrive in
        their respective phases.
      </p>
    </main>
  );
}
