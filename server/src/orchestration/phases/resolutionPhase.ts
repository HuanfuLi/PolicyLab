/**
 * resolutionPhase.ts — Central Agent narrative resolution (Phase 5 extraction).
 *
 * Handles both the standard single-LLM path (≤30 agents) and the
 * map-reduce HMAS path (>30 agents): role-clustered group coordinators
 * draft local resolutions, then the Central Agent merges them into a
 * society-wide narrative.
 *
 * Extracted verbatim from simulationRunner.ts lines ~1818–1949.
 * No logic changes — pure extraction.
 */

import {
  buildResolutionPrompt,
  buildGroupResolutionMessages,
  buildMergeResolutionMessages,
  buildLegalityCheckPrompt,
  type AgentIntent,
} from '../../llm/prompts.js';
import {
  parseResolutionStrict,
  parseGroupResolutionStrict,
  parseMergeResolutionStrict,
  type ParsedResolution,
} from '../../parsers/simulation.js';
import { retryWithHealing } from '../../llm/retryWithHealing.js';
import { runWithConcurrency } from '../concurrencyPool.js';
import { clusterByRole } from '../clustering.js';
import { simulationManager } from '../simulationManager.js';
import type { LLMProvider } from '../../llm/types.js';
import type { Agent } from '@policylab/shared';
import type { AppSettings } from '@policylab/shared';

/** Agents per resolution batch when session is large */
const MAPREDUCE_THRESHOLD = 30;
const BATCH_SIZE = 15;

