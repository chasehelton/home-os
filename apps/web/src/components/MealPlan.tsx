import { useEffect, useMemo, useState } from 'react';
import type { MealSlot } from '@home-os/shared';
import {
  addDays,
  createMealPlanEntryApi,
  deleteMealPlanEntryApi,
  fromYmd,
  listMealPlan,
  type MealPlanEntry,
  toYmd,
  updateMealPlanEntryApi,
  weekStartSunday,
} from '../lib/mealplan';
import { listRecipes, type RecipeSummary } from '../lib/recipes';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MealPlan() {
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartSunday(new Date()));
  const [entries, setEntries] = useState<MealPlanEntry[]>([]);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<
    | { kind: 'closed' }
    | { kind: 'add'; date: string; slot: MealSlot }
    | { kind: 'edit'; entry: MealPlanEntry }
  >({ kind: 'closed' });

  const weekStartYmd = toYmd(weekStart);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  async function refresh() {
    try {
      const res = await listMealPlan(weekStartYmd);
      setEntries(res.entries);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [weekStartYmd]);

  useEffect(() => {
    void listRecipes()
      .then(setRecipes)
      .catch(() => {});
  }, []);

  const byCell = useMemo(() => {
    const m = new Map<string, MealPlanEntry[]>();
    for (const e of entries) {
      const key = `${e.date}|${e.slot}`;
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    }
    return m;
  }, [entries]);

  const todayYmd = toYmd(new Date());
  const tonight = entries.find((e) => e.date === todayYmd && e.slot === 'dinner') ?? null;

  async function handleSave(input: {
    date: string;
    slot: MealSlot;
    recipeId: string | null;
    title: string | null;
    notes: string | null;
    id?: string;
  }) {
    try {
      if (input.id) {
        await updateMealPlanEntryApi(input.id, {
          date: input.date,
          slot: input.slot,
          recipeId: input.recipeId,
          title: input.title,
          notes: input.notes,
        });
      } else {
        await createMealPlanEntryApi({
          date: input.date,
          slot: input.slot,
          recipeId: input.recipeId,
          title: input.title,
          notes: input.notes,
        });
      }
      setModal({ kind: 'closed' });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMealPlanEntryApi(id);
      setModal({ kind: 'closed' });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            ← Prev
          </button>
          <button
            onClick={() => setWeekStart(weekStartSunday(new Date()))}
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            This week
          </button>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            Next →
          </button>
          <span className="ml-2 text-sm text-slate-400">
            Week of {weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        </div>
        {tonight && (
          <div className="rounded bg-blue-900/40 px-3 py-1 text-sm text-blue-100">
            Tonight: <strong>{displayLabel(tonight, recipes)}</strong>
          </div>
        )}
      </div>
      {error && <p className="rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-20 text-left text-xs font-medium text-slate-400"></th>
              {days.map((d, i) => {
                const isToday = toYmd(d) === todayYmd;
                return (
                  <th
                    key={i}
                    className={`px-2 pb-2 text-left text-xs font-medium ${
                      isToday ? 'text-blue-300' : 'text-slate-400'
                    }`}
                  >
                    <div>{DAY_LABELS[d.getDay()]}</div>
                    <div className="text-sm text-slate-200">{d.getDate()}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot}>
                <td className="pr-2 align-top text-xs capitalize text-slate-400">{slot}</td>
                {days.map((d, i) => {
                  const ymd = toYmd(d);
                  const cell = byCell.get(`${ymd}|${slot}`) ?? [];
                  return (
                    <td key={i} className="align-top">
                      <div className="flex min-h-[72px] flex-col gap-1 rounded bg-slate-800 p-2">
                        {cell.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => setModal({ kind: 'edit', entry: e })}
                            className="rounded bg-slate-700 px-2 py-1 text-left text-sm hover:bg-slate-600"
                          >
                            {displayLabel(e, recipes)}
                          </button>
                        ))}
                        <button
                          onClick={() => setModal({ kind: 'add', date: ymd, slot })}
                          className="mt-auto rounded border border-dashed border-slate-600 px-2 py-1 text-center text-xs text-slate-400 hover:border-slate-400 hover:text-slate-200"
                        >
                          + add
                        </button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal.kind !== 'closed' && (
        <EntryModal
          key={modal.kind === 'edit' ? modal.entry.id : `${modal.date}-${modal.slot}`}
          recipes={recipes}
          initial={
            modal.kind === 'edit'
              ? modal.entry
              : { date: modal.date, slot: modal.slot, id: undefined }
          }
          onCancel={() => setModal({ kind: 'closed' })}
          onSave={handleSave}
          onDelete={modal.kind === 'edit' ? () => handleDelete(modal.entry.id) : undefined}
        />
      )}
    </div>
  );
}

function displayLabel(e: MealPlanEntry, recipes: RecipeSummary[]): string {
  if (e.title) return e.title;
  if (e.recipeId) {
    const r = recipes.find((x) => x.id === e.recipeId);
    if (r) return r.title;
    return 'Recipe (deleted)';
  }
  return '—';
}

interface ModalInitial {
  id: string | undefined;
  date: string;
  slot: MealSlot;
  recipeId?: string | null;
  title?: string | null;
  notes?: string | null;
}

function EntryModal({
  recipes,
  initial,
  onCancel,
  onSave,
  onDelete,
}: {
  recipes: RecipeSummary[];
  initial: ModalInitial;
  onCancel: () => void;
  onSave: (input: {
    id?: string;
    date: string;
    slot: MealSlot;
    recipeId: string | null;
    title: string | null;
    notes: string | null;
  }) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [date, setDate] = useState(initial.date);
  const [slot, setSlot] = useState<MealSlot>(initial.slot);
  const [recipeId, setRecipeId] = useState<string>(initial.recipeId ?? '');
  const [title, setTitle] = useState<string>(initial.title ?? '');
  const [notes, setNotes] = useState<string>(initial.notes ?? '');
  const [err, setErr] = useState<string | null>(null);

  const labelForDate = fromYmd(date).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const rId = recipeId || null;
    const t = title.trim() ? title.trim() : null;
    if (!rId && !t) {
      setErr('Pick a recipe or enter a title.');
      return;
    }
    void onSave({
      id: initial.id,
      date,
      slot,
      recipeId: rId,
      title: t,
      notes: notes.trim() ? notes.trim() : null,
    });
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg bg-slate-900 p-5 shadow-xl ring-1 ring-slate-700"
      >
        <h2 className="text-lg font-semibold">{initial.id ? 'Edit meal' : 'Plan a meal'}</h2>
        <div className="text-xs text-slate-400">
          {labelForDate} · <span className="capitalize">{slot}</span>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-700 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Slot</span>
          <select
            value={slot}
            onChange={(e) => setSlot(e.target.value as MealSlot)}
            className="rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-700 focus:ring-blue-500"
          >
            {SLOTS.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Recipe</span>
          <select
            value={recipeId}
            onChange={(e) => setRecipeId(e.target.value)}
            className="rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-700 focus:ring-blue-500"
          >
            <option value="">— none (use title) —</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Title (optional override)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={recipeId ? '(using recipe title)' : 'e.g. Leftovers, Takeout'}
            className="rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-700 focus:ring-blue-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-700 focus:ring-blue-500"
          />
        </label>

        {err && <p className="rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{err}</p>}

        <div className="mt-2 flex items-center justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-red-900/40 px-3 py-1 text-sm text-red-200 hover:bg-red-900/60"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-1 text-sm font-medium hover:bg-blue-500"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
