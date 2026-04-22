import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { CreateRecipeInput, ImportRecipeInput, UpdateRecipeInput } from '@home-os/shared';
import { requireUser } from '../auth/middleware.js';
import { logAudit } from '../auth/audit.js';
import {
  createRecipeRow,
  deleteRecipeRow,
  findRecipeById,
  listRecipes,
  touchRecipe,
  updateRecipeRow,
  type RecipeRow,
} from '../recipes/repo.js';
import { safeFetch, FetchSafetyError } from '../recipes/safe-fetch.js';
import { classifyImport, parseToMarkdown } from '../recipes/parse.js';
import { downloadRecipeImage, resolveImagePath } from '../recipes/images.js';
import { deleteRecipeMarkdown, readRecipeMarkdown, writeRecipeMarkdown } from '../recipes/files.js';

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

function summarize(row: RecipeRow) {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    title: row.title,
    description: row.description,
    author: row.author,
    siteName: row.siteName,
    domain: row.domain,
    imagePath: row.imagePath,
    imageSourceUrl: row.imageSourceUrl,
    importStatus: row.importStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function registerRecipeRoutes(app: FastifyInstance) {
  const auth = requireUser(app);
  const dataDir = app.deps.dataDir;

  app.get('/api/recipes', { preHandler: auth }, async (_req, reply) => {
    return reply.send({ recipes: listRecipes(app.deps.db).map(summarize) });
  });

  app.get<{ Params: { id: string } }>(
    '/api/recipes/:id',
    { preHandler: auth },
    async (req, reply) => {
      const row = findRecipeById(app.deps.db, req.params.id);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      const markdown = await readRecipeMarkdown(dataDir, row.id);
      return reply.send({ ...summarize(row), markdown });
    },
  );

  app.post('/api/recipes', { preHandler: auth }, async (req, reply) => {
    const parsed = CreateRecipeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    const { markdown, ...meta } = parsed.data;
    const row = createRecipeRow(app.deps.db, req.user!.id, meta, { importStatus: 'manual' });
    await writeRecipeMarkdown(dataDir, row.id, markdown);
    logAudit(app.deps.db, {
      actorUserId: req.user!.id,
      action: 'create',
      entity: 'recipe',
      entityId: row.id,
      after: summarize(row),
    });
    return reply.code(201).send({ ...summarize(row), markdown });
  });

  app.post('/api/recipes/import', { preHandler: auth }, async (req, reply) => {
    const parsed = ImportRecipeInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
    }
    try {
      const html = await safeFetch(parsed.data.url, {
        maxBytes: MAX_HTML_BYTES,
        timeoutMs: FETCH_TIMEOUT_MS,
        accept: 'text/html,application/xhtml+xml',
      });
      const text = new TextDecoder('utf-8', { fatal: false }).decode(html.bytes);
      const parsedRecipe = await parseToMarkdown(text, html.finalUrl);
      const status = classifyImport(parsedRecipe);

      const id = nanoid(21);
      let imagePath: string | null = null;
      let imageSourceUrl: string | null = null;
      if (parsedRecipe.imageUrl) {
        imageSourceUrl = parsedRecipe.imageUrl;
        const img = await downloadRecipeImage(parsedRecipe.imageUrl, dataDir, id);
        if (img) imagePath = img.relativePath;
      }

      const row = createRecipeRow(
        app.deps.db,
        req.user!.id,
        {
          title: parsedRecipe.title ?? 'Untitled recipe',
          description: parsedRecipe.description,
          author: parsedRecipe.author,
          siteName: parsedRecipe.siteName,
          domain: parsedRecipe.domain,
          sourceUrl: html.finalUrl,
        },
        { id, importStatus: status, imagePath, imageSourceUrl },
      );
      await writeRecipeMarkdown(dataDir, id, parsedRecipe.markdown);
      logAudit(app.deps.db, {
        actorUserId: req.user!.id,
        action: 'import',
        entity: 'recipe',
        entityId: row.id,
        after: { sourceUrl: html.finalUrl, importStatus: status },
      });
      return reply.code(201).send({ ...summarize(row), markdown: parsedRecipe.markdown });
    } catch (err) {
      if (err instanceof FetchSafetyError) {
        return reply.code(422).send({ error: 'fetch_failed', message: err.message });
      }
      throw err as Error;
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/api/recipes/:id',
    { preHandler: auth },
    async (req, reply) => {
      const parsed = UpdateRecipeInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_body', details: parsed.error.format() });
      }
      const before = findRecipeById(app.deps.db, req.params.id);
      if (!before) return reply.code(404).send({ error: 'not_found' });
      const { markdown, ...meta } = parsed.data;

      let row: RecipeRow | null = before;
      const metaTouched = Object.keys(meta).length > 0;
      if (metaTouched) {
        row = updateRecipeRow(app.deps.db, req.params.id, meta);
        if (!row) return reply.code(404).send({ error: 'not_found' });
      }
      if (markdown !== undefined) {
        await writeRecipeMarkdown(dataDir, req.params.id, markdown);
        if (!metaTouched) {
          touchRecipe(app.deps.db, req.params.id);
          row = findRecipeById(app.deps.db, req.params.id);
        }
      }

      const finalMarkdown =
        markdown !== undefined ? markdown : await readRecipeMarkdown(dataDir, req.params.id);

      logAudit(app.deps.db, {
        actorUserId: req.user!.id,
        action: 'update',
        entity: 'recipe',
        entityId: req.params.id,
        before: summarize(before),
        after: row ? summarize(row) : null,
      });
      return reply.send({ ...summarize(row!), markdown: finalMarkdown });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/recipes/:id',
    { preHandler: auth },
    async (req, reply) => {
      const row = deleteRecipeRow(app.deps.db, req.params.id);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      await deleteRecipeMarkdown(dataDir, req.params.id);
      logAudit(app.deps.db, {
        actorUserId: req.user!.id,
        action: 'delete',
        entity: 'recipe',
        entityId: row.id,
        before: summarize(row),
      });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/recipes/:id/image',
    { preHandler: auth },
    async (req, reply) => {
      const row = findRecipeById(app.deps.db, req.params.id);
      if (!row || !row.imagePath) return reply.code(404).send({ error: 'not_found' });
      const resolved = resolveImagePath(dataDir, row.imagePath);
      if (!resolved || !fs.existsSync(resolved))
        return reply.code(404).send({ error: 'not_found' });
      const ext = resolved.split('.').pop()?.toLowerCase();
      const ct =
        ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : 'image/jpeg';
      reply.header('content-type', ct);
      reply.header('cache-control', 'private, max-age=86400');
      return reply.send(fs.createReadStream(resolved));
    },
  );
}
