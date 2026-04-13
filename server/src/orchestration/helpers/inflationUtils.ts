import type { ItemType, PriceIndex, InflationState } from '@policylab/shared';
import type { AutomatedMarketMaker } from '../../mechanics/automatedMarketMaker.js';
import { getEconomyConfig } from '../../mechanics/economyConfigUtils.js';
import { sessionPriceHistory } from '../simulationState.js';

// Realistic baseline prices for non-food commodities when no market data exists.
// Without these, fallback of 1.0 for tools/luxury_goods makes 60% of the CPI basket
// essentially static, preventing CPI from reflecting actual price movements.
const NON_FOOD_COMMODITY_BASELINES: Record<string, number> = {
  food: 6,           // typical AMM spot price for food
  tools: 12,
  luxury_goods: 12,
  raw_materials: 4,
};

export function getInflationBasketPrices(
  sessionId: string,
  economyConfig: ReturnType<typeof getEconomyConfig>,
  priceIndices: PriceIndex[] = [],
): Record<string, number> {
  const iterationPrices = new Map<ItemType, number>();
  for (const idx of priceIndices) {
    iterationPrices.set(idx.itemType, idx.volume > 0 ? idx.vwap : idx.lastPrice);
  }
  const priceHistory = sessionPriceHistory.get(sessionId);
  const basePrices = economyConfig.cpiBasePrices ?? {};

  // Resolve price per commodity: iteration price > history > config base > realistic baseline
  // Use explicit undefined checks (not truthiness) to avoid rejecting legitimate price of 0.
  const resolve = (item: string): number => {
    const iterPrice = iterationPrices.get(item as ItemType);
    if (iterPrice !== undefined && iterPrice > 0) return iterPrice;
    const histPrice = priceHistory?.get(item as ItemType);
    if (histPrice !== undefined && histPrice > 0) return histPrice;
    const basePrice = (basePrices as Record<string, number>)[item];
    if (basePrice !== undefined && basePrice > 0) return basePrice;
    return NON_FOOD_COMMODITY_BASELINES[item] ?? 1;
  };

  return {
    food: resolve('food'),
    tools: resolve('tools'),
    luxury_goods: resolve('luxury_goods'),
    raw_materials: resolve('raw_materials'),
  };
}

export function buildInflationContext(state?: InflationState): string | undefined {
  if (!state) return undefined;
  const direction = state.inflationRate >= 0 ? 'up' : 'down';
  return `Economic conditions: CPI is ${state.cpi.toFixed(1)} (${direction} ${Math.abs(state.inflationRate).toFixed(1)}% from base). Inflation running at ${state.inflationRate.toFixed(1)}% this period. Consider adjusting wage demands or consumption strategy.`;
}

export function applyInflationFeedback(pool: AutomatedMarketMaker, factor: number): void {
  if (Math.abs(factor - 1) <= 0.001) return;

  if (factor > 1) {
    const withdrawal = pool.currentFoodReserve * (1 - 1 / factor);
    pool.withdrawGoodsReserve(withdrawal);
    return;
  }

  const injection = pool.currentFoodReserve * ((1 / factor) - 1);
  pool.injectGoodsReserve(injection);
}
