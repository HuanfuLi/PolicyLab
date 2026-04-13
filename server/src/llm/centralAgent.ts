import { v4 as uuidv4 } from 'uuid';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  sessions,
  agents,
  agentIntents,
  resolvedActions,
  iterations,
  roleChanges,
  reflections,
  agentEconomy,
  economySnapshots,
  marketPrices,
} from '../db/schema.js';
// NOTE: centralAgent still uses direct db access for design-time operations.
// This is a known coupling — see MODULE_MAP.md Phase A2 for the full extraction plan.
// The chatMessages table import was removed; chat persistence is handled by routes.
import { getProvider } from './gateway.js';
import { withRetry } from './retry.js';
import {
  buildBrainstormMessages,
  buildOverviewMessages,
  buildLawMessages,
  buildAgentRosterMessages,
  buildRefineMessages,
} from './prompts/index.js';
import { parseJSON } from '../parsers/json.js';
import type { ChatMessage, DesignProgressEvent, BrainstormChecklist, SessionConfig, TaxPolicy } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG, DEFAULT_BUDGET_ALLOCATION } from '@policylab/shared';
import { validateTaxPolicy } from '../mechanics/economyConfigUtils.js';
import { applyParagraphDiff } from '../orchestration/helpers/lawDiff.js';

interface BrainstormResult {
  reply: string;
  checklist: BrainstormChecklist;
  readyForDesign: boolean;
}

export async function brainstorm(
  sessionId: string,
  idea: string,
  history: ChatMessage[],
  userMessage: string,
  currentChecklist?: BrainstormChecklist
): Promise<BrainstormResult> {
  const provider = getProvider();
  const messages = buildBrainstormMessages(idea, history, userMessage, currentChecklist);
  const raw = await withRetry(() => provider.chat(messages, {
  }));

  let parsed: { reply: string; checklist: BrainstormChecklist; readyForDesign: boolean };
  try {
    parsed = parseJSON<{
      reply: string;
      checklist: BrainstormChecklist;
      readyForDesign: boolean;
    }>(raw);
  } catch {
    // Build a fallback checklist that preserves already-confirmed items
    const fallbackChecklist: BrainstormChecklist = {
      governance: currentChecklist?.governance ?? false,
      economy: currentChecklist?.economy ?? false,
      legal: currentChecklist?.legal ?? false,
      culture: currentChecklist?.culture ?? false,
      infrastructure: currentChecklist?.infrastructure ?? false,
    };

    // If JSON extraction fails, try regex extraction of the reply field
    const replyMatch = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (replyMatch) {
      let extractedReply: string;
      try { extractedReply = JSON.parse(`"${replyMatch[1]}"`); } catch { extractedReply = replyMatch[1]; }

      // Try to extract individual checklist booleans from the raw text
      const extractBool = (key: string): boolean | undefined => {
        const m = raw.match(new RegExp(`"${key}"\\s*:\\s*(true|false)`));
        return m ? m[1] === 'true' : undefined;
      };

      parsed = {
        reply: extractedReply,
        checklist: {
          governance: extractBool('governance') ?? fallbackChecklist.governance,
          economy: extractBool('economy') ?? fallbackChecklist.economy,
          legal: extractBool('legal') ?? fallbackChecklist.legal,
          culture: extractBool('culture') ?? fallbackChecklist.culture,
          infrastructure: extractBool('infrastructure') ?? fallbackChecklist.infrastructure,
        },
        readyForDesign: false,
      };
    } else {
      // Sanitize raw text: strip JSON artifacts and trim
      const sanitized = raw.replace(/^[\s\n]*[{\[]+/, '').replace(/[}\]]+[\s\n]*$/, '').trim().slice(0, 500);
      parsed = {
        reply: sanitized || 'I received your message but had trouble formatting my response. Could you try again?',
        checklist: fallbackChecklist,
        readyForDesign: false,
      };
    }
  }

  // Force-merge: once an item is confirmed (in currentChecklist), it stays true
  const checklist: BrainstormChecklist = {
    governance: (currentChecklist?.governance || parsed.checklist?.governance) ?? false,
    economy: (currentChecklist?.economy || parsed.checklist?.economy) ?? false,
    legal: (currentChecklist?.legal || parsed.checklist?.legal) ?? false,
    culture: (currentChecklist?.culture || parsed.checklist?.culture) ?? false,
    infrastructure: (currentChecklist?.infrastructure || parsed.checklist?.infrastructure) ?? false,
  };
  const allDone = Object.values(checklist).every(Boolean);
  const readyForDesign = allDone; // If all items are confirmed, we're ready

  return { reply: parsed.reply, checklist, readyForDesign };
}

