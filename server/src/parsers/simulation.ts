/**
 * C6: Simulation parsers — parse LLM responses for agent intents and resolution (spec §5.6).
 */
import { parseJSON } from './json.js';
import { normalizeActionCode, type ActionCode } from '../mechanics/actionCodes.js';

export interface ParsedQueuedAction {
  actionCode: ActionCode;
  parameters: Record<string, unknown>;
}

export interface ParsedAgentIntent {
  intent: string;
  reasoning: string;
  actions: ParsedQueuedAction[];
  primaryActionCode: ActionCode;
  primaryActionTarget: string | null;
}

export interface ParsedAgentOutcome {
  agentId: string;
  outcome: string;
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
  died: boolean;
  newRole: string | null;
}

export interface ParsedLifecycleEvent {
  type: 'death' | 'role_change';
  agentId: string;
  detail: string;
}

export interface ParsedResolution {
  narrativeSummary: string;
  agentOutcomes: ParsedAgentOutcome[];
  lifecycleEvents: ParsedLifecycleEvent[];
}

export function parseAgentIntent(text: string): ParsedAgentIntent {
  try {
    const raw = parseJSON<Record<string, unknown>>(text);
    const actionCode = normalizeActionCode(String(raw.actionCode ?? 'NONE'));
    const actionTarget = raw.actionTarget ? String(raw.actionTarget) : null;
    return {
      intent: String(raw.intent ?? '').trim() || 'No specific intent.',
      reasoning: String(raw.reasoning ?? '').trim(),
      actions: [{ actionCode, parameters: actionTarget ? { target: actionTarget } : {} }],
      primaryActionCode: actionCode,
      primaryActionTarget: actionTarget,
    };
  } catch {
    // LLM returned prose — treat the whole text as the intent
    return {
      intent: text.trim().slice(0, 500) || 'No specific intent.',
      reasoning: '',
      actions: [{ actionCode: 'NONE', parameters: {} }],
      primaryActionCode: 'NONE',
      primaryActionTarget: null,
    };
  }
}

/**
 * Strict version of parseAgentIntent that throws on failure.
 * Used with retryWithHealing so the retry loop can detect failures and heal.
 */
export function parseAgentIntentStrict(text: string): ParsedAgentIntent {
  const raw = parseJSON<Record<string, unknown>>(text);
  const intent = String(raw.intent ?? '').trim();
  if (!intent) throw new Error('Missing or empty "intent" field');
  const actionCode = normalizeActionCode(String(raw.actionCode ?? 'NONE'));
  const actionTarget = raw.actionTarget ? String(raw.actionTarget) : null;
  return {
    intent,
    reasoning: String(raw.reasoning ?? '').trim(),
    actions: [{ actionCode, parameters: actionTarget ? { target: actionTarget } : {} }],
    primaryActionCode: actionCode,
    primaryActionTarget: actionTarget,
  };
}

/**
 * Parse the single-pass structured JSON output from buildNaturalIntentPrompt.
 *
 * Expected schema:
 *   { internal_monologue, public_narrative, actions[] }
 *
 * Throws on structural failure so retryWithHealing can append a healing message.
 * Falls back gracefully to old-style { intent, reasoning } fields for resilience.
 */
export function parseSinglePassIntent(text: string): ParsedAgentIntent {
  // Strip markdown code fences if the model wrapped its output
  const stripped = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '');

  const raw = parseJSON<Record<string, unknown>>(stripped);

  const narrative = String(
    raw.public_narrative ?? raw.public_action_narrative ?? raw.intent ?? ''
  ).trim();
  const monologue = String(
    raw.internal_monologue ?? raw.reasoning ?? ''
  ).trim();

  if (!narrative && !monologue) {
    throw new Error('Single-pass response missing both public_action_narrative and internal_monologue');
  }

  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  const actions: ParsedQueuedAction[] = rawActions.slice(0, 3).map((entry) => {
    const item = (entry && typeof entry === 'object') ? entry as Record<string, unknown> : {};
    const parameters = (item.parameters && typeof item.parameters === 'object')
      ? item.parameters as Record<string, unknown>
      : {};
    return {
      actionCode: normalizeActionCode(String(item.actionCode ?? 'NONE')),
      parameters,
    };
  });

  if (actions.length === 0) {
    const fallbackActionCode = normalizeActionCode(String(raw.actionCode ?? 'NONE'));
    const rawTarget = raw.actionTarget ?? (raw.parameters as Record<string, unknown> | undefined)?.target;
    const actionTarget = rawTarget && String(rawTarget).toLowerCase() !== 'null'
      ? String(rawTarget).trim() || null
      : null;
    actions.push({
      actionCode: fallbackActionCode,
      parameters: actionTarget ? { target: actionTarget } : {},
    });
  }

  const primaryAction = actions[0] ?? { actionCode: 'NONE' as ActionCode, parameters: {} };
  const rawPrimaryTarget = primaryAction.parameters.target ?? primaryAction.parameters.agent_id ?? primaryAction.parameters.enterprise_id;
  const primaryActionTarget = rawPrimaryTarget && String(rawPrimaryTarget).toLowerCase() !== 'null'
    ? String(rawPrimaryTarget).trim() || null
    : null;

  return {
    intent: narrative || monologue.slice(0, 300),
    reasoning: monologue,
    actions,
    primaryActionCode: primaryAction.actionCode,
    primaryActionTarget,
  };
}