export async function runResolutionPhase(ctx: {
  sessionId: string;
  iterNum: number;
  intents: AgentIntent[];
  aliveAgents: Agent[];
  illegalActionMap: Map<string, Set<string>>;
  settings: AppSettings;
  provider: LLMProvider;
  citizenProv: LLMProvider;
  lockedVariables: string[];
  session: any;
  prevIterMetrics: string | null;
  prevPhysicsLog: string | null;
  previousSummary: string | null;
  shouldAbort: () => boolean;
}): Promise<{
  resolution: ParsedResolution;
  illegalActionMap: Map<string, Set<string>>;
}> {
  const {
    sessionId,
    iterNum,
    intents,
    aliveAgents,
    illegalActionMap,
    settings,
    provider,
    citizenProv,
    lockedVariables,
    session,
    prevIterMetrics,
    prevPhysicsLog,
    previousSummary,
    shouldAbort,
  } = ctx;

  let resolution: ParsedResolution;

  if (aliveAgents.length > MAPREDUCE_THRESHOLD) {
    // ── Map-Reduce path for large sessions (role-based clustering) ──
    const allIntentsBrief = intents
      .map(i => `- ${i.agentName}: ${i.intent.slice(0, 80)}`)
      .join('\n');

    const groups = clusterByRole(aliveAgents, BATCH_SIZE);
    const groupTasks = groups.map((group, gi) => async () => {
      const groupIntents = intents.filter(i => group.some(a => a.id === i.agentId));
      const msgs = buildGroupResolutionMessages(session, group, groupIntents, allIntentsBrief, iterNum, previousSummary, prevIterMetrics, lockedVariables, prevPhysicsLog);
      // Use citizenAgentModel for group coordinators (cheaper); merge step keeps centralAgentModel
      const resolutionPromise = retryWithHealing({
        provider: citizenProv,
        messages: msgs,
        options: { model: settings.citizenAgentModel },
        parse: parseGroupResolutionStrict,
        fallback: { groupSummary: 'The group continued their activities.', agentOutcomes: [], lifecycleEvents: [] },
        label: `groupResolution:${gi}`,
        shouldAbort,
      });

      // Phase D: per-group legality check runs concurrently with resolution.
      // This avoids a single global prompt over 150 agents (context overflow risk).
      const legalityPromise: Promise<Array<{ agentId: string; actionCode: string; reason: string }>> =
        session.law
          ? (async () => {
              try {
                const legalityInput = groupIntents.map(i => ({
                  agentId: i.agentId,
                  agentName: i.agentName,
                  actionCodes: (i.actions ?? []).map(a => a.actionCode),
                  intent: i.intent,
                }));
                const legalityMsgs = buildLegalityCheckPrompt(legalityInput, session.law!, session.societyOverview ?? null);
                const rawLegality = await citizenProv.chat(legalityMsgs, { model: settings.citizenAgentModel });
                const clean = rawLegality.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/, '').trim();
                const parsed = JSON.parse(clean) as { illegalAgents?: Array<{ agentId: string; actionCode: string; reason: string }> };
                return Array.isArray(parsed?.illegalAgents) ? parsed.illegalAgents : [];
              } catch {
                return [];
              }
            })()
          : Promise.resolve([]);

      const [resolutionResult, illegalAgents] = await Promise.all([resolutionPromise, legalityPromise]);
      return { ...resolutionResult, illegalAgents };
    });

    const groupResults = await runWithConcurrency(groupTasks, settings.maxConcurrency, {
      shouldContinue: () => !shouldAbort(),
    });

    // Populate illegalActionMap from per-group legality results (Phase D)
    for (const groupResult of groupResults) {
      for (const entry of groupResult.illegalAgents ?? []) {
        if (typeof entry.agentId === 'string' && typeof entry.actionCode === 'string') {
          let codeSet = illegalActionMap.get(entry.agentId);
          if (!codeSet) { codeSet = new Set(); illegalActionMap.set(entry.agentId, codeSet); }
          codeSet.add(entry.actionCode);
          console.log(`[SHERIFF/MR] ${entry.agentId.slice(0, 8)}: "${entry.actionCode}" flagged illegal — ${entry.reason}`);
        }
      }
    }

    // HMAS coverage gap warning
    const coveredAgentIds = new Set(groups.flatMap(g => g.map(a => a.id)));
    const uncoveredCount = aliveAgents.filter(a => !coveredAgentIds.has(a.id)).length;
    if (uncoveredCount > 0) {
      console.warn(`[HMAS] ${uncoveredCount} agents not covered by any cluster group — they will be absent from group resolutions`);
    }

    // Merge step: synthesise group summaries into a society-wide narrative
    const groupSummaries = groupResults.map(r => r.groupSummary);
    const mergeMessages = buildMergeResolutionMessages(session, groupSummaries, iterNum, previousSummary, prevIterMetrics, lockedVariables);
    const mergeResult = await retryWithHealing({
      provider,
      messages: mergeMessages,
      options: { model: settings.centralAgentModel },
      parse: parseMergeResolutionStrict,
      fallback: { narrativeSummary: 'The iteration passed.', lifecycleEvents: [] },
      label: 'mergeResolution',
      shouldAbort,
    });

    resolution = {
      narrativeSummary: mergeResult.narrativeSummary,
      agentOutcomes: groupResults.flatMap(r => r.agentOutcomes),
      // Merge lifecycle events from all groups + merge result (deduplicate by agentId+type)
      lifecycleEvents: [
        ...groupResults.flatMap(r => r.lifecycleEvents),
        ...mergeResult.lifecycleEvents,
      ],
    };
  } else {
    // ── Standard path ────────────────────────────────────────────────
    // Bug #1 fix: pass aliveAgents only — dead agents must never appear in resolution
    const resolutionMessages = buildResolutionPrompt(session, aliveAgents, intents, iterNum, previousSummary, prevIterMetrics, lockedVariables, prevPhysicsLog);
    resolution = await retryWithHealing({
      provider,
      messages: resolutionMessages,
      options: { model: settings.centralAgentModel },
      parse: parseResolutionStrict,
      fallback: { narrativeSummary: 'The iteration passed without major events.', agentOutcomes: [], lifecycleEvents: [] },
      label: 'resolution',
      shouldAbort,
    });
  }

  // Controlled Variable Method: suppress role_change lifecycle events when role is locked
  if (lockedVariables.includes('role')) {
    resolution = {
      ...resolution,
      lifecycleEvents: resolution.lifecycleEvents?.filter(
        (e: { type: string }) => e.type !== 'role_change'
      ) ?? [],
    };
  }

  simulationManager.broadcast(sessionId, {
    type: 'resolution',
    iteration: iterNum,
    narrativeSummary: resolution.narrativeSummary,
    lifecycleEvents: resolution.lifecycleEvents,
  });

  return { resolution, illegalActionMap };
}