interface SessionRow {
  id: string;
  idea: string;
  societyOverview: string | null;
  law: string | null;
  config: string | null;
}

export async function generateDesign(
  session: SessionRow,
  brainstormHistory: ChatMessage[],
  onProgress: (event: DesignProgressEvent) => void
): Promise<void> {
  const provider = getProvider();
  const now = () => new Date().toISOString();

  // Build a text summary of the brainstorm conversation for context
  const brainstormSummary = brainstormHistory
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)
    .join('\n\n');

  // Step 1: Overview
  onProgress({ type: 'step_start', step: 'overview', stepIndex: 0, totalSteps: 3 });

  const overviewData = await withRetry(async () => {
    const raw = await provider.chat(buildOverviewMessages(session.idea, brainstormSummary), {
    });
    return parseJSON<{
      societyName: string;
      overview: string;
      timeScale: string;
      agentCount: number;
      governanceModel: string;
      economicModel: string;
    }>(raw);
  });

  // Clamp agentCount to 20-50
  const agentCount = Math.min(50, Math.max(20, Math.round(overviewData.agentCount ?? 30)));

  await db
    .update(sessions)
    .set({
      title: overviewData.societyName ?? session.id,
      societyOverview: overviewData.overview,
      timeScale: overviewData.timeScale,
      updatedAt: now(),
    })
    .where(eq(sessions.id, session.id));

  onProgress({ type: 'step_done', step: 'overview', stepIndex: 0 });

  // Step 2: Law
  onProgress({ type: 'step_start', step: 'law', stepIndex: 1, totalSteps: 3 });

  // Phase 11 D-13: law step also yields taxPolicy — schema extended in buildLawMessages.
  const lawData = await withRetry(async () => {
    const raw = await provider.chat(
      buildLawMessages(
        session.idea,
        overviewData.overview,
        overviewData.governanceModel,
        overviewData.economicModel
      )
    );
    return parseJSON<{ law: string; taxPolicy?: unknown }>(raw);
  });

  await db
    .update(sessions)
    .set({ law: lawData.law, updatedAt: now() })
    .where(eq(sessions.id, session.id));

  // Phase 11 D-13: extract + validate taxPolicy from LLM JSON. Malformed /
  // missing shapes fall back to the flat baseline via validateTaxPolicy.
  const llmTaxPolicy: TaxPolicy = validateTaxPolicy(lawData.taxPolicy);

  onProgress({ type: 'step_done', step: 'law', stepIndex: 1 });

  // Step 3: Agents
  onProgress({ type: 'step_start', step: 'agents', stepIndex: 2, totalSteps: 3 });

  const agentsData = await withRetry(async () => {
    const raw = await provider.chat(
      buildAgentRosterMessages(
        overviewData.overview,
        lawData.law,
        agentCount,
        overviewData.governanceModel,
        overviewData.economicModel
      ),
      {
      }
    );
    const parsed = parseJSON<{
      agents: Array<{
        name: string;
        role: string;
        background: string;
        personalityTraits?: string[];
        initialStats: { wealth: number; health: number; happiness: number; cortisol?: number };
      }>;
      enterprises?: Array<{
        id: string;
        name: string;
        ownerAgentName: string;
        sector: string;
        industry: string;
        initialEmployeeNames?: string[];
      }>;
    }>(raw);

    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) {
      throw new Error('Agent roster generation returned no agents. Please retry.');
    }
    return parsed;
  });

  // Clear design/simulation artifacts explicitly before replacing the roster.
  // This avoids FK failures on older local DBs whose schema may predate some
  // ON DELETE CASCADE rules.
  await db.delete(agentIntents).where(eq(agentIntents.sessionId, session.id));
  await db.delete(resolvedActions).where(eq(resolvedActions.sessionId, session.id));
  await db.delete(roleChanges).where(eq(roleChanges.sessionId, session.id));
  await db.delete(agentEconomy).where(eq(agentEconomy.sessionId, session.id));
  await db.delete(marketPrices).where(eq(marketPrices.sessionId, session.id));
  await db.delete(economySnapshots).where(eq(economySnapshots.sessionId, session.id));
  await db.delete(iterations).where(eq(iterations.sessionId, session.id));
  await db.delete(reflections).where(eq(reflections.sessionId, session.id));
  await db.delete(agents).where(eq(agents.sessionId, session.id));

  const agentRows = agentsData.agents.map(a => {
    const stats = {
      wealth: a.initialStats?.wealth ?? 50,
      health: a.initialStats?.health ?? 70,
      happiness: a.initialStats?.happiness ?? 60,
      cortisol: a.initialStats?.cortisol ?? 20,
    };
    return {
      id: uuidv4(),
      sessionId: session.id,
      name: a.name,
      role: a.role,
      background: a.background ?? '',
      initialStats: JSON.stringify(stats),
      currentStats: JSON.stringify(stats),
      personalityTraits: JSON.stringify(Array.isArray(a.personalityTraits) ? a.personalityTraits.slice(0, 2) : []),
      type: 'citizen',
      status: 'alive',
    };
  });

  // Insert in batches of 25
  for (let i = 0; i < agentRows.length; i += 25) {
    const batch = agentRows.slice(i, i + 25);
    await db.insert(agents).values(batch);
  }

  // Inject default economy config for creative-mode sessions so all subsystems
  // are available (banking, fiscal, capital markets, inflation). Bootstrap-mode
  // sessions already have a data-driven config from the World Bank pipeline.
  let existingConfig: Record<string, unknown> = {};
  if (session.config) {
    try { existingConfig = JSON.parse(session.config); } catch { /* ignore */ }
  }
  if (!existingConfig.economyConfig) {
    // Phase 11 D-13: creative-mode sessions adopt the LLM-chosen taxPolicy
    // (validated above). Malformed/missing LLM output already fell back to
    // flat 15/10/15 via validateTaxPolicy, so this is always a valid shape.
    const economyConfig = { ...DEFAULT_ECONOMY_CONFIG, taxPolicy: llmTaxPolicy };
    const budgetAllocation = { ...DEFAULT_BUDGET_ALLOCATION };
    const updatedConfig = JSON.stringify({
      ...existingConfig,
      economyConfig,
      budgetAllocation,
    });
    await db.update(sessions)
      .set({ config: updatedConfig, updatedAt: now() })
      .where(eq(sessions.id, session.id));

    // Insert a bank agent when banking is enabled (mirrors bootstrap flow)
    if (economyConfig.bankingEnabled) {
      const totalAgentWealth = agentRows.reduce((sum, a) => {
        try { return sum + (JSON.parse(a.initialStats).wealth ?? 50); } catch { return sum + 50; }
      }, 0);
      const bankWealth = Math.round(totalAgentWealth * 0.5);
      const bankStats = JSON.stringify({ wealth: bankWealth, health: 100, happiness: 100, cortisol: 0 });
      await db.insert(agents).values({
        id: uuidv4(),
        sessionId: session.id,
        name: 'Central Bank',
        role: 'Central Banker',
        background: 'System bank agent providing fractional reserve banking services.',
        initialStats: bankStats,
        currentStats: bankStats,
        type: 'bank',
        status: 'alive',
        personalityTraits: JSON.stringify(['analytical']),
      });
    }
  }

  await db
    .update(sessions)
    .set({ stage: 'design-review', updatedAt: now() })
    .where(eq(sessions.id, session.id));

  onProgress({ type: 'step_done', step: 'agents', stepIndex: 2 });
  onProgress({ type: 'complete', sessionStage: 'design-review' });
}

