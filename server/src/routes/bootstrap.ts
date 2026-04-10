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
import { db, sqlite } from '../db/index.js';
import { sessions, agents, enterprises } from '../db/schema.js';
import * as fiscalRepo from '../db/repos/fiscalRepo.js';
import { fetchLocationData } from '../data/locationDataService.js';
import {
  profileToEconomyConfig,
  generateAgentRoster,
  generateEnterprises,
  generateLawPromptContext,
} from '../data/dataBootstrapPipeline.js';
import { insertEnterprise } from '../db/repos/enterpriseRepo.js';
import { searchLocations } from '../data/photonGeocoder.js';
import { getCachedLLMData, setCachedLLMData } from '../data/locationCache.js';
import { getProvider } from '../llm/gateway.js';
import { withRetry } from '../llm/retry.js';
import {
  buildLocationAgentRosterMessages,
  buildLocationLawMessages,
  buildScenarioInterpretationMessages,
} from '../llm/prompts/index.js';
import { parseJSON } from '../parsers/json.js';
import { createScope } from '../db/sessionScope.js';
import type { BootstrapProgressEvent, LocationProfile, Stage } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';

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

// R2 fix: Prevent concurrent bootstrap requests for the same session
const bootstrappingSessionIds = new Set<string>();

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

  // R2 fix: Reject concurrent bootstraps for the same session
  if (bootstrappingSessionIds.has(id)) {
    return res.status(409).json({ error: 'Bootstrap already in progress for this session' });
  }
  bootstrappingSessionIds.add(id);

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
  let clientDisconnected = false;
  const heartbeatInterval = setInterval(() => {
    if (!clientDisconnected) sendEvent({ type: 'heartbeat' });
  }, 10_000);

  // Clean up heartbeat and concurrency guard if client disconnects mid-bootstrap
  req.on('close', () => {
    clientDisconnected = true;
    clearInterval(heartbeatInterval);
    bootstrappingSessionIds.delete(id);
  });

  const now = () => new Date().toISOString();
  const clampedAgentCount = Math.min(150, Math.max(20, Math.round(agentCount)));

  // M17 fix: step name → index mapping for step_fallback events
  const STEP_INDEX: Record<string, number> = {
    geocoding: 0, demographics: 1, economics: 2, governance: 3, infrastructure: 4, generation: 5,
  };

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
          sendEvent({ type: 'step_fallback', step: step as BootstrapProgressEvent['step'], stepIndex: STEP_INDEX[step] ?? 0, fallbackSource: source });
        },
      });
    } catch (err) {
      console.error('[bootstrap] Data fetch error:', err);
      sendEvent({ type: 'step_fallback', step: 'demographics', stepIndex: 1, fallbackSource: 'llm', message: 'World Bank data unavailable, using estimates' });
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

    // Step 3 & 4: Governance + Infrastructure
    // Check LLM cache first — these are country-level and rarely change
    const llmCache = await getCachedLLMData(countryCode);

    // Step 3: Governance
    sendEvent({ type: 'step_start', step: 'governance', stepIndex: 3, totalSteps: 6 });
    if (llmCache?.governance) {
      profile.governance = llmCache.governance as typeof profile.governance;
      console.log(`[bootstrap] Governance loaded from cache for ${countryCode}`);
    } else {
      try {
        const provider = getProvider();
        const govRaw = await withRetry(() =>
          provider.chat([
            { role: 'system', content: 'You are a political analyst. Describe the government type, key economic regulations, and property rights system.' },
            { role: 'user', content: `Briefly describe the government type, key economic regulations, and property rights system for ${location} (${countryCode}). Be factual and concise.` },
          ], {
          }));
        const govData = parseJSON<{ governmentType: string; keyRegulations: string; propertyRights: string }>(govRaw);
        profile.governance = {
          value: `${govData.governmentType}. ${govData.keyRegulations}`,
          source: 'llm',
          confidence: 'medium',
        };
      } catch {
        sendEvent({ type: 'step_fallback', step: 'governance', stepIndex: 3, fallbackSource: 'llm' });
      }
    }
    sendEvent({ type: 'step_done', step: 'governance', stepIndex: 3 });

    // Step 4: Infrastructure
    sendEvent({ type: 'step_start', step: 'infrastructure', stepIndex: 4, totalSteps: 6 });
    if (llmCache?.infrastructure) {
      profile.infrastructure = llmCache.infrastructure as typeof profile.infrastructure;
      console.log(`[bootstrap] Infrastructure loaded from cache for ${countryCode}`);
    } else {
      try {
        const provider = getProvider();
        const infraRaw = await withRetry(() =>
          provider.chat([
            { role: 'system', content: 'You are an infrastructure analyst. Describe the infrastructure state.' },
            { role: 'user', content: `Briefly describe the infrastructure state for ${location} (${countryCode}): transportation, energy, communications. Be factual and concise.` },
          ]));
        const infraData = parseJSON<{ summary: string }>(infraRaw);
        profile.infrastructure = {
          value: infraData.summary,
          source: 'llm',
          confidence: 'medium',
        };
      } catch {
        sendEvent({ type: 'step_fallback', step: 'infrastructure', stepIndex: 4, fallbackSource: 'llm' });
      }
    }
    sendEvent({ type: 'step_done', step: 'infrastructure', stepIndex: 4 });

    // Cache governance + infrastructure for future retries of same country
    if (!llmCache && (profile.governance?.source === 'llm' || profile.infrastructure?.source === 'llm')) {
      await setCachedLLMData(
        countryCode,
        profile.governance ?? null,
        profile.infrastructure ?? null).catch(() => {});
    }

    // Step 5: Generation — convert profile to session artifacts
    sendEvent({ type: 'step_start', step: 'generation', stepIndex: 5, totalSteps: 6 });

    // 5a: Convert profile to EconomyConfig + BudgetAllocation
    const { config: economyConfig, budget, confidence, sources: dataSources } = profileToEconomyConfig(profile);

    // 5b: Apply scenario parameter deltas if provided (D-12)
    // Merge with defaults so missing fields (cpiBasketWeights, fiscal multipliers, etc.) are populated
    let finalConfig = { ...DEFAULT_ECONOMY_CONFIG, ...economyConfig };
    if (scenario) {
      try {
        const provider = getProvider();
        const scenarioRaw = await withRetry(() =>
          provider.chat(
            buildScenarioInterpretationMessages(scenario, economyConfig, profile),
            {
            }));
        console.log('[bootstrap] Scenario interpretation raw:', scenarioRaw.slice(0, 500));
        const overrides = parseJSON<{ parameterOverrides: Record<string, number | boolean> }>(scenarioRaw);
        if (overrides.parameterOverrides && Object.keys(overrides.parameterOverrides).length > 0) {
          // L1 fix: Validate overrides — only allow known EconomyConfig keys
          // and reject values outside reasonable per-parameter ranges.
          const ECONOMY_CONFIG_BOUNDS: Partial<Record<keyof import('@policylab/shared').EconomyConfig, [min: number, max: number]>> = {
            reserveRequirement:        [0, 1],
            baseLoanInterestRate:      [0.0001, 0.05],
            depositInterestRate:       [0.0001, 0.04],
            dividendPayoutRatio:       [0, 0.5],
            budgetSpendingRate:        [0.01, 0.99],
            inflationAmmThreshold:     [0, 0.5],
            inflationAmmCap:           [0, 2],
            m1InflationCoeff:          [0, 1],
            govBondCouponRate:         [0.0001, 0.05],
            productivityGrowthEstimate:[- 0.1, 0.2],
          };
          const validKeys = new Set(Object.keys(finalConfig));
          const safeOverrides: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(overrides.parameterOverrides)) {
            if (!validKeys.has(key)) {
              console.warn(`[bootstrap] Rejected unknown override key: ${key}`);
              continue;
            }
            if (typeof value === 'number') {
              const bounds = ECONOMY_CONFIG_BOUNDS[key as keyof import('@policylab/shared').EconomyConfig];
              if (bounds) {
                const [min, max] = bounds;
                if (value < min || value > max || !Number.isFinite(value)) {
                  console.warn(`[bootstrap] Rejected out-of-bounds scenario override: ${key}=${value} (allowed: [${min}, ${max}])`);
                  continue;
                }
              } else if (!Number.isFinite(value) || value < -1000 || value > 1000) {
                // fallback for unmapped numeric keys
                console.warn(`[bootstrap] Rejected non-finite/extreme scenario override: ${key}=${value}`);
                continue;
              }
            }
            safeOverrides[key] = value;
          }
          console.log('[bootstrap] Applying scenario overrides:', JSON.stringify(safeOverrides));
          finalConfig = { ...finalConfig, ...safeOverrides };
        } else {
          console.warn('[bootstrap] Scenario interpretation returned no overrides');
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

    // 5d: Generate agent backgrounds via LLM in batches with JSON Schema enforcement.
    // JSON Schema forces the model to emit valid structured output, eliminating
    // the malformed JSON (unquoted keys, missing braces) seen with free-form prompting.
    // Batches of 10 keep each response small (~800-1200 tokens).
    const ROSTER_BATCH_SIZE = 10;
    const provider = getProvider();
    let rosterEnrichmentFailed = false;
    let rosterEnrichmentError: string | undefined;

    const rosterJsonSchema = {
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

    for (let batchStart = 0; batchStart < blueprints.length; batchStart += ROSTER_BATCH_SIZE) {
      const batchBlueprints = blueprints.slice(batchStart, batchStart + ROSTER_BATCH_SIZE);
      try {
        const rosterRaw = await withRetry(() =>
          provider.chat(
            buildLocationAgentRosterMessages(profile, batchBlueprints, scenario),
            { jsonSchema: rosterJsonSchema },
          ));
        const rosterData = parseJSON<{ agents: Array<{ name: string; background: string }> }>(rosterRaw);

        if (Array.isArray(rosterData.agents)) {
          for (let i = 0; i < Math.min(rosterData.agents.length, batchBlueprints.length); i++) {
            const globalIdx = batchStart + i;
            if (rosterData.agents[i].name) blueprints[globalIdx].name = rosterData.agents[i].name;
            if (rosterData.agents[i].background) blueprints[globalIdx].background = rosterData.agents[i].background;
          }
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`[bootstrap] Batch ${batchStart} LLM enrichment failed:`, err);
        rosterEnrichmentFailed = true;
        rosterEnrichmentError = detail;
        break;
      }
    }

    if (rosterEnrichmentFailed) {
      const msg = `Bootstrap aborted: Agent background generation failed (${rosterEnrichmentError ?? 'unknown error'}). Check the server console for details.`;
      sendEvent({ type: 'error', step: 'generation', message: msg } as any);
      clearInterval(heartbeatInterval);
      res.end();
      return;
    }

    // D-27: Validate no stub backgrounds survived LLM enrichment.
    // If the LLM call partially failed or returned truncated JSON, some agents may
    // still carry the placeholder string set by generateAgentRoster(). Abort early
    // so the user is never silently handed a session full of placeholder text.
    const STUB_TEXT = 'background to be generated by llm';
    const agentsWithStubs = blueprints.filter(
      (bp) => (bp.background ?? '').toLowerCase().includes(STUB_TEXT)
    );
    if (agentsWithStubs.length > 0) {
      const msg = `Bootstrap aborted: ${agentsWithStubs.length} of ${blueprints.length} agents still have placeholder backgrounds after LLM enrichment. This indicates the enrichment call returned incomplete data. Please try again.`;
      sendEvent({ type: 'error', step: 'generation', message: msg } as any);
      clearInterval(heartbeatInterval);
      res.end();
      return;
    }

    // Patch any agents still carrying placeholder names (Agent-I1, Agent-S1, etc.)
    // with role-based fallback names so they are never visible to the user.
    const PLACEHOLDER_RE = /^Agent-[A-Z]\d+$/;
    for (const bp of blueprints) {
      if (PLACEHOLDER_RE.test(bp.name)) {
        bp.name = generateFallbackName(bp.role, blueprints.indexOf(bp));
      }
    }

    // 5e: Generate law document via LLM
    const lawContext = generateLawPromptContext(profile);
    let law = 'No foundational law generated.';
    try {
      const provider = getProvider();
      const lawRaw = await withRetry(() =>
        provider.chat(
          buildLocationLawMessages(profile, lawContext, scenario)));
      const lawData = parseJSON<{ law: string }>(lawRaw);
      if (!lawData.law || lawData.law.trim().length < 50) {
        throw new Error('Law generation returned empty or trivially short document');
      }
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
          { role: 'system', content: 'You are a policy analyst. Write a simulation title and 3-paragraph overview.' },
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
        ], {
        }));
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
        role: 'bank',
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

    // Fix B: Wrap delete + batch insert in a single transaction so a partial
    // batch failure never leaves the session with 0 agents.
    // Fix A (enterprise delete) is included here so re-running bootstrap
    // never duplicates enterprise rows.
    sqlite.transaction(() => {
      db.delete(agents).where(eq(agents.sessionId, id)).run();
      db.delete(enterprises).where(eq(enterprises.sessionId, id)).run();
      for (let i = 0; i < citizenRows.length; i += 25) {
        db.insert(agents).values(citizenRows.slice(i, i + 25)).run();
      }
    })();

    // C1 fix: Seed fiscal_budgets table (simulationRunner reads from DB, not session.config)
    if (finalConfig.fiscalEnabled) {
      fiscalRepo.createBudget(createScope(id), budget);
    }

    // Generate and persist enterprise blueprints (Phase 10)
    // Build name→UUID map from persisted agents so enterprises store UUIDs directly (GC1)
    const agentNameToId = new Map(citizenRows.map(r => [r.name, r.id]));
    const enterpriseBlueprints = generateEnterprises(
      blueprints,
      profile,
      baseFiat,
      finalConfig.minimumWage ?? 5,
      agentNameToId,  // pass map so ownerId and employees are stored as UUIDs
    );
    for (const bp of enterpriseBlueprints) {
      insertEnterprise(id, bp);
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
      bootstrapSources: dataSources,
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
    bootstrappingSessionIds.delete(id);
    res.end();
  } catch (err) {
    clearInterval(heartbeatInterval);
    bootstrappingSessionIds.delete(id);
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
  coordinates: { lat: number; lon: number }): LocationProfile {
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
      gdpPerCapita: { value: 10000, source: 'llm' as const, confidence: 'low' as const },
      gdpGrowth: { value: 3.0, source: 'llm' as const, confidence: 'low' as const },
      giniIndex: { value: 40, source: 'llm', confidence: 'low' },
      inflationRate: { value: 4.0, source: 'llm' as const, confidence: 'low' as const },
      lendingInterestRate: { value: 10.0, source: 'llm' as const, confidence: 'low' as const },
      depositInterestRate: { value: 4.0, source: 'llm' as const, confidence: 'low' as const },
    },
    fiscal: {
      govExpensePctGdp: { value: 30, source: 'llm' as const, confidence: 'low' as const },
      militaryExpPctGdp: { value: 2.0, source: 'llm' as const, confidence: 'low' as const },
      healthExpPctGdp: { value: 7.0, source: 'llm' as const, confidence: 'low' as const },
      educationExpPctGdp: { value: 5.0, source: 'llm' as const, confidence: 'low' as const },
    },
    governance: { value: 'Unknown', source: 'llm', confidence: 'low' },
    infrastructure: { value: 'Unknown', source: 'llm', confidence: 'low' },
  };
}

