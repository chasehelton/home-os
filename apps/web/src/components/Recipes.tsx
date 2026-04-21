import { useEffect, useState } from 'react';
import { marked } from 'marked';
import {
  type Recipe,
  type RecipeSummary,
  deleteRecipeApi,
  getRecipe,
  importRecipeApi,
  listRecipes,
  updateRecipeApi,
} from '../lib/recipes';

type View =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'edit'; id: string };

export function Recipes() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [summaries, setSummaries] = useState<RecipeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState('');

  async function refresh() {
    try {
      setSummaries(await listRecipes());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function doImport(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const recipe = await importRecipeApi(url.trim());
      setUrl('');
      await refresh();
      setView({ kind: 'detail', id: recipe.id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  if (view.kind === 'detail') {
    return (
      <RecipeDetail
        id={view.id}
        onBack={() => {
          setView({ kind: 'list' });
          void refresh();
        }}
        onEdit={() => setView({ kind: 'edit', id: view.id })}
      />
    );
  }
  if (view.kind === 'edit') {
    return (
      <RecipeEditor
        id={view.id}
        onDone={() => {
          setView({ kind: 'detail', id: view.id });
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <form
        onSubmit={doImport}
        className="flex flex-col gap-2 rounded-lg bg-slate-800 p-3 sm:flex-row"
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a recipe URL…"
          className="flex-1 rounded bg-slate-900 px-3 py-2 outline-none ring-1 ring-slate-700 focus:ring-blue-500"
          disabled={importing}
        />
        <button
          type="submit"
          disabled={importing}
          className="rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500 disabled:opacity-50"
        >
          {importing ? 'Importing…' : 'Import'}
        </button>
      </form>
      {error && <p className="rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</p>}
      {summaries.length === 0 ? (
        <p className="py-8 text-center text-slate-500">No recipes yet. Paste a URL above.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setView({ kind: 'detail', id: r.id })}
                className="flex w-full flex-col overflow-hidden rounded-lg bg-slate-800 text-left transition hover:bg-slate-700"
              >
                {r.imagePath ? (
                  <img
                    src={`/api/recipes/${r.id}/image`}
                    alt=""
                    className="aspect-video w-full object-cover"
                  />
                ) : (
                  <div className="aspect-video w-full bg-slate-700" />
                )}
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="font-medium">{r.title}</p>
                  {r.siteName && <p className="text-xs text-slate-400">{r.siteName}</p>}
                  {r.importStatus === 'partial' && (
                    <span className="mt-1 inline-block w-fit rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-200">
                      Needs review
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecipeDetail({
  id,
  onBack,
  onEdit,
}: {
  id: string;
  onBack: () => void;
  onEdit: () => void;
}) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [stepMode, setStepMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getRecipe(id).then(setRecipe).catch((e) => setError((e as Error).message));
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <button onClick={onBack} className="text-sm text-blue-400 hover:underline">
          ← Back
        </button>
        <p className="mt-4 rounded bg-red-900/40 px-3 py-2 text-red-200">{error}</p>
      </div>
    );
  }
  if (!recipe) {
    return <div className="mx-auto max-w-3xl p-4 text-slate-400">Loading…</div>;
  }

  if (stepMode) {
    return <StepMode recipe={recipe} onExit={() => setStepMode(false)} />;
  }

  const html = marked.parse(recipe.markdown, { async: false }) as string;

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-blue-400 hover:underline">
          ← Back to recipes
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => setStepMode(true)}
            className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
          >
            Step mode
          </button>
          <button
            onClick={onEdit}
            className="rounded bg-slate-700 px-3 py-1 text-sm hover:bg-slate-600"
          >
            Edit
          </button>
        </div>
      </div>
      {recipe.imagePath && (
        <img
          src={`/api/recipes/${recipe.id}/image`}
          alt=""
          className="mt-4 aspect-video w-full rounded-lg object-cover"
        />
      )}
      <h1 className="mt-4 text-3xl font-semibold">{recipe.title}</h1>
      {(recipe.author || recipe.siteName) && (
        <p className="mt-1 text-sm text-slate-400">
          {recipe.author && <span>{recipe.author}</span>}
          {recipe.author && recipe.siteName && <span> · </span>}
          {recipe.siteName && <span>{recipe.siteName}</span>}
          {recipe.sourceUrl && (
            <>
              {' · '}
              <a
                href={recipe.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-blue-400 hover:underline"
              >
                source
              </a>
            </>
          )}
        </p>
      )}
      <article
        className="prose prose-invert prose-slate mt-6 max-w-none"
        // marked output is trusted-enough for a household-only app; we already
        // limit input sources (our own imports + our own edits).
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button
        onClick={async () => {
          if (!confirm(`Delete "${recipe.title}"?`)) return;
          await deleteRecipeApi(recipe.id);
          onBack();
        }}
        className="mt-8 rounded bg-red-900/40 px-3 py-1 text-sm text-red-200 hover:bg-red-900/60"
      >
        Delete recipe
      </button>
    </div>
  );
}

function RecipeEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getRecipe(id).then((r) => {
      setRecipe(r);
      setTitle(r.title);
      setMarkdown(r.markdown);
    });
  }, [id]);

  async function save() {
    setSaving(true);
    try {
      await updateRecipeApi(id, { title, markdown });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  if (!recipe) return <div className="mx-auto max-w-3xl p-4 text-slate-400">Loading…</div>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
      <button onClick={onDone} className="self-start text-sm text-blue-400 hover:underline">
        ← Cancel
      </button>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="rounded bg-slate-900 px-3 py-2 text-lg outline-none ring-1 ring-slate-700 focus:ring-blue-500"
      />
      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={24}
        className="rounded bg-slate-900 px-3 py-2 font-mono text-sm outline-none ring-1 ring-slate-700 focus:ring-blue-500"
      />
      <button
        onClick={save}
        disabled={saving}
        className="self-end rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function StepMode({ recipe, onExit }: { recipe: Recipe; onExit: () => void }) {
  const steps = splitSteps(recipe.markdown);
  const [idx, setIdx] = useState(0);
  const current = steps[idx] ?? '';
  const html = marked.parse(current, { async: false }) as string;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-between gap-6 p-6 text-center">
      <div className="flex w-full max-w-5xl items-center justify-between text-sm text-slate-400">
        <button onClick={onExit} className="hover:text-slate-200">
          ← Exit step mode
        </button>
        <span>
          {idx + 1} / {steps.length}
        </span>
      </div>
      <article
        className="prose prose-invert prose-xl max-w-3xl text-left"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="flex gap-6">
        <button
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="rounded-full bg-slate-700 px-8 py-4 text-xl hover:bg-slate-600 disabled:opacity-30"
        >
          Back
        </button>
        <button
          onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}
          disabled={idx >= steps.length - 1}
          className="rounded-full bg-blue-600 px-10 py-4 text-xl font-medium hover:bg-blue-500 disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Split a markdown document into roughly "one step per card" for the kiosk.
 * Strategy: split on headings (##, ###) and on blank lines between ordered
 * list items; each numbered item becomes its own card. Falls back to blank-line
 * chunks.
 */
function splitSteps(md: string): string[] {
  if (!md.trim()) return [''];
  // split out ordered-list items as their own steps
  const withNumbers = md.replace(/\n(\d+\.\s)/g, '\n---STEP---\n$1');
  const byHeading = withNumbers.split(/\n(?=#{2,3}\s)/g);
  const chunks: string[] = [];
  for (const section of byHeading) {
    const parts = section.split(/\n---STEP---\n/g);
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed) chunks.push(trimmed);
    }
  }
  return chunks.length > 0 ? chunks : [md];
}
