/**
 * C1: IterationRepo — CRUD for iterations and agent actions (spec §5.5).
 */
import { eq, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../index.js';
import { iterations, agentIntents, resolvedActions } from '../schema.js';
import type { Iteration, AgentAction, IterationStats } from '@policylab/shared';

function rowToIteration(row: typeof iterations.$inferSelect): Iteration {
  return {
    id: row.id,
    sessionId: row.sessionId,
    number: row.iterationNumber,
    narrativeSummary: row.stateSummary,
    timestamp: row.timestamp,
  };
}

function rowToAction(
  intent: typeof agentIntents.$inferSelect,
  resolved: typeof resolvedActions.$inferSelect | null
): AgentAction {
  let wealthDelta = 0, healthDelta = 0, happinessDelta = 0;
  let resolvedOutcome = resolved?.outcome ?? '';

  if (resolved?.outcome) {
    try {
      const parsed = JSON.parse(resolved.outcome);
      resolvedOutcome = parsed.text ?? resolved.outcome;
      wealthDelta = Number(parsed.wealthDelta ?? 0);
      healthDelta = Number(parsed.healthDelta ?? 0);
      happinessDelta = Number(parsed.happinessDelta ?? 0);
    } catch { /* raw text outcome */ }
  }

  return {
    id: intent.id,
    iterationId: intent.iterationId ?? '',
    agentId: intent.agentId,
    intent: intent.intent,
    resolvedOutcome,
    wealthDelta,
    healthDelta,
    happinessDelta,
  };
}

export const iterationRepo = {
  async create(data: {
    sessionId: string;
    number: number;
    narrativeSummary: string;
    statistics: IterationStats;
    lifecycleEvents?: unknown[];
  }): Promise<Iteration> {
    const id = uuidv4();
    const ts = new Date().toISOString();
    await db.insert(iterations).values({
      id,
      sessionId: data.sessionId,
      iterationNumber: data.number,
      stateSummary: data.narrativeSummary,
      statistics: JSON.stringify(data.statistics),
      lifecycleEvents: JSON.stringify(data.lifecycleEvents ?? []),
      timestamp: ts,
    });
    const [row] = await db.select().from(iterations).where(eq(iterations.id, id));
    return rowToIteration(row);
  },

  async listBySession(sessionId: string): Promise<Iteration[]> {
    const rows = await db
      .select()
      .from(iterations)
      .where(eq(iterations.sessionId, sessionId))
      .orderBy(asc(iterations.iterationNumber));
    return rows.map(rowToIteration);
  },

  /** Full iteration data including statistics and lifecycle events (for restoring UI state) */
  async listBySessionFull(sessionId: string): Promise<Array<Iteration & { statistics: IterationStats; lifecycleEvents: unknown[] }>> {
    const rows = await db
      .select()
      .from(iterations)
      .where(eq(iterations.sessionId, sessionId))
      .orderBy(asc(iterations.iterationNumber));
    return rows.map(row => ({
      ...rowToIteration(row),
      statistics: JSON.parse(row.statistics || '{}') as IterationStats,
      lifecycleEvents: JSON.parse(row.lifecycleEvents || '[]') as unknown[],
    }));
  },

  async getWithActions(iterationId: string): Promise<Iteration & { actions: AgentAction[] }> {
    const [row] = await db.select().from(iterations).where(eq(iterations.id, iterationId));
    if (!row) throw new Error(`Iteration ${iterationId} not found`);

    const intents = await db
      .select()
      .from(agentIntents)
      .where(eq(agentIntents.iterationId, iterationId));

    const resolved = await db
      .select()
      .from(resolvedActions)
      .where(eq(resolvedActions.iterationId, iterationId));

    const resolvedMap = new Map(resolved.map(r => [r.agentId, r]));

    const actions: AgentAction[] = intents.map(intent =>
      rowToAction(intent, resolvedMap.get(intent.agentId) ?? null)
    );

    return { ...rowToIteration(row), actions };
  },
};
