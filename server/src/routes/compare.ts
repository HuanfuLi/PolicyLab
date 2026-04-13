/**
 * Phase 5: Cross-session comparison routes.
 *
 * Mounted at: /api/compare
 *
 * POST /        — run LLM comparison of two sessions
 * POST /chat    — follow-up Q&A on an existing comparison
 */
import { Router } from 'express';
import { and, asc, eq, like } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, agents, iterations, chatMessages } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import { getProvider } from '../llm/gateway.js';
import { readSettings } from '../settings.js';
import { buildComparisonMessages, buildComparisonChatMessages } from '../llm/prompts/index.js';
import type { IterationMetricRow, WealthDistribution } from '../llm/prompts/comparison.js';
import { getSessionTelemetry } from '../orchestration/simulationRunner.js';
import { parseJSON } from '../parsers/json.js';
import type { ComparisonResult, ChatMessage, EconomyParamDiff } from '@policylab/shared';

const router = Router();

/** Gather all data needed to describe a session for comparison. */
async function loadSessionSummary(sessionId: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return null;

  const agentRows = await db.select().from(agents).where(eq(agents.sessionId, sessionId));
  const agentCount = agentRows.length;
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
  let defenseQuality: number | undefined;
  let welfareQuality: number | undefined;

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
      defenseQuality = typeof stats.defenseQuality === 'number' ? stats.defenseQuality : undefined;
      welfareQuality = typeof stats.welfareQuality === 'number' ? stats.welfareQuality : undefined;
    } catch { /* use defaults */ }
  }

  // Extract economyConfig from session config JSON
  let economyConfig: Record<string, unknown> = {};
  if (session.config) {
    try {
      const cfg = JSON.parse(session.config) as Record<string, unknown>;
      economyConfig = (cfg.economyConfig as Record<string, unknown>) ?? {};
    } catch { /* use empty */ }
  }

  let verdict: string | null = null;
  if (session.societyEvaluation) {
    try {
      const ev = JSON.parse(session.societyEvaluation) as { verdict?: string };
      verdict = ev.verdict ?? null;
    } catch { /* ignore */ }
  }

  return {
    title: session.title,
    societyOverview: session.societyOverview,
    law: session.law,
    agentCount,
    deaths,
    avgWealth,
    avgHealth,
    avgHappiness,
    verdict,
    // Economic telemetry
    giniCoefficient,
    m1,
    loansOutstanding,
    infrastructureQuality,
    educationQuality,
    defenseQuality,
    welfareQuality,
    economyConfig,
  };
}

// Param diff label map — maps EconomyConfig keys to human-readable labels
const PARAM_LABELS: Record<string, string> = {
  bankingEnabled: 'Banking Enabled',
  reserveRequirement: 'Reserve Ratio',
  baseLoanInterestRate: 'Loan Interest Rate',
  depositInterestRate: 'Deposit Interest Rate',
  defaultLoanTermIterations: 'Loan Term',
  defaultThresholdIterations: 'Default Threshold',
  capitalMarketsEnabled: 'Capital Markets Enabled',
  fiscalEnabled: 'Fiscal Policy Enabled',
  inflationEnabled: 'Inflation Enabled',
  dividendPayoutRatio: 'Dividend Payout Ratio',
  govBondCouponRate: 'Gov Bond Coupon Rate',
  govBondTermIterations: 'Gov Bond Maturity',
  budgetSpendingRate: 'Budget Spending Rate',
  infrastructureMultiplier: 'Infrastructure Multiplier',
  educationMultiplier: 'Education Multiplier',
  defenseMultiplier: 'Defense Multiplier',
  welfareMultiplier: 'Welfare Multiplier',
  publicGoodsDecayRate: 'Public Goods Decay Rate',
  publicGoodsGainDiminishing: 'Diminishing Returns Exponent',
  m1InflationCoeff: 'M1 Inflation Coefficient',
  inflationAmmThreshold: 'AMM Price Pressure Threshold',
  inflationAmmCap: 'AMM Price Change Cap',
  centralBankEnabled: 'Central Bank Enabled',
};

