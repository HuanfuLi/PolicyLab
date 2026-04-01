/**
 * C1: SessionRepo — CRUD for sessions (spec §5.5).
 */
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../index.js';
import { sessions, agents, iterations } from '../schema.js';
import type { Session, SessionMetadata, Stage } from '@policylab/shared';

function now(): string {
  return new Date().toISOString();
}

function rowToSession(row: typeof sessions.$inferSelect): Session {
  let config = null;
  if (row.config) {
    try { config = JSON.parse(row.config); } catch { /* ignore */ }
  }
  return {
    id: row.id,
    title: row.title,
    idea: row.idea,
    stage: row.stage as Stage,
    config,
    law: row.law ?? null,
    societyOverview: row.societyOverview ?? null,
    timeScale: row.timeScale ?? null,
    societyEvaluation: row.societyEvaluation ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? null,
  };
}

export const sessionRepo = {
  async create(data: { title: string; idea: string }): Promise<Session> {
    const id = uuidv4();
    const ts = now();
    await db.insert(sessions).values({
      id,
      title: data.title || data.idea.slice(0, 60),
      idea: data.idea,
      stage: 'idea-input',
      createdAt: ts,
      updatedAt: ts,
    });
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    return rowToSession(row);
  },

  async getById(id: string): Promise<Session | null> {
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    return row ? rowToSession(row) : null;
  },

  async list(): Promise<SessionMetadata[]> {
    const rows = await db
      .select()
      .from(sessions)
      .orderBy(sql`${sessions.updatedAt} DESC`);

    return Promise.all(
      rows.map(async (row) => {
        const [agentCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(agents)
          .where(eq(agents.sessionId, row.id));
        const [iterCount] = await db
          .select({ count: sql<number>`count(*)` })
          .from(iterations)
          .where(eq(iterations.sessionId, row.id));

        return {
          id: row.id,
          title: row.title,
          idea: row.idea,
          stage: row.stage as Stage,
          agentCount: Number(agentCount?.count ?? 0),
          totalIterations: 0,
          completedIterations: Number(iterCount?.count ?? 0),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      })
    );
  },

  async updateStage(id: string, stage: Stage): Promise<Session> {
    await db
      .update(sessions)
      .set({ stage, updatedAt: now() })
      .where(eq(sessions.id, id));
    const session = await this.getById(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  },

  async updateConfig(id: string, config: Record<string, unknown>): Promise<void> {
    await db
      .update(sessions)
      .set({ config: JSON.stringify(config), updatedAt: now() })
      .where(eq(sessions.id, id));
  },

  async delete(id: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, id));
  },
};
