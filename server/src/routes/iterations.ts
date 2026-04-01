/**
 * C5: Iteration query routes (spec §5.2, Stage 2 API).
 *
 * Mounted at: /api/sessions/:id/iterations
 *
 * GET   /              — list all iteration summaries for session
 * GET   /agent-stats   — per-agent stats across all iterations
 * GET   /:num          — get specific iteration with actions
 */
import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { iterationRepo } from '../db/repos/iterationRepo.js';
import { agentRepo } from '../db/repos/agentRepo.js';
import { db } from '../db/index.js';
import { resolvedActions, iterations as iterationsTable } from '../db/schema.js';

const router = Router({ mergeParams: true });

// GET /iterations?full=true — optionally includes statistics + lifecycleEvents
router.get('/', async (req, res) => {
  const { id } = req.params as { id: string };
  const full = req.query.full === 'true';
  try {
    if (full) {
      const iters = await iterationRepo.listBySessionFull(id);
      return res.json(iters);
    }
    const iters = await iterationRepo.listBySession(id);
    return res.json(iters);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' });
  }
});

// GET /iterations/agent-stats — per-agent stats across all iterations
// Must be before /:num to avoid being caught by the parameter route
router.get('/agent-stats', async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const agents = await agentRepo.listBySession(id);
    const citizenAgents = agents.filter(a => !a.isCentralAgent);

    const iters = await db.select()
      .from(iterationsTable)
      .where(eq(iterationsTable.sessionId, id))
      .orderBy(asc(iterationsTable.iterationNumber));

    const actions = await db.select()
      .from(resolvedActions)
      .where(eq(resolvedActions.sessionId, id));

    // Group actions by iterationId → agentId.
    // Prefer finalWealth/finalHealth/finalHappiness (stored after physiology clamping)
    // over raw deltas to match Society Trend values exactly.
    interface AgentIterStats {
      finalWealth?: number; finalHealth?: number; finalHappiness?: number;
      wealthDelta: number; healthDelta: number; happinessDelta: number;
    }
    const actionsByIter = new Map<string, Map<string, AgentIterStats>>();
    for (const a of actions) {
      const iterId = a.iterationId ?? '';
      if (!actionsByIter.has(iterId)) actionsByIter.set(iterId, new Map());
      let w = 0, h = 0, hap = 0;
      let finalW: number | undefined, finalH: number | undefined, finalHap: number | undefined;
      if (a.outcome) {
        try {
          const parsed = JSON.parse(a.outcome);
          w = Number(parsed.wealthDelta ?? 0);
          h = Number(parsed.healthDelta ?? 0);
          hap = Number(parsed.happinessDelta ?? 0);
          if (parsed.finalWealth !== undefined) finalW = Number(parsed.finalWealth);
          if (parsed.finalHealth !== undefined) finalH = Number(parsed.finalHealth);
          if (parsed.finalHappiness !== undefined) finalHap = Number(parsed.finalHappiness);
        } catch { /* ignore */ }
      }
      actionsByIter.get(iterId)!.set(a.agentId, { finalWealth: finalW, finalHealth: finalH, finalHappiness: finalHap, wealthDelta: w, healthDelta: h, happinessDelta: hap });
    }

    const clampStat = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
    const clampWealth = (v: number) => Math.max(0, Math.round(v));
    const result: Record<string, { name: string; role: string; history: Array<{ iter: number; wealth: number; health: number; happiness: number }> }> = {};

    for (const agent of citizenAgents) {
      let w = agent.initialStats.wealth;
      let h = agent.initialStats.health;
      let hap = agent.initialStats.happiness;

      const history: Array<{ iter: number; wealth: number; health: number; happiness: number }> = [];

      for (const iter of iters) {
        const entry = actionsByIter.get(iter.id)?.get(agent.id);
        if (entry) {
          // Use final clamped values if available (new data); fall back to delta accumulation (old data)
          if (entry.finalWealth !== undefined && entry.finalHealth !== undefined && entry.finalHappiness !== undefined) {
            w = entry.finalWealth;
            h = entry.finalHealth;
            hap = entry.finalHappiness;
          } else {
            w = clampWealth(w + entry.wealthDelta);
            h = clampStat(h + entry.healthDelta);
            hap = clampStat(hap + entry.happinessDelta);
          }
        }
        history.push({ iter: iter.iterationNumber, wealth: w, health: h, happiness: hap });
      }

      result[agent.id] = { name: agent.name, role: agent.role, history };
    }

    return res.json({ agents: result });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' });
  }
});

// GET /iterations/:num
router.get('/:num', async (req, res) => {
  const { id, num } = req.params as { id: string; num: string };
  const iterNum = parseInt(num, 10);
  if (isNaN(iterNum)) return res.status(400).json({ error: 'Invalid iteration number' });

  try {
    const all = await iterationRepo.listBySession(id);
    const iter = all.find(i => i.number === iterNum);
    if (!iter) return res.status(404).json({ error: `Iteration ${iterNum} not found` });

    const detail = await iterationRepo.getWithActions(iter.id);
    return res.json(detail);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'DB error' });
  }
});

export default router;
