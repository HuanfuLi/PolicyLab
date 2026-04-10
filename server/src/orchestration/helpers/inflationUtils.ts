import type { ItemType, PriceIndex, InflationState } from '@policylab/shared';
import type { AutomatedMarketMaker } from '../../mechanics/automatedMarketMaker.js';
import { getEconomyConfig } from '../../mechanics/economyConfigUtils.js';
import { sessionPriceHistory } from '../simulationState.js';

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
  return {
    food: iterationPrices.get('food') ?? priceHistory?.get('food') ?? basePrices.food ?? 1,
    tools: iterationPrices.get('tools') ?? priceHistory?.get('tools') ?? basePrices.tools ?? 1,
    luxury_goods: iterationPrices.get('luxury_goods') ?? priceHistory?.get('luxury_goods') ?? basePrices.luxury_goods ?? 1,
    raw_materials: iterationPrices.get('raw_materials') ?? priceHistory?.get('raw_materials') ?? basePrices.raw_materials ?? 1,
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
