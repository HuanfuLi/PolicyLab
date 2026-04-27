/**
 * Phase 12 D-06/D-15: Creative-mode enterprise generation.
 *
 * Calls the Central Agent LLM to produce enterprise blueprints for a
 * creative-mode society, then validates them against the D-05 invariant.
 * On invariant failure, re-prompts the LLM with validator feedback up to
 * MAX_CREATIVE_ATTEMPTS times. On exhaustion, throws with a clearly labelled
 * error that the bootstrap route surfaces as an SSE error event.
 */
import type { EnterpriseBlueprint, EnterpriseSector } from '@policylab/shared';
import type { LLMProvider } from '../llm/types.js';
import type { AgentBlueprint } from './dataBootstrapPipeline.js';
import { isEmployableAgent } from '../orchestration/helpers/isEmployableAgent.js';
import { buildEnterpriseBlueprintsPrompt } from '../llm/prompts/central-agent.js';

const MAX_CREATIVE_ATTEMPTS = 3;

/** Maps sector to its default commodity output. */
function sectorToCommodity(
  sector: EnterpriseSector,
): EnterpriseBlueprint['commodityOutput'] {
  switch (sector) {
    case 'agriculture': return 'food';
    case 'industry': return 'tools';
    case 'services': return 'luxury_goods';
    case 'government': return 'none';
  }
}

interface ValidatorContext {
  employableCount: number;
  sectorCounts: Map<EnterpriseSector | string, number>;
}

/**
 * Validates a raw LLM response string against the D-05 enterprise-roster
 * invariant. Returns either the parsed blueprints or a healing feedback string.
 *
 * Exported so tests can call it directly.
 */
export function validateEnterpriseRosterResponse(
  raw: string,
  ctx: ValidatorContext,
): { ok: true; value: EnterpriseBlueprint[] } | { ok: false; healing: string } {
  const { employableCount, sectorCounts } = ctx;

  // ── 1. JSON parse ─────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, healing: `Output was not valid JSON: ${(e as Error).message}` };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      healing: 'Top-level JSON must be an array of enterprise blueprint objects.',
    };
  }

  // ── 2. Shape validation ───────────────────────────────────────────────────
  const VALID_SECTORS = new Set<string>(['agriculture', 'industry', 'services', 'government']);
  const blueprints: EnterpriseBlueprint[] = [];

  for (const [i, item] of (parsed as unknown[]).entries()) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, healing: `Entry ${i}: must be an object.` };
    }
    const it = item as Record<string, unknown>;

    const sector = it.sector as EnterpriseSector;
    if (!VALID_SECTORS.has(sector)) {
      return {
        ok: false,
        healing: `Entry ${i}: sector must be one of agriculture|industry|services|government, got "${sector}".`,
      };
    }

    const capacity = typeof it.capacity === 'number' ? it.capacity : Number(it.capacity);
    if (!Number.isFinite(capacity) || capacity < 2) {
      return {
        ok: false,
        healing: `Entry ${i}: capacity must be a finite number ≥ 2, got ${it.capacity}.`,
      };
    }

    const initialWorkforceSize =
      typeof it.initialWorkforceSize === 'number'
        ? it.initialWorkforceSize
        : Number(it.initialWorkforceSize ?? 0);

    if (capacity < initialWorkforceSize) {
      return {
        ok: false,
        healing: `Entry ${i}: capacity (${capacity}) must be ≥ initialWorkforceSize (${initialWorkforceSize}).`,
      };
    }

    const wage =
      typeof it.wageAnchor === 'number'
        ? it.wageAnchor
        : typeof it.wage === 'number'
          ? it.wage
          : 5;

    blueprints.push({
      id: `ent_${sector.slice(0, 4)}_${i + 1}`,
      name: `${String(it.ownerRole ?? sector)} enterprise ${i + 1}`,
      ownerId: String(it.ownerRole ?? 'owner'),
      sector,
      industry: String(it.sector),
      commodityOutput: sectorToCommodity(sector),
      initialCapital: 0,
      initialInventory: {},
      employees: [],
      wage,
      isServiceEnterprise: sector === 'government',
      capacity,
    });
  }

  // ── 3. D-05 Invariant 1: every ≥5% sector has ≥1 enterprise ─────────────
  const coveredSectors = new Set(blueprints.map(b => b.sector));
  const missing: string[] = [];

  for (const [sector, count] of sectorCounts) {
    if (
      employableCount > 0 &&
      count / employableCount >= 0.05 &&
      !coveredSectors.has(sector as EnterpriseSector)
    ) {
      missing.push(String(sector));
    }
  }

  // ── 4. D-05 Invariant 2: sum(capacity) ≥ 1.10 × employable ──────────────
  const sumCapacity = blueprints.reduce((s, b) => s + (b.capacity ?? 0), 0);
  const target = Math.ceil(employableCount * 1.10);

  if (missing.length > 0 || sumCapacity < target) {
    const covered = [...coveredSectors].join(', ') || '(none)';
    const missingStr = missing.join(', ') || '(none)';
    const healing =
      `The roster you generated covers sectors [${covered}] but sectors [${missingStr}] ` +
      `have ≥5% workforce with zero employers. Total capacity: ${sumCapacity}. Need ≥ ${target}. ` +
      `Add enterprises for the missing sectors and/or raise capacity so every sector with ≥5% ` +
      `workforce has ≥1 enterprise and sum(capacity) ≥ 1.10 × ${employableCount}.`;
    return { ok: false, healing };
  }

  return { ok: true, value: blueprints };
}