function clampDelta(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Math.max(-30, Math.min(30, Math.round(isNaN(n) ? 0 : n)));
}

export function parseResolution(text: string): ParsedResolution {
  try {
    return parseResolutionStrict(text);
  } catch {
    // LLM returned prose instead of JSON — use the text as the narrative summary,
    // skip stat updates for this iteration to avoid crashing the simulation
    return {
      narrativeSummary: text.trim().slice(0, 500) || 'The iteration passed without major events.',
      agentOutcomes: [],
      lifecycleEvents: [],
    };
  }
}

/**
 * Strict version of parseResolution that throws on failure.
 * Used with retryWithHealing.
 */
export function parseResolutionStrict(text: string): ParsedResolution {
  const raw = parseJSON<Record<string, unknown>>(text);

  const narrativeSummary = String(raw.narrativeSummary ?? '').trim();
  if (!narrativeSummary) throw new Error('Missing or empty "narrativeSummary" field');

  const rawOutcomes = Array.isArray(raw.agentOutcomes) ? raw.agentOutcomes : [];
  const agentOutcomes: ParsedAgentOutcome[] = rawOutcomes.map((o: Record<string, unknown>) => ({
    agentId: String(o.agentId ?? ''),
    outcome: String(o.outcome ?? '').trim(),
    wealthDelta: 0,
    healthDelta: 0,
    happinessDelta: 0,
    died: o.died === true,
    newRole: o.newRole ? String(o.newRole) : null,
  }));

  const rawEvents = Array.isArray(raw.lifecycleEvents) ? raw.lifecycleEvents : [];
  const lifecycleEvents: ParsedLifecycleEvent[] = rawEvents.map((e: Record<string, unknown>) => ({
    type: e.type === 'role_change' ? 'role_change' : 'death',
    agentId: String(e.agentId ?? ''),
    detail: String(e.detail ?? ''),
  }));

  return { narrativeSummary, agentOutcomes, lifecycleEvents };
}

export function parseFinalReport(text: string): string {
  const raw = parseJSON<Record<string, unknown>>(text);
  return String(raw.finalReport ?? '').trim() || text.trim();
}

// ── Phase 6: map-reduce parsers ──────────────────────────────────────────────

export interface ParsedGroupResolution {
  groupSummary: string;
  agentOutcomes: ParsedAgentOutcome[];
  lifecycleEvents: ParsedLifecycleEvent[];
}

export function parseGroupResolution(text: string): ParsedGroupResolution {
  try {
    return parseGroupResolutionStrict(text);
  } catch {
    return { groupSummary: 'The group continued their activities.', agentOutcomes: [], lifecycleEvents: [] };
  }
}

/**
 * Strict version of parseGroupResolution that throws on failure.
 * Used with retryWithHealing.
 */
export function parseGroupResolutionStrict(text: string): ParsedGroupResolution {
  const raw = parseJSON<Record<string, unknown>>(text);
  const groupSummary = String(raw.groupSummary ?? '').trim();
  if (!groupSummary) throw new Error('Missing or empty "groupSummary" field');

  const rawOutcomes = Array.isArray(raw.agentOutcomes) ? raw.agentOutcomes : [];
  const agentOutcomes: ParsedAgentOutcome[] = rawOutcomes.map((o: Record<string, unknown>) => ({
    agentId: String(o.agentId ?? ''),
    outcome: String(o.outcome ?? '').trim(),
    wealthDelta: 0,
    healthDelta: 0,
    happinessDelta: 0,
    died: o.died === true,
    newRole: o.newRole ? String(o.newRole) : null,
  }));

  const rawEvents = Array.isArray(raw.lifecycleEvents) ? raw.lifecycleEvents : [];
  const lifecycleEvents: ParsedLifecycleEvent[] = rawEvents.map((e: Record<string, unknown>) => ({
    type: e.type === 'role_change' ? 'role_change' : 'death',
    agentId: String(e.agentId ?? ''),
    detail: String(e.detail ?? ''),
  }));

  return { groupSummary, agentOutcomes, lifecycleEvents };
}

export interface ParsedMergeResolution {
  narrativeSummary: string;
  lifecycleEvents: ParsedLifecycleEvent[];
}

export function parseMergeResolution(text: string): ParsedMergeResolution {
  try {
    return parseMergeResolutionStrict(text);
  } catch {
    return { narrativeSummary: text.trim().slice(0, 500) || 'The iteration passed.', lifecycleEvents: [] };
  }
}

/**
 * Strict version of parseMergeResolution that throws on failure.
 * Used with retryWithHealing.
 */
export function parseMergeResolutionStrict(text: string): ParsedMergeResolution {
  const raw = parseJSON<Record<string, unknown>>(text);
  const narrativeSummary = String(raw.narrativeSummary ?? '').trim();
  if (!narrativeSummary) throw new Error('Missing or empty "narrativeSummary" field');

  const rawEvents = Array.isArray(raw.lifecycleEvents) ? raw.lifecycleEvents : [];
  const lifecycleEvents: ParsedLifecycleEvent[] = rawEvents.map((e: Record<string, unknown>) => ({
    type: e.type === 'role_change' ? 'role_change' : 'death',
    agentId: String(e.agentId ?? ''),
    detail: String(e.detail ?? ''),
  }));

  return { narrativeSummary, lifecycleEvents };
}
