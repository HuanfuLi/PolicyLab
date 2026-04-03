/**
 * Location data fetch orchestrator.
 *
 * Coordinates geocoding, cache lookup, World Bank API batch fetches for all
 * data categories, and assembles a complete LocationProfile.
 *
 * All indicator codes come from indicatorMap.ts — never hardcoded inline.
 */

import type { LocationProfile, DataPoint, DataSource, ConfidenceLevel } from '@policylab/shared';
import { fetchIndicatorBatch, type IndicatorResult } from './worldBankApi.js';
import { WB_INDICATORS, type IndicatorKey } from './indicatorMap.js';
import { getCachedProfile, setCachedProfile } from './locationCache.js';

export interface FetchProgress {
  onStep: (step: string, index: number, total: number) => void;
  onFallback: (step: string, source: DataSource) => void;
}

const TOTAL_STEPS = 6;

/**
 * Helper to find an indicator result by its code and convert to a DataPoint.
 */
function toDataPoint(
  results: IndicatorResult[],
  indicatorKey: IndicatorKey,
): DataPoint | undefined {
  const code = WB_INDICATORS[indicatorKey];
  const match = results.find(r => r.indicatorCode === code);
  if (!match) return undefined;
  return {
    value: match.value,
    year: match.year,
    source: 'api' as DataSource,
    confidence: match.confidence,
  };
}

/**
 * Fetch and assemble a complete LocationProfile for a country.
 *
 * Checks file-based cache first. On cache miss, fetches all indicators from
 * the World Bank API in batched calls grouped by category, then caches the
 * assembled profile.
 *
 * @param countryCode - ISO 2-letter country code
 * @param locationName - Human-readable location name
 * @param coordinates - Lat/lon from geocoding
 * @param progress - Optional callback for SSE progress events
 */
export async function fetchLocationData(
  countryCode: string,
  locationName: string,
  coordinates: { lat: number; lon: number },
  progress?: FetchProgress,
): Promise<LocationProfile> {
  // Check cache first
  const cached = await getCachedProfile(countryCode);
  if (cached) return cached;

  // Fetch all indicators in one batch (World Bank supports semicolon-separated codes)
  const allCodes = Object.values(WB_INDICATORS);

  // Step 1: Demographics
  progress?.onStep('demographics', 1, TOTAL_STEPS);
  const demographicCodes = [
    WB_INDICATORS.population,
    WB_INDICATORS.populationGrowth,
    WB_INDICATORS.urbanPopulationPct,
    WB_INDICATORS.lifeExpectancy,
    WB_INDICATORS.ageDepRatio,
    WB_INDICATORS.unemployment,
    WB_INDICATORS.employmentAgriculture,
    WB_INDICATORS.employmentIndustry,
    WB_INDICATORS.employmentServices,
    WB_INDICATORS.laborForceParticipation,
  ];
  const demoResults = await fetchIndicatorBatch(countryCode, demographicCodes);

  // Step 2: Economics + Banking rates
  progress?.onStep('economics', 2, TOTAL_STEPS);
  const econCodes = [
    WB_INDICATORS.gdpPerCapita,
    WB_INDICATORS.gdpGrowth,
    WB_INDICATORS.giniIndex,
    WB_INDICATORS.inflationCPI,
    WB_INDICATORS.realInterestRate,
    WB_INDICATORS.lendingInterestRate,
    WB_INDICATORS.depositInterestRate,
    WB_INDICATORS.interestRateSpread,
    WB_INDICATORS.stockMarketCap,
  ];
  const econResults = await fetchIndicatorBatch(countryCode, econCodes);

  // Step 3: Fiscal
  progress?.onStep('fiscal', 3, TOTAL_STEPS);
  const fiscalCodes = [
    WB_INDICATORS.taxRevenuePctGdp,
    WB_INDICATORS.govExpensePctGdp,
    WB_INDICATORS.militaryExpPctGdp,
    WB_INDICATORS.healthExpPctGdp,
    WB_INDICATORS.educationExpPctGdp,
    WB_INDICATORS.govDebtPctGdp,
  ];
  const fiscalResults = await fetchIndicatorBatch(countryCode, fiscalCodes);

  // Step 4: Infrastructure
  progress?.onStep('infrastructure', 4, TOTAL_STEPS);
  const infraCodes = [
    WB_INDICATORS.electricityAccess,
    WB_INDICATORS.internetUsers,
    WB_INDICATORS.renewableEnergyPct,
  ];
  const infraResults = await fetchIndicatorBatch(countryCode, infraCodes);

  // Merge all results for easy lookup
  const allResults = [...demoResults, ...econResults, ...fiscalResults, ...infraResults];

  // Step 5: Governance (qualitative — to be filled by LLM in bootstrap pipeline)
  progress?.onStep('governance', 5, TOTAL_STEPS);

  // Step 6: Assemble profile
  progress?.onStep('generation', 6, TOTAL_STEPS);

  const profile: LocationProfile = {
    locationName,
    countryCode: countryCode.toUpperCase(),
    countryName: locationName, // Will be refined by caller if available
    coordinates,
    fetchedAt: new Date().toISOString(),
    demographics: {
      population: toDataPoint(allResults, 'population'),
      urbanPopulationPct: toDataPoint(allResults, 'urbanPopulationPct'),
      lifeExpectancy: toDataPoint(allResults, 'lifeExpectancy'),
      ageDepRatio: toDataPoint(allResults, 'ageDepRatio'),
      unemploymentRate: toDataPoint(allResults, 'unemployment'),
      sectorEmployment: {
        agriculture: toDataPoint(allResults, 'employmentAgriculture'),
        industry: toDataPoint(allResults, 'employmentIndustry'),
        services: toDataPoint(allResults, 'employmentServices'),
      },
    },
    economics: {
      gdpPerCapita: toDataPoint(allResults, 'gdpPerCapita'),
      gdpGrowth: toDataPoint(allResults, 'gdpGrowth'),
      giniIndex: toDataPoint(allResults, 'giniIndex'),
      inflationRate: toDataPoint(allResults, 'inflationCPI'),
      realInterestRate: toDataPoint(allResults, 'realInterestRate'),
      lendingInterestRate: toDataPoint(allResults, 'lendingInterestRate'),
      depositInterestRate: toDataPoint(allResults, 'depositInterestRate'),
      interestRateSpread: toDataPoint(allResults, 'interestRateSpread'),
      stockMarketCap: toDataPoint(allResults, 'stockMarketCap'),
    },
    fiscal: {
      taxRevenuePctGdp: toDataPoint(allResults, 'taxRevenuePctGdp'),
      govExpensePctGdp: toDataPoint(allResults, 'govExpensePctGdp'),
      militaryExpPctGdp: toDataPoint(allResults, 'militaryExpPctGdp'),
      healthExpPctGdp: toDataPoint(allResults, 'healthExpPctGdp'),
      educationExpPctGdp: toDataPoint(allResults, 'educationExpPctGdp'),
      govDebtPctGdp: toDataPoint(allResults, 'govDebtPctGdp'),
    },
    // Governance and infrastructure are qualitative — to be filled by LLM
    governance: { value: 'Unknown', source: 'llm' as DataSource, confidence: 'low' as ConfidenceLevel },
    infrastructure: { value: 'Unknown', source: 'llm' as DataSource, confidence: 'low' as ConfidenceLevel },
  };

  // Cache the assembled profile
  await setCachedProfile(countryCode, profile);

  return profile;
}
