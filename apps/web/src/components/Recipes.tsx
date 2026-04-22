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
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Input, Textarea } from './ui/Input';
import { Badge } from './ui/Badge';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

type View = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'edit'; id: string };

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
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-margin md:py-lg">
      <PageHeader
        title="Recipes"
        description="A curated shelf — paste a URL and home-os tucks it away as a clean markdown note."
      />

      <Card variant="tonal" padding="sm" className="sm:p-4">
        <form onSubmit={doImport} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a recipe URL…"
            className="flex-1"
            disabled={importing}
          />
          <Button type="submit" disabled={importing}>
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
          {error}
        </div>
      )}

      {summaries.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden>◉</span>}
          title="No recipes yet"
          description="Paste a URL above — home-os will strip out the life story and keep the cooking."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setView({ kind: 'detail', id: r.id })}
                className="group flex w-full flex-col overflow-hidden rounded-lg bg-surface-lowest text-left shadow-ambient transition-all duration-200 ease-soft hover:-translate-y-0.5 hover:shadow-ambient-lg"
              >
                {r.imagePath ? (
                  <img
                    src={`/api/recipes/${r.id}/image`}
                    alt=""
                    className="aspect-video w-full object-cover"
                  />
                ) : (
                  <div className="aspect-video w-full bg-surface-container" />
                )}
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <p className="font-display text-headline-md text-on-surface">{r.title}</p>
                  {r.siteName && (
                    <p className="text-label-md text-on-surface-variant">{r.siteName}</p>
                  )}
                  {r.importStatus === 'partial' && (
                    <Badge tone="secondary" className="mt-1 self-start">
                      Needs review
                    </Badge>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
    void getRecipe(id)
      .then(setRecipe)
      .catch((e) => setError((e as Error).message));
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-margin">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <div className="mt-4 rounded-md bg-danger-container px-3 py-2 text-label-md text-danger-on-container">
          {error}
        </div>
      </div>
    );
  }
  if (!recipe) {
    return <div className="mx-auto max-w-3xl p-8 text-body-md text-on-surface-variant">Loading…</div>;
  }

  if (stepMode) {
    return <StepMode recipe={recipe} onExit={() => setStepMode(false)} />;
  }

  const html = marked.parse(recipe.markdown, { async: false }) as string;

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 md:px-margin md:py-lg">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to recipes
        </Button>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setStepMode(true)}>
            Step mode
          </Button>
          <Button size="sm" variant="tonal" onClick={onEdit}>
            Edit
          </Button>
        </div>
      </div>
      {recipe.imagePath && (
        <img
          src={`/api/recipes/${recipe.id}/image`}
          alt=""
          className="mt-6 aspect-video w-full rounded-xl object-cover shadow-ambient"
        />
      )}
      <h1 className="mt-8 font-display text-display-lg text-on-surface">{recipe.title}</h1>
      {(recipe.author || recipe.siteName) && (
        <p className="mt-2 text-label-md text-on-surface-variant">
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
                className="text-primary underline underline-offset-2 hover:brightness-110"
              >
                source
              </a>
            </>
          )}
        </p>
      )}
      <div
        className="prose-home mt-8"
        // marked output is trusted-enough for a household-only app; we already
        // limit input sources (our own imports + our own edits).
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="mt-12 border-t border-outline-variant/60 pt-6">
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            if (!confirm(`Delete "${recipe.title}"?`)) return;
            await deleteRecipeApi(recipe.id);
            onBack();
          }}
        >
          Delete recipe
        </Button>
      </div>
    </article>
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

  if (!recipe) {
    return <div className="mx-auto max-w-3xl p-8 text-body-md text-on-surface-variant">Loading…</div>;
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8 md:px-margin md:py-lg">
      <Button variant="ghost" size="sm" onClick={onDone} className="self-start">
        ← Cancel
      </Button>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-body-lg"
      />
      <Textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        rows={24}
        className="font-mono text-body-md"
      />
      <Button onClick={save} disabled={saving} className="self-end">
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </section>
  );
}

function StepMode({ recipe, onExit }: { recipe: Recipe; onExit: () => void }) {
  const steps = splitSteps(recipe.markdown);
  const [idx, setIdx] = useState(0);
  const current = steps[idx] ?? '';
  const html = marked.parse(current, { async: false }) as string;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-between gap-6 bg-surface px-6 py-lg text-center">
      <div className="flex w-full max-w-5xl items-center justify-between text-label-md text-on-surface-variant">
        <Button variant="ghost" size="sm" onClick={onExit}>
          ← Exit step mode
        </Button>
        <Badge tone="primary">
          {idx + 1} / {steps.length}
        </Badge>
      </div>
      <div
        className="prose-home max-w-3xl text-left"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="flex gap-6">
        <Button
          size="lg"
          variant="tonal"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="rounded-full px-10 py-4 text-body-lg"
        >
          Back
        </Button>
        <Button
          size="lg"
          onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}
          disabled={idx >= steps.length - 1}
          className="rounded-full px-12 py-4 text-body-lg"
        >
          Next
        </Button>
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
