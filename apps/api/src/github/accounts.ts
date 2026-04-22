import { eq } from 'drizzle-orm';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import { makeTokenCrypto, deriveTokenKey, type TokenCrypto } from '../auth/crypto.js';
import type { Env } from '../env.js';

// ---------------------------------------------------------------------------
// Helpers for the Phase 9 GitHub account connection.
//
// The GitHub OAuth access token is stored encrypted in `github_accounts` and
// is used only to mint short-lived Copilot session tokens. We never persist
// the Copilot session token itself — the provider caches it in memory.
// ---------------------------------------------------------------------------

export interface GithubAccountRow {
  id: string;
  userId: string;
  githubUserId: number;
  githubLogin: string;
  scopes: string;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export function getGithubAccountPublic(db: DB, userId: string): GithubAccountRow | null {
  const row = db
    .select({
      id: schema.githubAccounts.id,
      userId: schema.githubAccounts.userId,
      githubUserId: schema.githubAccounts.githubUserId,
      githubLogin: schema.githubAccounts.githubLogin,
      scopes: schema.githubAccounts.scopes,
      status: schema.githubAccounts.status,
      createdAt: schema.githubAccounts.createdAt,
      updatedAt: schema.githubAccounts.updatedAt,
    })
    .from(schema.githubAccounts)
    .where(eq(schema.githubAccounts.userId, userId))
    .get();
  return row ?? null;
}

/**
 * Returns a `getGithubToken(userId)` function suitable for handing to
 * `CopilotProvider`. The returned function resolves to null if the user has
 * no active connection — CopilotProvider maps that to `github_not_connected`.
 */
export function makeGithubTokenLookup(env: Env, db: DB): (userId: string) => string | null {
  const crypto: TokenCrypto = makeTokenCrypto(deriveTokenKey(env));
  return (userId: string): string | null => {
    const row = db
      .select({
        accessTokenEnc: schema.githubAccounts.accessTokenEnc,
        status: schema.githubAccounts.status,
      })
      .from(schema.githubAccounts)
      .where(eq(schema.githubAccounts.userId, userId))
      .get();
    if (!row || row.status !== 'active' || !row.accessTokenEnc) return null;
    try {
      return crypto.open(row.accessTokenEnc);
    } catch {
      return null;
    }
  };
}

export function upsertGithubAccount(
  env: Env,
  db: DB,
  params: {
    id: string;
    userId: string;
    githubUserId: number;
    githubLogin: string;
    accessToken: string;
    scopes: string;
  },
): void {
  const crypto = makeTokenCrypto(deriveTokenKey(env));
  const enc = crypto.seal(params.accessToken);
  const now = new Date().toISOString();
  const existing = db
    .select({ id: schema.githubAccounts.id })
    .from(schema.githubAccounts)
    .where(eq(schema.githubAccounts.userId, params.userId))
    .get();
  if (existing) {
    db.update(schema.githubAccounts)
      .set({
        githubUserId: params.githubUserId,
        githubLogin: params.githubLogin,
        accessTokenEnc: enc,
        scopes: params.scopes,
        status: 'active',
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.githubAccounts.userId, params.userId))
      .run();
    return;
  }
  db.insert(schema.githubAccounts)
    .values({
      id: params.id,
      userId: params.userId,
      githubUserId: params.githubUserId,
      githubLogin: params.githubLogin,
      accessTokenEnc: enc,
      scopes: params.scopes,
      status: 'active',
    })
    .run();
}

export function deleteGithubAccount(db: DB, userId: string): void {
  db.delete(schema.githubAccounts).where(eq(schema.githubAccounts.userId, userId)).run();
}
