import type {
  CreateMealPlanEntryInput,
  MealPlanEntry,
  UpdateMealPlanEntryInput,
} from '@home-os/shared';

export type { MealPlanEntry } from '@home-os/shared';

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

export interface MealPlanWeek {
  from: string;
  to: string;
  entries: MealPlanEntry[];
}

export async function listMealPlan(weekStart: string): Promise<MealPlanWeek> {
  return jsonFetch<MealPlanWeek>(`/api/meal-plan?weekStart=${encodeURIComponent(weekStart)}`);
}

export async function createMealPlanEntryApi(
  body: CreateMealPlanEntryInput,
): Promise<MealPlanEntry> {
  return jsonFetch<MealPlanEntry>('/api/meal-plan', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateMealPlanEntryApi(
  id: string,
  body: UpdateMealPlanEntryInput,
): Promise<MealPlanEntry> {
  return jsonFetch<MealPlanEntry>(`/api/meal-plan/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteMealPlanEntryApi(id: string): Promise<void> {
  await jsonFetch<void>(`/api/meal-plan/${id}`, { method: 'DELETE' });
}

// ---------- Date helpers (kept in this file to avoid a utils grab-bag) ----------

/** Format a Date as local-calendar YYYY-MM-DD. */
export function toYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Parse a YYYY-MM-DD string as a local-calendar Date (midnight local). */
export function fromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Sunday of the calendar week containing `d`. */
export function weekStartSunday(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}
