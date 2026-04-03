/**
 * Data-to-simulation converter: maps a LocationProfile (real-world data)
 * to EconomyConfig + agent roster + law context for session bootstrap.
 *
 * All tunable economic parameters are stored in session-level config via
 * EconomyConfig type, never hardcoded (per CLAUDE.md convention).
 *
 * Rate conversion: annual rates / 12 (ITERATIONS_PER_YEAR = 12).
 * Gini: World Bank scale 0-100 divided by 100 before passing to distributeWealth.
 */

import type {
  LocationProfile,
  EconomyConfig,
  BudgetAllocation,
  ConfidenceLevel,
} from '@policylab/shared';
import { distributeWealth } from './giniDistribution.js';

/** Iterations per year — all annual rates are divided by this. */
const ITERATIONS_PER_YEAR = 12;

export interface AgentBlueprint {
  name: string;
  role: string;
  background: string;
  initialWealth: number;
  sector: 'agriculture' | 'industry' | 'services' | 'government';
}

/**
 * Convert a LocationProfile into EconomyConfig, BudgetAllocation, and
 * confidence metadata.
 *
 * Mapping rules (per D-11):
 * - All four system toggles enabled (banking, capital markets, fiscal, inflation)
 * - Annual rates divided by ITERATIONS_PER_YEAR (12)
 * - Budget fractions normalized to sum to 1.0
 * - Confidence tracked per parameter
 */
export function profileToEconomyConfig(profile: LocationProfile): {
  config: Partial<EconomyConfig>;
  budget: BudgetAllocation;
  confidence: Record<string, ConfidenceLevel>;
} {
  const confidence: Record<string, ConfidenceLevel> = {};

  // --- Interest rate mapping ---
  const annualRate = profile.economics.realInterestRate?.value;
  let baseLoanInterestRate: number;
  if (annualRate != null) {
    baseLoanInterestRate = annualRate / 100 / ITERATIONS_PER_YEAR;
    confidence['baseLoanInterestRate'] = profile.economics.realInterestRate!.confidence;
  } else {
    baseLoanInterestRate = 0.005; // default fallback
    confidence['baseLoanInterestRate'] = 'low';
  }

  const depositInterestRate = baseLoanInterestRate * 0.4;
  confidence['depositInterestRate'] = confidence['baseLoanInterestRate'];

  // --- Reserve requirement ---
  let reserveRequirement: number;
  if (annualRate != null) {
    reserveRequirement = Math.max(0.03, Math.min(0.20, annualRate / 100));
    confidence['reserveRequirement'] = profile.economics.realInterestRate!.confidence;
  } else {
    reserveRequirement = 0.10;
    confidence['reserveRequirement'] = 'low';
  }

  // --- Budget spending rate ---
  const govExpense = profile.fiscal.govExpensePctGdp?.value;
  let budgetSpendingRate: number;
  if (govExpense != null) {
    budgetSpendingRate = Math.max(0.05, Math.min(0.25, govExpense / 100));
    confidence['budgetSpendingRate'] = profile.fiscal.govExpensePctGdp!.confidence;
  } else {
    budgetSpendingRate = 0.10;
    confidence['budgetSpendingRate'] = 'low';
  }

  // --- Budget allocation: normalize fiscal spending categories ---
  const military = profile.fiscal.militaryExpPctGdp?.value ?? 2.0;
  const health = profile.fiscal.healthExpPctGdp?.value ?? 7.0;
  const education = profile.fiscal.educationExpPctGdp?.value ?? 5.0;
  // Infrastructure = remainder * 0.3 (estimate from remaining spending)
  const totalKnown = military + health + education;
  const infrastructure = totalKnown * 0.3;

  const rawTotal = military + health + education + infrastructure;
  const budget: BudgetAllocation = {
    defense: military / rawTotal,
    welfare: health / rawTotal,
    education: education / rawTotal,
    infrastructure: infrastructure / rawTotal,
  };

  // Track budget confidence as lowest confidence among inputs
  const fiscalConfidences: ConfidenceLevel[] = [
    profile.fiscal.militaryExpPctGdp?.confidence ?? 'low',
    profile.fiscal.healthExpPctGdp?.confidence ?? 'low',
    profile.fiscal.educationExpPctGdp?.confidence ?? 'low',
  ];
  const lowestConfidence = fiscalConfidences.includes('low') ? 'low'
    : fiscalConfidences.includes('medium') ? 'medium' : 'high';
  confidence['budgetAllocation'] = lowestConfidence;

  const config: Partial<EconomyConfig> = {
    bankingEnabled: true,
    capitalMarketsEnabled: true,
    fiscalEnabled: true,
    inflationEnabled: true,
    reserveRequirement,
    baseLoanInterestRate,
    depositInterestRate,
    budgetSpendingRate,
    // Keep other defaults from DEFAULT_ECONOMY_CONFIG
    defaultLoanTermIterations: 20,
    defaultThresholdIterations: 3,
  };

  return { config, budget, confidence };
}

