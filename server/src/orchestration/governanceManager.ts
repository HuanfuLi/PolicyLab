/**
 * GovernanceManager — 5-step political cycle triggered every 5 iterations.
 *
 * Step 1: Selection    — pick 1–3 "politician" agents based on society type
 * Step 2: Proposals    — each politician proposes ONE policy change via LLM
 * Step 3: Ballot       — Central Agent synthesizes proposals into formal ballot
 * Step 4: Voting       — politicians vote YES/NO on each ballot item
 * Step 5: Ratification — majority vote (or autocratic decree) updates session policy
 *
 * All LLM failures are non-fatal: a failed proposal or vote is silently skipped.
 * If fewer than 2 politicians can be selected, the cycle is skipped entirely.
 */

import type {
  Agent,
  Session,
  SessionPolicy,
  GovernanceBallotItem,
  LawAmendmentHistoryEntry,
} from '@policylab/shared';
import type { LLMProvider } from '../llm/types.js';
import {
  buildProposalPrompt,
  buildBallotPrompt,
  buildVotePrompt,
  buildFranchiseSizePrompt,
} from '../llm/prompts/index.js';
import type { GovernancePolicyProposal } from '../llm/prompts/index.js';
import { sessionRepo } from '../db/repos/sessionRepo.js';
import { applyParagraphDiff } from './helpers/lawDiff.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GovernanceResult {
  policyChanged: boolean;
  newPolicy: SessionPolicy;
  ratifiedItems: GovernanceBallotItem[];
  rejectedItems: GovernanceBallotItem[];
  summary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract session policy from config, falling back to defaults. */
export function getSessionPolicy(raw: unknown): SessionPolicy {
  const p = raw as Partial<SessionPolicy> | null | undefined;
  return {
    tax_rate: typeof p?.tax_rate === 'number' && isFinite(p.tax_rate) ? p.tax_rate : 0.02,
    ubi_allocation: typeof p?.ubi_allocation === 'number' && isFinite(p.ubi_allocation) ? p.ubi_allocation : 1.0,
    enforcement_level: typeof p?.enforcement_level === 'number' && isFinite(p.enforcement_level) ? p.enforcement_level : 1.0,
  };
}

/** Narrow helper: policy-kind ballot field (scalar fields only). */
type PolicyField = 'tax_rate' | 'ubi_allocation' | 'enforcement_level';

/** Validate and clamp a proposed policy value to its allowed range. */
function clampPolicyValue(field: PolicyField, value: number): number {
  if (!isFinite(value)) return NaN;
  switch (field) {
    case 'tax_rate':        return Math.max(0, Math.min(0.25, value));
    case 'ubi_allocation':  return Math.max(0, Math.min(1.0, value));
    case 'enforcement_level': return Math.max(0.1, Math.min(3.0, value));
  }
}

/**
 * Select politician agents for the governance cycle using emergent AI reasoning.
 *
 * Phase C: Instead of a hardcoded dictatorship/democracy regex, the Central
 * Agent reads the society's constitution and determines the "franchise size"
 * (how many citizens can vote). A direct democracy → everyone votes; a
 * monarchy → 1 most-powerful agent. Form of government is emergent, not flagged.
 *
 * Non-fatal: on any LLM failure falls back to selecting 1 agent (safe minimum).
 */
