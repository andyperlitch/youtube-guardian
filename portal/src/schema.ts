/**
 * Core + forward-looking tables.
 *
 * Implemented now:
 *   devices, allowlist_entries
 *
 * Stubbed for later (tables exist; no product features yet):
 *   watch_events          — per-play history / stats
 *   daily_time_limits     — minutes allowed per weekday (0=Sun … 6=Sat)
 *   channel_age_analysis  — age-appropriateness notes for a channel
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pairing_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allowlist_entries (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  list_kind TEXT NOT NULL,
  channel_id TEXT,
  handle TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_allowlist_device_kind
  ON allowlist_entries(device_id, list_kind);

CREATE TABLE IF NOT EXISTS watch_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  channel_id TEXT,
  handle TEXT,
  video_id TEXT,
  content_kind TEXT,
  started_at TEXT,
  duration_seconds INTEGER,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_time_limits (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  limit_minutes INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_age_analysis (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  handle TEXT,
  suggested_min_age INTEGER,
  labels TEXT,
  notes TEXT,
  source TEXT,
  analyzed_at TEXT
);
`;

export async function migrate(db: { exec(sql: string): Promise<void> }) {
  // node:sqlite exec() does not always accept multiple statements; split.
  const statements = SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await db.exec(`${stmt};`);
  }
}
