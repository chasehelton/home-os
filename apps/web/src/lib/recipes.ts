export interface RecipeSummary {
  id: string;
  sourceUrl: string | null;
  title: string;
  description: string | null;
  author: string | null;
  siteName: string | null;
  domain: string | null;
  imagePath: string | null;
  imageSourceUrl: string | null;
  importStatus: 'imported' | 'partial' | 'manual';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Recipe extends RecipeSummary {
  markdown: string;
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

export async function listRecipes(): Promise<RecipeSummary[]> {
  const data = await jsonFetch<{ recipes: RecipeSummary[] }>('/api/recipes');
  return data.recipes;
}

export async function getRecipe(id: string): Promise<Recipe> {
  return jsonFetch<Recipe>(`/api/recipes/${id}`);
}

export async function importRecipeApi(url: string): Promise<Recipe> {
  return jsonFetch<Recipe>('/api/recipes/import', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export async function createRecipeApi(body: {
  title: string;
  markdown: string;
  sourceUrl?: string | null;
}): Promise<Recipe> {
  return jsonFetch<Recipe>('/api/recipes', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateRecipeApi(
  id: string,
  body: Partial<{ title: string; markdown: string; description: string | null }>
): Promise<Recipe> {
  return jsonFetch<Recipe>(`/api/recipes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteRecipeApi(id: string): Promise<void> {
  await jsonFetch<void>(`/api/recipes/${id}`, { method: 'DELETE' });
}
