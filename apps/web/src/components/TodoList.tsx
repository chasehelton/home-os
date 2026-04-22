import { useEffect, useMemo, useState } from 'react';
import {
  type Todo,
  createTodoApi,
  deleteTodoApi,
  flushQueue,
  listTodos,
  makeTempId,
  pendingMutationCount,
  queueOrSend,
  updateTodoApi,
} from '../lib/todos';

type Filter = 'all' | 'household' | 'user';

export function TodoList({ currentUserId }: { currentUserId: string }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<'household' | 'user'>('household');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  async function refresh() {
    try {
      const rows = await listTodos();
      setTodos(rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setPending(pendingMutationCount());
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      void flushQueue().then(() => refresh());
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const visible = useMemo(() => {
    if (filter === 'all') return todos;
    if (filter === 'household') return todos.filter((t) => t.scope === 'household');
    return todos.filter((t) => t.scope === 'user' && t.ownerUserId === currentUserId);
  }, [todos, filter, currentUserId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    const tempId = makeTempId();
    const optimistic: Todo = {
      id: tempId,
      scope,
      ownerUserId: scope === 'user' ? currentUserId : null,
      title: trimmed,
      notes: null,
      dueAt: null,
      completedAt: null,
      createdBy: currentUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setTodos((prev) => [optimistic, ...prev]);
    setTitle('');
    try {
      const real = await createTodoApi({ scope, title: trimmed });
      setTodos((prev) => [real, ...prev.filter((t) => t.id !== tempId)]);
    } catch {
      await queueOrSend({ kind: 'create', tempId, body: { scope, title: trimmed } });
      setPending(pendingMutationCount());
    }
  }

  async function toggle(t: Todo) {
    const completedAt = t.completedAt ? null : new Date().toISOString();
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, completedAt } : x)));
    if (t.id.startsWith('tmp_')) return;
    try {
      const real = await updateTodoApi(t.id, { completedAt });
      setTodos((prev) => prev.map((x) => (x.id === t.id ? real : x)));
    } catch {
      await queueOrSend({ kind: 'update', id: t.id, body: { completedAt } });
      setPending(pendingMutationCount());
    }
  }

  async function remove(t: Todo) {
    setTodos((prev) => prev.filter((x) => x.id !== t.id));
    if (t.id.startsWith('tmp_')) return;
    try {
      await deleteTodoApi(t.id);
    } catch {
      await queueOrSend({ kind: 'delete', id: t.id });
      setPending(pendingMutationCount());
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded bg-slate-800 p-1 text-sm">
          {(['all', 'household', 'user'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 ${
                filter === f ? 'bg-blue-600' : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              {f === 'user' ? 'Mine' : f === 'household' ? 'Household' : 'All'}
            </button>
          ))}
        </div>
        <div className="text-xs text-slate-400">
          {online ? 'online' : 'offline'} · {pending} queued
        </div>
      </div>

      <form onSubmit={add} className="flex flex-col gap-2 rounded-lg bg-slate-800 p-3 sm:flex-row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          className="flex-1 rounded bg-slate-900 px-3 py-2 text-base outline-none ring-1 ring-slate-700 focus:ring-blue-500"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'household' | 'user')}
          className="rounded bg-slate-900 px-3 py-2 ring-1 ring-slate-700"
        >
          <option value="household">Household</option>
          <option value="user">Mine</option>
        </select>
        <button
          className="rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500"
          type="submit"
        >
          Add
        </button>
      </form>

      {error && <p className="rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</p>}

      <ul className="flex flex-col gap-1">
        {visible.length === 0 && (
          <li className="py-8 text-center text-slate-500">Nothing here yet.</li>
        )}
        {visible.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-lg bg-slate-800 p-3">
            <button
              onClick={() => toggle(t)}
              aria-label={t.completedAt ? 'Mark incomplete' : 'Mark complete'}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
                t.completedAt
                  ? 'border-green-500 bg-green-500/30 text-green-300'
                  : 'border-slate-600 hover:border-blue-400'
              }`}
            >
              {t.completedAt ? '✓' : ''}
            </button>
            <div className="flex-1 overflow-hidden">
              <p
                className={`truncate text-base ${
                  t.completedAt ? 'text-slate-500 line-through' : ''
                }`}
              >
                {t.title}
              </p>
              <p className="text-xs text-slate-400">
                {t.scope === 'household' ? 'Household' : 'Personal'}
                {t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString()}` : ''}
              </p>
            </div>
            <button
              onClick={() => remove(t)}
              aria-label="Delete"
              className="rounded px-2 py-1 text-slate-500 hover:bg-slate-700 hover:text-red-300"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