/** Build per-iteration metric trajectory from iteration rows + telemetry for comparison prompt grounding. */
function buildTimeSeries(
  iterRows: Array<{ iterationNumber: number; statistics: string }>,
  sessionId: string,
): IterationMetricRow[] {
  const telemetry = getSessionTelemetry(sessionId);
  const telemetryByIter = new Map(telemetry.map(t => [t.iterationNumber, t]));

  return iterRows.map(row => {
    let avgWealth = 0, avgHealth = 0, avgHappiness = 0, gini: number | undefined;
    try {
      const stats = JSON.parse(row.statistics) as Record<string, unknown>;
      avgWealth = Math.round((stats.avgWealth as number) ?? 0);
      avgHealth = Math.round((stats.avgHealth as number) ?? 0);
      avgHappiness = Math.round((stats.avgHappiness as number) ?? 0);
      gini = typeof stats.giniWealth === 'number' ? stats.giniWealth : undefined;
    } catch { /* use defaults */ }

    const t = telemetryByIter.get(row.iterationNumber);
    return {
      iter: row.iterationNumber,
      avgWealth,
      avgHealth,
      avgHappiness,
      gini: gini ?? t?.giniCoefficient,
      cpi: t?.cpi,
      m1: t?.m1,
    };
  });
}

/** Compute wealth distribution quartiles from alive agents. */
function computeWealthDistribution(agentRows: Array<{ status: string | null; currentStats: string }>): WealthDistribution | undefined {
  const aliveWealth = agentRows
    .filter(a => a.status !== 'dead')
    .map(a => {
      try {
        const stats = JSON.parse(a.currentStats) as { wealth?: number };
        return stats.wealth ?? 0;
      } catch { return 0; }
    })
    .sort((a, b) => a - b);

  if (aliveWealth.length < 4) return undefined;

  const q1End = Math.floor(aliveWealth.length * 0.25);
  const q3Start = Math.floor(aliveWealth.length * 0.75);
  const bottom25 = aliveWealth.slice(0, q1End);
  const top25 = aliveWealth.slice(q3Start);
  const medianIdx = Math.floor(aliveWealth.length / 2);

  return {
    bottom25Avg: Math.round(bottom25.reduce((s, v) => s + v, 0) / (bottom25.length || 1)),
    median: Math.round(aliveWealth[medianIdx]),
    top25Avg: Math.round(top25.reduce((s, v) => s + v, 0) / (top25.length || 1)),
  };
}

/** Compute deterministic param diffs between two sessions' economyConfig objects. */
function computeParamDiffs(
  config1: Record<string, unknown>,
  config2: Record<string, unknown>): EconomyParamDiff[] {
  const allKeys = new Set([...Object.keys(config1), ...Object.keys(config2)]);
  const diffs: EconomyParamDiff[] = [];
  for (const key of allKeys) {
    const v1 = config1[key];
    const v2 = config2[key];
    if (v1 !== v2 && (typeof v1 === 'number' || typeof v1 === 'boolean' || typeof v2 === 'number' || typeof v2 === 'boolean')) {
      diffs.push({
        param: key,
        label: PARAM_LABELS[key] ?? key,
        session1Value: (v1 as number | boolean) ?? ('N/A' as unknown as number),
        session2Value: (v2 as number | boolean) ?? ('N/A' as unknown as number),
      });
    }
  }
  return diffs;
}

