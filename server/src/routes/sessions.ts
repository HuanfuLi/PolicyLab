import { Router } from 'express';
import { eq, asc, sql } from 'drizzle-orm';
import { db, sqlite } from '../db/index.js';
import { sessions, agents, iterations, chatMessages, agentIntents } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import type { SessionMetadata, SessionDetail, Agent, ChatMessage, Stage, BudgetAllocation } from '@policylab/shared';
import * as fiscalRepo from '../db/repos/fiscalRepo.js';
import { simulationManager } from '../orchestration/simulationManager.js';

const router = Router();

const VALID_STAGES: string[] = [
  'idea-input',
  'brainstorming',
  'designing',
  'design-review',
  'refining',
  'simulating',
  'simulation-paused',
  'simulation-complete',
  'reflecting',
  'reflection-complete',
  'reviewing',
  'completed',
];

// GET /api/sessions — list all sessions with metadata
router.get('/', async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: sessions.id,
        title: sessions.title,
        idea: sessions.idea,
        stage: sessions.stage,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        agentCount: sql<number>`count(distinct ${agents.id})`,
        completedIterations: sql<number>`count(distinct ${iterations.id})`,
      })
      .from(sessions)
      .leftJoin(agents, eq(agents.sessionId, sessions.id))
      .leftJoin(iterations, eq(iterations.sessionId, sessions.id))
      .groupBy(sessions.id)
      .orderBy(sql`${sessions.updatedAt} DESC`);

    const result: SessionMetadata[] = rows.map(row => ({
      id: row.id,
      title: row.title,
      idea: row.idea,
      stage: row.stage as Stage,
      agentCount: Number(row.agentCount ?? 0),
      totalIterations: 0,
      completedIterations: Number(row.completedIterations ?? 0),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    res.json(result);
  } catch (err) {
    console.error('GET /sessions error:', err);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// POST /api/sessions — create a new session
// Body: { idea, title? }  (spec §5.2)
router.post('/', async (req, res) => {
  const body = req.body as { idea?: string; title?: string; seedIdea?: string; name?: string };
  const idea = body.idea ?? body.seedIdea; // accept legacy field name

  if (!idea || idea.trim().length < 10) {
    return res.status(400).json({ error: 'idea must be at least 10 characters' });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const title = body.title?.trim() || body.name?.trim() || idea.trim().slice(0, 60);

  try {
    await db.insert(sessions).values({
      id,
      title,
      idea: idea.trim(),
      stage: 'idea-input',
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ id });
  } catch (err) {
    console.error('POST /sessions error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /api/sessions/:id — session detail
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    let config = null;
    if (session.config) {
      try {
        config = JSON.parse(session.config);
      } catch {
        // ignore malformed config
      }
    }

    const detail: SessionDetail = {
      id: session.id,
      title: session.title,
      idea: session.idea,
      stage: session.stage as Stage,
      config,
      law: session.law ?? null,
      societyOverview: session.societyOverview ?? null,
      timeScale: session.timeScale ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };

    res.json(detail);
  } catch (err) {
    console.error('GET /sessions/:id error:', err);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

// GET /api/sessions/:id/agents — agent roster
router.get('/:id/agents', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await db
      .select()
      .from(agents)
      .where(eq(agents.sessionId, id))
      .orderBy(asc(agents.name));

    const result: Agent[] = rows.map(a => ({
      id: a.id,
      sessionId: a.sessionId,
      name: a.name,
      role: a.role,
      background: a.background,
      initialStats: (() => {
        try { return JSON.parse(a.initialStats); } catch { return { wealth: 50, health: 70, happiness: 60, cortisol: 0, dopamine: 50 }; }
      })(),
      currentStats: (() => {
        try { return JSON.parse(a.currentStats); } catch { return { wealth: 50, health: 70, happiness: 60, cortisol: 0, dopamine: 50 }; }
      })(),
      isAlive: a.status === 'alive',
      isCentralAgent: a.type === 'central' || undefined,
      status: a.status,
      type: a.type,
      bornAtIteration: a.bornAtIteration ?? null,
      diedAtIteration: a.diedAtIteration ?? null,
      personalityTraits: (() => { try { return JSON.parse(a.personalityTraits); } catch { return []; } })(),
      allostaticStrain: a.allostaticStrain ?? 0,
      allostaticLoad: a.allostaticLoad ?? 0,
    }));

    res.json({ agents: result, total: result.length });
  } catch (err) {
    console.error('GET /sessions/:id/agents error:', err);
    res.status(500).json({ error: 'Failed to load agents' });
  }
});

// GET /api/sessions/:id/agent-intents — all stored agent intents grouped by agent
router.get('/:id/agent-intents', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await db
      .select({
        agentId: agentIntents.agentId,
        agentName: agents.name,
        role: agents.role,
        actionCode: agentIntents.actionCode,
        actionTarget: agentIntents.actionTarget,
        actionQueue: agentIntents.actionQueue,
        intent: agentIntents.intent,
        reasoning: agentIntents.reasoning,
        iterationNumber: iterations.iterationNumber,
      })
      .from(agentIntents)
      .innerJoin(agents, eq(agentIntents.agentId, agents.id))
      .leftJoin(iterations, eq(agentIntents.iterationId, iterations.id))
      .where(eq(agentIntents.sessionId, id))
      .orderBy(asc(sql`COALESCE(${iterations.iterationNumber}, 9999999)`), asc(agentIntents.createdAt));

    // Find the max completed iteration to infer the iteration number of mid-flight intents
    const [maxIterRow] = await db.select({ max: sql<number>`max(${iterations.iterationNumber})` })
      .from(iterations).where(eq(iterations.sessionId, id));
    const maxCompleted = maxIterRow?.max ?? 0;
    const currentRunning = maxCompleted + 1;

    // Group by agentId preserving insertion order
    const byAgent = new Map<string, {
      agentId: string; agentName: string; role: string;
      intents: Array<{
        iterationNumber: number;
        actionCode: string;
        actionTarget: string | null;
        actions: Array<{ actionCode: string; parameters: Record<string, unknown> }>;
        narrative: string;
        reasoning: string;
      }>;
    }>();
    for (const row of rows) {
      if (!byAgent.has(row.agentId)) {
        byAgent.set(row.agentId, { agentId: row.agentId, agentName: row.agentName, role: row.role, intents: [] });
      }
      let actions: Array<{ actionCode: string; parameters: Record<string, unknown> }> = [];
      if (row.actionQueue) {
        try {
          const parsed = JSON.parse(row.actionQueue);
          if (Array.isArray(parsed)) actions = parsed;
        } catch { /* ignore malformed queue */ }
      }
      byAgent.get(row.agentId)!.intents.push({
        iterationNumber: row.iterationNumber ?? currentRunning,
        actionCode: row.actionCode ?? 'NONE',
        actionTarget: row.actionTarget ?? null,
        actions,
        narrative: row.intent,
        reasoning: row.reasoning ?? '',
      });
    }

    res.json({ agents: Array.from(byAgent.values()) });
  } catch (err) {
    console.error('GET /sessions/:id/agent-intents error:', err);
    res.status(500).json({ error: 'Failed to load agent intents' });
  }
});

// GET /api/sessions/:id/messages — chat history
// Supports ?context=brainstorm|refinement|review:<agentId>
// Without ?context returns all messages grouped by context (legacy)
router.get('/:id/messages', async (req, res) => {
  const { id } = req.params;
  const contextFilter = req.query.context as string | undefined;
  try {
    let query = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(asc(chatMessages.timestamp));

    const rows = await query;

    const toMsg = (r: typeof rows[0]): ChatMessage => ({
      id: r.id,
      sessionId: r.sessionId,
      context: r.context as ChatMessage['context'],
      agentId: r.agentId ?? null,
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
      timestamp: r.timestamp,
    });

    if (contextFilter) {
      // Return flat array filtered by context
      const filtered = rows.filter(r => r.context === contextFilter).map(toMsg);
      return res.json(filtered);
    }

    // Legacy grouped response for backward compat
    res.json({
      brainstorm: rows.filter(r => r.context === 'brainstorm').map(toMsg),
      refinement: rows.filter(r => r.context === 'refinement').map(toMsg),
    });
  } catch (err) {
    console.error('GET /sessions/:id/messages error:', err);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// PATCH /api/sessions/:id/stage — update stage only (spec §5.2)

router.patch('/:id/stage', async (req, res) => {
  const { id } = req.params;
  const { stage } = req.body as { stage?: string };

  if (!stage) {
    return res.status(400).json({ error: 'stage is required' });
  }

  if (!VALID_STAGES.includes(stage)) {
    return res.status(400).json({ error: `Invalid stage: '${stage}'`, validStages: VALID_STAGES });
  }

  try {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const now = new Date().toISOString();
    await db
      .update(sessions)
      .set({ stage, updatedAt: now })
      .where(eq(sessions.id, id));

    const [updated] = await db.select().from(sessions).where(eq(sessions.id, id));
    let config = null;
    if (updated.config) {
      try { config = JSON.parse(updated.config); } catch { /* ignore */ }
    }

    res.json({
      id: updated.id,
      title: updated.title,
      idea: updated.idea,
      stage: updated.stage,
      config,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    console.error('PATCH /sessions/:id/stage error:', err);
    res.status(500).json({ error: 'Failed to update stage' });
  }
});

// PUT /api/sessions/:id/config — patch config fields (kept for backward compat)
router.put('/:id/config', async (req, res) => {
  const { id } = req.params;
  const body = req.body as {
    totalIterations?: number;
    checklist?: unknown;
    readyForDesign?: boolean;
    stage?: string;
    lockedVariables?: string[];
    economyConfig?: Partial<Record<string, unknown>>;
    budgetAllocation?: BudgetAllocation;
  };

  // Budget validation — reject invalid allocations before any DB writes
  if (body.budgetAllocation) {
    const alloc = body.budgetAllocation;
    if (alloc.infrastructure < 0 || alloc.education < 0 || alloc.defense < 0 || alloc.welfare < 0) {
      return res.status(400).json({ error: 'Budget allocations must be non-negative' });
    }
    const sum = alloc.infrastructure + alloc.education + alloc.defense + alloc.welfare;
    if (Math.abs(sum - 1.0) > 0.01) {
      return res.status(400).json({ error: 'Budget allocation must sum to 1.0' });
    }
  }

  try {
    // Wrap read-modify-write + budget persistence in a transaction to prevent
    // concurrent config updates from losing writes (H2) and ensure budget is
    // persisted before the response (H3).
    let updatedConfig: Record<string, unknown> = {};

    sqlite.transaction(() => {
      const row = sqlite.prepare('SELECT config, stage FROM sessions WHERE id = ?').get(id) as
        { config: string | null; stage: string } | undefined;
      if (!row) throw Object.assign(new Error('Session not found'), { status: 404 });

      let currentConfig: Record<string, unknown> = {};
      if (row.config) {
        try { currentConfig = JSON.parse(row.config); } catch { /* ignore */ }
      }

      updatedConfig = { ...currentConfig };
      if (body.totalIterations !== undefined) updatedConfig.totalIterations = body.totalIterations;
      if (body.checklist !== undefined) updatedConfig.checklist = body.checklist;
      if (body.readyForDesign !== undefined) updatedConfig.readyForDesign = body.readyForDesign;
      if (body.lockedVariables !== undefined) updatedConfig.lockedVariables = body.lockedVariables;
      if (body.economyConfig !== undefined) {
        const existingEconomy = (currentConfig.economyConfig ?? {}) as Record<string, unknown>;
        updatedConfig.economyConfig = { ...existingEconomy, ...body.economyConfig };
      }

      const now = new Date().toISOString();
      const setClauses = [`config = ?`, `updated_at = ?`];
      const params: unknown[] = [JSON.stringify(updatedConfig), now];
      if (body.stage) {
        if (!VALID_STAGES.includes(body.stage)) {
          throw Object.assign(new Error(`Invalid stage: ${body.stage}`), { status: 400 });
        }
        setClauses.push(`stage = ?`);
        params.push(body.stage);
      }
      params.push(id);
      sqlite.prepare(`UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

      // Budget persistence inside the same transaction
      if (body.budgetAllocation) {
        fiscalRepo.createBudget(id, body.budgetAllocation);
      }
    })();

    const [updated] = await db.select().from(sessions).where(eq(sessions.id, id));
    res.json({
      id: updated.id,
      stage: updated.stage,
      config: updatedConfig,
      updatedAt: updated.updatedAt,
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) return res.status(404).json({ error: 'Session not found' });
    console.error('PUT /sessions/:id/config error:', err);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// POST /api/sessions/:id/fork — clone session design into a new session
router.post('/:id/fork', async (req, res) => {
  const { id } = req.params;
  const body = req.body as { iterations?: number };

  try {
    const [source] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!source) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const newId = uuidv4();
    const now = new Date().toISOString();
    const totalIterations = body.iterations || 20;

    // Extract economyConfig and budgetAllocation from source session config
    let sourceConfig: Record<string, unknown> = {};
    if (source.config) {
      try { sourceConfig = JSON.parse(source.config) as Record<string, unknown>; } catch { /* use empty */ }
    }

    const config = JSON.stringify({
      totalIterations,
      checklist: { governance: true, economy: true, legal: true, culture: true, infrastructure: true },
      readyForDesign: true,
      ...(sourceConfig.economyConfig ? { economyConfig: sourceConfig.economyConfig } : {}),
      ...(sourceConfig.budgetAllocation ? { budgetAllocation: sourceConfig.budgetAllocation } : {}),
    });

    await db.insert(sessions).values({
      id: newId,
      title: `${source.title} (fork)`,
      idea: source.idea,
      stage: 'design-review',
      config,
      law: source.law,
      societyOverview: source.societyOverview,
      timeScale: source.timeScale,
      createdAt: now,
      updatedAt: now,
    });

    // Copy agents with fresh stats
    const sourceAgents = await db.select().from(agents).where(eq(agents.sessionId, id));
    for (const a of sourceAgents) {
      await db.insert(agents).values({
        id: uuidv4(),
        sessionId: newId,
        name: a.name,
        role: a.role,
        background: a.background,
        initialStats: a.initialStats,
        currentStats: a.initialStats, // reset to initial
        status: 'alive',
        type: a.type,
        bornAtIteration: null,
        diedAtIteration: null,
        personalityTraits: a.personalityTraits,
      });
    }

    // Clone fiscal budget if source had one
    const sourceBudget = sourceConfig.budgetAllocation as BudgetAllocation | undefined;
    if (sourceBudget) {
      fiscalRepo.createBudget(newId, sourceBudget);
    }

    res.status(201).json({ id: newId });
  } catch (err) {
    console.error('POST /sessions/:id/fork error:', err);
    res.status(500).json({ error: 'Failed to fork session' });
  }
});

// POST /api/sessions/:id/fork-simulation — fork with simulation data preserved
router.post('/:id/fork-simulation', async (req, res) => {
  const { id } = req.params;

  try {
    const [source] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!source) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const newId = uuidv4();
    const now = new Date().toISOString();

    // Find max iteration number for config
    const [maxRow] = await db.select({ max: sql<number>`max(${iterations.iterationNumber})` })
      .from(iterations).where(eq(iterations.sessionId, id));
    const maxIterNum = maxRow?.max ?? 0;

    // Preserve the full source config (economyConfig, budgetAllocation, etc.)
    // so the forked session retains all economic parameters
    let mergedConfig: Record<string, unknown> = {};
    if (source.config) {
      try { mergedConfig = JSON.parse(source.config); } catch { /* ignore */ }
    }
    mergedConfig.totalIterations = maxIterNum;
    const config = JSON.stringify(mergedConfig);

    await db.insert(sessions).values({
      id: newId,
      title: `${source.title} (fork)`,
      idea: source.idea,
      stage: 'simulation-complete',
      config,
      law: source.law,
      societyOverview: source.societyOverview,
      timeScale: source.timeScale,
      createdAt: now,
      updatedAt: now,
    });

    // Copy agents — preserve currentStats as both initial and current
    const sourceAgents = await db.select().from(agents).where(eq(agents.sessionId, id));
    for (const a of sourceAgents) {
      await db.insert(agents).values({
        id: uuidv4(),
        sessionId: newId,
        name: a.name,
        role: a.role,
        background: a.background,
        initialStats: a.currentStats,
        currentStats: a.currentStats,
        status: a.status,
        type: a.type,
        bornAtIteration: a.bornAtIteration ?? null,
        diedAtIteration: a.diedAtIteration ?? null,
        personalityTraits: a.personalityTraits,
        allostaticStrain: a.allostaticStrain,
        allostaticLoad: a.allostaticLoad,
      });
    }

    // Copy all iterations
    const sourceIters = await db.select().from(iterations)
      .where(eq(iterations.sessionId, id))
      .orderBy(asc(iterations.iterationNumber));
    for (const it of sourceIters) {
      await db.insert(iterations).values({
        id: uuidv4(),
        sessionId: newId,
        iterationNumber: it.iterationNumber,
        stateSummary: it.stateSummary,
        statistics: it.statistics,
        lifecycleEvents: it.lifecycleEvents,
        timestamp: it.timestamp,
      });
    }

    // Clone fiscal budget if source had one
    const sourceConfig = mergedConfig as Record<string, unknown>;
    const sourceBudget = sourceConfig.budgetAllocation as BudgetAllocation | undefined;
    if (sourceBudget) {
      fiscalRepo.createBudget(newId, sourceBudget);
    }

    res.status(201).json({ id: newId });
  } catch (err) {
    console.error('POST /sessions/:id/fork-simulation error:', err);
    res.status(500).json({ error: 'Failed to fork simulation' });
  }
});

// PATCH /api/sessions/:id/agents/:agentId — update agent initial stats (design stage)
router.patch('/:id/agents/:agentId', async (req, res) => {
  const { id, agentId } = req.params;
  const body = req.body as { wealth?: number; health?: number; happiness?: number; cortisol?: number; dopamine?: number };

  const clamp = (v: number, min = 0, max = 100) => Math.min(max, Math.max(min, Math.round(v)));

  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent || agent.sessionId !== id) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    let current: Record<string, unknown> = {};
    try { current = JSON.parse(agent.initialStats); } catch { /* use defaults */ }

    if (body.wealth !== undefined) current.wealth = clamp(body.wealth, 0, 9999);
    if (body.health !== undefined) current.health = clamp(body.health);
    if (body.happiness !== undefined) current.happiness = clamp(body.happiness);
    if (body.cortisol !== undefined) current.cortisol = clamp(body.cortisol);
    if (body.dopamine !== undefined) current.dopamine = clamp(body.dopamine);

    const statsJson = JSON.stringify(current);
    await db.update(agents)
      .set({ initialStats: statsJson, currentStats: statsJson })
      .where(eq(agents.id, agentId));

    res.json({ ok: true, initialStats: current });
  } catch (err) {
    console.error('PATCH /sessions/:id/agents/:agentId error:', err);
    res.status(500).json({ error: 'Failed to update agent stats' });
  }
});

// DELETE /api/sessions/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  // R5 fix: Prevent deletion of sessions with active simulations
  const simStatus = simulationManager.getStatus(id);
  if (simStatus === 'running' || simStatus === 'paused') {
    return res.status(409).json({
      error: `Cannot delete session with ${simStatus} simulation. Stop or abort the simulation first.`,
    });
  }

  try {
    await db.delete(sessions).where(eq(sessions.id, id));
    // Clean up in-memory simulation state (SSE clients, sequenceId, flags) to
    // prevent memory leaks when a session is deleted while not simulating.
    simulationManager.finish(id);
    res.status(204).send();
  } catch (err) {
    console.error('DELETE /sessions/:id error:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
