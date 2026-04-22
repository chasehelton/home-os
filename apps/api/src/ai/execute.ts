import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import type { ToolCall } from '@home-os/ai';
import { createTodo, ScopeError } from '../todos/repo.js';
import {
  WriteError,
  createLocalEvent,
  pushPendingForAccount,
  resolveWriteContext,
} from '../calendar/write.js';
import { withAccountLock, type AccountRow, type SyncConfig } from '../calendar/sync.js';
import { safeFetch, FetchSafetyError } from '../recipes/safe-fetch.js';
import { classifyImport, parseToMarkdown } from '../recipes/parse.js';
import { downloadRecipeImage } from '../recipes/images.js';
import { writeRecipeMarkdown } from '../recipes/files.js';
import { createRecipeRow } from '../recipes/repo.js';
import { logAudit } from '../auth/audit.js';
import { hasWriteScope } from '../routes/calendar-helpers.js';

// ---------------------------------------------------------------------------
// Phase 9 — AI tool-call executor.
//
// Each tool maps to existing domain code so the AI path and the HTTP path
// share logic + enforcement. Every function returns a {ok, entityId?, error?}
// outcome; it never throws. Validation errors become {ok:false, error}.
// ---------------------------------------------------------------------------

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export interface ExecuteContext {
  db: DB;
  dataDir: string;
  userId: string;
  syncCfg: SyncConfig;
}

export interface ToolOutcome {
  ok: boolean;
  entityId?: string;
  entityType?: 'todo' | 'calendar_event' | 'recipe';
  error?: string;
}

export async function executeToolCall(ctx: ExecuteContext, call: ToolCall): Promise<ToolOutcome> {
  switch (call.tool) {
    case 'create_todo':
      return execCreateTodo(ctx, call.args);
    case 'create_event':
      return execCreateEvent(ctx, call.args);
    case 'import_recipe':
      return execImportRecipe(ctx, call.args);
    default:
      return { ok: false, error: 'unknown_tool' };
  }
}

function execCreateTodo(
  ctx: ExecuteContext,
  args: Extract<ToolCall, { tool: 'create_todo' }>['args'],
): ToolOutcome {
  try {
    const row = createTodo(ctx.db, ctx.userId, {
      scope: args.scope,
      title: args.title,
      notes: args.notes ?? null,
      dueAt: args.dueAt ?? null,
    });
    logAudit(ctx.db, {
      actorUserId: ctx.userId,
      action: 'ai.create_todo',
      entity: 'todo',
      entityId: row.id,
      after: row,
    });
    return { ok: true, entityId: row.id, entityType: 'todo' };
  } catch (err) {
    if (err instanceof ScopeError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: (err as Error).message };
  }
}

/** Resolve the user's primary, write-capable calendar list (if any). */
function findWritablePrimaryList(
  db: DB,
  userId: string,
): { listId: string; accountId: string } | null {
  const accounts = db
    .select()
    .from(schema.calendarAccounts)
    .where(
      and(eq(schema.calendarAccounts.userId, userId), eq(schema.calendarAccounts.status, 'active')),
    )
    .all();
  for (const a of accounts) {
    if (!hasWriteScope(a.scopes)) continue;
    const list = db
      .select()
      .from(schema.calendarLists)
      .where(and(eq(schema.calendarLists.accountId, a.id), eq(schema.calendarLists.primary, true)))
      .get();
    if (list) return { listId: list.id, accountId: a.id };
  }
  return null;
}

async function execCreateEvent(
  ctx: ExecuteContext,
  args: Extract<ToolCall, { tool: 'create_event' }>['args'],
): Promise<ToolOutcome> {
  const target = findWritablePrimaryList(ctx.db, ctx.userId);
  if (!target) {
    return { ok: false, error: 'no_writable_primary_calendar' };
  }
  try {
    // Validate context (ownership + primary) the same way the REST route does.
    resolveWriteContext(ctx.db, ctx.userId, target.listId);
    const row = createLocalEvent(ctx.db, ctx.userId, {
      calendarListId: target.listId,
      title: args.title,
      description: args.description ?? null,
      location: args.location ?? null,
      allDay: false,
      startAt: args.startAt,
      endAt: args.endAt,
    });
    // Fire inline push so the user sees the event mirrored on Google promptly.
    try {
      const acc = ctx.db
        .select()
        .from(schema.calendarAccounts)
        .where(eq(schema.calendarAccounts.id, target.accountId))
        .get() as AccountRow | undefined;
      if (acc) {
        await withAccountLock(acc.id, () => pushPendingForAccount(ctx.db, acc, ctx.syncCfg));
      }
    } catch {
      // Push failures are tolerable: the worker retries.
    }
    return { ok: true, entityId: row.id, entityType: 'calendar_event' };
  } catch (err) {
    if (err instanceof WriteError) return { ok: false, error: err.code };
    return { ok: false, error: (err as Error).message };
  }
}

async function execImportRecipe(
  ctx: ExecuteContext,
  args: Extract<ToolCall, { tool: 'import_recipe' }>['args'],
): Promise<ToolOutcome> {
  try {
    const html = await safeFetch(args.url, {
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
      const img = await downloadRecipeImage(parsedRecipe.imageUrl, ctx.dataDir, id);
      if (img) imagePath = img.relativePath;
    }
    const row = createRecipeRow(
      ctx.db,
      ctx.userId,
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
    await writeRecipeMarkdown(ctx.dataDir, id, parsedRecipe.markdown);
    logAudit(ctx.db, {
      actorUserId: ctx.userId,
      action: 'ai.import_recipe',
      entity: 'recipe',
      entityId: row.id,
      after: { sourceUrl: html.finalUrl, importStatus: status },
    });
    return { ok: true, entityId: row.id, entityType: 'recipe' };
  } catch (err) {
    if (err instanceof FetchSafetyError) {
      return { ok: false, error: `fetch_failed: ${err.message}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}