// POST /api/compare
router.post('/', async (req, res) => {
  const { id1, id2 } = req.body as { id1?: string; id2?: string };

  if (!id1 || !id2) {
    return res.status(400).json({ error: 'id1 and id2 are required' });
  }
  if (id1 === id2) {
    return res.status(400).json({ error: 'id1 and id2 must be different sessions' });
  }

  const [summary1, summary2] = await Promise.all([
    loadSessionSummary(id1),
    loadSessionSummary(id2),
  ]);

  if (!summary1) return res.status(404).json({ error: `Session ${id1} not found` });
  if (!summary2) return res.status(404).json({ error: `Session ${id2} not found` });

  try {
    const settings = readSettings();
    const provider = getProvider();

    const economyParamDiffs = computeParamDiffs(summary1.economyConfig, summary2.economyConfig);

    // Gather per-iteration time-series for trend grounding
    const [iterRows1, iterRows2] = await Promise.all([
      db.select({ iterationNumber: iterations.iterationNumber, statistics: iterations.statistics })
        .from(iterations).where(eq(iterations.sessionId, id1)).orderBy(asc(iterations.iterationNumber)),
      db.select({ iterationNumber: iterations.iterationNumber, statistics: iterations.statistics })
        .from(iterations).where(eq(iterations.sessionId, id2)).orderBy(asc(iterations.iterationNumber)),
    ]);
    const timeSeries1 = buildTimeSeries(iterRows1, id1);
    const timeSeries2 = buildTimeSeries(iterRows2, id2);

    // Gather wealth distribution for inequality grounding
    const [agentRows1, agentRows2] = await Promise.all([
      db.select({ status: agents.status, currentStats: agents.currentStats })
        .from(agents).where(eq(agents.sessionId, id1)),
      db.select({ status: agents.status, currentStats: agents.currentStats })
        .from(agents).where(eq(agents.sessionId, id2)),
    ]);
    const wealthDist1 = computeWealthDistribution(agentRows1);
    const wealthDist2 = computeWealthDistribution(agentRows2);

    // Sample time-series if iterations exceed 30 to keep prompt within token budget.
    // Every Nth row is kept, plus always the first and last for endpoint anchoring.
    const sampleTimeSeries = (rows: typeof timeSeries1): typeof timeSeries1 => {
      if (rows.length <= 30) return rows;
      const step = Math.ceil(rows.length / 25);
      const sampled = rows.filter((_, i) => i === 0 || i === rows.length - 1 || i % step === 0);
      return sampled;
    };

    const llmMessages = buildComparisonMessages(
      summary1, summary2,
      economyParamDiffs.length > 0 ? economyParamDiffs : undefined,
      sampleTimeSeries(timeSeries1), sampleTimeSeries(timeSeries2),
      wealthDist1, wealthDist2,
    );
    const raw = await provider.chat(llmMessages, {
      model: settings.centralAgentModel
    });
    const parsed = parseJSON<{ narrative: string; dimensions: ComparisonResult['dimensions']; verdict: string }>(raw);

    // Diagnostic: if the LLM collapsed most dimensions into the "severe failure"
    // band for both sessions, log a warning so we can catch prompt-calibration
    // regressions. The UI's relative-spread bars still render correctly, but
    // low absolute scores suggest the rubric isn't being respected.
    const bothLowCount = parsed.dimensions.filter(d => d.score1 < 20 && d.score2 < 20).length;
    if (parsed.dimensions.length >= 8 && bothLowCount >= 5) {
      console.warn(
        `[compare] LLM scored ${bothLowCount}/${parsed.dimensions.length} dimensions < 20 for both sessions ${id1} vs ${id2}. ` +
        `Check comparison rubric calibration. Raw dimensions:`,
        parsed.dimensions.map(d => ({ name: d.name, score1: d.score1, score2: d.score2 })),
      );
    }

    const comparison: ComparisonResult = {
      session1Id: id1,
      session2Id: id2,
      narrative: parsed.narrative,
      dimensions: parsed.dimensions,
      verdict: parsed.verdict,
      economyParamDiffs: economyParamDiffs.length > 0 ? economyParamDiffs : undefined,
    };

    // Persist the comparison as a system message so /chat can reload it
    const context = `compare:${id1}:${id2}`;
    await db.insert(chatMessages).values({
      id: uuidv4(),
      sessionId: id1,
      context,
      agentId: null,
      role: 'system',
      content: JSON.stringify(comparison),
      timestamp: new Date().toISOString(),
    });

    return res.json({ comparison });
  } catch (err) {
    console.error('POST /api/compare error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'LLM call failed', detail });
  }
});

// POST /api/compare/chat
router.post('/chat', async (req, res) => {
  const { id1, id2, message } = req.body as { id1?: string; id2?: string; message?: string };
  const maxLength = readSettings().maxMessageLength ?? 64000;

  if (!id1 || !id2) {
    return res.status(400).json({ error: 'id1 and id2 are required' });
  }
  if (!message || message.trim().length === 0 || message.length > maxLength) {
    return res.status(400).json({ error: `message must be 1-${maxLength} characters` });
  }

  // Verify both sessions exist
  const [s1, s2] = await Promise.all([
    db.select().from(sessions).where(eq(sessions.id, id1)),
    db.select().from(sessions).where(eq(sessions.id, id2)),
  ]);
  if (!s1[0]) return res.status(404).json({ error: `Session ${id1} not found` });
  if (!s2[0]) return res.status(404).json({ error: `Session ${id2} not found` });

  const context = `compare:${id1}:${id2}`;

  // Load all stored messages for this comparison context
  const allRows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.sessionId, id1), eq(chatMessages.context, context)))
    .orderBy(asc(chatMessages.timestamp));

  // The latest system message holds the comparison result
  const systemRow = [...allRows].reverse().find(r => r.role === 'system');
  if (!systemRow) {
    return res.status(409).json({ error: 'No comparison found for these sessions. Run POST /api/compare first.' });
  }

  let comparison: ComparisonResult;
  try {
    comparison = JSON.parse(systemRow.content) as ComparisonResult;
  } catch {
    return res.status(500).json({ error: 'Stored comparison data is corrupt' });
  }

  // Chat history = non-system messages
  const history: ChatMessage[] = allRows
    .filter(r => r.role !== 'system')
    .map(r => ({
      id: r.id,
      sessionId: r.sessionId,
      context: r.context as ChatMessage['context'],
      agentId: r.agentId ?? null,
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
      timestamp: r.timestamp,
    }));

  const now = new Date().toISOString();

  // Persist user message
  await db.insert(chatMessages).values({
    id: uuidv4(),
    sessionId: id1,
    context,
    agentId: null,
    role: 'user',
    content: message.trim(),
    timestamp: now,
  });

  try {
    const settings = readSettings();
    const provider = getProvider();
    const llmMessages = buildComparisonChatMessages(
      s1[0].title,
      s2[0].title,
      comparison,
      history,
      message.trim()
    );
    const reply = await provider.chat(llmMessages, { model: settings.centralAgentModel });

    await db.insert(chatMessages).values({
      id: uuidv4(),
      sessionId: id1,
      context,
      agentId: null,
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
    });

    return res.json({ reply });
  } catch (err) {
    console.error('POST /api/compare/chat error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'LLM call failed', detail });
  }
});

// DELETE /api/compare/:id — delete a comparison result
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.delete(chatMessages).where(eq(chatMessages.id, id));
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/compare/:id error:', err);
    return res.status(500).json({ error: 'Failed to delete comparison' });
  }
});

// GET /api/compare/history
router.get('/history', async (req, res) => {
  try {
    const rows = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        context: chatMessages.context,
        content: chatMessages.content,
        timestamp: chatMessages.timestamp
      })
      .from(chatMessages)
      .where(and(eq(chatMessages.role, 'system'), like(chatMessages.context, 'compare:%')))
      .orderBy(asc(chatMessages.timestamp));

    const history = rows.map(r => {
      try {
        const comparison = JSON.parse(r.content) as ComparisonResult;
        return {
          id: r.id,
          timestamp: r.timestamp,
          comparison
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch comparison history' });
  }
});

export default router;