async function selectPoliticians(
  agents: Agent[],
  societyContext: string,
  provider: LLMProvider,
  model: string): Promise<Agent[]> {
  if (agents.length === 0) return [];

  // Determine franchise size via Central Agent reasoning
  let franchiseSize = 1;
  try {
    const messages = buildFranchiseSizePrompt(agents.length, societyContext);
    const raw = await provider.chat(messages, {
      model
    });
    const parsed = JSON.parse(raw) as { franchiseSize?: number };
    if (typeof parsed?.franchiseSize === 'number' && isFinite(parsed.franchiseSize)) {
      franchiseSize = Math.min(agents.length, Math.max(1, Math.round(parsed.franchiseSize)));
    }
  } catch {
    // Non-fatal: fall back to 1 (safe minimum — avoids over-selecting)
  }

  if (franchiseSize >= agents.length) return [...agents];

  const sorted = [...agents].sort((a, b) => a.currentStats.wealth - b.currentStats.wealth);

  if (franchiseSize === 1) {
    // Single decision-maker: pick the most wealthy/powerful agent
    return [sorted[sorted.length - 1]];
  }

  // Select a diverse sample evenly distributed across the wealth spectrum
  const result: Agent[] = [];
  const step = sorted.length / franchiseSize;
  for (let i = 0; i < franchiseSize; i++) {
    const idx = Math.min(sorted.length - 1, Math.round(i * step));
    const candidate = sorted[idx];
    if (!result.find(a => a.id === candidate.id)) result.push(candidate);
  }
  // Fill any dedup gaps with unused agents
  for (const agent of sorted) {
    if (result.length >= franchiseSize) break;
    if (!result.find(a => a.id === agent.id)) result.push(agent);
  }
  return result;
}

