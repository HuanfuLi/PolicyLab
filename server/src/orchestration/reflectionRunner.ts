/**
 * C4: ReflectionRunner — generates per-agent reflections and society evaluation.
 *
 * Flow:
 *   1. Load agents + iteration summaries for the session
 *   2. Pass 1: parallel agent reflections (personal experience) → persist → SSE
 *   3. Build society evaluation using pass1 reflections → persist → SSE
 *   4. Pass 2: parallel agent reflections after seeing evaluation → persist → SSE
 *   5. Advance stage to 'reflection-complete', emit reflection-complete
 */
import { v4 as uuidv4 } from 'uuid';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reflections, iterations as iterationsTable, sessions as sessionsTable, resolvedActions, economySnapshots } from '../db/schema.js';
import { agentRepo } from '../db/repos/agentRepo.js';
import { sessionRepo } from '../db/repos/sessionRepo.js';
import { getProvider, getCitizenProvider } from '../llm/gateway.js';
import { readSettings } from '../settings.js';
import {
  buildAgentReflectionPrompt,
  buildAgentReflection2Prompt,
  buildEvaluationPrompt,
} from '../llm/prompts/index.js';
import type { StatTrajectoryEntry } from '../llm/prompts/index.js';
import {
  parseAgentReflection,
  parseAgentReflection2,
  parseSocietyEvaluation,
} from '../parsers/reflection.js';
import { runWithConcurrency } from './concurrencyPool.js';
import { reflectionManager } from './reflectionManager.js';
import type { Agent } from '@policylab/shared';
import { createScope } from '../db/sessionScope.js';

