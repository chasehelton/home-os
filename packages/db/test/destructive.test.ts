import { describe, it, expect } from 'vitest';
import { scanMigrationSql } from '../src/destructive.js';

describe('scanMigrationSql', () => {
  it('returns clean for additive CREATE TABLE', () => {
    const sql = `
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE INDEX users_name_idx ON users(name);
    `;
    const r = scanMigrationSql(sql);
    expect(r.destructive).toBe(false);
    expect(r.findings).toEqual([]);
  });

  it('returns clean for plain INSERT ... SELECT (no drop/create)', () => {
    const sql = `INSERT INTO backup_users SELECT * FROM users;`;
    expect(scanMigrationSql(sql).destructive).toBe(false);
  });

  it('flags DROP TABLE', () => {
    const r = scanMigrationSql(`DROP TABLE todos;`);
    expect(r.destructive).toBe(true);
    expect(r.findings[0].kind).toBe('drop_table');
    expect(r.findings[0].detail).toContain('TODOS');
  });

  it('flags DROP TABLE IF EXISTS with quoted identifier', () => {
    const r = scanMigrationSql('DROP TABLE IF EXISTS `recipe_old`;');
    expect(r.destructive).toBe(true);
    expect(r.findings[0].kind).toBe('drop_table');
  });

  it('flags ALTER TABLE ... DROP COLUMN', () => {
    const r = scanMigrationSql(`ALTER TABLE recipes DROP COLUMN ingredients_json;`);
    expect(r.destructive).toBe(true);
    expect(r.findings[0].kind).toBe('drop_column');
    expect(r.findings[0].detail).toContain('RECIPES');
    expect(r.findings[0].detail).toContain('INGREDIENTS_JSON');
  });

  it('flags drizzle-style recreate sequence', () => {
    const sql = `
      CREATE TABLE __new_users (id TEXT PRIMARY KEY, email TEXT NOT NULL);
      INSERT INTO __new_users SELECT id, email FROM users;
      DROP TABLE users;
      ALTER TABLE __new_users RENAME TO users;
    `;
    const r = scanMigrationSql(sql);
    expect(r.destructive).toBe(true);
    const kinds = r.findings.map((f) => f.kind);
    expect(kinds).toContain('drop_table');
    expect(kinds).toContain('table_recreate');
  });

  it('ignores destructive SQL inside -- line comments', () => {
    const sql = `-- DROP TABLE old_thing;
      CREATE TABLE ok (id TEXT PRIMARY KEY);`;
    expect(scanMigrationSql(sql).destructive).toBe(false);
  });

  it('ignores destructive SQL inside /* ... */ block comments', () => {
    const sql = `/* DROP TABLE ignored;
      ALTER TABLE x DROP COLUMN y; */
      CREATE TABLE ok (id TEXT PRIMARY KEY);`;
    expect(scanMigrationSql(sql).destructive).toBe(false);
  });

  it('is case-insensitive', () => {
    const r = scanMigrationSql(`drop table lowercase_tbl;`);
    expect(r.destructive).toBe(true);
  });

  it('handles drizzle statement breakpoints', () => {
    const sql = `
      CREATE TABLE a (id INT);
      --> statement-breakpoint
      DROP TABLE b;
    `;
    expect(scanMigrationSql(sql).destructive).toBe(true);
  });
});
