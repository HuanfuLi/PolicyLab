import type { LocationProfile } from '@policylab/shared';
import type { AgentBlueprint } from '../data/dataBootstrapPipeline.js';
import type { LLMProvider } from '../llm/types.js';
import { withRetry } from '../llm/retry.js';
import { retryWithHealing } from '../llm/retryWithHealing.js';
import { buildLocationAgentRosterMessages } from '../llm/prompts/index.js';
import { parseJSON } from '../parsers/json.js';

export interface RosterAgentEntry {
  name: string;
  background: string;
}

export const rosterJsonSchema = {
  name: 'agent_roster',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      agents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            background: { type: 'string' },
          },
          required: ['name', 'background'],
          additionalProperties: false,
        },
      },
    },
    required: ['agents'],
    additionalProperties: false,
  } as Record<string, unknown>,
};

function isCountMismatch(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /expected \d+ agents, got \d+/i.test(msg);
}

export function parseAndValidateRosterBatch(
  rosterRaw: string,
  expectedCount: number,
  batchStart: number,
): RosterAgentEntry[] {
  const rosterData = parseJSON<{ agents: Array<{ name: string; background: string }> }>(rosterRaw);

  if (!Array.isArray(rosterData.agents)) {
    throw new Error(`batch ${batchStart}: response is not an array`);
  }
  if (rosterData.agents.length !== expectedCount) {
    throw new Error(`batch ${batchStart}: expected ${expectedCount} agents, got ${rosterData.agents.length}`);
  }

  return rosterData.agents.map((entry, index) => {
    const background = (entry?.background ?? '').trim();
    if (!background) {
      throw new Error(`batch ${batchStart}: agent index ${index} has empty background`);
    }
    return {
      name: (entry?.name ?? '').trim(),
      background,
    };
  });
}

interface EnrichRosterBatchArgs {
  provider: LLMProvider;
  profile: LocationProfile;
  batchBlueprints: AgentBlueprint[];
  scenario?: string;
  batchStart: number;
}

export async function enrichRosterBatch({
  provider,
  profile,
  batchBlueprints,
  scenario,
  batchStart,
}: EnrichRosterBatchArgs): Promise<RosterAgentEntry[]> {
  const messages = buildLocationAgentRosterMessages(profile, batchBlueprints, scenario);
  const parse = (raw: string) => parseAndValidateRosterBatch(raw, batchBlueprints.length, batchStart);

  try {
    const rosterRaw = await withRetry(() => provider.chat(messages, { jsonSchema: rosterJsonSchema }));
    return parse(rosterRaw);
  } catch (err) {
    if (batchBlueprints.length > 1 && isCountMismatch(err)) {
      const splitAt = Math.ceil(batchBlueprints.length / 2);
      console.warn(
        `[bootstrap] Batch ${batchStart} returned the wrong agent count; splitting ${batchBlueprints.length} -> ${splitAt} + ${batchBlueprints.length - splitAt}`,
      );
      const left = await enrichRosterBatch({
        provider,
        profile,
        batchBlueprints: batchBlueprints.slice(0, splitAt),
        scenario,
        batchStart,
      });
      const right = await enrichRosterBatch({
        provider,
        profile,
        batchBlueprints: batchBlueprints.slice(splitAt),
        scenario,
        batchStart: batchStart + splitAt,
      });
      return [...left, ...right];
    }
  }

  return retryWithHealing({
    provider,
    messages,
    options: { jsonSchema: rosterJsonSchema },
    parse,
    fallback: [],
    label: `bootstrap roster batch ${batchStart}`,
    throwOnExhaustion: true,
  });
}