export async function runReflection(sessionId: string): Promise<void> {
  const settings = readSettings();
  const provider = getProvider();
  const citizenProv = getCitizenProvider();

  try {
    reflectionManager.start(sessionId);
    await sessionRepo.updateStage(sessionId, 'reflecting');

    const session = await sessionRepo.getById(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const agents = await agentRepo.listBySession(createScope(sessionId));
    // Exclude Central Agent and institutional agents (bank/central_bank) from reflection.
    // Institutional agents don't have personal experiences to reflect on.
    const citizenAgents = agents.filter(a => !a.isCentralAgent && a.type !== 'bank');

    // Load iteration summaries
    const iterRows = await db
      .select()
      .from(iterationsTable)
      .where(eq(iterationsTable.sessionId, sessionId))
      .orderBy(asc(iterationsTable.iterationNumber));

    const iterationSummaries = iterRows.map(r => ({
      number: r.iterationNumber,
      summary: r.stateSummary,
    }));

    const total = citizenAgents.length;

    // ── Build per-agent stat trajectories from resolved actions (D-21) ──────
    // Resolved actions store finalWealth/finalHealth/finalHappiness in outcome JSON,
    // allowing reconstruction of per-agent per-iteration stat snapshots.
    const allResolvedActions = await db
      .select()
      .from(resolvedActions)
      .where(eq(resolvedActions.sessionId, sessionId));

    // Build trajectory lookup: map iteration IDs to numbers
    const iterIdToNumber = new Map<string, number>();
    for (const row of iterRows) {
      iterIdToNumber.set(row.id, row.iterationNumber);
    }

    // Group resolved actions by agent → iteration, extracting both actions and stats
    interface IterEntry { actions: string[]; finalWealth?: number; finalHealth?: number; finalHappiness?: number; wealthDelta: number; healthDelta: number; happinessDelta: number }
    const agentIterData = new Map<string, Map<string, IterEntry>>();
    for (const ra of allResolvedActions) {
      if (!agentIterData.has(ra.agentId)) agentIterData.set(ra.agentId, new Map());
      const iterMap = agentIterData.get(ra.agentId)!;
      const iterKey = ra.iterationId ?? 'unknown';
      if (!iterMap.has(iterKey)) {
        iterMap.set(iterKey, { actions: [], wealthDelta: 0, healthDelta: 0, happinessDelta: 0 });
      }
      const entry = iterMap.get(iterKey)!;
      entry.actions.push(ra.action);
      if (ra.outcome) {
        try {
          const parsed = JSON.parse(ra.outcome) as Record<string, unknown>;
          if (parsed.finalWealth !== undefined) entry.finalWealth = Number(parsed.finalWealth);
          if (parsed.finalHealth !== undefined) entry.finalHealth = Number(parsed.finalHealth);
          if (parsed.finalHappiness !== undefined) entry.finalHappiness = Number(parsed.finalHappiness);
          entry.wealthDelta += Number(parsed.wealthDelta ?? 0);
          entry.healthDelta += Number(parsed.healthDelta ?? 0);
          entry.happinessDelta += Number(parsed.happinessDelta ?? 0);
        } catch { /* ignore malformed outcome */ }
      }
    }

    const clampStat = (v: number) => Math.min(100, Math.max(0, v));

    function buildStatTrajectory(agentId: string, agent: Agent): StatTrajectoryEntry[] {
      const iterData = agentIterData.get(agentId);
      if (!iterData) return [];

      // Reconstruct per-iteration stats using final values (preferred) or delta accumulation (fallback)
      let w = agent.initialStats.wealth;
      let h = agent.initialStats.health;
      let hap = agent.initialStats.happiness;

      // Sort iteration entries by iteration number for correct accumulation order
      const sortedEntries = [...iterData.entries()]
        .map(([iterId, data]) => ({ iterNum: iterIdToNumber.get(iterId) ?? 0, data }))
        .filter(e => e.iterNum > 0)
        .sort((a, b) => a.iterNum - b.iterNum);

      const entries: StatTrajectoryEntry[] = [];
      for (const { iterNum, data } of sortedEntries) {
        if (data.finalWealth !== undefined && data.finalHealth !== undefined && data.finalHappiness !== undefined) {
          w = data.finalWealth;
          h = data.finalHealth;
          hap = data.finalHappiness;
        } else {
          // Delta accumulation fallback for old data without final values
          w = Math.max(0, w + data.wealthDelta);
          h = clampStat(h + data.healthDelta);
          hap = clampStat(hap + data.happinessDelta);
        }
        entries.push({ iteration: iterNum, wealth: w, health: h, happiness: hap, actions: data.actions });
      }
      // Limit to last 10 for token budget
      return entries.slice(-10);
    }

    // ── Pass 1: personal reflections ────────────────────────────────────────
    reflectionManager.broadcast(sessionId, { type: 'pass-start', pass: 1, total });

    const pass1Map = new Map<string, string>();

    const pass1Tasks = citizenAgents.map(agent => async () => {
      try {
        const statTrajectory = buildStatTrajectory(agent.id, agent);
        const messages = buildAgentReflectionPrompt(agent, session, iterationSummaries, statTrajectory);
        const raw = await citizenProv.chat(messages, { model: settings.citizenAgentModel });
        const { pass1 } = parseAgentReflection(raw);
        pass1Map.set(agent.id, pass1);

        // Broadcast BEFORE DB insert — frontend always receives pass1 even if DB fails
        reflectionManager.broadcast(sessionId, {
          type: 'agent-reflection',
          pass: 1,
          agentId: agent.id,
          agentName: agent.name,
          content: pass1,
        });

        await db.insert(reflections).values({
          id: uuidv4(),
          sessionId,
          agentId: agent.id,
          content: pass1,
          insights: null,
          createdAt: new Date().toISOString(),
        });

        return { agentName: agent.name, role: agent.role, pass1 };
      } catch {
        // Use actual pass1 from map if LLM succeeded but DB failed; else use fallback
        const existingPass1 = pass1Map.get(agent.id);
        const fallback = existingPass1 ?? `As ${agent.name}, I lived through this society and experienced its challenges firsthand.`;
        if (!existingPass1) {
          // LLM failed — set fallback in map and broadcast it so the agent appears on frontend
          pass1Map.set(agent.id, fallback);
          reflectionManager.broadcast(sessionId, {
            type: 'agent-reflection',
            pass: 1,
            agentId: agent.id,
            agentName: agent.name,
            content: fallback,
          });
        }
        return { agentName: agent.name, role: agent.role, pass1: fallback };
      }
    });

    const pass1Results = await runWithConcurrency(pass1Tasks, settings.maxConcurrency);

    // ── Society evaluation ───────────────────────────────────────────────────
    reflectionManager.broadcast(sessionId, { type: 'evaluation-start' });

    const aliveAgents = citizenAgents.filter(a => a.isAlive);
    const avgStat = (key: keyof Agent['currentStats']) =>
      aliveAgents.length === 0
        ? 0
        : Math.round(aliveAgents.reduce((s, a) => s + a.currentStats[key], 0) / aliveAgents.length);

    const evalMessages = buildEvaluationPrompt(
      session,
      iterationSummaries,
      pass1Results,
      {
        aliveCount: aliveAgents.length,
        totalCount: citizenAgents.length,
        avgWealth: avgStat('wealth'),
        avgHealth: avgStat('health'),
        avgHappiness: avgStat('happiness'),
      }
    );

    let evaluation = { verdict: '', strengths: [] as string[], weaknesses: [] as string[], analysis: '' };
    try {
      const evalRaw = await provider.chat(evalMessages, { model: settings.centralAgentModel });
      evaluation = parseSocietyEvaluation(evalRaw);
    } catch {
      evaluation = {
        verdict: `The society "${session.idea}" concluded its simulation run.`,
        strengths: ['Community resilience', 'Adaptability under stress', 'Agent cooperation'],
        weaknesses: ['Resource constraints', 'Governance challenges', 'Population decline'],
        analysis: `The simulation of "${session.idea}" ran for ${iterationSummaries.length} iterations with ${citizenAgents.length} agents, ending with ${aliveAgents.length} survivors.`,
      };
    }

    // Persist evaluation on the session
    const evalJson = JSON.stringify(evaluation);
    await db
      .update(sessionsTable)
      .set({ societyEvaluation: evalJson, updatedAt: new Date().toISOString() })
      .where(eq(sessionsTable.id, sessionId));

    reflectionManager.broadcast(sessionId, {
      type: 'evaluation',
      verdict: evaluation.verdict,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      analysis: evaluation.analysis,
    });

    // ── Pass 2: post-briefing reflections ────────────────────────────────────
    reflectionManager.broadcast(sessionId, { type: 'pass-start', pass: 2, total });

    const pass2Tasks = citizenAgents.map(agent => async () => {
      const pass1 = pass1Map.get(agent.id) ?? '';
      try {
        const messages = buildAgentReflection2Prompt(agent, session, pass1, evaluation.analysis);
        const raw = await citizenProv.chat(messages, { model: settings.citizenAgentModel });
        const { pass2 } = parseAgentReflection2(raw);

        // Broadcast BEFORE DB insert — frontend always receives pass2 even if DB fails
        reflectionManager.broadcast(sessionId, {
          type: 'agent-reflection',
          pass: 2,
          agentId: agent.id,
          agentName: agent.name,
          content: pass2,
        });

        // Store pass2 as a second reflection entry with insights field marking it
        await db.insert(reflections).values({
          id: uuidv4(),
          sessionId,
          agentId: agent.id,
          content: pass2,
          insights: 'pass2',
          createdAt: new Date().toISOString(),
        });
      } catch { /* skip pass2 for this agent */ }
    });

    await runWithConcurrency(pass2Tasks, settings.maxConcurrency);

    // ── Complete ─────────────────────────────────────────────────────────────
    await sessionRepo.updateStage(sessionId, 'reflection-complete');
    reflectionManager.broadcast(sessionId, { type: 'reflection-complete' });
    reflectionManager.finish(sessionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reflection error';
    reflectionManager.broadcast(sessionId, { type: 'error', message });
    reflectionManager.finish(sessionId);
    console.error(`[ReflectionRunner] Session ${sessionId}:`, err);
  }
}