/**
 * Generate a deterministic fallback name for agents whose LLM-generated names
 * were not produced (e.g., when the LLM returns fewer agents than requested).
 * Uses role + index to create a unique, readable name.
 */
function generateFallbackName(role: string, index: number): string {
  // Simple role-based name prefixes that avoid the ugly "Agent-XX" pattern
  const ROLE_NAMES: Record<string, string[]> = {
    farmer: ['Maria', 'Carlos', 'Elena', 'Pedro', 'Ana', 'Luis', 'Sofia', 'Diego'],
    ranch_hand: ['Jorge', 'Rosa', 'Manuel', 'Carmen', 'Pablo', 'Lucia'],
    agricultural_technician: ['Raul', 'Isabel', 'Andres', 'Clara'],
    factory_worker: ['Viktor', 'Natalia', 'Sergei', 'Olga', 'Ivan', 'Tatiana'],
    engineer: ['James', 'Sarah', 'Robert', 'Linda', 'Michael', 'Patricia'],
    foreman: ['Franz', 'Heinrich', 'Otto', 'Klaus', 'Hans', 'Wilhelm'],
    merchant: ['Ali', 'Fatima', 'Omar', 'Leila', 'Hassan', 'Amira'],
    teacher: ['Margaret', 'Thomas', 'Catherine', 'William', 'Elizabeth', 'Henry'],
    healthcare_worker: ['Grace', 'David', 'Ruth', 'Joseph', 'Martha', 'Samuel'],
    clerk: ['Kenji', 'Yuki', 'Takeshi', 'Sakura', 'Hiroshi', 'Aiko'],
  };
  const names = ROLE_NAMES[role.toLowerCase()] ?? ['Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Quinn'];
  const firstName = names[index % names.length];
  const suffix = Math.floor(index / names.length);
  const roleTitle = role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return suffix > 0 ? `${firstName} (${roleTitle} ${suffix + 1})` : `${firstName} the ${roleTitle}`;
}

export default router;
