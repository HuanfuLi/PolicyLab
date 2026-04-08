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
import { reflections, iterations as iterationsTable, resolvedActions, sessions as sessionsTable } from '../db/schema.js';
import { agentRepo } from '../db/repos/agentRepo.js';
import { sessionRepo } from '../db/repos/sessionRepo.js';
import { getProvider, getCitizenProvider } from '../llm/gateway.js';
import { readSettings } from '../settings.js';
import {
  buildAgentReflectionPrompt,
  buildAgentReflection2Prompt,
  buildEvaluationPrompt,
} from '../llm/prompts/index.js';
import {
  parseAgentReflection,
  parseAgentReflection2,
  parseSocietyEvaluation,
} from '../parsers/reflection.js';
import { runWithConcurrency } from './concurrencyPool.js';
import { reflectionManager } from './reflectionManager.js';
import type { Agent } from '@policylab/shared';

interface ReflectionTrajectoryPoint {
  iteration: number;
  wealth: number;
  health: number;
  happiness: number;
  actions: string[];
}

function clampStat(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampWealth(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export async function runReflection(sessionId: string): Promise<void> {
  const settings = readSettings();
  const provider = getProvider();
  const citizenProv = getCitizenProvider();

  try {
    reflectionManager.start(sessionId);
    await sessionRepo.updateStage(sessionId, 'reflecting');

    const session = await sessionRepo.getById(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const agents = await agentRepo.listBySession(sessionId);
    const citizenAgents = agents.filter(a => !a.isCentralAgent);

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
    const iterNumberById = new Map(iterRows.map(r => [r.id, r.iterationNumber]));

    const actionRows = await db
      .select()
      .from(resolvedActions)
      .where(eq(resolvedActions.sessionId, sessionId));

    const actionStateByIter = new Map<string, Map<string, ReflectionTrajectoryPoint>>();
    for (const row of actionRows) {
      const iterId = row.iterationId ?? '';
      if (!iterId) continue;
      const iterNumber = iterNumberById.get(iterId);
      if (!iterNumber) continue;
      if (!actionStateByIter.has(iterId)) actionStateByIter.set(iterId, new Map());

      let wealthDelta = 0;
      let healthDelta = 0;
      let happinessDelta = 0;
      let finalWealth: number | undefined;
      let finalHealth: number | undefined;
      let finalHappiness: number | undefined;
      let actions: string[] = [];

      if (row.outcome) {
        try {
          const parsed = JSON.parse(row.outcome) as {
            wealthDelta?: number;
            healthDelta?: number;
            happinessDelta?: number;
            finalWealth?: number;
            finalHealth?: number;
            finalHappiness?: number;
            actionQueue?: Array<{ actionCode?: string }>;
          };
          wealthDelta = Number(parsed.wealthDelta ?? 0);
          healthDelta = Number(parsed.healthDelta ?? 0);
          happinessDelta = Number(parsed.happinessDelta ?? 0);
          finalWealth = parsed.finalWealth !== undefined ? Number(parsed.finalWealth) : undefined;
          finalHealth = parsed.finalHealth !== undefined ? Number(parsed.finalHealth) : undefined;
          finalHappiness = parsed.finalHappiness !== undefined ? Number(parsed.finalHappiness) : undefined;
          actions = (parsed.actionQueue ?? [])
            .map(action => action.actionCode?.trim())
            .filter((code): code is string => Boolean(code));
        } catch {
          actions = [];
        }
      }

      actionStateByIter.get(iterId)!.set(row.agentId, {
        iteration: iterNumber,
        wealth: finalWealth ?? wealthDelta,
        health: finalHealth ?? healthDelta,
        happiness: finalHappiness ?? happinessDelta,
        actions: actions.length > 0 ? actions : ['NONE'],
      });
    }

    const statTrajectoryByAgent = new Map<string, ReflectionTrajectoryPoint[]>();
    for (const agent of citizenAgents) {
      let wealth = agent.initialStats.wealth;
      let health = agent.initialStats.health;
      let happiness = agent.initialStats.happiness;
      const history: ReflectionTrajectoryPoint[] = [];

      for (const iter of iterRows) {
        const entry = actionStateByIter.get(iter.id)?.get(agent.id);
        if (entry) {
          wealth = entry.wealth > 100 || entry.wealth === 0
            ? clampWealth(entry.wealth)
            : clampWealth(wealth + entry.wealth);
          health = entry.health <= 100
            ? (entry.health >= 0 && Number.isInteger(entry.health) ? entry.health : clampStat(health + entry.health))
            : clampStat(entry.health);
          happiness = entry.happiness <= 100
            ? (entry.happiness >= 0 && Number.isInteger(entry.happiness) ? entry.happiness : clampStat(happiness + entry.happiness))
            : clampStat(entry.happiness);
          history.push({
            iteration: iter.iterationNumber,
            wealth,
            health,
            happiness,
            actions: entry.actions,
          });
        } else {
          history.push({
            iteration: iter.iterationNumber,
            wealth: clampWealth(wealth),
            health: clampStat(health),
            happiness: clampStat(happiness),
            actions: ['NONE'],
          });
        }
      }

      statTrajectoryByAgent.set(agent.id, history);
    }

    const total = citizenAgents.length;

    // ── Pass 1: personal reflections ────────────────────────────────────────
    reflectionManager.broadcast(sessionId, { type: 'pass-start', pass: 1, total });

    const pass1Map = new Map<string, string>();

    const pass1Tasks = citizenAgents.map(agent => async () => {
      try {
        const messages = buildAgentReflectionPrompt(
          agent,
          session,
          iterationSummaries,
          statTrajectoryByAgent.get(agent.id),
        );
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
