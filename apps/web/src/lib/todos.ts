import type { CreateTodoInput, UpdateTodoInput } from '@home-os/shared';

export interface Todo {
  id: string;
  scope: 'household' | 'user';
  ownerUserId: string | null;
  title: string;
  notes: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const QUEUE_KEY = 'home-os.mutation-queue.v1';

type QueuedMutation =
  | { kind: 'create'; tempId: string; body: CreateTodoInput }
  | { kind: 'update'; id: string; body: UpdateTodoInput }
  | { kind: 'delete'; id: string };

function loadQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}
function saveQueue(q: QueuedMutation[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}
function enqueue(m: QueuedMutation) {
  const q = loadQueue();
  q.push(m);
  saveQueue(q);
}

async function jsonFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listTodos(): Promise<Todo[]> {
  const data = await jsonFetch<{ todos: Todo[] }>('/api/todos');
  return data.todos;
}

export async function createTodoApi(body: CreateTodoInput): Promise<Todo> {
  return jsonFetch<Todo>('/api/todos', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateTodoApi(id: string, body: UpdateTodoInput): Promise<Todo> {
  return jsonFetch<Todo>(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function deleteTodoApi(id: string): Promise<void> {
  await jsonFetch<void>(`/api/todos/${id}`, { method: 'DELETE' });
}

export async function queueOrSend(m: QueuedMutation): Promise<void> {
  try {
    if (m.kind === 'create') await createTodoApi(m.body);
    else if (m.kind === 'update') await updateTodoApi(m.id, m.body);
    else await deleteTodoApi(m.id);
  } catch (err) {
    if (isOffline(err)) {
      enqueue(m);
      return;
    }
    throw err;
  }
}

function isOffline(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err instanceof TypeError;
}

export async function flushQueue(): Promise<{ flushed: number; remaining: number }> {
  let flushed = 0;
  let q = loadQueue();
  while (q.length > 0) {
    const next = q[0]!;
    try {
      if (next.kind === 'create') await createTodoApi(next.body);
      else if (next.kind === 'update') await updateTodoApi(next.id, next.body);
      else await deleteTodoApi(next.id);
      q = q.slice(1);
      saveQueue(q);
      flushed++;
    } catch (err) {
      if (isOffline(err)) break;
      // permanent failure (e.g. 404 because the row was already deleted) — drop it
      q = q.slice(1);
      saveQueue(q);
    }
  }
  return { flushed, remaining: loadQueue().length };
}

export function pendingMutationCount(): number {
  return loadQueue().length;
}

export function makeTempId(): string {
  return `tmp_${Math.random().toString(36).slice(2, 10)}`;
}
