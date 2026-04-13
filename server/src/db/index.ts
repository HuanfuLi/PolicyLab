import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

const dbDir = path.join(os.homedir(), '.policylab');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'policylab.db');
const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrency & tune for high-frequency writes
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('cache_size = -20000');   // ~20 MB page cache
sqlite.pragma('busy_timeout = 5000');   // wait up to 5 s on lock contention

export const db = drizzle(sqlite, { schema });
export { sqlite };

// ── Schema migrations (ALTER TABLE guards for additive column additions) ──────
// These are one-time idempotent guards that add columns to existing DBs.
// Drizzle ORM does not auto-migrate on start; we use try/catch ALTER TABLE.

try {
  // GC1: add employees column to enterprises table (Phase 10 gap closure)
  sqlite.prepare("ALTER TABLE enterprises ADD COLUMN employees TEXT NOT NULL DEFAULT '[]'").run();
} catch {
  // Column already exists — safe to ignore
}

try {
  // [H2] Add createdAtIteration to deposit_accounts so interest-accrual can
  // distinguish "created this tick" from "touched this tick". Existing rows
  // default to 0, which makes them NOT match any non-zero iterNum filter —
  // i.e., existing deposits are treated as pre-existing and accrue interest,
  // which is the correct behavior for legacy data.
  sqlite.prepare("ALTER TABLE deposit_accounts ADD COLUMN created_at_iteration INTEGER NOT NULL DEFAULT 0").run();
} catch {
  // Column already exists — safe to ignore
}
