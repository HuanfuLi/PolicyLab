import {
  DEFAULT_CPI_BASKET_WEIGHTS,
  DEFAULT_ECONOMY_CONFIG,
  type EconomyConfig,
} from '@policylab/shared';

export interface InflationInput {
  iterationNumber: number;
  currentPrices: Record<string, number>;
  basePrices: Record<string, number>;
  m1Current: number;
  m1Previous: number | null;
  previousCpi: number | null;
  recentCpiHistory: number[];
  economyConfig: EconomyConfig;
}

export interface InflationOutput {
  cpi: number;
  inflationRate: number;
  inflationExpectations: number;
  ammFeedbackFactor: number;
  trace: string[];
}

function computeHistoryInflationRates(cpiHistory: number[]): number[] {
  const rates: number[] = [];

  for (let i = 1; i < cpiHistory.length; i += 1) {
    const previous = cpiHistory[i - 1];
    const current = cpiHistory[i];
    if (previous === 0) continue;
    rates.push(((current / previous) - 1) * 100);
  }

  return rates;
}

export function computeInflation(input: InflationInput): InflationOutput {
  const trace: string[] = [];
  const weights = input.economyConfig.cpiBasketWeights ?? DEFAULT_CPI_BASKET_WEIGHTS;
  const alpha = input.economyConfig.m1InflationCoeff ?? DEFAULT_ECONOMY_CONFIG.m1InflationCoeff ?? 0.3;
  const productivityGrowthEstimate =
    input.economyConfig.productivityGrowthEstimate
    ?? DEFAULT_ECONOMY_CONFIG.productivityGrowthEstimate
    ?? 0.01;
  const threshold =
    input.economyConfig.inflationAmmThreshold
    ?? DEFAULT_ECONOMY_CONFIG.inflationAmmThreshold
    ?? 0.5;
  const cap = input.economyConfig.inflationAmmCap ?? DEFAULT_ECONOMY_CONFIG.inflationAmmCap ?? 2.0;

  const basketEntries = Object.entries(weights) as Array<[keyof typeof weights, number]>;
  let weightedRatioSum = 0;

  for (const [item, weight] of basketEntries) {
    const basePrice = input.basePrices[item] ?? 1;
    const currentPrice = input.currentPrices[item] ?? basePrice;
    const ratio = basePrice === 0 ? 1 : currentPrice / basePrice;
    weightedRatioSum += weight * ratio;
    trace.push(
      `[INFL] CPI basket ${item}: weight=${weight.toFixed(2)}, current=${currentPrice.toFixed(4)}, base=${basePrice.toFixed(4)}, ratio=${ratio.toFixed(4)}`,
    );
  }

  const cpi = weightedRatioSum * 100;
  trace.push(`[INFL] CPI = ${weightedRatioSum.toFixed(4)} * 100 = ${cpi.toFixed(4)}`);

  const inflationRate = input.previousCpi === null || input.previousCpi === 0
    ? 0
    : ((cpi / input.previousCpi) - 1) * 100;
  trace.push(
    input.previousCpi === null
      ? '[INFL] Inflation rate = 0.0000 (no previous CPI)'
      : `[INFL] Inflation rate = ((${cpi.toFixed(4)} / ${input.previousCpi.toFixed(4)}) - 1) * 100 = ${inflationRate.toFixed(4)}`,
  );

  const m1GrowthRate = input.m1Previous === null || input.m1Previous === 0
    ? 0
    : (input.m1Current - input.m1Previous) / input.m1Previous;
  const m1Signal = input.m1Previous === null ? 0 : m1GrowthRate - productivityGrowthEstimate;
  trace.push(
    input.m1Previous === null
      ? '[INFL] M1 signal = 0.0000 (no previous M1)'
      : `[INFL] M1 signal = ${m1GrowthRate.toFixed(4)} - productivity ${productivityGrowthEstimate.toFixed(4)} = ${m1Signal.toFixed(4)}`,
  );

  const blendedInflation = ((1 - alpha) * inflationRate) + (alpha * m1Signal * 100);
  trace.push(
    `[INFL] Blended inflation = (1 - ${alpha.toFixed(4)}) * ${inflationRate.toFixed(4)} + ${alpha.toFixed(4)} * ${m1Signal.toFixed(4)} * 100 = ${blendedInflation.toFixed(4)}`,
  );

  const smoothedHistory = input.recentCpiHistory.length > 0
    ? input.recentCpiHistory.slice(-(input.economyConfig.inflationSmoothingWindow ?? DEFAULT_ECONOMY_CONFIG.inflationSmoothingWindow ?? 3))
    : [];
  const historyRates = computeHistoryInflationRates(smoothedHistory);
  const inflationExpectations = historyRates.length > 0
    ? historyRates.reduce((sum, rate) => sum + rate, 0) / historyRates.length
    : blendedInflation;
  trace.push(
    historyRates.length > 0
      ? `[INFL] Inflation expectations = mean(${historyRates.map((rate) => rate.toFixed(4)).join(', ')}) = ${inflationExpectations.toFixed(4)}`
      : `[INFL] Inflation expectations fallback to blended inflation = ${inflationExpectations.toFixed(4)}`,
  );

  if (Math.abs(inflationExpectations) < threshold) {
    trace.push(
      `[INFL] AMM feedback inactive: |${inflationExpectations.toFixed(4)}| < threshold ${threshold.toFixed(4)}`,
    );
    return {
      cpi,
      inflationRate,
      inflationExpectations,
      ammFeedbackFactor: 1,
      trace,
    };
  }

  const rawFactor = 1 + ((inflationExpectations / 100) * alpha);
  const minFactor = 1 - (cap / 100);
  const maxFactor = 1 + (cap / 100);
  const ammFeedbackFactor = Math.min(Math.max(rawFactor, minFactor), maxFactor);
  trace.push(
    `[INFL] AMM feedback factor raw=${rawFactor.toFixed(4)}, clamped to [${minFactor.toFixed(4)}, ${maxFactor.toFixed(4)}] => ${ammFeedbackFactor.toFixed(4)}`,
  );

  return {
    cpi,
    inflationRate,
    inflationExpectations,
    ammFeedbackFactor,
    trace,
  };
}
