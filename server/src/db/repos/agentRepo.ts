/**
 * C1: AgentRepo — CRUD for agents (spec §5.5).
 */
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db, sqlite } from '../index.js';
import { agents } from '../schema.js';
import type { Agent, AgentStats, PersonalityTrait } from '@policylab/shared';
import { PERSONALITY_TRAITS } from '@policylab/shared';

function parseStats(raw: string): AgentStats {
  try {
    const parsed = JSON.parse(raw);
    return {
      wealth: parsed.wealth ?? 50,
      health: parsed.health ?? 70,
      happiness: parsed.happiness ?? 60,
      cortisol: parsed.cortisol ?? 20,
      dopamine: parsed.dopamine ?? 50,
    };
  } catch {
    return { wealth: 50, health: 70, happiness: 60, cortisol: 20, dopamine: 50 };
  }
}

function rowToAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    sessionId: row.sessionId,
    name: row.name,
    role: row.role,
    background: row.background,
    initialStats: parseStats(row.initialStats),
    currentStats: parseStats(row.currentStats),
    isAlive: row.status === 'alive',
    isCentralAgent: row.type === 'central' ? true : undefined,
    status: row.status,
    type: row.type,
    bornAtIteration: row.bornAtIteration ?? null,
    diedAtIteration: row.diedAtIteration ?? null,
    age: row.age ?? undefined,
    weightKg: row.weightKg ?? undefined,
    allostaticStrain: row.allostaticStrain ?? 0,
    allostaticLoad: row.allostaticLoad ?? 0,
    personalityTraits: parseTraits(row.personalityTraits),
  };
}

function parseTraits(raw: string): PersonalityTrait[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t: unknown): t is PersonalityTrait =>
      typeof t === 'string' && PERSONALITY_TRAITS.includes(t as PersonalityTrait)
    );
  } catch { return []; }
}

export const agentRepo = {
  async bulkCreate(
    agentData: Omit<Agent, 'id' | 'isAlive' | 'isCentralAgent'>[]
  ): Promise<Agent[]> {
    const rows = agentData.map(a => ({
      id: uuidv4(),
      sessionId: a.sessionId,
      name: a.name,
      role: a.role,
      background: a.background,
      initialStats: JSON.stringify(a.initialStats),
      currentStats: JSON.stringify(a.currentStats),
      type: a.type ?? 'citizen',
      status: a.status ?? 'alive',
      bornAtIteration: a.bornAtIteration ?? undefined,
      diedAtIteration: a.diedAtIteration ?? undefined,
      age: a.age ?? undefined,
      weightKg: a.weightKg ?? undefined,
      personalityTraits: JSON.stringify(a.personalityTraits ?? []),
    }));

    // Insert in batches of 25
    for (let i = 0; i < rows.length; i += 25) {
      await db.insert(agents).values(rows.slice(i, i + 25));
    }

    const inserted = await this.listBySession(agentData[0]?.sessionId ?? '');
    return inserted;
  },

  async listBySession(sessionId: string): Promise<Agent[]> {
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.sessionId, sessionId));
    return rows.map(rowToAgent);
  },

  /**
   * Update an agent's current stats after an iteration resolves.
   * Clamps values to [0, 100].
   */
  async updateStats(id: string, wealth: number, health: number, happiness: number, cortisol: number = 20, dopamine: number = 50): Promise<Agent> {
    const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
    const stats: AgentStats = {
      wealth: Math.max(0, wealth),
      health: clamp(health),
      happiness: clamp(happiness),
      cortisol: clamp(cortisol),
      dopamine: clamp(dopamine),
    };
    await db
      .update(agents)
      .set({ currentStats: JSON.stringify(stats) })
      .where(eq(agents.id, id));
    const [row] = await db.select().from(agents).where(eq(agents.id, id));
    return rowToAgent(row);
  },

  async markDead(id: string, iterationNumber: number): Promise<void> {
    await db
      .update(agents)
      .set({ status: 'dead', diedAtIteration: iterationNumber })
      .where(eq(agents.id, id));
  },

  /**
   * Batch-update stats for multiple agents in a single SQLite transaction.
   * Much faster than individual UPDATE statements when agent count is high.
   */
  async bulkUpdateStats(
    updates: Array<{ id: string; wealth: number; health: number; happiness: number; cortisol?: number; dopamine?: number }>
  ): Promise<void> {
    if (updates.length === 0) return;
    const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
    const stmt = sqlite.prepare(
      `UPDATE agents SET current_stats = ? WHERE id = ?`
    );
    const run = sqlite.transaction((items: typeof updates) => {
      for (const u of items) {
        const stats: AgentStats = {
          wealth: Math.max(0, u.wealth),
          health: clamp(u.health),
          happiness: clamp(u.happiness),
          cortisol: clamp(u.cortisol ?? 20),
          dopamine: clamp(u.dopamine ?? 50),
        };
        stmt.run(JSON.stringify(stats), u.id);
      }
    });
    run(updates);
  },

  /**
   * Batch-update allostatic strain and load for multiple agents in a single transaction.
   * Synchronous (uses better-sqlite3 directly) so it can be called inside a sqlite.transaction.
   */
  bulkUpdateAllostaticStates(
    updates: Array<{ id: string; allostaticStrain: number; allostaticLoad: number }>
  ): void {
    if (updates.length === 0) return;
    const stmt = sqlite.prepare(
      `UPDATE agents SET allostatic_strain = ?, allostatic_load = ? WHERE id = ?`
    );
    const run = sqlite.transaction((items: typeof updates) => {
      for (const u of items) {
        stmt.run(u.allostaticStrain, u.allostaticLoad, u.id);
      }
    });
    run(updates);
  },

  /**
   * Batch-mark agents as dead in a single transaction.
   */
  async bulkMarkDead(
    deaths: Array<{ id: string; iterationNumber: number }>
  ): Promise<void> {
    if (deaths.length === 0) return;
    const stmt = sqlite.prepare(
      `UPDATE agents SET status = 'dead', died_at_iteration = ? WHERE id = ?`
    );
    const run = sqlite.transaction((items: typeof deaths) => {
      for (const d of items) {
        stmt.run(d.iterationNumber, d.id);
      }
    });
    run(deaths);
  },
};
