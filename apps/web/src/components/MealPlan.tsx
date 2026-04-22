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
import { Button } from './ui/Button';
import { Field, Input, Select, Textarea } from './ui/Input';
import { Dialog } from './ui/Dialog';
import { Badge } from './ui/Badge';
import { PageHeader } from './ui/PageHeader';
import { cn } from './ui/cn';

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
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-margin md:py-lg">
      <PageHeader
        title="Meal plan"
        description={`Week of ${weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              ← Prev
            </Button>
            <Button size="sm" variant="tonal" onClick={() => setWeekStart(weekStartSunday(new Date()))}>
              This week
            </Button>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}>
              Next →
            </Button>
          </div>
        }
      />

      {tonight && (
        <div className="flex items-center gap-2 rounded-lg bg-tertiary-container px-4 py-3 text-body-md text-tertiary-on-container">
          <span aria-hidden>🍽</span>
          Tonight: <strong className="font-semibold">{displayLabel(tonight, recipes)}</strong>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="w-20 text-left text-label-sm text-on-surface-variant"></th>
              {days.map((d, i) => {
                const isToday = toYmd(d) === todayYmd;
                return (
                  <th key={i} className="px-2 pb-2 text-left">
                    <div
                      className={cn(
                        'text-label-sm',
                        isToday ? 'text-primary' : 'text-on-surface-variant',
                      )}
                    >
                      {DAY_LABELS[d.getDay()]}
                    </div>
                    <div
                      className={cn(
                        'font-display text-headline-md',
                        isToday ? 'text-primary' : 'text-on-surface',
                      )}
                    >
                      {d.getDate()}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot}>
                <td className="pr-2 align-top text-label-md capitalize text-on-surface-variant">
                  {slot}
                </td>
                {days.map((d, i) => {
                  const ymd = toYmd(d);
                  const cell = byCell.get(`${ymd}|${slot}`) ?? [];
                  return (
                    <td key={i} className="align-top">
                      <div className="flex min-h-[84px] flex-col gap-1 rounded-md bg-surface-container-low p-2">
                        {cell.map((e) => (
                          <button
                            key={e.id}
                            onClick={() => setModal({ kind: 'edit', entry: e })}
                            className="rounded-sm bg-surface-lowest px-2 py-1.5 text-left text-body-md text-on-surface shadow-ambient transition-all duration-200 ease-soft hover:-translate-y-px"
                          >
                            {displayLabel(e, recipes)}
                          </button>
                        ))}
                        <button
                          onClick={() => setModal({ kind: 'add', date: ymd, slot })}
                          className="mt-auto rounded-sm border border-dashed border-outline-variant px-2 py-1 text-center text-label-md text-on-surface-variant transition-colors duration-200 ease-soft hover:border-primary hover:text-primary"
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
    </section>
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
    <Dialog
      open
      onClose={onCancel}
      title={initial.id ? 'Edit meal' : 'Plan a meal'}
      description={
        <span>
          {labelForDate} · <span className="capitalize">{slot}</span>
        </span>
      }
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {onDelete ? (
            <Button type="button" size="sm" variant="danger" onClick={onDelete}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="tonal" onClick={onCancel}>
              Cancel
            </Button>
            <Button form="mealplan-form" type="submit">
              Save
            </Button>
          </div>
        </div>
      }
    >
      <form id="mealplan-form" onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Slot">
            <Select value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)}>
              {SLOTS.map((s) => (
                <option key={s} value={s} className="capitalize">
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Recipe">
          <Select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
            <option value="">— none (use title) —</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title (optional override)">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={recipeId ? '(using recipe title)' : 'e.g. Leftovers, Takeout'}
          />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        {err && (
          <Badge tone="danger" className="self-start normal-case">
            {err}
          </Badge>
        )}
      </form>
    </Dialog>
  );
}