/**
 * Asks the Central Agent LLM to generate an enterprise roster matching the
 * creative-mode society, then validates the D-05 invariant.
 *
 * On invariant failure, re-prompts with validator feedback up to
 * MAX_CREATIVE_ATTEMPTS (3) total attempts. On exhaustion throws:
 *   Error('[Phase 12 L-03 creative-mode] Central Agent failed to generate valid
 *   enterprise roster after 3 attempts: <lastError>')
 *
 * The caller (bootstrap route) is expected to surface this as an SSE error event.
 */
export async function generateEnterprisesFromCentralAgent(params: {
  overview: string;
  agentRoster: AgentBlueprint[];
  baseFiat: number;
  minimumWage: number;
  llm: LLMProvider;
}): Promise<EnterpriseBlueprint[]> {
  const { overview, agentRoster, baseFiat, minimumWage, llm } = params;

  // Compute employable counts once — reused across all retry attempts
  const employable = agentRoster.filter(isEmployableAgent);
  const sectorCounts = new Map<EnterpriseSector | string, number>();
  for (const a of employable) {
    const s = (a.sector ?? 'unspecified') as EnterpriseSector | string;
    sectorCounts.set(s, (sectorCounts.get(s) ?? 0) + 1);
  }
  const validatorCtx: ValidatorContext = {
    employableCount: employable.length,
    sectorCounts,
  };

  let lastHealing: string | undefined = undefined;
  let lastError = 'unknown validation error';

  for (let attempt = 0; attempt < MAX_CREATIVE_ATTEMPTS; attempt++) {
    // Build a fresh prompt each attempt, injecting the previous healing feedback
    const messages = buildEnterpriseBlueprintsPrompt({
      overview,
      agentRoster,
      baseFiat,
      minimumWage,
      healingFeedback: lastHealing,
    });

    let raw: string;
    try {
      raw = await llm.chat(messages);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Phase 12 L-03 creative-mode] LLM call failed on attempt ${attempt + 1}: ${lastError}`,
      );
      continue;
    }

    const result = validateEnterpriseRosterResponse(raw, validatorCtx);

    if (result.ok) {
      return result.value;
    }

    lastError = result.healing;
    lastHealing = result.healing;

    console.warn(
      `[Phase 12 L-03 creative-mode] Attempt ${attempt + 1} failed validation: ${lastError.slice(0, 200)}`,
    );
  }

  throw new Error(
    `[Phase 12 L-03 creative-mode] Central Agent failed to generate valid enterprise roster after ${MAX_CREATIVE_ATTEMPTS} attempts: ${lastError}`,
  );
}