// --- Role pools per sector ---
const AGRICULTURE_ROLES = ['farmer', 'ranch_hand', 'agricultural_technician'];
const INDUSTRY_ROLES = ['factory_worker', 'engineer', 'foreman'];
const SERVICES_ROLES = ['merchant', 'teacher', 'healthcare_worker', 'clerk'];

/**
 * Generate an agent roster with role distribution proportional to real sector
 * employment data and Gini-distributed wealth.
 *
 * IMPORTANT: Gini from World Bank is 0-100 scale. We divide by 100 before
 * passing to distributeWealth (Pitfall 4).
 */
export function generateAgentRoster(
  profile: LocationProfile,
  agentCount: number,
  baseFiat: number,
): AgentBlueprint[] {
  // Extract sector employment percentages
  const agriPct = (profile.demographics.sectorEmployment?.agriculture?.value ?? 10) / 100;
  const industryPct = (profile.demographics.sectorEmployment?.industry?.value ?? 25) / 100;
  const servicesPct = (profile.demographics.sectorEmployment?.services?.value ?? 65) / 100;

  // Normalize to sum to 1.0
  const total = agriPct + industryPct + servicesPct;
  const normAgri = agriPct / total;
  const normIndustry = industryPct / total;

  // Calculate sector counts
  const agriCount = Math.round(agentCount * normAgri);
  const industryCount = Math.round(agentCount * normIndustry);
  const servicesCount = agentCount - agriCount - industryCount; // remainder to services

  // Distribute wealth using Gini
  // World Bank Gini is 0-100; distributeWealth expects 0-1 (Pitfall 4)
  const giniRaw = profile.economics.giniIndex?.value ?? 40;
  const gini01 = giniRaw / 100;
  const wealthValues = distributeWealth(agentCount, baseFiat, gini01, 42); // seed for reproducibility

  // Build agent blueprints
  const agents: AgentBlueprint[] = [];
  let wealthIdx = 0;

  // Industry agents get wealthiest slots (reflects real wealth patterns)
  for (let i = 0; i < industryCount; i++) {
    const roleIdx = i % INDUSTRY_ROLES.length;
    agents.push({
      name: `Agent-I${i + 1}`,
      role: INDUSTRY_ROLES[roleIdx],
      background: 'Background to be generated by LLM',
      initialWealth: wealthValues[wealthIdx++],
      sector: 'industry',
    });
  }

  // Services agents
  for (let i = 0; i < servicesCount; i++) {
    const roleIdx = i % SERVICES_ROLES.length;
    agents.push({
      name: `Agent-S${i + 1}`,
      role: SERVICES_ROLES[roleIdx],
      background: 'Background to be generated by LLM',
      initialWealth: wealthValues[wealthIdx++],
      sector: 'services',
    });
  }

  // Agriculture agents get lowest wealth slots
  for (let i = 0; i < agriCount; i++) {
    const roleIdx = i % AGRICULTURE_ROLES.length;
    agents.push({
      name: `Agent-A${i + 1}`,
      role: AGRICULTURE_ROLES[roleIdx],
      background: 'Background to be generated by LLM',
      initialWealth: wealthValues[wealthIdx++],
      sector: 'agriculture',
    });
  }

  return agents;
}

/**
 * Generate a law prompt context string from the LocationProfile governance data.
 * This is injected into the LLM prompt for generating the foundational law document.
 */
export function generateLawPromptContext(profile: LocationProfile): string {
  const parts: string[] = [];

  parts.push(`Country: ${profile.countryName} (${profile.countryCode})`);
  parts.push(`Location: ${profile.locationName}`);

  if (profile.governance) {
    parts.push(`Government type: ${profile.governance.value}`);
  }

  if (profile.fiscal.taxRevenuePctGdp) {
    parts.push(`Tax revenue: ${profile.fiscal.taxRevenuePctGdp.value.toFixed(1)}% of GDP`);
  }

  if (profile.fiscal.govExpensePctGdp) {
    parts.push(`Government expenditure: ${profile.fiscal.govExpensePctGdp.value.toFixed(1)}% of GDP`);
  }

  if (profile.economics.gdpPerCapita) {
    parts.push(`GDP per capita: $${profile.economics.gdpPerCapita.value.toFixed(0)}`);
  }

  if (profile.demographics.unemploymentRate) {
    parts.push(`Unemployment rate: ${profile.demographics.unemploymentRate.value.toFixed(1)}%`);
  }

  return parts.join('\n');
}
