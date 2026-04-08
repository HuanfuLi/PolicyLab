/**
 * Policy brief and cross-scenario reflection routes.
 *
 * Mounted at: /api/reflect
 *
 * POST /policy-brief     -- generate combined policy brief from multiple scenarios
 * POST /cross-scenario   -- generate cross-scenario comparison narrative
 */
import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, agents, iterations } from '../db/schema.js';
import { getProvider } from '../llm/gateway.js';
import { readSettings } from '../settings.js';
import { buildPolicyBriefPrompt } from '../llm/prompts/index.js';
import type { PolicyBriefScenario } from '../llm/prompts/index.js';

const router = Router();

/** Load session data needed for policy brief generation. */
async function loadScenarioData(sessionId: string): Promise<PolicyBriefScenario | null> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return null;

  const agentRows = await db.select().from(agents).where(eq(agents.sessionId, sessionId));
  const agentCount = agentRows.filter(a => a.type !== 'central').length;
  const deaths = agentRows.filter(a => a.status === 'dead').length;

  const iterRows = await db
    .select()
    .from(iterations)
    .where(eq(iterations.sessionId, sessionId))
    .orderBy(asc(iterations.iterationNumber));

  let avgWealth = 0, avgHealth = 0, avgHappiness = 0;
  let giniCoefficient: number | undefined;
  let m1: number | undefined;
  let loansOutstanding: number | undefined;
  let infrastructureQuality: number | undefined;
  let educationQuality: number | undefined;

  if (iterRows.length > 0) {
    const last = iterRows[iterRows.length - 1];
    try {
      const stats = JSON.parse(last.statistics) as Record<string, unknown>;
      avgWealth = Math.round((stats.avgWealth as number | undefined) ?? 0);
      avgHealth = Math.round((stats.avgHealth as number | undefined) ?? 0);
      avgHappiness = Math.round((stats.avgHappiness as number | undefined) ?? 0);
      giniCoefficient = typeof stats.giniCoefficient === 'number' ? stats.giniCoefficient : undefined;
      m1 = typeof stats.m1 === 'number' ? stats.m1 : undefined;
      loansOutstanding = typeof stats.loansOutstanding === 'number' ? stats.loansOutstanding : undefined;
      infrastructureQuality = typeof stats.infrastructureQuality === 'number' ? stats.infrastructureQuality : undefined;
      educationQuality = typeof stats.educationQuality === 'number' ? stats.educationQuality : undefined;
    } catch { /* use defaults */ }
  }

  let verdict: string | null = null;
  if (session.societyEvaluation) {
    try {
      const ev = JSON.parse(session.societyEvaluation) as { verdict?: string };
      verdict = ev.verdict ?? null;
    } catch { /* ignore */ }
  }

  // Extract config diffs (compare against first session as baseline)
  let economyConfig: Record<string, unknown> = {};
  if (session.config) {
    try {
      const cfg = JSON.parse(session.config) as Record<string, unknown>;
      economyConfig = (cfg.economyConfig as Record<string, unknown>) ?? {};
    } catch { /* use empty */ }
  }

  return {
    label: session.scenarioLabel || session.title,
    title: session.title,
    societyOverview: session.societyOverview,
    agentCount,
    deaths,
    avgWealth,
    avgHealth,
    avgHappiness,
    verdict,
    giniCoefficient,
    m1,
    loansOutstanding,
    infrastructureQuality,
    educationQuality,
    configDiffs: undefined, // Computed after loading all scenarios
    _economyConfig: economyConfig, // Internal: used for diff computation
  } as PolicyBriefScenario & { _economyConfig: Record<string, unknown> };
}

// POST /policy-brief
router.post('/policy-brief', async (req, res) => {
  const { sessionIds } = req.body as { sessionIds?: string[] };

  if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length < 2) {
    return res.status(400).json({ error: 'At least 2 session IDs required' });
  }

  try {
    // Load all scenario data
    const rawScenarios = await Promise.all(sessionIds.map(loadScenarioData));
    const scenarios = rawScenarios.filter((s): s is NonNullable<typeof s> => s !== null);

    if (scenarios.length < 2) {
      return res.status(404).json({ error: 'Could not load enough sessions for comparison' });
    }

    // Compute config diffs relative to first scenario (baseline)
    const baselineConfig = (scenarios[0] as unknown as { _economyConfig: Record<string, unknown> })._economyConfig;
    for (let i = 1; i < scenarios.length; i++) {
      const scenarioConfig = (scenarios[i] as unknown as { _economyConfig: Record<string, unknown> })._economyConfig;
      const diffs: Record<string, { baseline: number; scenario: number }> = {};
      for (const key of Object.keys(scenarioConfig)) {
        const bVal = baselineConfig[key];
        const sVal = scenarioConfig[key];
        if (typeof bVal === 'number' && typeof sVal === 'number' && bVal !== sVal) {
          diffs[key] = { baseline: bVal, scenario: sVal };
        }
      }
      if (Object.keys(diffs).length > 0) {
        scenarios[i].configDiffs = diffs;
      }
    }

    // Clean internal fields before passing to prompt builder
    const cleanScenarios: PolicyBriefScenario[] = scenarios.map(s => {
      const { _economyConfig, ...clean } = s as PolicyBriefScenario & { _economyConfig?: unknown };
      return clean;
    });

    const settings = readSettings();
    const provider = getProvider();
    const messages = buildPolicyBriefPrompt(cleanScenarios);
    const brief = await provider.chat(messages, { model: settings.centralAgentModel });

    return res.json({ brief });
  } catch (err) {
    console.error('POST /api/reflect/policy-brief error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Policy brief generation failed', detail });
  }
});

// POST /cross-scenario
router.post('/cross-scenario', async (req, res) => {
  const { sessionIds } = req.body as { sessionIds?: string[] };

  if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length < 2) {
    return res.status(400).json({ error: 'At least 2 session IDs required' });
  }

  try {
    const rawScenarios = await Promise.all(sessionIds.map(loadScenarioData));
    const scenarios = rawScenarios.filter((s): s is NonNullable<typeof s> => s !== null);

    if (scenarios.length < 2) {
      return res.status(404).json({ error: 'Could not load enough sessions for comparison' });
    }

    const cleanScenarios: PolicyBriefScenario[] = scenarios.map(s => {
      const { _economyConfig, ...clean } = s as PolicyBriefScenario & { _economyConfig?: unknown };
      return clean;
    });

    const settings = readSettings();
    const provider = getProvider();

    const systemPrompt = `You are analyzing ${scenarios.length} parallel economic simulation scenarios. Generate a concise cross-scenario comparison narrative in markdown format. Focus on how outcomes differ and why. Keep it under 500 words.`;

    const scenarioText = cleanScenarios.map((s, i) =>
      `Scenario ${i + 1} "${s.label}": ${s.agentCount} agents, ${s.deaths} deaths, avg wealth=${s.avgWealth}, health=${s.avgHealth}, happiness=${s.avgHappiness}. Verdict: ${s.verdict ?? 'N/A'}`
    ).join('\n');

    const narrative = await provider.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Compare these scenarios:\n${scenarioText}` },
    ], { model: settings.centralAgentModel });

    return res.json({ narrative });
  } catch (err) {
    console.error('POST /api/reflect/cross-scenario error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'Cross-scenario analysis failed', detail });
  }
});

export default router;