/** Safe JSON parse — returns null on failure. */
function safeJson(text: string): unknown {
  const clean = text.replace(/^```json?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(clean); } catch { return null; }
}

// ── Main governance cycle ─────────────────────────────────────────────────────

export async function runGovernanceCycle(params: {
  sessionId: string;
  agents: Agent[];
  session: Pick<Session, 'id' | 'societyOverview' | 'idea' | 'config' | 'law'>;
  currentPolicy: SessionPolicy;
  iterNum: number;
  provider: LLMProvider;
  citizenProv: LLMProvider;
  model: string;
  citizenModel: string;
}): Promise<GovernanceResult> {
  const { sessionId, agents, session, currentPolicy, iterNum, provider, citizenProv, model, citizenModel } = params;

  const societyContext = [
    session.societyOverview ? `Society: ${session.societyOverview.slice(0, 400)}` : '',
    session.law ? `Founding law excerpt: ${session.law.slice(0, 300)}` : '',
  ].filter(Boolean).join('\n\n');

  // ── Step 1: Select politicians (emergent — LLM reads constitution) ───────
  const politicians = await selectPoliticians(agents.filter(a => a.isAlive), societyContext, provider, model);
  if (politicians.length === 0) {
    return {
      policyChanged: false,
      newPolicy: currentPolicy,
      ratifiedItems: [],
      rejectedItems: [],
      summary: '',
    };
  }

  // ── Step 2: Collect proposals ────────────────────────────────────────────
  // Phase 11 D-18: proposals may be scalar policy changes OR law_amendment
  // (paragraph-level text diffs). Both shapes land in `rawProposals` below.
  type LawAmendmentProposal = {
    kind: 'law_amendment';
    oldParagraph: string;
    newParagraph: string;
    reasoning: string;
  };
  type PolicyProposal = GovernancePolicyProposal & { kind: 'policy' };
  type RawProposal =
    | { name: string; role: string; proposal: PolicyProposal }
    | { name: string; role: string; proposal: LawAmendmentProposal };
  const rawProposals: RawProposal[] = [];

  await Promise.allSettled(politicians.map(async (agent) => {
    try {
      const messages = buildProposalPrompt(agent, currentPolicy, societyContext, iterNum);
      const raw = await citizenProv.chat(messages, {
        model: citizenModel
      });
      const parsed = safeJson(raw) as { proposal?: Record<string, unknown> | null } | null;
      const proposal = parsed?.proposal;
      if (!proposal || typeof proposal !== 'object') return;

      // law_amendment kind (detected by paragraph fields)
      if (typeof proposal.oldParagraph === 'string' && typeof proposal.newParagraph === 'string') {
        const oldPara = (proposal.oldParagraph as string).trim();
        const newPara = (proposal.newParagraph as string).trim();
        if (!oldPara || !newPara) return;
        rawProposals.push({
          name: agent.name,
          role: agent.role,
          proposal: {
            kind: 'law_amendment',
            oldParagraph: oldPara,
            newParagraph: newPara,
            reasoning: String(proposal.reasoning ?? '').slice(0, 200),
          },
        });
        return;
      }

      // Legacy scalar policy kind
      const field = proposal.field as string | undefined;
      const value = proposal.value as number | undefined;
      const reasoning = proposal.reasoning as string | undefined;
      if (!field || typeof value !== 'number') return;
      if (!['tax_rate', 'ubi_allocation', 'enforcement_level'].includes(field)) return;
      const clamped = clampPolicyValue(field as PolicyField, value);
      if (!isFinite(clamped)) return;
      rawProposals.push({
        name: agent.name,
        role: agent.role,
        proposal: {
          kind: 'policy',
          field: field as PolicyField,
          value: clamped,
          reasoning: String(reasoning ?? '').slice(0, 200),
        },
      });
    } catch {
      // Non-fatal: skip this politician's proposal
    }
  }));

  if (rawProposals.length === 0) {
    return {
      policyChanged: false,
      newPolicy: currentPolicy,
      ratifiedItems: [],
      rejectedItems: [],
      summary: `📜 Governance Session at iteration ${iterNum}: No policy proposals were submitted.`,
    };
  }

  // ── Step 3: Synthesize ballot (Central Agent / provider) ─────────────────
  let ballot: GovernanceBallotItem[] = [];
  try {
    const messages = buildBallotPrompt(rawProposals, currentPolicy, societyContext);
    const raw = await provider.chat(messages, {
      model
    });
    const parsed = safeJson(raw) as { ballot?: Array<Record<string, unknown>> } | null;
    if (Array.isArray(parsed?.ballot)) {
      const items: GovernanceBallotItem[] = [];
      for (const rawItem of parsed.ballot.slice(0, 3)) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const impactForecast = typeof rawItem.impactForecast === 'string'
          ? (rawItem.impactForecast as string).slice(0, 300)
          : undefined;
        const description = String(rawItem.description ?? '').slice(0, 200);

        // Phase 11 D-18: law_amendment kind (detected by presence of paragraph fields).
        if (typeof rawItem.oldParagraph === 'string' && typeof rawItem.newParagraph === 'string') {
          const oldPara = (rawItem.oldParagraph as string).trim();
          const newPara = (rawItem.newParagraph as string).trim();
          if (!oldPara || !newPara) continue;
          items.push({
            kind: 'law_amendment',
            oldParagraph: oldPara,
            newParagraph: newPara,
            description,
            impactForecast,
          });
          continue;
        }

        // Legacy 'policy' kind (detected by scalar field + proposedValue).
        if (typeof rawItem.field === 'string' && typeof rawItem.proposedValue === 'number') {
          const field = rawItem.field as string;
          if (field !== 'tax_rate' && field !== 'ubi_allocation' && field !== 'enforcement_level') continue;
          const clamped = clampPolicyValue(field, rawItem.proposedValue as number);
          if (!isFinite(clamped)) continue;
          items.push({
            kind: 'policy',
            field: field as PolicyField,
            proposedValue: clamped,
            description,
            impactForecast,
          });
          continue;
        }

        console.warn('[GOVERNANCE] Ballot item with unrecognized shape; skipping');
      }
      ballot = items;
    }
  } catch {
    // Non-fatal: empty ballot
  }

  if (ballot.length === 0) {
    return {
      policyChanged: false,
      newPolicy: currentPolicy,
      ratifiedItems: [],
      rejectedItems: [],
      summary: `📜 Governance Session at iteration ${iterNum}: Proposals were submitted but could not be synthesized into a ballot.`,
    };
  }

  // ── Step 4: Voting ───────────────────────────────────────────────────────
  const voteResults: Array<{ item: GovernanceBallotItem; yesCount: number; noCount: number }> = [];

  for (const item of ballot) {
    let yesCount = 0;
    let noCount = 0;

    await Promise.allSettled(politicians.map(async (agent) => {
      try {
        const messages = buildVotePrompt(agent, item, currentPolicy);
        const raw = await citizenProv.chat(messages, {
          model: citizenModel
        });
        const parsed = safeJson(raw) as { vote?: string } | null;
        if (parsed?.vote === 'YES') yesCount++;
        else if (parsed?.vote === 'NO') noCount++;
        // else: true abstention — neither counter incremented, vote has no effect on outcome
      } catch {
        // abstain on LLM failure — don't bias the vote either direction
      }
    }));

    voteResults.push({ item, yesCount, noCount });
  }

  // ── Step 5: Ratification ─────────────────────────────────────────────────
  const ratifiedItems: GovernanceBallotItem[] = [];
  const rejectedItems: GovernanceBallotItem[] = [];
  const newPolicy: SessionPolicy = { ...currentPolicy };
  let updatedLaw: string | null = null;
  const sessionConfigRoot = (session.config as Record<string, unknown> | null) ?? {};
  const amendmentHistory: LawAmendmentHistoryEntry[] = Array.isArray(
    sessionConfigRoot.lawAmendmentHistory,
  )
    ? ([...(sessionConfigRoot.lawAmendmentHistory as LawAmendmentHistoryEntry[])])
    : [];
  let workingLaw: string = session.law ?? '';

  for (const { item, yesCount, noCount } of voteResults) {
    const passes = yesCount > noCount; // Strict majority required; ties and abstentions reject the item.
    if (!passes) {
      rejectedItems.push(item);
      continue;
    }

    if (item.kind === 'policy') {
      newPolicy[item.field] = item.proposedValue;
      ratifiedItems.push(item);
      continue;
    }

    // Phase 11 D-18: law_amendment — apply paragraph-level diff to session.law.
    const diffResult = applyParagraphDiff(workingLaw, item.oldParagraph, item.newParagraph);
    if (diffResult.applied) {
      workingLaw = diffResult.law;
      updatedLaw = diffResult.law;
      amendmentHistory.push({
        iteration: iterNum,
        old: item.oldParagraph,
        new: item.newParagraph,
        description: item.description,
      });
      ratifiedItems.push(item);
      console.log(`[GOVERNANCE] Law amendment ratified at iter ${iterNum}: ${item.description}`);
    } else {
      console.warn('[GOVERNANCE] Law amendment not applied: oldParagraph not found verbatim');
      rejectedItems.push(item);
    }
  }

  const policyChanged = ratifiedItems.length > 0;

  // Persist ratified policy / law / history to DB
  if (policyChanged) {
    try {
      const updatedConfig: Record<string, unknown> = {
        ...sessionConfigRoot,
        policy: newPolicy,
      };
      if (amendmentHistory.length > 0) {
        updatedConfig.lawAmendmentHistory = amendmentHistory;
      }
      await sessionRepo.updateConfig(sessionId, updatedConfig);
      // Mutate in-memory session so downstream iterations see the updated config.
      session.config = updatedConfig as typeof session.config;

      if (updatedLaw !== null) {
        await sessionRepo.updateLaw(sessionId, updatedLaw);
        session.law = updatedLaw;
      }
    } catch (err) {
      console.error(`[GOVERNANCE] Failed to persist policy for session ${sessionId}:`, err);
    }
  }

  // ── Build summary narrative ──────────────────────────────────────────────
  const politicianNames = politicians.map(p => `${p.name} (${p.role})`).join(', ');
  const describeItem = (i: GovernanceBallotItem): string =>
    i.kind === 'policy'
      ? `**${i.field}** → ${i.proposedValue} — "${i.description}"`
      : `**law amendment** — "${i.description}"`;
  const ratifiedLines = ratifiedItems.map(i => `  ✅ ${describeItem(i)}`);
  const rejectedLines = rejectedItems.map(i => `  ❌ ${describeItem(i)} (rejected)`);

  let summary: string;
  if (!policyChanged) {
    summary = `📜 **Governance Session — Iteration ${iterNum}**\n` +
      `Legislators: ${politicianNames}\n` +
      `All ${ballot.length} ballot item(s) were rejected. Current policy unchanged.`;
  } else {
    summary = `📜 **Governance Session — Iteration ${iterNum}**\n` +
      `Legislators: ${politicianNames}\n` +
      `**Ratified:**\n${ratifiedLines.join('\n')}` +
      (rejectedLines.length > 0 ? `\n**Rejected:**\n${rejectedLines.join('\n')}` : '') +
      `\n\nThe new laws take effect immediately.`;
  }

  return { policyChanged, newPolicy, ratifiedItems, rejectedItems, summary };
}
