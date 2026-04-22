/**
 * Static analysis of a migration's SQL for patterns that can cause irreversible
 * data loss. Used by the Phase 10 migration safety gate (see
 * `pnpm --filter=@home-os/db migrate:safe`, invoked by scripts/deploy.sh).
 * A migration flagged as destructive must
 * be re-run with `HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS=1` (or the `--allow`
 * flag on the CLI).
 *
 * We normalize the SQL first (strip comments, collapse whitespace, uppercase)
 * and then look for:
 *
 *   1. `DROP TABLE` (ignoring temp `__old_*` / `__new_*` names used by
 *      drizzle's table-recreate pattern — but see #3 which catches those).
 *   2. `ALTER TABLE ... DROP COLUMN`.
 *   3. Table-recreate sequences: the presence of a `DROP TABLE` together with
 *      a `CREATE TABLE` + `INSERT ... SELECT` copy indicates a destructive
 *      recreate even if individual statements look benign.
 *
 * We deliberately do NOT auto-whitelist the recreate sequence — the point of
 * the gate is that a human looks at it and confirms the copy step is correct
 * before running it on production data.
 */

export interface DestructiveFinding {
  kind: 'drop_table' | 'drop_column' | 'table_recreate';
  detail: string;
}

export interface ScanResult {
  destructive: boolean;
  findings: DestructiveFinding[];
}

function normalize(sql: string): string {
  // Strip /* ... */ block comments (non-greedy, multiline).
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Strip -- line comments.
  out = out.replace(/--[^\n]*/g, ' ');
  // Collapse whitespace and uppercase for pattern matching.
  out = out.replace(/\s+/g, ' ').trim().toUpperCase();
  return out;
}

function splitStatements(normalizedSql: string): string[] {
  // Drizzle uses `--> statement-breakpoint` between statements, which the
  // normalizer has already stripped. Fall back to semicolons.
  return normalizedSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function scanMigrationSql(sql: string): ScanResult {
  const normalized = normalize(sql);
  const statements = splitStatements(normalized);

  const findings: DestructiveFinding[] = [];

  let sawDropTable = false;
  let sawCreateTable = false;
  let sawInsertSelect = false;

  for (const stmt of statements) {
    if (/^DROP\s+TABLE\b/.test(stmt)) {
      sawDropTable = true;
      const m = stmt.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?([A-Z0-9_]+)[`"]?/);
      findings.push({
        kind: 'drop_table',
        detail: m ? `DROP TABLE ${m[1]}` : 'DROP TABLE',
      });
    }
    if (/\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b/.test(stmt)) {
      const m = stmt.match(
        /ALTER\s+TABLE\s+[`"]?([A-Z0-9_]+)[`"]?[^;]*DROP\s+COLUMN\s+[`"]?([A-Z0-9_]+)[`"]?/,
      );
      findings.push({
        kind: 'drop_column',
        detail: m ? `ALTER TABLE ${m[1]} DROP COLUMN ${m[2]}` : 'ALTER TABLE ... DROP COLUMN',
      });
    }
    if (/^CREATE\s+TABLE\b/.test(stmt)) {
      sawCreateTable = true;
    }
    if (/^INSERT\s+INTO\b[^;]*\bSELECT\b/.test(stmt)) {
      sawInsertSelect = true;
    }
  }

  // If the migration both drops a table AND recreates one with a copy step,
  // treat that as a "recreate" finding on top of the drop — makes the reason
  // clearer in the CLI output.
  if (sawDropTable && sawCreateTable && sawInsertSelect) {
    findings.push({
      kind: 'table_recreate',
      detail: 'CREATE TABLE + INSERT...SELECT + DROP TABLE (recreate pattern)',
    });
  }

  return { destructive: findings.length > 0, findings };
}
