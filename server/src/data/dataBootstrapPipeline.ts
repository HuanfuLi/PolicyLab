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

  // Helper: pick best available data point and track confidence
  function pickAndTrack(key: string, dp: { value: number; confidence: ConfidenceLevel } | undefined, fallback: number): number {
    if (dp != null) {
      confidence[key] = dp.confidence;
      return dp.value;
    }
    return fallback;
  }

  // --- Lending interest rate ---
  // Priority: WB lendingInterestRate (direct) > WB realInterestRate (indirect) > default
  const lendingAnnual = profile.economics.lendingInterestRate?.value
    ?? profile.economics.realInterestRate?.value;
  const lendingSrc = profile.economics.lendingInterestRate ?? profile.economics.realInterestRate;
  const baseLoanInterestRate = lendingAnnual != null
    ? Math.max(0.001, Math.min(0.02, lendingAnnual / 100 / ITERATIONS_PER_YEAR))
    : 0.005;
  confidence['baseLoanInterestRate'] = lendingSrc?.confidence ?? 'low';

  // --- Deposit interest rate ---
  // Priority: WB depositInterestRate (direct) > derived from lending rate × 0.4
  const depositAnnual = profile.economics.depositInterestRate?.value;
  const depositInterestRate = depositAnnual != null
    ? Math.max(0.0005, Math.min(0.01, depositAnnual / 100 / ITERATIONS_PER_YEAR))
    : baseLoanInterestRate * 0.4;
  confidence['depositInterestRate'] = profile.economics.depositInterestRate?.confidence
    ?? confidence['baseLoanInterestRate'];

  // --- Reserve requirement ---
  // No direct WB indicator for statutory reserve ratio. Use a heuristic:
  // Developing economies (GDP < $15k) tend toward 0.10-0.15; developed toward 0.03-0.08.
  const gdpPC = profile.economics.gdpPerCapita?.value ?? 10000;
  const reserveRequirement = gdpPC < 5000 ? 0.15
    : gdpPC < 15000 ? 0.10
    : gdpPC < 40000 ? 0.07
    : 0.03;
  confidence['reserveRequirement'] = profile.economics.gdpPerCapita?.confidence ?? 'low';

  // --- Budget spending rate ---
  const govExpense = profile.fiscal.govExpensePctGdp?.value;
  const budgetSpendingRate = govExpense != null
    ? Math.max(0.05, Math.min(0.25, govExpense / 100))
    : 0.10;
  confidence['budgetSpendingRate'] = profile.fiscal.govExpensePctGdp?.confidence ?? 'low';

  // --- Budget allocation: normalize fiscal spending categories ---
  const military = pickAndTrack('_budgetDefense', profile.fiscal.militaryExpPctGdp, 2.0);
  const health = pickAndTrack('_budgetWelfare', profile.fiscal.healthExpPctGdp, 7.0);
  const education = pickAndTrack('_budgetEducation', profile.fiscal.educationExpPctGdp, 5.0);
  const infrastructure = (military + health + education) * 0.3; // estimated remainder
  const rawTotal = military + health + education + infrastructure;
  const budget: BudgetAllocation = {
    defense: military / rawTotal,
    welfare: health / rawTotal,
    education: education / rawTotal,
    infrastructure: infrastructure / rawTotal,
  };
  const fiscalConfidences: ConfidenceLevel[] = [
    profile.fiscal.militaryExpPctGdp?.confidence ?? 'low',
    profile.fiscal.healthExpPctGdp?.confidence ?? 'low',
    profile.fiscal.educationExpPctGdp?.confidence ?? 'low',
  ];
  confidence['budgetAllocation'] = fiscalConfidences.includes('low') ? 'low'
    : fiscalConfidences.includes('medium') ? 'medium' : 'high';

  // --- Inflation AMM params ---
  // These are PERCENTAGE-SCALE thresholds (default 0.5 and 2.0), NOT per-iteration decimals!
  // inflationAmmThreshold: minimum inflation expectation % before AMM feedback triggers (softRange 0.2–1.0)
  // inflationAmmCap: max AMM price change per iteration in % (softRange 1.0–5.0)
  // CPI inflation values: typical range 2–10%, high-inflation 10–30%
  const inflationCPI = profile.economics.inflationRate?.value; // annual CPI inflation %
  let inflationAmmThreshold: number;
  let inflationAmmCap: number;
  if (inflationCPI != null) {
    // Map CPI range [2..10] → threshold range [0.3..1.0], CPI range [10..30] → [1.0..1.5]
    inflationAmmThreshold = Math.max(0.2, Math.min(1.5, inflationCPI / 6));
    // Map CPI range [2..10] → cap range [1.0..3.3], CPI range [10..30] → [3.3..5.0]
    inflationAmmCap = Math.max(1.0, Math.min(5.0, inflationCPI / 3));
    confidence['inflationAmmThreshold'] = profile.economics.inflationRate!.confidence;
    confidence['inflationAmmCap'] = profile.economics.inflationRate!.confidence;
  } else {
    inflationAmmThreshold = 0.5;
    inflationAmmCap = 2.0;
    confidence['inflationAmmThreshold'] = 'low';
    confidence['inflationAmmCap'] = 'low';
  }

  // --- Productivity growth estimate ---
  const gdpGrowth = profile.economics.gdpGrowth?.value;
  const productivityGrowthEstimate = gdpGrowth != null
    ? Math.max(0.001, Math.min(0.05, gdpGrowth / 100 / ITERATIONS_PER_YEAR))
    : 0.01;
  confidence['productivityGrowthEstimate'] = profile.economics.gdpGrowth?.confidence ?? 'low';

  // --- M1 inflation coefficient ---
  // Higher inflation economies need stronger M1-to-price feedback
  const m1InflationCoeff = inflationCPI != null
    ? Math.max(0.1, Math.min(0.5, 0.3 + (inflationCPI - 3) * 0.02))
    : 0.3;
  confidence['m1InflationCoeff'] = profile.economics.inflationRate?.confidence ?? 'low';

  // --- Government bond coupon rate ---
  // Derived from gov debt burden + lending rate: higher debt = higher yield
  const govDebt = profile.fiscal.govDebtPctGdp?.value;
  let govBondCouponRate: number;
  if (govDebt != null && lendingAnnual != null) {
    // Bond yield ~ lending rate × 0.6 + debt premium
    const debtPremium = govDebt > 80 ? 0.003 : govDebt > 50 ? 0.002 : 0.001;
    govBondCouponRate = Math.max(0.001, Math.min(0.02,
      (lendingAnnual / 100 * 0.6 + debtPremium) / ITERATIONS_PER_YEAR));
    confidence['govBondCouponRate'] = lendingSrc?.confidence ?? 'low';
  } else {
    govBondCouponRate = 0.004;
    confidence['govBondCouponRate'] = 'low';
  }

  // --- Dividend payout ratio ---
  // Proxied by stock market maturity: larger market cap → more dividend culture
  const stockMktCap = profile.economics.stockMarketCap?.value;
  let dividendPayoutRatio: number;
  if (stockMktCap != null) {
    dividendPayoutRatio = stockMktCap > 100 ? 0.08
      : stockMktCap > 50 ? 0.06
      : stockMktCap > 20 ? 0.04
      : 0.02;
    confidence['dividendPayoutRatio'] = profile.economics.stockMarketCap!.confidence;
  } else {
    dividendPayoutRatio = 0.05;
    confidence['dividendPayoutRatio'] = 'low';
  }

  // --- Default loan term ---
  // Developing economies: shorter terms. Developed: longer.
  const defaultLoanTermIterations = gdpPC < 5000 ? 12
    : gdpPC < 15000 ? 16
    : gdpPC < 40000 ? 20
    : 24;
  confidence['defaultLoanTermIterations'] = profile.economics.gdpPerCapita?.confidence ?? 'low';

  const config: Partial<EconomyConfig> = {
    bankingEnabled: true,
    capitalMarketsEnabled: true,
    fiscalEnabled: true,
    inflationEnabled: true,
    reserveRequirement,
    baseLoanInterestRate,
    depositInterestRate,
    budgetSpendingRate,
    inflationAmmThreshold,
    inflationAmmCap,
    productivityGrowthEstimate,
    m1InflationCoeff,
    govBondCouponRate,
    dividendPayoutRatio,
    defaultLoanTermIterations,
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
