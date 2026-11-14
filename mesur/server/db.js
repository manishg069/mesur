import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();

/** Open (and migrate) the database. `path` may be ":memory:" for tests. */
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  raw.exec(readFileSync(resolve(here, 'schema.sql'), 'utf8'));

  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const db = {
    raw,
    get: (sql, ...p) => prep(sql).get(...p) ?? null,
    all: (sql, ...p) => prep(sql).all(...p),
    run: (sql, ...p) => prep(sql).run(...p),
    /** Run fn inside a transaction; rolls back on throw. */
    tx(fn) {
      raw.exec('BEGIN');
      try { const out = fn(); raw.exec('COMMIT'); return out; }
      catch (err) { raw.exec('ROLLBACK'); throw err; }
    },
    /** INSERT a row from an object; adds id and timestamps when the caller omits them. */
    insert(table, row) {
      const t = now();
      const full = { id: uuid(), created_at: t, updated_at: t, ...row };
      if (table === 'recommendation_events') delete full.updated_at;
      const keys = Object.keys(full);
      prep(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => full[k]));
      return full;
    },
    /** UPDATE by id from an object; bumps updated_at. */
    update(table, id, patch) {
      const full = { ...patch, updated_at: now() };
      const keys = Object.keys(full);
      prep(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => full[k]), id);
    },
    close: () => raw.close(),
  };
  return db;
}

export const parseJson = (text, fallback) => {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
};