interface RefineResult {
  reply: string;
  artifactsUpdated: Array<'overview' | 'law' | 'agents'>;
  agentsSummary: string | null;
}

interface AgentRow {
  id: string;
  name: string;
  role: string;
  background: string;
  initialStats: string;
}

export async function refine(
  session: SessionRow & { title: string },
  currentAgents: AgentRow[],
  refineHistory: ChatMessage[],
  userMessage: string
): Promise<RefineResult> {
  const provider = getProvider();

  // Build agent list with parsed stats for the prompt
  const agentList = currentAgents.map(a => {
    let stats: { wealth: number; health: number; happiness: number };
    try {
      stats = JSON.parse(a.initialStats);
    } catch {
      stats = { wealth: 50, health: 70, happiness: 60 };
    }
    return { name: a.name, role: a.role, initialStats: stats };
  });

  const messages = buildRefineMessages(
    session.idea,
    session.societyOverview ?? '',
    session.law ?? '',
    agentList,
    refineHistory,
    userMessage
  );

  const raw = await withRetry(() => provider.chat(messages));
  const parsed = parseJSON<{
    reply: string;
    artifactsUpdated: Array<'overview' | 'law' | 'agents'>;
    updatedOverview: string | null;
    updatedLaw?: string | null;
    // Backward compat: old diff-based format
    lawChanges?: {
      add?: string[];
      modify?: Array<{ original: string; replacement: string }>;
      remove?: string[];
    } | null;
    agentChanges: {
      add: Array<{ name: string; role: string; background: string; personalityTraits?: string[]; initialStats: { wealth: number; health: number; happiness: number; cortisol?: number } }>;
      remove: string[];
      modify: Array<{ name: string; role: string; background: string; personalityTraits?: string[]; initialStats: { wealth: number; health: number; happiness: number; cortisol?: number } }>;
    };
    agentsSummary: string | null;
  }>(raw);

  // Helper: clamp stat values to 0-100 with defaults, handling any partial/missing data
  const clampStats = (s: unknown) => {
    const obj = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    return {
      wealth: Math.max(0, Math.round(Number(obj.wealth) || 50)),
      health: Math.max(0, Math.min(100, Math.round(Number(obj.health) || 70))),
      happiness: Math.max(0, Math.min(100, Math.round(Number(obj.happiness) || 60))),
      cortisol: Math.max(0, Math.min(100, Math.round(Number(obj.cortisol) || 20))),
    };
  };

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };

  // Track what was actually updated (don't rely solely on LLM's artifactsUpdated)
  const actuallyUpdated: Array<'overview' | 'law' | 'agents'> = [];

  // Apply overview changes
  if (parsed.updatedOverview && typeof parsed.updatedOverview === 'string' && parsed.updatedOverview.trim().length > 0) {
    updates.societyOverview = parsed.updatedOverview;
    if (!actuallyUpdated.includes('overview')) actuallyUpdated.push('overview');
  }

  // Apply law changes: prefer full-text updatedLaw, fall back to diff-based lawChanges
  if (parsed.updatedLaw && typeof parsed.updatedLaw === 'string' && parsed.updatedLaw.trim().length > 0) {
    // Full replacement — the robust path
    updates.law = parsed.updatedLaw.trim();
    if (!actuallyUpdated.includes('law')) actuallyUpdated.push('law');
    console.log('[refine] Law updated via full-text replacement');
  } else if (parsed.lawChanges) {
    // Backward compat: diff-based approach (fragile, but try it)
    let currentLaw = session.law ?? '';
    const lc = parsed.lawChanges;
    let changed = false;

    if (lc.add?.length) {
      currentLaw = currentLaw.trimEnd() + '\n\n' + lc.add.join('\n\n');
      changed = true;
    }
    if (lc.modify?.length) {
      for (const m of lc.modify) {
        if (!m.original || !m.replacement) continue;
        // Phase 11 D-19: shared paragraph-diff helper (smart-quote / whitespace normalized).
        const result = applyParagraphDiff(currentLaw, m.original, m.replacement);
        if (result.applied) {
          currentLaw = result.law;
          changed = true;
        } else {
          console.warn(`[refine] lawChanges.modify: could not find exact match for: "${m.original?.slice(0, 80)}..."`);
        }
      }
    }
    if (lc.remove?.length) {
      for (const text of lc.remove) {
        if (currentLaw.includes(text)) {
          currentLaw = currentLaw.replace(text, '');
          changed = true;
        } else {
          console.warn(`[refine] lawChanges.remove: could not find exact match for: "${text?.slice(0, 80)}..."`);
        }
      }
    }

    if (changed) {
      updates.law = currentLaw.trim();
      if (!actuallyUpdated.includes('law')) actuallyUpdated.push('law');
      console.log('[refine] Law updated via diff-based changes');
    } else {
      console.warn('[refine] lawChanges provided but no changes could be applied (exact text not found)');
    }
  }

  // Write session updates to DB
  if (Object.keys(updates).length > 1) {
    await db.update(sessions).set(updates).where(eq(sessions.id, session.id));
  }

  // Apply agent changes
  const agentChanges = parsed.agentChanges ?? { add: [], remove: [], modify: [] };
  const existingNames = new Set(currentAgents.map(a => a.name));

  // Remove agents by name
  if (agentChanges.remove?.length > 0) {
    for (const name of agentChanges.remove) {
      await db
        .delete(agents)
        .where(sql`${agents.sessionId} = ${session.id} AND ${agents.name} = ${name}`);
    }
    if (!actuallyUpdated.includes('agents')) actuallyUpdated.push('agents');
  }

  // Modify existing agents by name (with robust stat clamping)
  if (agentChanges.modify?.length > 0) {
    for (const a of agentChanges.modify) {
      if (!a.name || !existingNames.has(a.name)) {
        console.warn(`[refine] agentChanges.modify: agent "${a.name}" not found in roster, skipping`);
        continue;
      }
      const clamped = clampStats(a.initialStats);
      const statsJson = JSON.stringify(clamped);
      await db
        .update(agents)
        .set({
          role: a.role || undefined,
          background: a.background || undefined,
          initialStats: statsJson,
          currentStats: statsJson,
          personalityTraits: JSON.stringify(Array.isArray(a.personalityTraits) ? a.personalityTraits.slice(0, 2) : []),
        })
        .where(sql`${agents.sessionId} = ${session.id} AND ${agents.name} = ${a.name}`);
    }
    if (!actuallyUpdated.includes('agents')) actuallyUpdated.push('agents');
  }

  // Add new agents (with robust stat clamping + deduplication)
  if (agentChanges.add?.length > 0) {
    const deduped = agentChanges.add.filter(a => a.name && !existingNames.has(a.name));
    if (deduped.length > 0) {
      const newRows = deduped.map(a => {
        const clamped = clampStats(a.initialStats);
        return {
          id: uuidv4(),
          sessionId: session.id,
          name: a.name,
          role: a.role ?? 'citizen',
          background: a.background ?? '',
          initialStats: JSON.stringify(clamped),
          currentStats: JSON.stringify(clamped),
          personalityTraits: JSON.stringify(Array.isArray(a.personalityTraits) ? a.personalityTraits.slice(0, 2) : []),
          type: 'citizen',
          status: 'alive',
        };
      });
      await db.insert(agents).values(newRows);
      if (!actuallyUpdated.includes('agents')) actuallyUpdated.push('agents');
    }
  }

  // Merge LLM-reported and actually-applied updates
  const reportedUpdates = parsed.artifactsUpdated ?? [];
  const mergedUpdates = [...new Set([...actuallyUpdated, ...reportedUpdates.filter(u => actuallyUpdated.includes(u))])];

  return {
    reply: parsed.reply,
    artifactsUpdated: mergedUpdates as Array<'overview' | 'law' | 'agents'>,
    agentsSummary: parsed.agentsSummary ?? null,
  };
}

