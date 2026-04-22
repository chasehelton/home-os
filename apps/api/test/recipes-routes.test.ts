import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTestApp } from './_helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/sessions.js';
import { schema } from '@home-os/db';

let ctx: Awaited<ReturnType<typeof makeTestApp>>;

beforeEach(async () => {
  ctx = await makeTestApp();
  ctx.deps.db
    .insert(schema.users)
    .values({
      id: 'u-jane',
      email: 'jane@example.com',
      emailVerified: true,
      displayName: 'Jane',
      googleSub: 'g1',
    })
    .run();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await ctx.cleanup();
});

function cookieFor(userId: string): string {
  const { id } = createSession(ctx.deps.db, { userId });
  const signed = (ctx.app as unknown as { signCookie: (v: string) => string }).signCookie(id);
  return `${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
}

describe('recipe routes', () => {
  it('requires auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/recipes' });
    expect(res.statusCode).toBe(401);
  });

  it('creates a manual recipe with markdown stored on disk', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: {
        title: 'Pancakes',
        description: 'Fluffy stack',
        markdown: '# Pancakes\n\n- 2 cups flour\n- 2 eggs\n\nMix and cook.\n',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('Pancakes');
    expect(body.importStatus).toBe('manual');
    expect(body.markdown).toContain('Pancakes');

    const file = await fs.readFile(path.join(ctx.dataDir, 'recipes', `${body.id}.md`), 'utf8');
    expect(file).toContain('Pancakes');
  });

  it('rejects an import URL that resolves to a private IP', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes/import',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { url: 'http://127.0.0.1/recipe' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('fetch_failed');
  });

  it('imports a recipe using defuddle (fetch is mocked)', async () => {
    const html = `<!doctype html><html><head>
      <title>Mock Soup</title>
      <meta property="og:image" content="https://example.com/soup.jpg" />
      <script type="application/ld+json">
      { "@type":"Recipe", "name":"Mock Soup", "description":"Cozy.",
        "image":["https://example.com/soup.jpg"] }
      </script></head>
      <body><article><h1>Mock Soup</h1>
      <p>A very comforting soup for cold evenings, easy to make with pantry ingredients.</p>
      <h2>Ingredients</h2><ul><li>broth</li><li>noodles</li><li>herbs</li></ul>
      <h2>Instructions</h2><ol><li>Simmer broth.</li><li>Add noodles.</li><li>Garnish with herbs.</li></ol>
      </article></body></html>`;

    const realFetch = globalThis.fetch;
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: Parameters<typeof fetch>[0]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        if (url.startsWith('https://example.org/recipe')) {
          return new Response(html, {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }
        if (url.startsWith('https://example.com/soup.jpg')) {
          return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          });
        }
        return realFetch(input);
      });

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes/import',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { url: 'https://example.org/recipe' },
    });
    expect(mock).toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toMatch(/Mock Soup/i);
    expect(body.sourceUrl).toBe('https://example.org/recipe');
    expect(body.markdown.toLowerCase()).toContain('broth');
    expect(body.importStatus === 'imported' || body.importStatus === 'partial').toBe(true);
  });

  it('updates markdown and promotes partial imports to manual', async () => {
    // seed a "partial" row directly
    const seed = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { title: 'Tmp', markdown: 'short' },
    });
    const id = seed.json().id as string;
    // force importStatus to 'partial' to test the promotion path
    ctx.deps.sqlite.prepare('UPDATE recipes SET import_status=? WHERE id=?').run('partial', id);

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/recipes/${id}`,
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { title: 'Better Title', markdown: '# Better Title\n\nFilled in.' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe('Better Title');
    expect(body.markdown).toContain('Filled in');
    expect(body.importStatus).toBe('manual');
  });

  it('deletes a recipe and removes the markdown file', async () => {
    const seed = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes',
      headers: { cookie: cookieFor('u-jane'), 'content-type': 'application/json' },
      payload: { title: 'Tmp', markdown: 'body' },
    });
    const id = seed.json().id as string;
    const filePath = path.join(ctx.dataDir, 'recipes', `${id}.md`);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/recipes/${id}`,
      headers: { cookie: cookieFor('u-jane') },
    });
    expect(del.statusCode).toBe(204);
    await expect(fs.access(filePath)).rejects.toThrow();
  });
});
