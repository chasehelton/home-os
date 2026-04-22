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
import { Button, IconButton } from './ui/Button';
import { Card } from './ui/Card';
import { Input, Select } from './ui/Input';
import { SegmentedTabs } from './ui/Tabs';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';
import { Badge } from './ui/Badge';
import { cn } from './ui/cn';

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
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-margin md:py-lg">
      <PageHeader
        title="Todos"
        description="What the house needs doing, and what you've taken on personally."
        actions={
          <div className="flex items-center gap-3 text-label-md text-on-surface-variant">
            <span
              className={cn(
                'inline-flex items-center gap-1.5',
                online ? 'text-tertiary' : 'text-danger',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'h-2 w-2 rounded-full',
                  online ? 'bg-tertiary' : 'bg-danger',
                )}
              />
              {online ? 'Online' : 'Offline'}
            </span>
            {pending > 0 && <Badge tone="secondary">{pending} queued</Badge>}
          </div>
        }
      />

      <SegmentedTabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'household', label: 'Household' },
          { id: 'user', label: 'Mine' },
        ]}
      />

      <Card variant="tonal" padding="sm" className="sm:p-4">
        <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            className="flex-1"
          />
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'household' | 'user')}
            className="sm:w-40"
          >
            <option value="household">Household</option>
            <option value="user">Mine</option>
          </Select>
          <Button type="submit">Add</Button>
        </form>
      </Card>

      {error && (
        <div className="rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden>✓</span>}
          title="Nothing on the list"
          description="Add a task above to get started — laundry, groceries, follow-ups."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((t) => (
            <li key={t.id}>
              <Card variant="elevated" padding="none" className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => toggle(t)}
                  aria-label={t.completedAt ? 'Mark incomplete' : 'Mark complete'}
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200 ease-soft',
                    t.completedAt
                      ? 'border-primary bg-primary text-primary-on'
                      : 'border-outline-variant text-transparent hover:border-primary hover:text-primary/40',
                  )}
                >
                  ✓
                </button>
                <div className="flex-1 overflow-hidden">
                  <p
                    className={cn(
                      'truncate text-body-md',
                      t.completedAt ? 'text-on-surface-variant line-through' : 'text-on-surface',
                    )}
                  >
                    {t.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-label-md text-on-surface-variant">
                    <span>{t.scope === 'household' ? 'Household' : 'Personal'}</span>
                    {t.dueAt && (
                      <>
                        <span aria-hidden>·</span>
                        <span>due {new Date(t.dueAt).toLocaleDateString()}</span>
                      </>
                    )}
                  </p>
                </div>
                <IconButton
                  onClick={() => remove(t)}
                  aria-label="Delete"
                  size="sm"
                  className="text-on-surface-variant hover:bg-danger-container hover:text-danger-on-container"
                >
                  ✕
                </IconButton>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
