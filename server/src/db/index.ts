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

const dbPath = path.join(dbDir, .policylab.db');
const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrency & tune for high-frequency writes
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('cache_size = -20000');   // ~20 MB page cache
sqlite.pragma('busy_timeout = 5000');   // wait up to 5 s on lock contention

export const db = drizzle(sqlite, { schema });
export { sqlite };
