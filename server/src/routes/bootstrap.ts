/**
 * Bootstrap SSE route: data-driven session design from real-world location data.
 *
 * POST /api/sessions/:id/bootstrap — SSE stream that fetches World Bank data,
 * converts to EconomyConfig + agent roster, and populates the session.
 *
 * GET /api/locations/search?q=:query — Geocoding autocomplete via Photon API.
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { sessions, agents } from '../db/schema.js';
import * as fiscalRepo from '../db/repos/fiscalRepo.js';
import { fetchLocationData } from '../data/locationDataService.js';
import {
  profileToEconomyConfig,
  generateAgentRoster,
  generateLawPromptContext,
} from '../data/dataBootstrapPipeline.js';
import { searchLocations } from '../data/photonGeocoder.js';
import { getProvider } from '../llm/gateway.js';
import { withRetry } from '../llm/retry.js';
import {
  buildLocationAgentRosterMessages,
  buildLocationLawMessages,
  buildScenarioInterpretationMessages,
} from '../llm/prompts.js';
import { parseJSON } from '../parsers/json.js';
import type { BootstrapProgressEvent, LocationProfile, Stage } from '@policylab/shared';

const router = Router({ mergeParams: true });

// ── GET /api/locations/search?q=:query — Geocoding autocomplete (D-18) ──────
router.get('/locations/search', async (req, res) => {
  const query = (req.query.q as string) || '';
  if (!query.trim()) {
    return res.json([]);
  }

  try {
    const features = await searchLocations(query, 5);
    const results = features.map(f => ({
      name: f.properties.name,
      country: f.properties.country,
      countryCode: f.properties.countrycode,
      coordinates: {
        lat: f.geometry.coordinates[1], // GeoJSON is [lon, lat]
        lon: f.geometry.coordinates[0],
      },
      type: f.properties.type,
    }));
    res.json(results);
  } catch (err) {
    console.error('[bootstrap] Location search error:', err);
    res.status(500).json({ error: 'Location search failed' });
  }
});

// ── POST /:id/bootstrap — SSE bootstrap pipeline ───────────────────────────
router.post('/:id/bootstrap', async (req, res) => {
  const { id } = req.params;
  const {
    location,
    countryCode,
    coordinates,
    scenario,
    agentCount = 30,
  } = req.body as {
    location: string;
    countryCode: string;
    coordinates: { lat: number; lon: number };
    scenario?: string;
    agentCount: number;
  };

  // Validate session
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Allow bootstrap from idea-input or brainstorming stages
  if (session.stage !== 'idea-input' && session.stage !== 'brainstorming') {
    return res.status(400).json({
      error: 'Session must be in idea-input or brainstorming stage to bootstrap',
      stage: session.stage,
    });
  }

  // Set SSE headers (mirror design.ts pattern)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data: BootstrapProgressEvent) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat timer (per Pitfall 6 — send every 10 seconds during long fetches)
  const heartbeatInterval = setInterval(() => {
    sendEvent({ type: 'heartbeat' });
  }, 10_000);

  const now = () => new Date().toISOString();
  const clampedAgentCount = Math.min(150, Math.max(20, Math.round(agentCount)));

  try {
    // Step 0: Geocoding already done by frontend
    sendEvent({ type: 'step_done', step: 'geocoding', stepIndex: 0, totalSteps: 6 });

    // Step 1: Demographics + Employment data
    sendEvent({ type: 'step_start', step: 'demographics', stepIndex: 1, totalSteps: 6 });

    let profile: LocationProfile;
    try {
      profile = await fetchLocationData(countryCode, location, coordinates, {
        onStep: (step, idx, total) => {
          // Internal progress from locationDataService — we let SSE events cover top-level
        },
        onFallback: (step, source) => {
          sendEvent({ type: 'step_fallback', step: step as BootstrapProgressEvent['step'], fallbackSource: source });
        },
      });
    } catch (err) {
      console.error('[bootstrap] Data fetch error:', err);
      sendEvent({ type: 'step_fallback', step: 'demographics', fallbackSource: 'llm', message: 'World Bank data unavailable, using estimates' });
      // Create a minimal profile with defaults for LLM estimation
      profile = createFallbackProfile(location, countryCode, coordinates);
    }

    // Patch countryName from location if geocoder provided it
    profile.countryName = location;

    // Log fetched data for debugging
    const pop = profile.demographics.population?.value;
    const gdp = profile.economics.gdpPerCapita?.value;
    const gini = profile.economics.giniIndex?.value;
    console.log(`[bootstrap] Data for ${countryCode}: pop=${pop}, gdp=${gdp}, gini=${gini}`);

    sendEvent({ type: 'step_done', step: 'demographics', stepIndex: 1 });

    // Step 2: Economics (already fetched as part of profile)
    sendEvent({ type: 'step_start', step: 'economics', stepIndex: 2, totalSteps: 6 });
    sendEvent({ type: 'step_done', step: 'economics', stepIndex: 2 });

    // Step 3: Governance (LLM call for qualitative governance summary)
    sendEvent({ type: 'step_start', step: 'governance', stepIndex: 3, totalSteps: 6 });
    try {
      const provider = getProvider();
      const govRaw = await withRetry(() =>
        provider.chat([
          { role: 'system', content: 'You are a political analyst. Respond with ONLY valid JSON: {"governmentType": "string", "keyRegulations": "string", "propertyRights": "string"}' },
          { role: 'user', content: `Briefly describe the government type, key economic regulations, and property rights system for ${location} (${countryCode}). Be factual and concise.` },
        ], { maxTokens: 1024 }),
      );
      const govData = parseJSON<{ governmentType: string; keyRegulations: string; propertyRights: string }>(govRaw);
      profile.governance = {
        value: `${govData.governmentType}. ${govData.keyRegulations}`,
        source: 'llm',
        confidence: 'medium',
      };
    } catch {
      // Keep fallback governance
      sendEvent({ type: 'step_fallback', step: 'governance', fallbackSource: 'llm' });
    }
    sendEvent({ type: 'step_done', step: 'governance', stepIndex: 3 });

    // Step 4: Infrastructure (LLM call for qualitative infrastructure summary)
    sendEvent({ type: 'step_start', step: 'infrastructure', stepIndex: 4, totalSteps: 6 });
    try {
      const provider = getProvider();
      const infraRaw = await withRetry(() =>
        provider.chat([
          { role: 'system', content: 'You are an infrastructure analyst. Respond with ONLY valid JSON: {"summary": "string"}' },
          { role: 'user', content: `Briefly describe the infrastructure state for ${location} (${countryCode}): transportation, energy, communications. Be factual and concise.` },
        ], { maxTokens: 1024 }),
      );
      const infraData = parseJSON<{ summary: string }>(infraRaw);
      profile.infrastructure = {
        value: infraData.summary,
        source: 'llm',
        confidence: 'medium',
      };
    } catch {
      sendEvent({ type: 'step_fallback', step: 'infrastructure', fallbackSource: 'llm' });
    }
    sendEvent({ type: 'step_done', step: 'infrastructure', stepIndex: 4 });

    // Step 5: Generation — convert profile to session artifacts
    sendEvent({ type: 'step_start', step: 'generation', stepIndex: 5, totalSteps: 6 });

    // 5a: Convert profile to EconomyConfig + BudgetAllocation
    const { config: economyConfig, budget, confidence } = profileToEconomyConfig(profile);

    // 5b: Apply scenario parameter deltas if provided (D-12)
    let finalConfig = { ...economyConfig };
    if (scenario) {
      try {
        const provider = getProvider();
        const scenarioRaw = await withRetry(() =>
          provider.chat(
            buildScenarioInterpretationMessages(scenario, economyConfig, profile),
            { maxTokens: 2048 },
          ),
        );
        const overrides = parseJSON<{ parameterOverrides: Record<string, number | boolean> }>(scenarioRaw);
        if (overrides.parameterOverrides) {
          finalConfig = { ...finalConfig, ...overrides.parameterOverrides };
        }
      } catch (err) {
        console.warn('[bootstrap] Scenario interpretation failed, using base config:', err);
      }
    }

    // 5c: Generate agent roster from employment data
    // Scale base fiat from GDP per capita (normalized: $10k GDP → 100 fiat baseline)
    const gdpPerCapita = profile.economics.gdpPerCapita?.value ?? 10000;
    const baseFiat = Math.max(20, Math.min(500, Math.round(gdpPerCapita / 100)));
    const blueprints = generateAgentRoster(profile, clampedAgentCount, baseFiat);

    // 5d: Generate agent backgrounds via LLM (batch call)
    try {
      const provider = getProvider();
      const rosterRaw = await withRetry(() =>
        provider.chat(
          buildLocationAgentRosterMessages(profile, blueprints, scenario),
          { maxTokens: 8192 },
        ),
      );
      const rosterData = parseJSON<{
        agents: Array<{ name: string; background: string }>;
      }>(rosterRaw);

      // Apply LLM-generated names and backgrounds to blueprints
      if (Array.isArray(rosterData.agents)) {
        for (let i = 0; i < Math.min(rosterData.agents.length, blueprints.length); i++) {
          if (rosterData.agents[i].name) blueprints[i].name = rosterData.agents[i].name;
          if (rosterData.agents[i].background) blueprints[i].background = rosterData.agents[i].background;
        }
      }
    } catch (err) {
      console.warn('[bootstrap] Agent roster LLM enrichment failed, using defaults:', err);
    }

    // 5e: Generate law document via LLM
    const lawContext = generateLawPromptContext(profile);
    let law = 'No foundational law generated.';
    try {
      const provider = getProvider();
      const lawRaw = await withRetry(() =>
        provider.chat(
          buildLocationLawMessages(profile, lawContext, scenario),
          { maxTokens: 4096 },
        ),
      );
      const lawData = parseJSON<{ law: string }>(lawRaw);
      law = lawData.law;
    } catch (err) {
      console.warn('[bootstrap] Law generation failed:', err);
    }

    // 5f: Generate society overview via LLM (richer than a template string)
    let societyOverview: string;
    let societyTitle = location;
    try {
      const provider = getProvider();
      const overviewRaw = await withRetry(() =>
        provider.chat([
          { role: 'system', content: 'You are a policy analyst. Respond with ONLY valid JSON: {"title": "string", "overview": "string"}' },
          { role: 'user', content: `Write a 3-paragraph overview for a policy simulation based on ${location} (${countryCode}).

Real-world data:
- Population: ${profile.demographics.population?.value?.toLocaleString() ?? 'N/A'}
- GDP per capita: $${profile.economics.gdpPerCapita?.value?.toFixed(0) ?? 'N/A'}
- Gini index: ${profile.economics.giniIndex?.value?.toFixed(1) ?? 'N/A'}
- Inflation: ${profile.economics.inflationRate?.value?.toFixed(1) ?? 'N/A'}%
- Unemployment: ${profile.demographics.unemploymentRate?.value?.toFixed(1) ?? 'N/A'}%
- Government expense: ${profile.fiscal.govExpensePctGdp?.value?.toFixed(1) ?? 'N/A'}% of GDP
${scenario ? `\nPolicy scenario to explore: ${scenario}` : ''}

The title should be descriptive (e.g., "Brazil: Tariff Impact Simulation" or "Detroit Economic Recovery Model"). The overview should describe the economic context, key challenges, and what this simulation will explore. Use real numbers from the data above.` },
        ], { maxTokens: 2048 }),
      );
      const overviewData = parseJSON<{ title: string; overview: string }>(overviewRaw);
      societyTitle = overviewData.title || location;
      societyOverview = overviewData.overview;
    } catch {
      // Fallback to template if LLM fails
      societyOverview = `A data-driven simulation based on ${location} (${countryCode}). `
        + `Population: ${profile.demographics.population?.value?.toLocaleString() ?? 'unknown'}. `
        + `GDP per capita: $${profile.economics.gdpPerCapita?.value?.toFixed(0) ?? 'unknown'}. `
        + `Gini index: ${profile.economics.giniIndex?.value?.toFixed(1) ?? 'unknown'}. `
        + (scenario ? `Policy scenario: ${scenario}` : '');
    }

    sendEvent({ type: 'step_done', step: 'generation', stepIndex: 5 });

    // --- Persist session artifacts ---

    // Clear existing agents for this session
    await db.delete(agents).where(eq(agents.sessionId, id));

    // Insert agent roster (citizens + bank agent)
    const citizenRows = blueprints.map(bp => ({
      id: uuidv4(),
      sessionId: id,
      name: bp.name,
      role: bp.role,
      background: bp.background,
      initialStats: JSON.stringify({
        wealth: bp.initialWealth,
        health: 70,
        happiness: 60,
        cortisol: 20,
        dopamine: 50,
      }),
      currentStats: JSON.stringify({
        wealth: bp.initialWealth,
        health: 70,
        happiness: 60,
        cortisol: 20,
        dopamine: 50,
      }),
      type: 'citizen',
      status: 'alive',
      personalityTraits: JSON.stringify([]),
    }));

    // C2 fix: Insert a bank agent when bankingEnabled (required for banking subsystem)
    if (finalConfig.bankingEnabled) {
      const bankWealth = baseFiat * clampedAgentCount * 0.5; // bank starts with 50% of total economy fiat
      citizenRows.push({
        id: uuidv4(),
        sessionId: id,
        name: `${location} Central Bank`,
        role: 'banker',
        background: `The central banking institution of ${location}, responsible for monetary policy, reserve management, and lending operations.`,
        initialStats: JSON.stringify({
          wealth: bankWealth,
          health: 100,
          happiness: 50,
          cortisol: 10,
          dopamine: 50,
        }),
        currentStats: JSON.stringify({
          wealth: bankWealth,
          health: 100,
          happiness: 50,
          cortisol: 10,
          dopamine: 50,
        }),
        type: 'bank',
        status: 'alive',
        personalityTraits: JSON.stringify(['analytical']),
      });
    }

    for (let i = 0; i < citizenRows.length; i += 25) {
      await db.insert(agents).values(citizenRows.slice(i, i + 25));
    }

    // C1 fix: Seed fiscal_budgets table (simulationRunner reads from DB, not session.config)
    if (finalConfig.fiscalEnabled) {
      fiscalRepo.createBudget(id, budget);
    }

    // Update session: config (partial merge), law, overview, stage
    let currentConfig: Record<string, unknown> = {};
    if (session.config) {
      try { currentConfig = JSON.parse(session.config); } catch { /* ignore */ }
    }

    const updatedConfig = {
      ...currentConfig,
      totalIterations: currentConfig.totalIterations ?? 20,
      checklist: { governance: true, economy: true, legal: true, culture: true, infrastructure: true },
      readyForDesign: true,
      economyConfig: finalConfig,
      budgetAllocation: budget,
      locationProfile: profile,
      bootstrapConfidence: confidence,
    };

    await db
      .update(sessions)
      .set({
        stage: 'design-review' as Stage,
        title: societyTitle,
        law,
        societyOverview: societyOverview,
        config: JSON.stringify(updatedConfig),
        updatedAt: now(),
      })
      .where(eq(sessions.id, id));

    // Send completion event
    sendEvent({ type: 'complete', message: `Bootstrap complete for ${location}` });

    clearInterval(heartbeatInterval);
    res.end();
  } catch (err) {
    clearInterval(heartbeatInterval);
    console.error('[bootstrap] Pipeline error:', err);
    const message = err instanceof Error ? err.message : String(err);
    sendEvent({ type: 'error', step: 'generation', message });
    res.end();
  }
});

/**
 * Create a minimal fallback LocationProfile when World Bank data is unavailable.
 */
function createFallbackProfile(
  locationName: string,
  countryCode: string,
  coordinates: { lat: number; lon: number },
): LocationProfile {
  return {
    locationName,
    countryCode: countryCode.toUpperCase(),
    countryName: locationName,
    coordinates,
    fetchedAt: new Date().toISOString(),
    demographics: {
      sectorEmployment: {
        agriculture: { value: 10, source: 'llm', confidence: 'low' },
        industry: { value: 25, source: 'llm', confidence: 'low' },
        services: { value: 65, source: 'llm', confidence: 'low' },
      },
    },
    economics: {
      giniIndex: { value: 40, source: 'llm', confidence: 'low' },
    },
    fiscal: {},
    governance: { value: 'Unknown', source: 'llm', confidence: 'low' },
    infrastructure: { value: 'Unknown', source: 'llm', confidence: 'low' },
  };
}

export default router;
