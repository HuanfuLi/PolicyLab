/**
 * AsyncLogFlusher — in-memory queue for non-critical DB inserts.
 *
 * Inserts are accumulated and flushed in bulk either:
 *   • every FLUSH_INTERVAL_MS (default 500 ms), OR
 *   • when the queue exceeds BULK_THRESHOLD rows.
 *
 * This prevents the main simulation loop from blocking on individual
 * INSERT statements for high-volume tables (agent_intents, resolved_actions).
 *
 * Events emitted:
 *   'data-loss' — { rowsLost: number, table: string } — emitted when rows are
 *   permanently dropped after exhausting all retry attempts.
 */
import { EventEmitter } from 'events';
import { sqlite } from './index.js';

export interface DataLossPayload {
  rowsLost: number;
  /** The table name of the first dropped item in the batch, or 'unknown'. */
  table: string;
}

interface QueuedInsert {
  table: string;
  columns: string[];
  values: unknown[][];
}

const FLUSH_INTERVAL_MS = 500;
const BULK_THRESHOLD = 200;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_QUEUE_SIZE = 10_000;

class AsyncLogFlusher extends EventEmitter {
  private queue: QueuedInsert[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
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
    // D2 fix: Retry flush up to MAX_RETRY_ATTEMPTS to avoid losing the
    // final batch when the timer is already cleared.
    for (let i = 0; i < MAX_RETRY_ATTEMPTS && this.queue.length > 0; i++) {
      this.flush();
    }
    if (this.queue.length > 0) {
      const rowsLost = this.queue.length;
      const table = this.queue[0]?.table ?? 'unknown';
      console.error(`[asyncLogFlusher] ${rowsLost} rows lost after ${MAX_RETRY_ATTEMPTS} drain attempts on stop()`);
      this.emit('data-loss', { rowsLost, table } satisfies DataLossPayload);
      this.queue.length = 0;
    }
  }

  /**
   * Enqueue a row for deferred insertion.
   * @param table  - raw SQLite table name (e.g. 'agent_intents')
   * @param columns - column names in insertion order
   * @param values  - corresponding values (same order as columns)
   */
  enqueue(table: string, columns: string[], values: unknown[]): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      console.error(`[asyncLogFlusher] Queue full (${MAX_QUEUE_SIZE} rows) — dropping oldest ${BULK_THRESHOLD} rows to prevent OOM`);
      this.queue.splice(0, BULK_THRESHOLD);
    }
    this.queue.push({ table, columns, values: [values] });
    if (this.queue.length >= BULK_THRESHOLD) {
      this.flush();
    }
  }

  /** Flush all queued rows to SQLite in a single transaction. */
  flush(): void {
    if (this.queue.length === 0) return;

    // Snapshot the batch but DON'T splice yet — only clear after successful commit
    const batch = this.queue.slice(0);

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

    try {
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
      // Transaction succeeded — now clear the committed items from the queue
      this.queue.splice(0, batch.length);
      this.consecutiveFailures = 0;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // If the batch-level transaction failed due to a FK constraint, try inserting
      // rows individually so only the offending rows are dropped (not the entire batch).
      if (/FOREIGN KEY/i.test(errMsg)) {
        console.warn(`[asyncLogFlusher] FK constraint in batch — falling back to per-row insert (${batch.length} rows)`);
        let inserted = 0;
        let dropped = 0;
        for (const [key, group] of groups) {
          let stmt = this.stmtCache.get(key);
          if (!stmt) {
            const placeholders = group.columns.map(() => '?').join(', ');
            const sql = `INSERT INTO ${group.table} (${group.columns.join(', ')}) VALUES (${placeholders})`;
            stmt = sqlite.prepare(sql);
            this.stmtCache.set(key, stmt);
          }
          for (const row of group.rows) {
            try {
              (stmt.run as (...params: unknown[]) => void)(...row);
              inserted++;
            } catch {
              dropped++;
            }
          }
        }
        if (dropped > 0) {
          console.warn(`[asyncLogFlusher] Per-row fallback: ${inserted} inserted, ${dropped} dropped (FK violations)`);
        }
        this.queue.splice(0, batch.length);
        this.consecutiveFailures = 0;
        return;
      }

      this.consecutiveFailures++;
      if (this.consecutiveFailures >= MAX_RETRY_ATTEMPTS) {
        const rowsLost = batch.length;
        const table = batch[0]?.table ?? 'unknown';
        console.error(`[asyncLogFlusher] Transaction failed ${this.consecutiveFailures} times, dropping ${rowsLost} rows:`, err);
        this.emit('data-loss', { rowsLost, table } satisfies DataLossPayload);
        this.queue.splice(0, batch.length);
        this.consecutiveFailures = 0;
      } else {
        console.error(`[asyncLogFlusher] Transaction failed (attempt ${this.consecutiveFailures}/${MAX_RETRY_ATTEMPTS}), rows retained for retry:`, err);
      }
    }
  }
}

export const asyncLogFlusher = new AsyncLogFlusher();
