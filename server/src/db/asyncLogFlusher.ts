/**
 * AsyncLogFlusher — in-memory queue for non-critical DB inserts.
 *
 * Inserts are accumulated and flushed in bulk either:
 *   • every FLUSH_INTERVAL_MS (default 500 ms), OR
 *   • when the queue exceeds BULK_THRESHOLD rows.
 *
 * This prevents the main simulation loop from blocking on individual
 * INSERT statements for high-volume tables (agent_intents, resolved_actions).
 */
import { sqlite } from './index.js';

interface QueuedInsert {
  table: string;
  columns: string[];
  values: unknown[][];
}

const FLUSH_INTERVAL_MS = 500;
const BULK_THRESHOLD = 200;

class AsyncLogFlusher {
  private queue: QueuedInsert[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Prepared-statement cache keyed by "table|col1,col2,…" */
  private stmtCache = new Map<string, ReturnType<typeof sqlite.prepare>>();

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Drain remaining items
    this.flush();
  }

  /**
   * Enqueue a row for deferred insertion.
   * @param table  - raw SQLite table name (e.g. 'agent_intents')
   * @param columns - column names in insertion order
   * @param values  - corresponding values (same order as columns)
   */
  enqueue(table: string, columns: string[], values: unknown[]): void {
    this.queue.push({ table, columns, values: [values] });
    if (this.queue.length >= BULK_THRESHOLD) {
      this.flush();
    }
  }

  /** Flush all queued rows to SQLite in a single transaction. */
  flush(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);

    // Group by table+columns signature so we can reuse prepared statements
    const groups = new Map<string, { table: string; columns: string[]; rows: unknown[][] }>();
    for (const item of batch) {
      const key = `${item.table}|${item.columns.join(',')}`;
      let group = groups.get(key);
      if (!group) {
        group = { table: item.table, columns: item.columns, rows: [] };
        groups.set(key, group);
      }
      group.rows.push(...item.values);
    }

    sqlite.transaction(() => {
      for (const [key, group] of groups) {
        let stmt = this.stmtCache.get(key);
        if (!stmt) {
          const placeholders = group.columns.map(() => '?').join(', ');
          const sql = `INSERT INTO ${group.table} (${group.columns.join(', ')}) VALUES (${placeholders})`;
          stmt = sqlite.prepare(sql);
          this.stmtCache.set(key, stmt);
        }
        for (const row of group.rows) {
          (stmt.run as (...params: unknown[]) => void)(...row);
        }
      }
    })();
  }
}

export const asyncLogFlusher = new AsyncLogFlusher();
