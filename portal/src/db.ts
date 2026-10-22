import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

export type SqlValue = string | number | null | bigint;
export type SqlParams = SqlValue[];

export interface Db {
  kind: "sqlite" | "postgres";
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParams): Promise<{ changes: number }>;
  get<T>(sql: string, params?: SqlParams): Promise<T | undefined>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  close(): Promise<void>;
}

function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export function createSqliteDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");

  return {
    kind: "sqlite",
    async exec(sql: string) {
      db.exec(sql);
    },
    async run(sql: string, params: SqlParams = []) {
      const stmt = db.prepare(sql);
      const result = stmt.run(...(params as SqlValue[]));
      return { changes: Number(result.changes || 0) };
    },
    async get<T>(sql: string, params: SqlParams = []) {
      const stmt = db.prepare(sql);
      return (stmt.get(...(params as SqlValue[])) as T | undefined) ?? undefined;
    },
    async all<T>(sql: string, params: SqlParams = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...(params as SqlValue[])) as T[];
    },
    async close() {
      db.close();
    },
  };
}

export function createPostgresDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });

  return {
    kind: "postgres",
    async exec(sql: string) {
      await pool.query(sql);
    },
    async run(sql: string, params: SqlParams = []) {
      const res = await pool.query(toPg(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async get<T>(sql: string, params: SqlParams = []) {
      const res = await pool.query(toPg(sql), params);
      return (res.rows[0] as T | undefined) ?? undefined;
    },
    async all<T>(sql: string, params: SqlParams = []) {
      const res = await pool.query(toPg(sql), params);
      return res.rows as T[];
    },
    async close() {
      await pool.end();
    },
  };
}

export function openDbFromEnv(env: NodeJS.ProcessEnv): Db {
  const url = env.DATABASE_URL || "";
  if (/^postgres(ql)?:\/\//i.test(url)) {
    return createPostgresDb(url);
  }
  const file = env.SQLITE_PATH || url || "./data/portal.db";
  return createSqliteDb(file);
}
