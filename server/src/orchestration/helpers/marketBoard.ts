import type { ItemType, MarketState, PriceIndex } from '@policylab/shared';
import type {
  EmploymentBoardEntry,
  MarketBoardEntry,
  PersonalStatusBoard,
} from '../../llm/prompts/index.js';
import {
  sessionPriceHistory,
  getEnterpriseRegistry,
  getEmploymentRegistry,
} from '../simulationState.js';

export function buildMarketBoardEntries(sessionId: string, marketState?: MarketState): MarketBoardEntry[] {
  const previous = sessionPriceHistory.get(sessionId) ?? new Map<ItemType, number>();
  const indices = marketState?.priceIndices ?? [];
  return indices.map((idx): MarketBoardEntry => {
    const prev = previous.get(idx.itemType);
    let trend: MarketBoardEntry['trend'] = 'unknown';
    if (prev == null || prev === 0) trend = 'new';
    else if (idx.vwap > prev) trend = 'up';
    else if (idx.vwap < prev) trend = 'down';
    else trend = 'flat';
    return {
      itemType: idx.itemType,
      averageClearingPrice: idx.vwap || idx.lastPrice || null,
      trend,
    };
  });
}

export function buildEmploymentBoardEntries(sessionId: string): EmploymentBoardEntry[] {
  const enterprises = getEnterpriseRegistry(sessionId);
  return [...enterprises.values()]
    .filter(enterprise => enterprise.wage > 0)
    .map(enterprise => ({
      enterprise_id: enterprise.id,
      industry: enterprise.industry,
      wage: enterprise.wage,
      min_skill: enterprise.minSkill,
      owner_name: enterprise.ownerName,
    }));
}

export function buildPersonalStatus(sessionId: string, agentId: string, enterpriseOwnerId?: string, agentWealth?: number): PersonalStatusBoard {
  const employment = getEmploymentRegistry(sessionId).get(agentId);
  if (employment) {
    return { employed: true, enterprise_id: employment.enterpriseId, enterprise_role: 'employee', agentWealth };
  }
  if (enterpriseOwnerId) {
    return { employed: false, enterprise_id: enterpriseOwnerId, enterprise_role: 'owner', agentWealth };
  }
  return { employed: false, enterprise_id: null, enterprise_role: null, agentWealth };
}

export function updatePriceHistory(sessionId: string, priceIndices: PriceIndex[]): void {
  const history = new Map<ItemType, number>();
  for (const idx of priceIndices) {
    history.set(idx.itemType, idx.vwap || idx.lastPrice || 0);
  }
  sessionPriceHistory.set(sessionId, history);
}
