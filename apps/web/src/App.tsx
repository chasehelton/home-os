import { useEffect, useState } from 'react';
import { TodoList } from './components/TodoList';
import { Recipes } from './components/Recipes';
import { MealPlan } from './components/MealPlan';
import { Settings } from './components/Settings';
import { Calendar } from './components/Calendar';
import { Assistant } from './components/Assistant';
import { Reminders } from './components/Reminders';
import { ReminderBanner } from './components/ReminderBanner';
import { AppShell, type NavItem } from './components/AppShell';
import { ButtonLink } from './components/ui/Button';
import { useTheme } from './lib/theme';

interface Me {
  id: string;
  email: string;
  displayName: string;
  pictureUrl: string | null;
}

type Tab = 'todos' | 'recipes' | 'meals' | 'calendar' | 'reminders' | 'assistant' | 'settings';

const NAV: NavItem<Tab>[] = [
  { id: 'todos', label: 'Todos', icon: <span aria-hidden>✓</span> },
  { id: 'recipes', label: 'Recipes', icon: <span aria-hidden>◉</span> },
  { id: 'meals', label: 'Meals', icon: <span aria-hidden>☰</span> },
  { id: 'calendar', label: 'Calendar', icon: <span aria-hidden>▦</span> },
  { id: 'reminders', label: 'Reminders', icon: <span aria-hidden>❖</span> },
  { id: 'assistant', label: 'Assistant', icon: <span aria-hidden>✦</span> },
  { id: 'settings', label: 'Settings', icon: <span aria-hidden>⚙</span> },
];

export function App() {
  // Wire up theme (reads localStorage, syncs html.dark, listens to system changes).
  useTheme();

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    return t === 'recipes' ||
      t === 'meals' ||
      t === 'calendar' ||
      t === 'reminders' ||
      t === 'assistant' ||
      t === 'settings'
      ? (t as Tab)
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
      <main className="flex min-h-full items-center justify-center bg-surface text-on-surface-variant">
        <span className="text-body-lg">Loading…</span>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="grid min-h-full place-items-center bg-surface px-6 py-16 text-on-surface">
        <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
          <p className="text-label-sm text-on-surface-variant">A calmer home, together.</p>
          <h1 className="font-display text-display-lg text-on-surface">home-os</h1>
          <p className="max-w-md text-body-lg text-on-surface-variant">
            Your family&rsquo;s quiet workshop for todos, recipes, meal plans, and the rhythms that
            hold the house together.
          </p>
          <ButtonLink href="/auth/google/login" size="lg" className="mt-4">
            Sign in with Google
          </ButtonLink>
        </div>
      </main>
    );
  }

  const body =
    tab === 'todos' ? (
      <TodoList currentUserId={me.id} />
    ) : tab === 'recipes' ? (
      <Recipes />
    ) : tab === 'meals' ? (
      <MealPlan />
    ) : tab === 'calendar' ? (
      <Calendar currentUserId={me.id} />
    ) : tab === 'reminders' ? (
      <Reminders />
    ) : tab === 'assistant' ? (
      <Assistant />
    ) : (
      <Settings />
    );

  return (
    <AppShell<Tab>
      items={NAV}
      current={tab}
      onSelect={setTab}
      user={{ displayName: me.displayName, pictureUrl: me.pictureUrl }}
      onSignOut={() => void logout()}
      banner={<ReminderBanner />}
    >
      {body}
    </AppShell>
  );
}
