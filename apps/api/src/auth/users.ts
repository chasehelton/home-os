import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DB } from '@home-os/db';
import { schema } from '@home-os/db';
import type { OidcVerifiedClaims } from './oidc.js';

export interface UserRow {
  id: string;
  googleSub: string | null;
  email: string;
  emailVerified: boolean;
  displayName: string;
  pictureUrl: string | null;
  color: string | null;
  pinHash: string | null;
  createdAt: string;
}

export function findUserBySub(db: DB, sub: string): UserRow | null {
  return db.select().from(schema.users).where(eq(schema.users.googleSub, sub)).get() ?? null;
}

export function findUserByEmail(db: DB, email: string): UserRow | null {
  return (
    db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).get() ?? null
  );
}

export function findUserById(db: DB, id: string): UserRow | null {
  return db.select().from(schema.users).where(eq(schema.users.id, id)).get() ?? null;
}

/**
 * Look up by Google sub first, then by email (for first-time linking when an
 * allowlisted user has been pre-seeded). Insert if neither matches. Always
 * keeps email/displayName/picture in sync with the latest claims.
 */
export function upsertUserFromClaims(db: DB, claims: OidcVerifiedClaims): UserRow {
  const existing = findUserBySub(db, claims.sub) ?? findUserByEmail(db, claims.email);

  if (existing) {
    db.update(schema.users)
      .set({
        googleSub: claims.sub,
        email: claims.email,
        emailVerified: claims.emailVerified,
        displayName: claims.name,
        pictureUrl: claims.pictureUrl,
      })
      .where(eq(schema.users.id, existing.id))
      .run();
    return findUserById(db, existing.id)!;
  }

  const id = nanoid(21);
  db.insert(schema.users)
    .values({
      id,
      googleSub: claims.sub,
      email: claims.email,
      emailVerified: claims.emailVerified,
      displayName: claims.name,
      pictureUrl: claims.pictureUrl,
    })
    .run();
  return findUserById(db, id)!;
}
