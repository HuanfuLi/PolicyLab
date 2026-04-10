/**
 * executionPhase.ts — Physics/execution mega-block (Phase 5 extraction).
 *
 * Covers (in order):
 *   1. weekStateMap init + outcomeMap/intentMap building
 *   2. Ghost enterprise cleanup
 *   3. Per-agent action queue micro-turns (applyEnterpriseAction + resolveAction)
 *   4. Sheriff C enforcement, SFC routing (WORK/INVEST/STEAL/HELP)
 *   5. Physics trace save
 *   6. Non-food order book matching + SYSTEM_NPC
 *   7. Wage settlement & bankruptcy
 *   8. ADJUST_TAX, SET_RESERVE_RATIO, SET_BASE_RATE
 *   9. EMBEZZLE settlement
 *  10. AMM famine reserve
 *  11. Inventory depreciation
 *  12. MET metabolism
 *  13. Allostatic load pipeline
 *  14. Demurrage UBI
 *  15. Market board + price history update + orderBook.reset()
 *  16. Stat finalization loop (death/humiliation/clamp/economyUpdates/actionRows)
 *  17. Sheriff C seized wealth redistribution
 *
 * Extracted verbatim from simulationRunner.ts lines ~1951–2883.
 * No logic changes — pure extraction.
 */

import { v4 as uuidv4 } from 'uuid';
import { db, sqlite } from '../../db/index.js';
import { resolvedActions } from '../../db/schema.js';
import { agentRepo } from '../../db/repos/agentRepo.js';
import { sessionRepo } from '../../db/repos/sessionRepo.js';
import { economyRepo, type AgentEconomyState } from '../../db/repos/economyRepo.js';
import * as bankingEngine from '../../mechanics/bankingEngine.js';
import * as bankingRepo from '../../db/repos/bankingRepo.js';
import * as capitalMarketEngine from '../../mechanics/capitalMarketEngine.js';
import * as capitalMarketRepo from '../../db/repos/capitalMarketRepo.js';
import * as fiscalEngine from '../../mechanics/fiscalEngine.js';
import * as fiscalRepo from '../../db/repos/fiscalRepo.js';
import * as macroSnapshotRepo from '../../db/repos/macroSnapshotRepo.js';
import { getEconomyConfig } from '../../mechanics/economyConfigUtils.js';
import { resolveAction, clampHappinessByPhysiology } from '../../mechanics/physicsEngine.js';
import { physicsConfig } from '../../mechanics/physicsConfig.js';
import { getRoleTier } from '../../mechanics/actionCodes.js';
import { getActionMultiplier, getSkillMultiplier, processSkills } from '../../mechanics/skillSystem.js';
import {
  runFullMetabolicTick,
  getMetCategory,
  AllostaticEngine,
  type AllostaticState,
} from '../../mechanics/allostaticEngine.js';
import {
  computeDemurrageCycle,
  type AgentWealth as AMMAgentWealth,
  type AutomatedMarketMaker,
  type MultiAMMItemType,
} from '../../mechanics/automatedMarketMaker.js';
import { getOrderBook } from '../../mechanics/orderBook.js';
import { computeInflation } from '../../mechanics/inflationEngine.js';
import { simulationManager } from '../simulationManager.js';
import type { AgentIntent, MarketBoardEntry, QueuedActionInstruction } from '../../llm/prompts.js';
import type {
  Agent,
  ItemType,
  PriceIndex,
  SkillMatrix,
  Inventory,
  TelemetryLog,
  InflationState,
} from '@policylab/shared';
import { DEFAULT_BUDGET_ALLOCATION, DEFAULT_PUBLIC_GOODS_INITIAL, DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';
import type { ParsedResolution } from '../../parsers/simulation.js';

// ── Local types ───────────────────────────────────────────────────────────────

interface EnterpriseRecord {
  id: string;
  ownerId: string;
  ownerName: string;
  industry: string;
  employees: Set<string>;
  applicants: Set<string>;
  wage: number;
  minSkill: number;
}

interface EmploymentRecord {
  enterpriseId: string;
  employerId: string;
  employeeId: string;
  wage: number;
  minSkill: number;
  startedAt: number;
}

interface EnterpriseLedger {
  totalRevenue: number;
  totalWages: number;
  workerCount: number;
}

interface AgentWeekState {
  skills: SkillMatrix;
  inventory: Inventory;
  events: string[];
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
  cortisolDelta: number;
  dopamineDelta: number;
  executedActions: QueuedActionInstruction[];
  interrupted: boolean;
  interruptedReason: 'starvation' | 'mental_breakdown' | null;
  workedEnterpriseId: string | null;
  quitEnterpriseId: string | null;
  employer_id: string | null;
  caloriesBurned: number;
  caloriesProduced: number;
  failedActionCount: number;
}

/** Session-level singleton maps (passed by reference from simulationRunner.ts) */
export interface ExecutionScope {
  sessionId: string;
  enterpriseRegistry: Map<string, Map<string, EnterpriseRecord>>;
  employmentRegistry: Map<string, Map<string, EmploymentRecord>>;
  sessionPriceHistory: Map<string, Map<ItemType, number>>;
  sessionAMMRegistry: Map<string, AutomatedMarketMaker>;
  sessionMultiAMMRegistry: Map<string, Map<MultiAMMItemType, AutomatedMarketMaker>>;
  sessionAllostaticStates: Map<string, Map<string, AllostaticState>>;
  sessionLastActionResults: Map<string, Map<string, string>>;
  sessionStateTreasury: Map<string, number>;
  sessionLastPhysicsTraces: Map<string, string>;
  sessionFiscalMultipliers: Map<string, fiscalEngine.MultiplierEffects>;
  sessionInflationState: Map<string, InflationState>;
}

// ── Helpers (mirrored from simulationRunner.ts) ────────────────────────────────

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clampWealth(value: number): number {
  return Math.max(0, value);
}

function distributeProRata(total: number, ratios: number[]): number[] {
  const ratioSum = ratios.reduce((s, r) => s + r, 0);
  if (ratioSum === 0 || ratios.length === 0) return ratios.map(() => 0);
  const shares = ratios.map(r => Math.floor(total * (r / ratioSum)));
  const distributed = shares.reduce((s, v) => s + v, 0);
  let remainder = Math.round(total - distributed);
  for (let i = 0; i < shares.length && remainder > 0; i++) {
    shares[i]++;
    remainder--;
  }
  return shares;
}

function normalizeItemType(raw: unknown): ItemType {
  const normalized = String(raw ?? 'food').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'food') return 'food';
  if (normalized === 'tools' || normalized === 'tool' || normalized === 'tech_parts' || normalized === 'tech') return 'tools';
  if (normalized === 'luxury_goods' || normalized === 'luxury' || normalized === 'goods') return 'luxury_goods';
  return 'raw_materials';
}

function industryToItemType(industry: string): ItemType {
  return normalizeItemType(industry);
}

function getAgentPeakSkill(skills: SkillMatrix): number {
  return Math.max(...Object.values(skills).map(entry => Math.round(entry.level)));
}

function computeSystemFiatTotal(
  agents: Agent[],
  primaryAMM: AutomatedMarketMaker | undefined,
  multiAMMs: Map<MultiAMMItemType, AutomatedMarketMaker> | undefined,
  treasury: number,
  wealthOverrides?: Map<string, number>,
  depositBalances: number = 0,
  collateralEscrow: number = 0,
): number {
  const agentFiat = agents
    .filter(agent => agent.isAlive)
    .reduce((sum, agent) => sum + (wealthOverrides?.get(agent.id) ?? agent.currentStats.wealth), 0);
  const multiAMMFiat = multiAMMs
    ? [...multiAMMs.values()].reduce((sum, pool) => sum + pool.currentFiatReserve, 0)
    : 0;
  return agentFiat + (primaryAMM?.currentFiatReserve ?? 0) + multiAMMFiat + treasury + depositBalances + collateralEscrow;
}

function buildMarketBoardEntries(scope: ExecutionScope, sessionId: string, marketState?: { priceIndices: PriceIndex[] }): MarketBoardEntry[] {
  const previous = scope.sessionPriceHistory.get(sessionId) ?? new Map<ItemType, number>();
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

function updatePriceHistory(scope: ExecutionScope, sessionId: string, priceIndices: PriceIndex[]): void {
  const history = new Map<ItemType, number>();
  for (const idx of priceIndices) {
    history.set(idx.itemType, idx.vwap || idx.lastPrice || 0);
  }
  scope.sessionPriceHistory.set(sessionId, history);
}

function getInflationBasketPrices(
  scope: ExecutionScope,
  sessionId: string,
  economyConfig: ReturnType<typeof getEconomyConfig>,
  priceIndices: PriceIndex[] = [],
): Record<string, number> {
  const iterationPrices = new Map<ItemType, number>();
  for (const idx of priceIndices) {
    iterationPrices.set(idx.itemType, idx.volume > 0 ? idx.vwap : idx.lastPrice);
  }
  const priceHistory = scope.sessionPriceHistory.get(sessionId);
  const basePrices = economyConfig.cpiBasePrices ?? {};
  return {
    food: iterationPrices.get('food') ?? priceHistory?.get('food') ?? basePrices.food ?? 1,
    tools: iterationPrices.get('tools') ?? priceHistory?.get('tools') ?? basePrices.tools ?? 1,
    luxury_goods: iterationPrices.get('luxury_goods') ?? priceHistory?.get('luxury_goods') ?? basePrices.luxury_goods ?? 1,
    raw_materials: iterationPrices.get('raw_materials') ?? priceHistory?.get('raw_materials') ?? basePrices.raw_materials ?? 1,
  };
}

function applyInflationFeedback(pool: AutomatedMarketMaker, factor: number): void {
  if (Math.abs(factor - 1) <= 0.001) return;
  if (factor > 1) {
    const withdrawal = pool.currentFoodReserve * (1 - 1 / factor);
    pool.withdrawGoodsReserve(withdrawal);
    return;
  }
  const injection = pool.currentFoodReserve * ((1 / factor) - 1);
  pool.injectGoodsReserve(injection);
}

// ── applyEnterpriseAction (verbatim from simulationRunner.ts) ─────────────────

function applyEnterpriseAction(params: {
  sessionId: string;
  iterationNumber: number;
  agent: Agent;
  action: QueuedActionInstruction;
  state: AgentWeekState;
  allWeekStates: Map<string, AgentWeekState>;
  enterpriseRegistry: Map<string, EnterpriseRecord>;
  employmentRegistry: Map<string, EmploymentRecord>;
  orderBook: ReturnType<typeof getOrderBook>;
  amm?: AutomatedMarketMaker;
  multiAMMs?: Map<MultiAMMItemType, AutomatedMarketMaker>;
  enterpriseLedger?: Map<string, EnterpriseLedger>;
  scope: ExecutionScope;
}): { wealthDelta: number; healthDelta: number; happinessDelta: number; cortisolDelta: number; dopamineDelta: number } {
  const {
    iterationNumber,
    agent,
    action,
    state,
    allWeekStates,
    enterpriseRegistry,
    employmentRegistry,
    orderBook,
    amm,
    multiAMMs,
    enterpriseLedger,
    scope,
  } = params;
  const economyDelta = { wealthDelta: 0, healthDelta: 0, happinessDelta: 0, cortisolDelta: 0, dopamineDelta: 0 };
  const getNumber = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  switch (action.actionCode) {
    case 'FOUND_ENTERPRISE': {
      const FOUNDING_COST = 40;
      const currentWealth = agent.currentStats.wealth + economyDelta.wealthDelta;
      if (currentWealth < FOUNDING_COST) {
        state.failedActionCount++;
        state.events.push(`FOUND_ENTERPRISE failed: need ${FOUNDING_COST} Wealth (have ${Math.round(currentWealth)})`);
        break;
      }
      const industry = String(action.parameters.industry ?? `${agent.role}_enterprise`);
      const enterpriseId = `e-${agent.id.slice(0, 8)}-${iterationNumber}`;
      if (!enterpriseRegistry.has(enterpriseId)) {
        enterpriseRegistry.set(enterpriseId, {
          id: enterpriseId,
          ownerId: agent.id,
          ownerName: agent.name,
          industry,
          employees: new Set(),
          applicants: new Set(),
          wage: 0,
          minSkill: 0,
        });
        economyDelta.wealthDelta -= FOUNDING_COST;
        {
          const treasury = scope.sessionStateTreasury.get(params.sessionId) ?? 0;
          scope.sessionStateTreasury.set(params.sessionId, treasury + FOUNDING_COST);
        }
        state.events.push(`Founded enterprise ${enterpriseId} in ${industry} (spent ${FOUNDING_COST} Wealth — fee recycled into treasury)`);
      }
      break;
    }
    case 'POST_JOB_OFFER': {
      const enterpriseId = String(action.parameters.enterprise_id ?? '');
      const enterprise = enterpriseRegistry.get(enterpriseId);
      if (enterprise && enterprise.ownerId === agent.id) {
        enterprise.wage = getNumber(action.parameters.wage, enterprise.wage || 6);
        enterprise.minSkill = getNumber(action.parameters.min_skill, enterprise.minSkill || 10);
        state.events.push(`Posted job offer for ${enterpriseId} at wage ${enterprise.wage}`);
      }
      break;
    }
    case 'APPLY_FOR_JOB': {
      const enterpriseId = String(action.parameters.enterprise_id ?? '');
      const enterprise = enterpriseRegistry.get(enterpriseId);
      if (enterprise) {
        enterprise.applicants.add(agent.id);
        state.events.push(`Applied for job at ${enterpriseId}`);
      }
      break;
    }
    case 'HIRE_EMPLOYEE': {
      const targetAgentId = String(action.parameters.agent_id ?? '');
      const enterprise = [...enterpriseRegistry.values()].find(entry => entry.ownerId === agent.id);
      if (enterprise && enterprise.applicants.has(targetAgentId)) {
        const targetState = allWeekStates.get(targetAgentId);
        const skillFloor = targetState ? getAgentPeakSkill(targetState.skills) : 0;
        if (skillFloor >= enterprise.minSkill) {
          employmentRegistry.set(targetAgentId, {
            enterpriseId: enterprise.id,
            employerId: agent.id,
            employeeId: targetAgentId,
            wage: enterprise.wage,
            minSkill: enterprise.minSkill,
            startedAt: iterationNumber,
          });
          enterprise.applicants.delete(targetAgentId);
          enterprise.employees.add(targetAgentId);
          state.events.push(`Hired ${targetAgentId} into ${enterprise.id}`);
        }
      }
      break;
    }
    case 'FIRE_EMPLOYEE': {
      const targetAgentId = String(action.parameters.agent_id ?? '');
      const employment = employmentRegistry.get(targetAgentId);
      if (employment) {
        const enterprise = enterpriseRegistry.get(employment.enterpriseId);
        if (enterprise?.ownerId === agent.id) {
          enterprise.employees.delete(targetAgentId);
          employmentRegistry.delete(targetAgentId);
          state.events.push(`Fired ${targetAgentId} from ${enterprise.id}`);
        }
      }
      break;
    }
    case 'QUIT_JOB': {
      const enterpriseId = String(action.parameters.enterprise_id ?? '');
      const employment = employmentRegistry.get(agent.id);
      if (employment && employment.enterpriseId === enterpriseId) {
        employmentRegistry.delete(agent.id);
        const enterprise = enterpriseRegistry.get(enterpriseId);
        enterprise?.employees.delete(agent.id);
        state.quitEnterpriseId = enterpriseId;
        state.employer_id = null;
        state.events.push(`Quit job at ${enterpriseId}`);
      }
      break;
    }
    case 'WORK_AT_ENTERPRISE': {
      const enterpriseId = String(action.parameters.enterprise_id ?? '');
      const employment = employmentRegistry.get(agent.id);

      if (state.employer_id !== enterpriseId) {
        state.cortisolDelta += 5;
        state.failedActionCount++;
        state.events.push(`WORK_AT_ENTERPRISE rejected: not employed at ${enterpriseId} (employer: ${state.employer_id ?? 'none'})`);
        break;
      }

      if (employment && employment.enterpriseId === enterpriseId) {
        state.workedEnterpriseId = enterpriseId;
        const enterprise = enterpriseRegistry.get(enterpriseId);
        if (enterprise) {
          const ownerState = allWeekStates.get(enterprise.ownerId);
          const itemType = industryToItemType(enterprise.industry);
          const ownerManagementLevel = ownerState?.skills['management']?.level ?? 10;
          const ownerManagementBonus = getSkillMultiplier(ownerManagementLevel);
          const baseQty = getActionMultiplier(state.skills, 'WORK_AT_ENTERPRISE');
          const producedQty = Math.max(1, Math.round(baseQty * ownerManagementBonus));

          let fiatRevenue = 0;
          if (itemType === 'food' && amm) {
            const receipt = amm.executeSell(producedQty, iterationNumber);
            if (receipt.success) {
              fiatRevenue = 'fiatOut' in receipt.quote ? receipt.quote.fiatOut : 0;
              const effectivePrice = 'effectivePrice' in receipt.quote ? receipt.quote.effectivePrice.toFixed(2) : '?';
              if (ownerState) {
                ownerState.wealthDelta += fiatRevenue;
                ownerState.events.push(`Enterprise ${enterpriseId}: ${producedQty} food sold to AMM at ${effectivePrice}/unit (+${fiatRevenue} fiat)`);
              }
            } else {
              if (ownerState) {
                ownerState.inventory[itemType].quantity += producedQty;
                ownerState.events.push(`Enterprise ${enterpriseId}: ${producedQty} food kept in inventory (AMM saturated)`);
              }
            }
          } else {
            const commodityAMM = multiAMMs?.get(itemType as MultiAMMItemType);
            if (commodityAMM) {
              const receipt = commodityAMM.executeSell(producedQty, iterationNumber);
              if (receipt.success) {
                fiatRevenue = 'fiatOut' in receipt.quote ? receipt.quote.fiatOut : 0;
                const effectivePrice = 'effectivePrice' in receipt.quote ? receipt.quote.effectivePrice.toFixed(2) : '?';
                if (ownerState) {
                  ownerState.wealthDelta += fiatRevenue;
                  ownerState.events.push(`Enterprise ${enterpriseId}: ${producedQty} ${itemType} sold to AMM at ${effectivePrice}/unit (+${fiatRevenue} fiat)`);
                }
              } else if (ownerState) {
                ownerState.inventory[itemType].quantity += producedQty;
                ownerState.events.push(`Enterprise ${enterpriseId}: ${producedQty} ${itemType} kept in inventory (AMM saturated)`);
              }
            } else if (ownerState) {
              ownerState.inventory[itemType].quantity += producedQty;
              ownerState.events.push(`Enterprise ${enterpriseId}: ${producedQty} ${itemType} added to inventory`);
            }
          }

          if (enterpriseLedger) {
            const ledger = enterpriseLedger.get(enterpriseId) ?? { totalRevenue: 0, totalWages: 0, workerCount: 0 };
            ledger.totalRevenue += fiatRevenue;
            ledger.workerCount += 1;
            enterpriseLedger.set(enterpriseId, ledger);
          }

          state.events.push(`Worked at ${enterpriseId} (produced ${producedQty} ${itemType}, owner mgmt bonus: ×${ownerManagementBonus.toFixed(2)})`);
        }
      }
      break;
    }
    case 'PRODUCE_AND_SELL': {
      const itemType = normalizeItemType(action.parameters.itemType);
      const BASE_PRODUCE_QUANTITY = 20;
      const skillMult = getActionMultiplier(state.skills, 'PRODUCE_AND_SELL');
      const quantity = Math.max(BASE_PRODUCE_QUANTITY, getNumber(action.parameters.quantity, Math.round(BASE_PRODUCE_QUANTITY * skillMult)));
      const price = Math.max(1, getNumber(action.parameters.price, 5));
      if (itemType === 'food' && amm) {
        const receipt = amm.executeSell(quantity, iterationNumber);
        if (receipt.success) {
          const fiatReceived = 'fiatOut' in receipt.quote ? receipt.quote.fiatOut : 0;
          economyDelta.wealthDelta += fiatReceived;
          const effectivePrice = 'effectivePrice' in receipt.quote ? receipt.quote.effectivePrice.toFixed(2) : price.toString();
          state.events.push(`Produced ${quantity} food → sold to market at ${effectivePrice}/unit (+${fiatReceived} fiat)`);
          state.caloriesProduced += quantity;
        } else {
          state.inventory.food.quantity += quantity;
          state.caloriesProduced += quantity;
          state.events.push(`Produced ${quantity} food (market saturated — kept in inventory)`);
        }
      } else {
        const commodityAMMProduce = multiAMMs?.get(itemType as MultiAMMItemType);
        if (commodityAMMProduce) {
          const receipt = commodityAMMProduce.executeSell(quantity, iterationNumber);
          if (receipt.success) {
            const fiatReceived = 'fiatOut' in receipt.quote ? receipt.quote.fiatOut : 0;
            economyDelta.wealthDelta += fiatReceived;
            const effectivePrice = 'effectivePrice' in receipt.quote ? receipt.quote.effectivePrice.toFixed(2) : price.toString();
            state.events.push(`Produced ${quantity} ${itemType} → sold to AMM at ${effectivePrice}/unit (+${fiatReceived} fiat)`);
          } else {
            orderBook.submitOrder({ sessionId: params.sessionId, agentId: agent.id, side: 'sell', itemType, price, quantity, iterationPlaced: iterationNumber });
            state.events.push(`Produced and listed ${quantity} ${itemType} at ${price} (AMM saturated)`);
          }
        } else {
          orderBook.submitOrder({ sessionId: params.sessionId, agentId: agent.id, side: 'sell', itemType, price, quantity, iterationPlaced: iterationNumber });
          state.events.push(`Produced and listed ${quantity} ${itemType} at ${price}`);
        }
      }
      break;
    }
    case 'POST_BUY_ORDER': {
      const itemType = normalizeItemType(action.parameters.itemType);
      const quantity = Math.max(1, getNumber(action.parameters.quantity, 1));
      const price = Math.max(1, getNumber(action.parameters.price, amm ? Math.round(amm.spotPrice) : 5));
      if (itemType === 'food' && amm) {
        const fiatToSpend = price * quantity;
        const agentCurrentWealth = agent.currentStats.wealth + economyDelta.wealthDelta;
        if (agentCurrentWealth <= 0) {
          state.events.push(`RECEIPT: FAILED — Insufficient wealth. Need ${fiatToSpend} fiat, have ${Math.round(agentCurrentWealth)}.`);
          state.failedActionCount++;
        } else {
          const affordableFiat = Math.min(fiatToSpend, agentCurrentWealth);
          const currentSpot = amm.spotPrice;
          const preview = amm.quoteBuy(affordableFiat);
          if (!preview.executable) {
            state.events.push(`RECEIPT: FAILED — Food buy rejected. Bid ${price}/unit, AMM spot ${currentSpot.toFixed(2)}/unit. Reason: ${preview.rejectReason}`);
            state.failedActionCount++;
          } else {
            const foodReceived = Math.floor(preview.foodOut);
            if (foodReceived <= 0) {
              state.events.push(`RECEIPT: FAILED — Bid too low to purchase even 1 food unit (AMM spot ${currentSpot.toFixed(2)}).`);
              state.failedActionCount++;
            } else {
              const exactFiat = amm.fiatCostForFood(foodReceived);
              if (exactFiat === null || exactFiat > agentCurrentWealth) {
                state.events.push(`RECEIPT: FAILED — Cannot afford ${foodReceived} food (need ${exactFiat?.toFixed(2) ?? '?'} fiat).`);
                state.failedActionCount++;
              } else {
                const receipt = amm.executeBuy(exactFiat, iterationNumber);
                if (receipt.success) {
                  economyDelta.wealthDelta -= exactFiat;
                  state.inventory.food.quantity += foodReceived;
                  const effectivePrice = exactFiat / foodReceived;
                  if (foodReceived < quantity) {
                    state.events.push(`RECEIPT: Price slipped. Bid ${price}/unit for ${quantity} food, AMM spot ${currentSpot.toFixed(2)}. Got ${foodReceived} food for ${exactFiat.toFixed(2)} fiat (${effectivePrice.toFixed(2)}/unit).`);
                  } else {
                    state.events.push(`Bought ${foodReceived} food from market at ${effectivePrice.toFixed(2)}/unit (spent ${exactFiat.toFixed(2)} fiat)`);
                  }
                } else {
                  state.events.push(`RECEIPT: FAILED — Food buy rejected. Reason: ${receipt.rejectReason}`);
                  state.failedActionCount++;
                }
              }
            }
          }
        }
      } else {
        const commodityAMM = multiAMMs?.get(itemType as MultiAMMItemType);
        if (commodityAMM) {
          const fiatCost = commodityAMM.fiatCostForFood(quantity);
          const agentCurrentWealth = agent.currentStats.wealth + economyDelta.wealthDelta;
          if (fiatCost !== null && agentCurrentWealth >= fiatCost) {
            const receipt = commodityAMM.executeBuy(fiatCost, iterationNumber);
            if (receipt.success) {
              const buyQuote = receipt.quote as import('../../mechanics/automatedMarketMaker.js').BuyQuote;
              const received = Math.floor(buyQuote.foodOut);
              state.inventory[itemType as keyof typeof state.inventory].quantity += received;
              economyDelta.wealthDelta -= fiatCost;
              state.events.push(`Bought ${received} ${itemType} from AMM for ${fiatCost.toFixed(1)} fiat`);
            } else {
              orderBook.submitOrder({ sessionId: params.sessionId, agentId: agent.id, side: 'buy', itemType, price, quantity, iterationPlaced: iterationNumber });
              state.events.push(`Posted buy order for ${quantity} ${itemType} at ${price} (AMM rejected)`);
            }
          } else {
            orderBook.submitOrder({ sessionId: params.sessionId, agentId: agent.id, side: 'buy', itemType, price, quantity, iterationPlaced: iterationNumber });
            state.events.push(`Posted buy order for ${quantity} ${itemType} at ${price}`);
          }
        } else {
          orderBook.submitOrder({ sessionId: params.sessionId, agentId: agent.id, side: 'buy', itemType, price, quantity, iterationPlaced: iterationNumber });
          state.events.push(`Posted buy order for ${quantity} ${itemType} at ${price}`);
        }
      }
      break;
    }
    case 'POST_SELL_ORDER': {
      const itemType = normalizeItemType(action.parameters.itemType);
      const quantity = Math.max(1, getNumber(action.parameters.quantity, 1));
      const price = Math.max(1, getNumber(action.parameters.price, amm ? Math.round(amm.spotPrice) : 5));
      if (itemType === 'food' && amm) {
        if (state.inventory.food.quantity >= quantity) {
          state.inventory.food.quantity -= quantity;
          const receipt = amm.executeSell(quantity, iterationNumber);
          if (receipt.success) {
            const fiatReceived = 'fiatOut' in receipt.quote ? receipt.quote.fiatOut : 0;
            economyDelta.wealthDelta += fiatReceived;
            const effectivePrice = 'effectivePrice' in receipt.quote ? receipt.quote.effectivePrice.toFixed(2) : price.toString();
            state.events.push(`Sold ${quantity} food to market at ${effectivePrice}/unit (+${fiatReceived} fiat)`);
          } else {
            state.inventory.food.quantity += quantity;
            state.events.push(`Food sell failed: ${receipt.rejectReason}`);
          }
        }
      } else {
        const commodityAMMSell = multiAMMs?.get(itemType as MultiAMMItemType);
        if (commodityAMMSell && state.inventory[itemType as keyof typeof state.inventory].quantity >= quantity) {
          const receipt = commodityAMMSell.executeSell(quantity, iterationNumber);
          if (receipt.success) {
            const sellQuote = receipt.quote as import('../../mechanics/automatedMarketMaker.js').SellQuote;
            state.inventory[itemType as keyof typeof state.inventory].quantity -= quantity;
            economyDelta.wealthDelta += sellQuote.fiatOut;
            state.events.push(`Sold ${quantity} ${itemType} to AMM for ${sellQuote.fiatOut.toFixed(1)} fiat (spot: ${sellQuote.spotPriceBefore.toFixed(2)})`);
          } else {
            if (state.inventory[itemType as keyof typeof state.inventory].quantity >= quantity) {
              state.inventory[itemType as keyof typeof state.inventory].quantity -= quantity;
              orderBook.submitOrder({ sessionId: params.sessionId, agentId: agent.id, side: 'sell', itemType, price, quantity, iterationPlaced: iterationNumber });
              state.events.push(`Posted sell order for ${quantity} ${itemType} at ${price} (AMM insufficient liquidity)`);
            }
          }
        } else if (!commodityAMMSell) {
          if (state.inventory[itemType as keyof typeof state.inventory].quantity >= quantity) {
            state.inventory[itemType as keyof typeof state.inventory].quantity -= quantity;
            orderBook.submitOrder({ sessionId: params.sessionId, agentId: agent.id, side: 'sell', itemType, price, quantity, iterationPlaced: iterationNumber });
            state.events.push(`Posted sell order for ${quantity} ${itemType} at ${price}`);
          }
        }
      }
      break;
    }
    default:
      break;
  }

  return economyDelta;
}

// ── applyMETMetabolism (verbatim from simulationRunner.ts) ────────────────────

function applyMETMetabolism(
  state: AgentWeekState,
  agent: { role: string; age?: number; weightKg?: number; currentWealth: number },
  scope: ExecutionScope,
  sessionId: string,
  iterationNumber: number,
): void {
  if (state.inventory.luxury_goods.quantity > 0) {
    state.inventory.luxury_goods.quantity -= 1;
    state.cortisolDelta -= 20;
    state.happinessDelta += 5;
    state.events.push('Enjoyed luxury services — stress reduced');
  }

  const enterpriseIndustry = (() => {
    const enterprises = scope.enterpriseRegistry.get(sessionId) ?? new Map<string, EnterpriseRecord>();
    for (const ent of enterprises.values()) {
      if (ent.employees.has(agent.role)) return ent.industry;
    }
    return undefined;
  })();

  const actionsToMeter = state.executedActions.length > 0
    ? state.executedActions
    : [{ actionCode: 'NONE' as const }];

  let totalSatietyCost = 0;
  let primaryMetCategory = 'rest';
  for (let i = 0; i < actionsToMeter.length; i++) {
    const metCategory = getMetCategory(actionsToMeter[i].actionCode, agent.role, enterpriseIndustry);
    if (i === 0) primaryMetCategory = metCategory;
    const metResult = runFullMetabolicTick({
      cortisol: 0,
      weightKg: agent.weightKg ?? 70,
      age: agent.age ?? 35,
      metCategory,
      allostaticState: { allostaticStrain: 0, allostaticLoad: 0 },
    });
    totalSatietyCost += metResult.satietyCost;
  }

  const satietyCost = Math.max(1, totalSatietyCost);
  const metCategory = primaryMetCategory;

  state.caloriesBurned += satietyCost;

  let foodToConsume = satietyCost;

  const foodFromInventory = Math.min(state.inventory.food.quantity, foodToConsume);
  state.inventory.food.quantity -= foodFromInventory;
  foodToConsume -= foodFromInventory;

  let foodFromAMM = 0;
  if (foodToConsume > 0) {
    const ammForAutoEat = scope.sessionAMMRegistry.get(sessionId);
    if (ammForAutoEat) {
      const availableWealth = agent.currentWealth + state.wealthDelta;
      const maxBuyable = ammForAutoEat.maxBuyableFood();

      const amountsToTry = [
        foodToConsume,
        Math.min(foodToConsume, maxBuyable),
        Math.max(0.5, maxBuyable * 0.5),
        maxBuyable * 0.25,
        0.1,
      ].filter((amt, idx, arr) => arr.indexOf(amt) === idx && amt > 0);

      for (const unitsToAttempt of amountsToTry) {
        const fiatCost = ammForAutoEat.fiatCostForFood(unitsToAttempt);
        if (fiatCost !== null && availableWealth >= fiatCost) {
          const receipt = ammForAutoEat.executeBuy(fiatCost, iterationNumber);
          if (receipt.success) {
            const buyQuote = receipt.quote as import('../../mechanics/automatedMarketMaker.js').BuyQuote;
            foodFromAMM = buyQuote.foodOut;
            state.wealthDelta -= fiatCost;
            foodToConsume = Math.max(0, foodToConsume - foodFromAMM);
            state.events.push(`Auto-bought ${foodFromAMM.toFixed(1)} food from AMM for ${fiatCost.toFixed(1)} fiat (metabolic need)`);
            break;
          }
        }
      }
    }
  }

  if (foodToConsume <= 0) {
    const ammNote = foodFromAMM > 0 ? ', AMM top-up' : '';
    state.events.push(`Consumed ${satietyCost} food (${metCategory}×${actionsToMeter.length} actions${ammNote})`);
  } else if (foodToConsume < satietyCost) {
    const deficitRatio = foodToConsume / satietyCost;
    state.healthDelta -= 5 * deficitRatio;
    state.cortisolDelta += 8 * deficitRatio;
    state.events.push(`Partial nutrition: ${(satietyCost - foodToConsume).toFixed(0)}/${satietyCost} food (hungry)`);
  } else {
    state.healthDelta -= 10;
    state.cortisolDelta += 15;
    state.events.push('Starvation — no food available');
  }
}

// ── createAgentWeekState ──────────────────────────────────────────────────────

import { DEFAULT_SKILL_MATRIX, DEFAULT_INVENTORY } from '@policylab/shared';

function createAgentWeekState(econState?: AgentEconomyState): AgentWeekState {
  return {
    skills: structuredClone(econState?.skills ?? DEFAULT_SKILL_MATRIX),
    inventory: structuredClone(econState?.inventory ?? DEFAULT_INVENTORY),
    events: [],
    wealthDelta: 0,
    healthDelta: 0,
    happinessDelta: 0,
    cortisolDelta: 0,
    dopamineDelta: 0,
    executedActions: [],
    interrupted: false,
    interruptedReason: null,
    workedEnterpriseId: null,
    quitEnterpriseId: null,
    employer_id: null,
    caloriesBurned: 0,
    caloriesProduced: 0,
    failedActionCount: 0,
  };
}

// ── gini ──────────────────────────────────────────────────────────────────────

function gini(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sum += Math.abs(values[i] - values[j]);
    }
  }
  return Math.round((sum / (2 * n * n * mean)) * 1000) / 1000;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runExecutionPhase(ctx: {
  sessionId: string;
  scope: ExecutionScope;
  iterNum: number;
  agents: Agent[];
  aliveAgents: Agent[];
  intents: AgentIntent[];
  resolution: ParsedResolution;
  illegalActionMap: Map<string, Set<string>>;
  agentEconomyMap: Map<string, AgentEconomyState>;
  lockedVariables: string[];
  lockedEconomySnapshot: Map<string, AgentEconomyState>;
  sessionPolicy: any;
  session: any;
  sabotageRegistry: Map<string, number>;
  suppressRegistry: Map<string, number>;
  deathReasonMap: Map<string, { iteration: number; reason: string }>;
  iterationId: string;
  now: string;
  r4: (v: number) => number;
  sfcPrevTotalFiat: number | null;
}): Promise<{
  weekStateMap: Map<string, AgentWeekState>;
  statUpdates: Array<{ id: string; wealth: number; health: number; happiness: number; cortisol: number; dopamine: number }>;
  deaths: Array<{ id: string; iterationNumber: number }>;
  economyUpdates: Array<{ agentId: string; sessionId: string; skills: SkillMatrix; inventory: Inventory; lastUpdated: number }>;
  actionRows: Array<typeof resolvedActions.$inferInsert>;
  actionRowByAgentId: Map<string, typeof resolvedActions.$inferInsert>;
  humiliatedAgentIds: Set<string>;
  enterpriseLedgerMap: Map<string, EnterpriseLedger>;
  seizedWealthPool: number;
  bankruptciesThisIter: number;
  latestMarketBoard: MarketBoardEntry[];
  marketState: any;
  bankingTotalDeposits: number;
  bankingCollateralEscrow: number;
  bankingLoansOutstanding: number;
  inflationTelemetry: Pick<TelemetryLog, 'cpi' | 'inflationRate' | 'inflationExpectations'> | null;
  fiscalPublicGoodsQuality: { infrastructureQuality: number; educationQuality: number; defenseQuality: number; welfareQuality: number } | null;
  iterTelemetry: TelemetryLog | null;
  newSfcPrevTotalFiat: number;
}> {
  const {
    sessionId,
    scope,
    iterNum,
    agents,
    aliveAgents,
    intents,
    resolution,
    illegalActionMap,
    agentEconomyMap,
    lockedVariables,
    lockedEconomySnapshot,
    sessionPolicy,
    session,
    sabotageRegistry,
    suppressRegistry,
    deathReasonMap,
    iterationId,
    now,
    r4,
    sfcPrevTotalFiat,
  } = ctx;

  const enterpriseRegistry = scope.enterpriseRegistry.get(sessionId) ?? new Map<string, EnterpriseRecord>();
  const employmentRegistry = scope.employmentRegistry.get(sessionId) ?? new Map<string, EmploymentRecord>();

  const intentMap = new Map(intents.map(i => [i.agentId, i]));
  const outcomeMap = new Map(resolution.agentOutcomes.map(o => [o.agentId, o]));

  // Fix A1: Reconcile lifecycle death events with agent outcomes.
  for (const event of resolution.lifecycleEvents ?? []) {
    if ((event as { type: string; agentId?: string }).type === 'death') {
      const evtAgentId = (event as { type: string; agentId?: string }).agentId;
      if (evtAgentId) {
        const existing = outcomeMap.get(evtAgentId);
        if (existing && !existing.died) {
          outcomeMap.set(evtAgentId, { ...existing, died: true });
        }
      }
    }
  }

  const weekStateMap = new Map<string, AgentWeekState>(
    aliveAgents.map(agent => [agent.id, createAgentWeekState(agentEconomyMap.get(agent.id))])
  );
  // Populate employer_id from persisted employment registry
  for (const agent of aliveAgents) {
    const state = weekStateMap.get(agent.id)!;
    state.employer_id = employmentRegistry.get(agent.id)?.enterpriseId ?? null;
  }
  const orderBook = getOrderBook(sessionId);

  const statUpdates: Array<{ id: string; wealth: number; health: number; happiness: number; cortisol: number; dopamine: number }> = [];
  const deaths: Array<{ id: string; iterationNumber: number }> = [];
  const actionRows: Array<typeof resolvedActions.$inferInsert> = [];
  const actionRowByAgentId = new Map<string, typeof resolvedActions.$inferInsert>();
  const economyUpdates: Array<{ agentId: string; sessionId: string; skills: SkillMatrix; inventory: Inventory; lastUpdated: number }> = [];
  const humiliatedAgentIds = new Set<string>();
  const enterpriseLedgerMap = new Map<string, EnterpriseLedger>();
  let seizedWealthPool = 0;

  // ── Ghost Enterprise Cleanup ──────────────────────────────────────────────
  {
    const aliveAgentIds = new Set(aliveAgents.map(a => a.id));
    for (const [enterpriseId, enterprise] of enterpriseRegistry) {
      if (aliveAgentIds.has(enterprise.ownerId)) continue;
      for (const [employeeId] of enterprise.employees) {
        const empRecord = employmentRegistry.get(employeeId);
        if (!empRecord) continue;
        const empState = weekStateMap.get(employeeId);
        if (empState) {
          empState.cortisolDelta += 20;
          empState.happinessDelta -= 15;
          empState.events.push(`Your employer died — enterprise ${enterpriseId} dissolved, you are now unemployed`);
          empState.employer_id = null;
        }
        employmentRegistry.delete(employeeId);
      }
      enterpriseRegistry.delete(enterpriseId);
    }
  }

  // D4: Per-agent physics trace accumulator
  const agentTraceMap = new Map<string, string[]>();

  // ── Per-agent action queue micro-turns ────────────────────────────────────
  for (const agent of aliveAgents) {
    const weekState = weekStateMap.get(agent.id)!;
    const agentIntent = intentMap.get(agent.id);
    const queue = (agentIntent?.actions?.slice(0, 3) ?? [{ actionCode: 'NONE', parameters: {} }]) as QueuedActionInstruction[];
    let runningWealth = agent.currentStats.wealth;
    let runningHealth = agent.currentStats.health;
    let runningHappiness = agent.currentStats.happiness;
    let runningCortisol = agent.currentStats.cortisol ?? 20;
    let runningDopamine = agent.currentStats.dopamine ?? 50;

    for (const [actionIndex, action] of queue.entries()) {
      const rawTarget = action.parameters?.target ?? action.parameters?.agent_id;
      const targetText = typeof rawTarget === 'string' ? rawTarget.toLowerCase() : '';
      const targetAgent = aliveAgents.find(a => a.id === rawTarget || a.name.toLowerCase() === targetText);

      const economyDelta = applyEnterpriseAction({
        sessionId,
        iterationNumber: iterNum,
        agent,
        action,
        state: weekState,
        allWeekStates: weekStateMap,
        enterpriseRegistry,
        employmentRegistry,
        orderBook,
        amm: scope.sessionAMMRegistry.get(sessionId),
        multiAMMs: scope.sessionMultiAMMRegistry.get(sessionId),
        enterpriseLedger: enterpriseLedgerMap,
        scope,
      });

      // SFC fix: For STEAL actions, patch target wealth to reflect accumulated deltas
      let agentsForPhysics = aliveAgents;
      if (action.actionCode === 'STEAL' && targetAgent) {
        const targetState = weekStateMap.get(targetAgent.id);
        if (targetState) {
          const targetRunningWealth = Math.max(0, targetAgent.currentStats.wealth + targetState.wealthDelta);
          agentsForPhysics = aliveAgents.map(a =>
            a.id === targetAgent.id
              ? { ...a, currentStats: { ...a.currentStats, wealth: targetRunningWealth } }
              : a
          );
        }
      }

      const physics = resolveAction({
        agent: {
          ...agent,
          currentStats: {
            ...agent.currentStats,
            wealth: runningWealth,
            health: runningHealth,
            happiness: runningHappiness,
            cortisol: runningCortisol,
            dopamine: runningDopamine,
          },
        },
        actionCode: action.actionCode,
        actionParameters: action.parameters,
        actionTarget: targetAgent?.id,
        allAgents: agentsForPhysics,
        skills: weekState.skills,
        inventory: weekState.inventory,
        economyDeltas: economyDelta,
        isSabotaged: sabotageRegistry.has(agent.id),
        isSuppressed: suppressRegistry.has(agent.id),
        isFirstAction: actionIndex === 0,
        fiscalMultipliers: scope.sessionFiscalMultipliers.get(sessionId),
      });

      weekState.executedActions.push(action);

      // D4: Accumulate physics trace
      if (physics.trace.length > 0) {
        const existing = agentTraceMap.get(agent.id) ?? [];
        agentTraceMap.set(agent.id, [...existing, ...physics.trace.slice(-3)].slice(-9));
      }

      // ── Phase Sheriff C: enforcement check ──────────────────────────────
      const illegalCodesForAgent = illegalActionMap.get(agent.id);
      if (illegalCodesForAgent?.has(action.actionCode)) {
        const detectionProb = Math.min(0.9, 0.2 * sessionPolicy.enforcement_level);
        if (Math.random() < detectionProb) {
          const seizureFromBalance = runningWealth * 0.25;
          const seizedActionGain = Math.max(0, physics.wealthDelta);
          const totalSeized = seizureFromBalance + seizedActionGain;
          seizedWealthPool += totalSeized;
          physics.wealthDelta -= totalSeized;
          physics.cortisolDelta += 30;
          physics.happinessDelta = Math.min(physics.happinessDelta, -5);
          weekState.events.push(
            `ARRESTED for illegal "${action.actionCode}": −${totalSeized.toFixed(1)} fiat seized by state (${seizureFromBalance.toFixed(1)} from savings, ${seizedActionGain.toFixed(1)} from illegal gain; +30 stress, enforcement_level=${sessionPolicy.enforcement_level.toFixed(1)}).`
          );
        }
      }

      const enforcementCortisolScale = action.actionCode === 'STEAL' ? sessionPolicy.enforcement_level : 1.0;
      const effectiveCortisolDelta = physics.cortisolDelta * enforcementCortisolScale;

      weekState.wealthDelta += physics.wealthDelta;

      // D1: Deduct standalone WORK income from state treasury (SFC-compliant)
      if (action.actionCode === 'WORK' && physics.wealthDelta > 0) {
        const treasury = scope.sessionStateTreasury.get(sessionId) ?? 0;
        if (treasury < physics.wealthDelta) {
          weekState.wealthDelta -= (physics.wealthDelta - treasury);
          scope.sessionStateTreasury.set(sessionId, 0);
        } else {
          scope.sessionStateTreasury.set(sessionId, treasury - physics.wealthDelta);
        }
      }

      // D2: REST recovery scaling by dopamine
      let scaledHealthDelta = physics.healthDelta;
      if (action.actionCode === 'REST' && physics.healthDelta > 0) {
        const dopamineScaleMult = runningDopamine >= 70 ? 1.25 : runningDopamine <= 30 ? 0.75 : 1.0;
        scaledHealthDelta = Math.round(physics.healthDelta * dopamineScaleMult);
      }

      weekState.healthDelta += scaledHealthDelta;
      weekState.happinessDelta += physics.happinessDelta;
      weekState.cortisolDelta += effectiveCortisolDelta;
      weekState.dopamineDelta += physics.dopamineDelta;

      // Fix A: Zero-sum STEAL
      if (action.actionCode === 'STEAL' && targetAgent && physics.wealthDelta > 0) {
        const victimState = weekStateMap.get(targetAgent.id);
        if (victimState) {
          const victimAvailable = Math.max(0, targetAgent.currentStats.wealth + victimState.wealthDelta);
          const actualStolen = Math.min(physics.wealthDelta, victimAvailable);
          victimState.wealthDelta -= actualStolen;
          if (actualStolen < physics.wealthDelta) {
            weekState.wealthDelta -= (physics.wealthDelta - actualStolen);
          }
        }
      }

      // BUG-03 fix: Zero-sum HELP
      if (action.actionCode === 'HELP' && targetAgent && physics.wealthDelta < 0) {
        const beneficiaryState = weekStateMap.get(targetAgent.id);
        if (beneficiaryState) {
          const helpAmount = Math.abs(physics.wealthDelta);
          const actualGift = Math.min(helpAmount, runningWealth);
          beneficiaryState.wealthDelta += actualGift;
          if (actualGift < helpAmount) {
            weekState.wealthDelta += (helpAmount - actualGift);
          }
        }
      }

      runningWealth = clampWealth(runningWealth + physics.wealthDelta);
      runningHealth = clampStat(runningHealth + physics.healthDelta);
      runningHappiness = clampStat(runningHappiness + physics.happinessDelta);
      runningCortisol = clampStat(runningCortisol + effectiveCortisolDelta);
      runningDopamine = clampStat(runningDopamine + physics.dopamineDelta);

      const fiscalSkillMult = scope.sessionFiscalMultipliers.get(sessionId);
      const skillGainMult = fiscalSkillMult ? 1 + fiscalSkillMult.skillGainBonus : 1.0;
      weekState.skills = processSkills(weekState.skills, action.actionCode, skillGainMult);

      if (runningHealth < 20) {
        weekState.interrupted = true;
        weekState.interruptedReason = 'starvation';
        break;
      }
      if (runningCortisol > 90) {
        weekState.interrupted = true;
        weekState.interruptedReason = 'mental_breakdown';
        break;
      }
    }
  }

  // D4: Build physics log from this iteration's traces
  {
    const logLines: string[] = [];
    for (const ag of aliveAgents) {
      const traces = agentTraceMap.get(ag.id) ?? [];
      if (traces.length > 0) {
        logLines.push(`${ag.name}: ${traces.slice(-3).join(' | ')}`);
      }
    }
    if (logLines.length > 0) {
      scope.sessionLastPhysicsTraces.set(sessionId, logLines.join('\n'));
    }
  }

  // ── Non-food order book matching + SYSTEM_NPC ──────────────────────────────
  if (aliveAgents.length > 0) {
    orderBook.submitOrder({
      sessionId,
      agentId: 'SYSTEM_NPC',
      side: 'buy',
      itemType: 'raw_materials',
      price: 2,
      quantity: aliveAgents.length * 10,
      iterationPlaced: iterNum,
    });
  }
  const trades = orderBook.matchOrders();
  for (const trade of trades) {
    const buyerState = weekStateMap.get(trade.buyerId);
    const sellerState = weekStateMap.get(trade.sellerId);
    if (buyerState) {
      buyerState.wealthDelta -= trade.executionPrice * trade.quantity;
      buyerState.inventory[trade.itemType].quantity += trade.quantity;
      buyerState.events.push(`Bought ${trade.quantity} ${trade.itemType} at ${trade.executionPrice}`);
    } else if (trade.buyerId === 'SYSTEM_NPC') {
      const cost = trade.executionPrice * trade.quantity;
      const treasury = scope.sessionStateTreasury.get(sessionId) ?? 0;
      const fundedCost = Math.min(cost, treasury);
      scope.sessionStateTreasury.set(sessionId, treasury - fundedCost);
      if (sellerState && fundedCost < cost) {
        sellerState.wealthDelta += fundedCost;
        sellerState.events.push(`Sold ${trade.quantity} ${trade.itemType} at ${trade.executionPrice} (treasury-backed)`);
        continue;
      }
    }
    if (sellerState) {
      sellerState.wealthDelta += trade.executionPrice * trade.quantity;
      sellerState.events.push(`Sold ${trade.quantity} ${trade.itemType} at ${trade.executionPrice}`);
    }
  }

  // ── Wage Settlement & Bankruptcy ──────────────────────────────────────────
  let bankruptciesThisIter = 0;
  {
    const enterpriseWorkers = new Map<string, EmploymentRecord[]>();
    for (const employment of employmentRegistry.values()) {
      const employeeState = weekStateMap.get(employment.employeeId);
      if (!employeeState) continue;
      if (employeeState.workedEnterpriseId === employment.enterpriseId) {
        const list = enterpriseWorkers.get(employment.enterpriseId) ?? [];
        list.push(employment);
        enterpriseWorkers.set(employment.enterpriseId, list);
      } else if (employeeState.quitEnterpriseId !== employment.enterpriseId) {
        employeeState.cortisolDelta += 10;
        employeeState.happinessDelta -= 5;
        employeeState.events.push(`Failed to fulfill employment obligation at ${employment.enterpriseId}`);
      }
    }

    for (const [enterpriseId, workers] of enterpriseWorkers) {
      const enterprise = enterpriseRegistry.get(enterpriseId);
      if (!enterprise) continue;
      const ownerState = weekStateMap.get(enterprise.ownerId);
      if (!ownerState) continue;

      const totalWageObligation = workers.reduce((sum, e) => sum + e.wage, 0);
      const ownerAvailableWealth = enterprise.ownerId
        ? (aliveAgents.find(a => a.id === enterprise.ownerId)?.currentStats.wealth ?? 0) + ownerState.wealthDelta
        : 0;

      if (ownerAvailableWealth >= totalWageObligation) {
        for (const employment of workers) {
          const employeeState = weekStateMap.get(employment.employeeId);
          if (!employeeState) continue;
          ownerState.wealthDelta -= employment.wage;
          ownerState.events.push(`Paid wage ${employment.wage} to ${employment.employeeId}`);
          employeeState.wealthDelta += employment.wage;
          employeeState.events.push(`Received wage ${employment.wage} from ${enterpriseId}`);
        }
        {
          const ledger = enterpriseLedgerMap.get(enterpriseId) ?? { totalRevenue: 0, totalWages: 0, workerCount: 0 };
          ledger.totalWages += totalWageObligation;
          enterpriseLedgerMap.set(enterpriseId, ledger);
        }
      } else {
        {
          const ledger = enterpriseLedgerMap.get(enterpriseId) ?? { totalRevenue: 0, totalWages: 0, workerCount: 0 };
          ledger.totalWages += totalWageObligation;
          enterpriseLedgerMap.set(enterpriseId, ledger);
        }
        bankruptciesThisIter++;
        const liquidatable = Math.max(0, ownerAvailableWealth);
        const payRatio = totalWageObligation > 0 ? liquidatable / totalWageObligation : 0;

        const workerPayments: Array<{ employment: (typeof workers)[0]; payment: number }> = [];
        let totalPaid = 0;
        for (const employment of workers) {
          const payment = Math.floor(employment.wage * payRatio);
          workerPayments.push({ employment, payment });
          totalPaid += payment;
        }
        let remainder = Math.floor(liquidatable) - totalPaid;
        for (let i = 0; i < workerPayments.length && remainder > 0; i++) {
          workerPayments[i].payment++;
          remainder--;
        }

        for (const { employment, payment: partialPay } of workerPayments) {
          const employeeState = weekStateMap.get(employment.employeeId);
          if (!employeeState) continue;
          if (partialPay > 0) {
            ownerState.wealthDelta -= partialPay;
            employeeState.wealthDelta += partialPay;
            employeeState.events.push(`Partial wage ${partialPay}/${employment.wage} from bankrupt enterprise ${enterpriseId}`);
          } else {
            employeeState.events.push(`Wage unpaid — enterprise ${enterpriseId} declared bankruptcy`);
          }
          employmentRegistry.delete(employment.employeeId);
          enterprise.employees.delete(employment.employeeId);
          const empWeekState = weekStateMap.get(employment.employeeId);
          if (empWeekState) empWeekState.employer_id = null;
          employeeState.cortisolDelta += 20;
          employeeState.happinessDelta -= 15;
        }

        ownerState.events.push(`CRITICAL: Your enterprise ${enterpriseId} went bankrupt! You failed to pay your workers and lost your business.`);
        ownerState.cortisolDelta += 40;
        ownerState.happinessDelta -= 30;
        enterpriseRegistry.delete(enterpriseId);
      }
    }
  }

  // ── ADJUST_TAX ───────────────────────────────────────────────────────────
  const TAX_PER_AGENT = 3;
  for (const intent of intents) {
    const taxActions = intent.actions?.filter(action => action.actionCode === 'ADJUST_TAX') ?? [];
    if (taxActions.length === 0) continue;
    const taxerState = weekStateMap.get(intent.agentId);
    const taxableAgents = aliveAgents.filter(a =>
      !a.isCentralAgent && a.id !== intent.agentId && getRoleTier(a.role) !== 'elite'
    );
    let actualTaxCollected = 0;
    for (const taxed of taxableAgents) {
      const taxedState = weekStateMap.get(taxed.id);
      if (!taxedState) continue;
      const required = TAX_PER_AGENT * taxActions.length;
      const availableWealth = taxed.currentStats.wealth + taxedState.wealthDelta;
      const actualDeduction = Math.min(required, Math.max(0, availableWealth));
      taxedState.wealthDelta -= actualDeduction;
      actualTaxCollected += actualDeduction;
      taxedState.cortisolDelta += 5 * taxActions.length;
      taxedState.happinessDelta -= 3 * taxActions.length;
    }
    if (taxerState) taxerState.wealthDelta += actualTaxCollected;
  }

  // ── SET_RESERVE_RATIO / SET_BASE_RATE ─────────────────────────────────────
  {
    const configRoot = (session.config as Record<string, unknown> | null) ?? {};
    const persistedEconomyConfig = getEconomyConfig(configRoot);
    let configChanged = false;

    for (const intent of intents) {
      for (const action of intent.actions ?? []) {
        const requestedValue = typeof action.parameters?.value === 'number' ? action.parameters.value : null;
        if (requestedValue === null) continue;

        if (action.actionCode === 'SET_RESERVE_RATIO') {
          persistedEconomyConfig.reserveRequirement = Math.max(0.05, Math.min(0.50, requestedValue));
          configChanged = true;
        }

        if (action.actionCode === 'SET_BASE_RATE') {
          persistedEconomyConfig.baseLoanInterestRate = Math.max(0.001, Math.min(0.05, requestedValue));
          configChanged = true;
        }
      }
    }

    if (configChanged) {
      session.config = {
        ...(configRoot ?? {}),
        economyConfig: {
          ...((configRoot.economyConfig as Record<string, unknown> | undefined) ?? {}),
          ...persistedEconomyConfig,
        },
      };
      await sessionRepo.updateConfig(sessionId, session.config as Record<string, unknown>);
    }
  }

  // ── EMBEZZLE Settlement ───────────────────────────────────────────────────
  {
    for (const intent of intents) {
      const embezzleActions = intent.actions?.filter(a => a.actionCode === 'EMBEZZLE') ?? [];
      if (embezzleActions.length === 0) continue;
      const embezzlerState = weekStateMap.get(intent.agentId);
      if (!embezzlerState) continue;
      const EMBEZZLE_TARGET = 20 * embezzleActions.length;
      const contributors = aliveAgents.filter(a => a.id !== intent.agentId);
      if (contributors.length === 0) continue;

      const availableList = contributors.map(c => {
        const cState = weekStateMap.get(c.id);
        return cState ? Math.max(0, c.currentStats.wealth + cState.wealthDelta) : 0;
      });
      const totalAvailable = availableList.reduce((s, v) => s + v, 0);

      const targetShares = distributeProRata(
        Math.min(EMBEZZLE_TARGET, Math.floor(totalAvailable)),
        availableList.map(a => (a > 0 ? a : 0)),
      );

      let totalEmbezzled = 0;
      for (let i = 0; i < contributors.length; i++) {
        const contributor = contributors[i];
        const cState = weekStateMap.get(contributor.id);
        if (!cState) continue;
        const deducted = Math.min(targetShares[i] ?? 0, availableList[i] ?? 0);
        cState.wealthDelta -= deducted;
        totalEmbezzled += deducted;
      }
      embezzlerState.wealthDelta += totalEmbezzled;
      embezzlerState.events.push(`Embezzled ${totalEmbezzled.toFixed(1)} fiat from communal pool (spread across ${contributors.length} agents)`);
    }
  }

  // ── AMM Famine Reserve ────────────────────────────────────────────────────
  {
    const primaryAMM = scope.sessionAMMRegistry.get(sessionId);
    if (primaryAMM && aliveAgents.length > 0) {
      const foodReserve = primaryAMM.currentFoodReserve;
      const minReserve = aliveAgents.length * 2;
      if (foodReserve < minReserve) {
        const injection = minReserve - foodReserve;
        const sellReceipt = primaryAMM.executeSell(injection, iterNum);
        if (sellReceipt.success && 'fiatOut' in sellReceipt.quote) {
          const fiatFromSale = sellReceipt.quote.fiatOut;
          const treasury = scope.sessionStateTreasury.get(sessionId) ?? 0;
          scope.sessionStateTreasury.set(sessionId, treasury + fiatFromSale);
        }
      }
    }
  }

  // ── Inventory Depreciation ────────────────────────────────────────────────
  for (const agent of aliveAgents) {
    const weekState = weekStateMap.get(agent.id)!;
    const inv = weekState.inventory;

    if (inv.food.quantity > 0) {
      inv.food.quality = Math.max(0, inv.food.quality - 0.15 * 100);
      if (inv.food.quality < 10) {
        weekState.events.push(`${inv.food.quantity} food spoiled (quality decayed below threshold)`);
        inv.food.quantity = 0;
        inv.food.quality = 100;
      }
    }

    const workedThisTurn = weekState.executedActions.some(
      a => a.actionCode === 'WORK' || a.actionCode === 'WORK_AT_ENTERPRISE' || a.actionCode === 'PRODUCE_AND_SELL'
    );
    if (workedThisTurn && inv.tools.quantity > 0) {
      inv.tools.quality = Math.max(0, inv.tools.quality - 5);
      if (inv.tools.quality < 5) {
        inv.tools.quantity = Math.max(0, inv.tools.quantity - 1);
        inv.tools.quality = inv.tools.quantity > 0 ? 80 : 100;
        weekState.events.push('A tool broke from use');
      }
    }

    if (inv.raw_materials.quantity > 0) {
      inv.raw_materials.quality = Math.max(0, inv.raw_materials.quality - 0.01 * 100);
      if (inv.raw_materials.quality < 10) {
        weekState.events.push(`${inv.raw_materials.quantity} raw materials degraded`);
        inv.raw_materials.quantity = 0;
        inv.raw_materials.quality = 100;
      }
    }
  }

  // ── MET Metabolism ────────────────────────────────────────────────────────
  for (const agent of aliveAgents) {
    const weekState = weekStateMap.get(agent.id)!;
    applyMETMetabolism(weekState, { ...agent, currentWealth: agent.currentStats.wealth }, scope, sessionId, iterNum);
  }

  // ── Allostatic Load Pipeline ──────────────────────────────────────────────
  {
    let sessionAlloStates = scope.sessionAllostaticStates.get(sessionId);
    if (!sessionAlloStates) {
      sessionAlloStates = new Map();
      scope.sessionAllostaticStates.set(sessionId, sessionAlloStates);
    }
    for (const agent of aliveAgents) {
      const weekState = weekStateMap.get(agent.id)!;
      const currentCortisol = clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta);
      const currentDopamine = clampStat((agent.currentStats.dopamine ?? 50) + weekState.dopamineDelta);
      const priorState = sessionAlloStates.get(agent.id) ?? { allostaticStrain: 0, allostaticLoad: 0 };
      const engine = new AllostaticEngine(priorState);
      const alloResult = engine.tick({ cortisol: currentCortisol, dopamine: currentDopamine });
      if (alloResult.healthDelta < 0) {
        weekState.healthDelta += alloResult.healthDelta;
        weekState.events.push(
          `Allostatic overload: health ${alloResult.healthDelta.toFixed(1)} (strain: ${alloResult.updatedState.allostaticStrain.toFixed(1)}, load: ${alloResult.updatedState.allostaticLoad.toFixed(1)})`
        );
      }
      sessionAlloStates.set(agent.id, alloResult.updatedState);
    }
  }

  // ── Demurrage UBI ─────────────────────────────────────────────────────────
  {
    const agentWealthList: AMMAgentWealth[] = aliveAgents.map(agent => ({
      agentId: agent.id,
      wealth: clampWealth(agent.currentStats.wealth + (weekStateMap.get(agent.id)?.wealthDelta ?? 0)),
    }));
    const demurrage = computeDemurrageCycle(agentWealthList, sessionPolicy.tax_rate, sessionPolicy.ubi_allocation);
    for (const [agentId, netDelta] of demurrage.netDeltas) {
      const weekState = weekStateMap.get(agentId);
      if (!weekState) continue;
      weekState.wealthDelta += netDelta;
      if (netDelta > 0.5) {
        weekState.events.push(`UBI received: +${netDelta.toFixed(1)} fiat (demurrage redistribution @ ${(sessionPolicy.ubi_allocation * 100).toFixed(0)}% UBI allocation)`);
      } else if (netDelta < -0.5) {
        weekState.events.push(`Demurrage tax: ${netDelta.toFixed(1)} fiat (${(sessionPolicy.tax_rate * 100).toFixed(1)}% wealth decay)`);
      }
    }
    {
      const clampedUbiAllocation = Math.min(1, Math.max(0, sessionPolicy.ubi_allocation));
      const unredistributed = demurrage.taxPoolCollected * (1 - clampedUbiAllocation);
      const treasuryCredit = unredistributed + demurrage.ubiFractionalRemainder;
      if (treasuryCredit > 0) {
        const treasury = scope.sessionStateTreasury.get(sessionId) ?? 0;
        scope.sessionStateTreasury.set(sessionId, treasury + treasuryCredit);
      }
    }
  }

  // ── Market board + price history update + orderBook.reset() ──────────────
  const sessionAMM = scope.sessionAMMRegistry.get(sessionId);
  const marketState = orderBook.getMarketState();
  let latestMarketBoard = buildMarketBoardEntries(scope, sessionId, marketState);
  if (sessionAMM) {
    const ammFoodPrice = Math.round(sessionAMM.spotPrice * 100) / 100;
    const prevFoodPrice = scope.sessionPriceHistory.get(sessionId)?.get('food');
    let ammFoodTrend: MarketBoardEntry['trend'] = 'unknown';
    if (prevFoodPrice == null) ammFoodTrend = 'new';
    else if (ammFoodPrice > prevFoodPrice) ammFoodTrend = 'up';
    else if (ammFoodPrice < prevFoodPrice) ammFoodTrend = 'down';
    else ammFoodTrend = 'flat';
    const withoutFood = latestMarketBoard.filter(e => e.itemType !== 'food');
    latestMarketBoard = [{ itemType: 'food', averageClearingPrice: ammFoodPrice, trend: ammFoodTrend }, ...withoutFood];
    let priceHist = scope.sessionPriceHistory.get(sessionId);
    if (!priceHist) { priceHist = new Map(); scope.sessionPriceHistory.set(sessionId, priceHist); }
    priceHist.set('food', ammFoodPrice);
  }
  const multiAMMsForBoard = scope.sessionMultiAMMRegistry.get(sessionId);
  if (multiAMMsForBoard) {
    const multiEntries = Array.from(multiAMMsForBoard.entries()).map(([itemType, pool]) => {
      const spotPrice = Math.round(pool.spotPrice * 100) / 100;
      const prevMultiPrice = scope.sessionPriceHistory.get(sessionId)?.get(itemType as ItemType);
      let multiTrend: MarketBoardEntry['trend'] = 'unknown';
      if (prevMultiPrice == null) multiTrend = 'new';
      else if (spotPrice > prevMultiPrice) multiTrend = 'up';
      else if (spotPrice < prevMultiPrice) multiTrend = 'down';
      else multiTrend = 'flat';
      return { itemType, averageClearingPrice: spotPrice, trend: multiTrend };
    });
    latestMarketBoard = [
      ...latestMarketBoard,
      ...multiEntries.filter(e => !latestMarketBoard.some(m => m.itemType === e.itemType)),
    ];
  }
  if (multiAMMsForBoard) {
    let priceHistForMulti = scope.sessionPriceHistory.get(sessionId);
    if (!priceHistForMulti) { priceHistForMulti = new Map(); scope.sessionPriceHistory.set(sessionId, priceHistForMulti); }
    for (const [itemType, pool] of multiAMMsForBoard) {
      priceHistForMulti.set(itemType as ItemType, Math.round(pool.spotPrice * 100) / 100);
    }
  }
  updatePriceHistory(scope, sessionId, marketState.priceIndices);
  orderBook.reset();

  // ── Capital market request accumulation ───────────────────────────────────
  const cmktPendingSharePurchases: Array<{
    buyerId: string;
    enterpriseOwnerId: string;
    sharesToBuy: number;
    totalSharesOutstanding: number;
  }> = [];
  const cmktPendingShareSales: Array<{
    sellerId: string;
    buyerId: string;
    enterpriseOwnerId: string;
    sharesToSell: number;
    totalSharesOutstanding: number;
  }> = [];
  const cmktPendingGovBondPurchases: Array<{
    buyerId: string;
    faceValue: number;
  }> = [];
  const cmktPendingCorpBondIssuances: Array<{
    buyerId: string;
    enterpriseOwnerId: string;
    faceValue: number;
    couponRate: number;
    maturityIteration: number;
  }> = [];

  const cmktEconomyConfig = getEconomyConfig(session.config as Record<string, unknown> | null);
  if (cmktEconomyConfig.capitalMarketsEnabled) {
    const allEquityPositions = capitalMarketRepo.getEquityPositionsBySession(sessionId);
    const sharesByEnterprise = new Map<string, number>();
    for (const pos of allEquityPositions) {
      const prev = sharesByEnterprise.get(pos.enterpriseOwnerId) ?? 0;
      sharesByEnterprise.set(pos.enterpriseOwnerId, prev + pos.sharesHeld);
    }

    for (const intent of intents) {
      if (!intent.actions) continue;
      for (const action of intent.actions) {
        const rawTarget = action.parameters?.target ?? action.parameters?.agent_id ?? '';
        const targetText = typeof rawTarget === 'string' ? rawTarget.toLowerCase() : '';

        if (action.actionCode === 'BUY_SHARES') {
          const enterpriseOwner = aliveAgents.find(
            a => a.id === rawTarget || a.name.toLowerCase() === targetText,
          );
          if (!enterpriseOwner) continue;
          const sharesToBuy = typeof action.parameters?.quantity === 'number' ? action.parameters.quantity : 10;
          const totalShares = sharesByEnterprise.get(enterpriseOwner.id) ?? 0;
          cmktPendingSharePurchases.push({
            buyerId: intent.agentId,
            enterpriseOwnerId: enterpriseOwner.id,
            sharesToBuy,
            totalSharesOutstanding: totalShares,
          });
        } else if (action.actionCode === 'SELL_SHARES') {
          const enterpriseOwner = aliveAgents.find(
            a => a.id === rawTarget || a.name.toLowerCase() === targetText,
          );
          if (!enterpriseOwner) continue;
          const sharesToSell = typeof action.parameters?.quantity === 'number' ? action.parameters.quantity : 10;
          const totalShares = sharesByEnterprise.get(enterpriseOwner.id) ?? 0;
          const potentialBuyer = aliveAgents.find(
            a => a.id !== intent.agentId && a.id !== enterpriseOwner.id,
          );
          if (!potentialBuyer) continue;
          cmktPendingShareSales.push({
            sellerId: intent.agentId,
            buyerId: potentialBuyer.id,
            enterpriseOwnerId: enterpriseOwner.id,
            sharesToSell,
            totalSharesOutstanding: totalShares,
          });
        } else if (action.actionCode === 'BUY_BOND') {
          const faceValue = typeof action.parameters?.amount === 'number' ? action.parameters.amount : 50;
          if (targetText === 'treasury' || !targetText) {
            cmktPendingGovBondPurchases.push({ buyerId: intent.agentId, faceValue });
          } else {
            const enterpriseOwner = aliveAgents.find(
              a => a.id === rawTarget || a.name.toLowerCase() === targetText,
            );
            if (!enterpriseOwner) continue;
            const couponRate = cmktEconomyConfig.govBondCouponRate ?? 0.01;
            const maturityIter = iterNum + (cmktEconomyConfig.govBondTermIterations ?? 10);
            cmktPendingCorpBondIssuances.push({
              buyerId: intent.agentId,
              enterpriseOwnerId: enterpriseOwner.id,
              faceValue,
              couponRate,
              maturityIteration: maturityIter,
            });
          }
        } else if (action.actionCode === 'ISSUE_GOV_BOND') {
          const faceValue = typeof action.parameters?.amount === 'number'
            ? action.parameters.amount
            : (typeof rawTarget === 'string' && !isNaN(Number(rawTarget)) ? Number(rawTarget) : 100);
          cmktPendingGovBondPurchases.push({ buyerId: intent.agentId, faceValue });
        }
      }
    }
  }

  // ── Banking tick ──────────────────────────────────────────────────────────
  const economyConfig = getEconomyConfig(session.config as Record<string, unknown> | null);
  let bankingTotalDeposits = 0;
  let bankingCollateralEscrow = 0;
  let bankingLoansOutstanding = 0;
  let inflationTelemetry: Pick<TelemetryLog, 'cpi' | 'inflationRate' | 'inflationExpectations'> | null = null;

  if (economyConfig.bankingEnabled) {
    const bankAgents = agents.filter(a => a.type === 'bank' && a.isAlive);
    const loans = bankingRepo.getActiveLoans(sessionId);
    const deposits = bankingRepo.getDepositsBySession(sessionId);

    const bankingDelta = bankingEngine.processIteration({
      sessionId,
      bankAgents,
      allAgents: agents,
      loans,
      deposits,
      economyConfig,
      iterationNumber: iterNum,
    });

    sqlite.transaction(() => {
      for (const upd of bankingDelta.depositUpdates) {
        bankingRepo.updateDepositBalance(upd.accountId, upd.newBalance, upd.iteration);
      }
      for (const upd of bankingDelta.loanUpdates) {
        bankingRepo.updateLoan(upd.loanId, upd.updates);
      }
      for (const loan of bankingDelta.newLoans) {
        bankingRepo.insertLoan(loan);
      }
      for (const dep of bankingDelta.newDeposits) {
        bankingRepo.upsertDeposit(dep);
      }
      for (const sheet of bankingDelta.balanceSheetSnapshots) {
        bankingRepo.insertBalanceSheet(sheet);
      }
    })();

    // Apply wealth deltas from banking (in-memory only, persisted with statUpdates below)
    // NOTE: statUpdates is built in the stat finalization loop below; banking deltas are
    // applied there too by matching agentId. We store them temporarily here.
    const bankingWealthDeltas = bankingDelta.wealthDeltas;

    if (bankingDelta.trace.length > 0) {
      const existingTrace = scope.sessionLastPhysicsTraces.get(sessionId) ?? '';
      scope.sessionLastPhysicsTraces.set(sessionId,
        existingTrace + '\n' + bankingDelta.trace.join('\n'));
    }

    bankingTotalDeposits = bankingRepo.getTotalDeposits(sessionId);
    bankingCollateralEscrow = bankingRepo.getTotalCollateral(sessionId);
    bankingLoansOutstanding = bankingRepo.getTotalLoansOutstanding(sessionId);

    // Store for stat finalization loop below
    (ctx as any)._bankingWealthDeltas = bankingWealthDeltas;
  }

  // ── Capital market tick ───────────────────────────────────────────────────
  if (cmktEconomyConfig.capitalMarketsEnabled) {
    const equityPositions = capitalMarketRepo.getEquityPositionsBySession(sessionId);
    const bondHoldings = capitalMarketRepo.getActiveBondHoldingsBySession(sessionId);

    // Build agent snapshots — we need wealth post-stat-accumulation so use current agentEconomyMap
    // (stat finalization hasn't run yet; this matches original runner ordering)
    const agentsWithRunningWealth = aliveAgents.map(a => {
      const econState = agentEconomyMap.get(a.id);
      // approx: use current stats (actual deltas applied after the finalization loop)
      return a;
    });

    const cmktDelta = capitalMarketEngine.processIteration({
      sessionId,
      allAgents: agentsWithRunningWealth,
      equityPositions,
      bondHoldings,
      economyConfig: cmktEconomyConfig,
      iterationNumber: iterNum,
      pendingSharePurchases: cmktPendingSharePurchases,
      pendingShareSales: cmktPendingShareSales,
      pendingGovBondPurchases: cmktPendingGovBondPurchases,
      pendingCorpBondIssuances: cmktPendingCorpBondIssuances,
    });

    sqlite.transaction(() => {
      for (const pos of cmktDelta.upsertEquityPositions) {
        capitalMarketRepo.upsertEquityPosition(pos);
      }
      for (const holding of cmktDelta.upsertBondHoldings) {
        capitalMarketRepo.upsertBondHolding(holding);
      }
      for (const id of cmktDelta.deleteBondHoldingIds) {
        capitalMarketRepo.deleteBondHolding(id);
      }
    })();

    // Store for stat finalization loop below
    (ctx as any)._cmktWealthDeltas = cmktDelta.wealthDeltas;
    (ctx as any)._cmktEnterpriseTreasuryDeltas = cmktDelta.enterpriseTreasuryDeltas;
    (ctx as any)._cmktTreasuryDelta = cmktDelta.treasuryDelta;

    scope.sessionStateTreasury.set(
      sessionId,
      (scope.sessionStateTreasury.get(sessionId) ?? 0) + cmktDelta.treasuryDelta,
    );

    if (cmktDelta.trace.length > 0) {
      const existingTrace = scope.sessionLastPhysicsTraces.get(sessionId) ?? '';
      scope.sessionLastPhysicsTraces.set(sessionId,
        existingTrace + '\n' + cmktDelta.trace.join('\n'));
    }
  }

  // ── Fiscal policy tick ────────────────────────────────────────────────────
  let fiscalPublicGoodsQuality: { infrastructureQuality: number; educationQuality: number; defenseQuality: number; welfareQuality: number } | null = null;
  if (economyConfig.fiscalEnabled) {
    const budgetAllocation = fiscalRepo.getActiveBudget(sessionId) ?? DEFAULT_BUDGET_ALLOCATION;
    const currentPublicGoods = fiscalRepo.getPublicGoodsState(sessionId);
    const treasuryBalance = scope.sessionStateTreasury.get(sessionId) ?? 0;

    const fiscalDelta = fiscalEngine.executeBudget({
      treasuryBalance,
      budgetAllocation,
      economyConfig,
      currentPublicGoods: currentPublicGoods
        ? {
            iterationNumber: currentPublicGoods.iterationNumber,
            infrastructureQuality: currentPublicGoods.infrastructureQuality,
            educationQuality: currentPublicGoods.educationQuality,
            defenseQuality: currentPublicGoods.defenseQuality,
            welfareQuality: currentPublicGoods.welfareQuality,
          }
        : { iterationNumber: 0, ...DEFAULT_PUBLIC_GOODS_INITIAL },
      aliveAgentIds: aliveAgents.map(a => a.id),
      iterationNumber: iterNum,
    });

    fiscalPublicGoodsQuality = fiscalDelta.updatedPublicGoods;

    scope.sessionStateTreasury.set(sessionId, treasuryBalance + fiscalDelta.treasuryDelta);

    // Store for stat finalization loop below
    (ctx as any)._fiscalAgentPayments = fiscalDelta.agentPayments;

    sqlite.transaction(() => {
      fiscalRepo.upsertPublicGoodsState({
        id: `${sessionId}-${iterNum}`,
        sessionId,
        ...fiscalDelta.updatedPublicGoods,
      });
    })();

    scope.sessionFiscalMultipliers.set(sessionId, fiscalDelta.multiplierEffects);

    if (fiscalDelta.trace.length > 0) {
      const existingTrace = scope.sessionLastPhysicsTraces.get(sessionId) ?? '';
      scope.sessionLastPhysicsTraces.set(sessionId,
        existingTrace + '\n' + fiscalDelta.trace.join('\n'));
    }
  }

  // ── Inflation tick ────────────────────────────────────────────────────────
  if (economyConfig.inflationEnabled) {
    const configRoot = (session.config as Record<string, unknown> | null) ?? {};
    const persistedEconomyConfig = getEconomyConfig(configRoot);
    const currentPrices = getInflationBasketPrices(scope, sessionId, persistedEconomyConfig, marketState.priceIndices);
    const hasBasePrices = Object.keys(persistedEconomyConfig.cpiBasePrices ?? {}).length > 0;

    if (!hasBasePrices) {
      persistedEconomyConfig.cpiBasePrices = { ...currentPrices };
      session.config = {
        ...configRoot,
        economyConfig: {
          ...((configRoot.economyConfig as Record<string, unknown> | undefined) ?? {}),
          ...persistedEconomyConfig,
        },
      };
      await sessionRepo.updateConfig(sessionId, session.config as Record<string, unknown>);
    }

    // Stat finalization hasn't run yet, so we use weekState deltas for the inflation M0 calc
    const finalWealthByAgentId = new Map(aliveAgents.map(a => {
      const ws = weekStateMap.get(a.id);
      return [a.id, clampWealth(a.currentStats.wealth + (ws?.wealthDelta ?? 0))];
    }));

    const treasuryBalance = scope.sessionStateTreasury.get(sessionId) ?? 0;
    const currentM0 = computeSystemFiatTotal(
      agents,
      scope.sessionAMMRegistry.get(sessionId),
      scope.sessionMultiAMMRegistry.get(sessionId),
      treasuryBalance,
      finalWealthByAgentId,
      bankingTotalDeposits,
      bankingCollateralEscrow,
    );
    const latestSnapshot = macroSnapshotRepo.getLatestSnapshot(db, sessionId);
    const smoothingWindow = persistedEconomyConfig.inflationSmoothingWindow ?? DEFAULT_ECONOMY_CONFIG.inflationSmoothingWindow ?? 3;
    const recentSnapshots = macroSnapshotRepo.getRecentSnapshots(db, sessionId, smoothingWindow);
    const inflationOutput = computeInflation({
      iterationNumber: iterNum,
      currentPrices,
      basePrices: persistedEconomyConfig.cpiBasePrices ?? currentPrices,
      m1Current: currentM0 + bankingLoansOutstanding,
      m1Previous: latestSnapshot?.m1 ?? null,
      previousCpi: latestSnapshot?.cpi ?? null,
      recentCpiHistory: recentSnapshots.map(snapshot => snapshot.cpi).reverse(),
      economyConfig: persistedEconomyConfig,
    });

    macroSnapshotRepo.insertMacroSnapshot(db, {
      sessionId,
      iterationNumber: iterNum,
      m0: currentM0,
      m1: currentM0 + bankingLoansOutstanding,
      cpi: inflationOutput.cpi,
      inflationRate: inflationOutput.inflationRate,
      inflationExpectations: inflationOutput.inflationExpectations,
      totalLoansOutstanding: bankingLoansOutstanding,
      treasuryBalance,
    });

    scope.sessionInflationState.set(sessionId, {
      cpi: inflationOutput.cpi,
      inflationRate: inflationOutput.inflationRate,
      inflationExpectations: inflationOutput.inflationExpectations,
    });
    inflationTelemetry = {
      cpi: inflationOutput.cpi,
      inflationRate: inflationOutput.inflationRate,
      inflationExpectations: inflationOutput.inflationExpectations,
    };

    if (Math.abs(inflationOutput.ammFeedbackFactor - 1) > 0.001) {
      const primaryAMM2 = scope.sessionAMMRegistry.get(sessionId);
      if (primaryAMM2) {
        applyInflationFeedback(primaryAMM2, inflationOutput.ammFeedbackFactor);
      }
      const secondaryAMMs = scope.sessionMultiAMMRegistry.get(sessionId);
      if (secondaryAMMs) {
        for (const pool of secondaryAMMs.values()) {
          applyInflationFeedback(pool, inflationOutput.ammFeedbackFactor);
        }
      }
      const existingTrace = scope.sessionLastPhysicsTraces.get(sessionId) ?? '';
      scope.sessionLastPhysicsTraces.set(
        sessionId,
        existingTrace + '\n' + `AMM feedback: scaled goods reserves for price factor ${inflationOutput.ammFeedbackFactor.toFixed(4)}`,
      );
    }

    if (inflationOutput.trace.length > 0) {
      const existingTrace = scope.sessionLastPhysicsTraces.get(sessionId) ?? '';
      scope.sessionLastPhysicsTraces.set(
        sessionId,
        existingTrace + '\n' + inflationOutput.trace.join('\n'),
      );
    }
  }

  // ── Stat finalization loop ────────────────────────────────────────────────
  const finalStatsByAgentId = new Map<string, { id: string; wealth: number; health: number; happiness: number; cortisol: number; dopamine: number }>();

  for (const agent of aliveAgents) {
    const outcome = outcomeMap.get(agent.id);
    const agentIntent = intentMap.get(agent.id);
    const weekState = weekStateMap.get(agent.id)!;

    let newWealth = clampWealth(agent.currentStats.wealth + r4(weekState.wealthDelta));
    let newHealth = clampStat(agent.currentStats.health + weekState.healthDelta);
    let newHappiness = clampStat(agent.currentStats.happiness + weekState.happinessDelta);
    let newCortisol = clampStat((agent.currentStats.cortisol ?? 20) + weekState.cortisolDelta);
    let newDopamine = clampStat((agent.currentStats.dopamine ?? 50) + weekState.dopamineDelta);

    newHappiness = clampHappinessByPhysiology(newHappiness, newHealth, newCortisol);

    const shouldDie = (outcome?.died === true) || newHealth <= 2;
    const isBreakdownTrapped =
      weekState.interruptedReason === 'mental_breakdown' &&
      weekState.inventory.food.quantity <= 0 &&
      newWealth < physicsConfig.lowWealthThreshold;
    const shouldHumiliate = !shouldDie && (
      (newHealth < 20 && weekState.inventory.food.quantity <= 0) ||
      isBreakdownTrapped
    );

    if (shouldDie) {
      deaths.push({ id: agent.id, iterationNumber: iterNum });
      const lifecycleEvent = resolution.lifecycleEvents?.find(
        (e: { type: string; agentId: string; detail?: string }) => e.agentId && e.agentId === agent.id && e.type === 'death'
      );
      const deathReason = lifecycleEvent?.detail ?? (newHealth <= 2 ? 'health depleted' : 'fatal circumstances');
      deathReasonMap.set(agent.id, { iteration: iterNum, reason: deathReason });
      orderBook.removeAgentOrders(agent.id);
      seizedWealthPool += Math.max(0, newWealth);
      newWealth = 0;
    } else if (shouldHumiliate) {
      humiliatedAgentIds.add(agent.id);
      seizedWealthPool += Math.max(0, newWealth);
      newHealth = 30;
      newWealth = 0;
      newCortisol = 85;
      newHappiness = clampHappinessByPhysiology(newHappiness, newHealth, newCortisol);
    }

    if (weekState.interruptedReason === 'mental_breakdown') {
      newCortisol = Math.min(newCortisol, 75);
      newHappiness = clampHappinessByPhysiology(newHappiness, newHealth, newCortisol);
    }

    if (lockedVariables.includes('wealth')) newWealth = agent.initialStats.wealth;
    if (lockedVariables.includes('health')) newHealth = agent.initialStats.health;
    if (lockedVariables.includes('happiness')) newHappiness = agent.initialStats.happiness;
    if (lockedVariables.includes('cortisol')) newCortisol = agent.initialStats.cortisol ?? 20;
    if (lockedVariables.includes('dopamine')) newDopamine = agent.initialStats.dopamine ?? 50;

    statUpdates.push({
      id: agent.id,
      wealth: newWealth,
      health: newHealth,
      happiness: newHappiness,
      cortisol: newCortisol,
      dopamine: newDopamine,
    });
    finalStatsByAgentId.set(agent.id, { id: agent.id, wealth: newWealth, health: newHealth, happiness: newHappiness, cortisol: newCortisol, dopamine: newDopamine });

    // Task 4: Build action-result feedback for next iteration
    {
      const wDelta = newWealth - agent.currentStats.wealth;
      const hDelta = newHealth - agent.currentStats.health;
      const hapDelta = newHappiness - agent.currentStats.happiness;
      const lines: string[] = [];
      if (weekState.executedActions.length > 0) {
        lines.push(`Actions taken: ${weekState.executedActions.map(a => a.actionCode).join(', ')}`);
      }
      const economyLines = weekState.events.filter(e =>
        /sold|bought|produced|wage|starv|food|fail|UBI|demurrage|AMM|market|hired|quit|enterprise/i.test(e)
      ).slice(0, 6);
      if (economyLines.length > 0) lines.push(...economyLines.map(e => `• ${e}`));
      lines.push(`Net changes: Wealth ${wDelta >= 0 ? '+' : ''}${wDelta}, Health ${hDelta >= 0 ? '+' : ''}${hDelta}, Happiness ${hapDelta >= 0 ? '+' : ''}${hapDelta}`);
      if (weekState.interrupted) {
        lines.push(`Action queue interrupted: ${weekState.interruptedReason}`);
      }
      const ownedEnterprise = [...enterpriseRegistry.values()].find(e => e.ownerId === agent.id);
      if (ownedEnterprise) {
        const ledger = enterpriseLedgerMap.get(ownedEnterprise.id);
        if (ledger) {
          const netProfit = ledger.totalRevenue - ledger.totalWages;
          const profitLabel = netProfit >= 0 ? `+${netProfit.toFixed(1)}` : netProfit.toFixed(1);
          lines.push(
            `[Enterprise ${ownedEnterprise.id} Summary]: Total Revenue from Labor (+${ledger.totalRevenue.toFixed(1)}), Total Wages Paid (-${ledger.totalWages.toFixed(1)}). **Net Weekly Profit: ${profitLabel}.**` +
            (netProfit < 0 ? ' Your enterprise is LOSING money. Consider FIRE_EMPLOYEE or adjusting your business model.' : '')
          );
        }
      }
      const resultText = `[Week ${iterNum} Results]\n${lines.join('\n')}`;
      let agentResults = scope.sessionLastActionResults.get(sessionId);
      if (!agentResults) { agentResults = new Map(); scope.sessionLastActionResults.set(sessionId, agentResults); }
      agentResults.set(agent.id, resultText);
    }

    for (const action of weekState.executedActions) {
      const rawTarget = action.parameters?.target ?? action.parameters?.agent_id;
      const targetText = typeof rawTarget === 'string' ? rawTarget.toLowerCase() : '';
      const targetAgent = aliveAgents.find(a => a.id === rawTarget || a.name.toLowerCase() === targetText);
      if (action.actionCode === 'SABOTAGE' && targetAgent) {
        sabotageRegistry.set(targetAgent.id, 3);
      }
      if (action.actionCode === 'SUPPRESS' && targetAgent) {
        suppressRegistry.set(targetAgent.id, 2);
        const targetUpdate = statUpdates.find(u => u.id === targetAgent.id);
        if (targetUpdate) {
          targetUpdate.cortisol = clampStat(targetUpdate.cortisol + 25);
          targetUpdate.happiness = clampStat(targetUpdate.happiness - 10);
        }
      }
    }

    const lockedSnap = lockedEconomySnapshot.get(agent.id);
    economyUpdates.push({
      agentId: agent.id,
      sessionId,
      skills: lockedVariables.includes('skills') && lockedSnap ? lockedSnap.skills : weekState.skills,
      inventory: lockedVariables.includes('inventory') && lockedSnap ? lockedSnap.inventory : weekState.inventory,
      lastUpdated: iterNum,
    });

    const actionRow = {
      id: uuidv4(),
      sessionId,
      agentId: agent.id,
      iterationId,
      action: outcome?.outcome ?? agentIntent?.intent ?? 'No action.',
      outcome: JSON.stringify({
        text: outcome?.outcome ?? agentIntent?.intent ?? 'No action.',
        actionQueue: weekState.executedActions,
        wealthDelta: weekState.wealthDelta,
        healthDelta: weekState.healthDelta,
        happinessDelta: weekState.happinessDelta,
        finalWealth: newWealth,
        finalHealth: newHealth,
        finalHappiness: newHappiness,
        interrupted: weekState.interrupted,
        interruptedReason: weekState.interruptedReason,
        economyEvents: weekState.events,
        foodAfterMetabolism: weekState.inventory.food.quantity,
      }),
      resolvedAt: now,
    };
    actionRows.push(actionRow);
    actionRowByAgentId.set(agent.id, actionRow);
  }

  // Apply banking wealth deltas to statUpdates
  const bankingWealthDeltas = (ctx as any)._bankingWealthDeltas as Map<string, number> | undefined;
  if (bankingWealthDeltas) {
    for (const [agentId, delta] of bankingWealthDeltas) {
      const agentUpdate = statUpdates.find(u => u.id === agentId);
      if (agentUpdate) agentUpdate.wealth += delta;
    }
  }

  // Apply capital market wealth deltas to statUpdates
  const cmktWealthDeltas = (ctx as any)._cmktWealthDeltas as Map<string, number> | undefined;
  if (cmktWealthDeltas) {
    for (const [agentId, delta] of cmktWealthDeltas) {
      const agentUpdate = statUpdates.find(u => u.id === agentId);
      if (agentUpdate) agentUpdate.wealth += delta;
    }
  }
  const cmktEnterpriseTreasuryDeltas = (ctx as any)._cmktEnterpriseTreasuryDeltas as Map<string, number> | undefined;
  if (cmktEnterpriseTreasuryDeltas) {
    for (const [enterpriseOwnerId, delta] of cmktEnterpriseTreasuryDeltas) {
      const agentUpdate = statUpdates.find(u => u.id === enterpriseOwnerId);
      if (agentUpdate) agentUpdate.wealth += delta;
    }
  }

  // Apply fiscal agent payments to statUpdates
  const fiscalAgentPayments = (ctx as any)._fiscalAgentPayments as Map<string, number> | undefined;
  if (fiscalAgentPayments) {
    for (const [agentId, payment] of fiscalAgentPayments) {
      const agentUpdate = statUpdates.find(u => u.id === agentId);
      if (agentUpdate) agentUpdate.wealth += payment;
    }
  }

  // ── Phase Sheriff C: redistribute seized wealth ────────────────────────────
  if (seizedWealthPool > 0) {
    const deadIds = new Set(deaths.map(d => d.id));
    const survivorUpdates = statUpdates.filter(u => !deadIds.has(u.id));
    if (survivorUpdates.length > 0) {
      const integerPool = Math.floor(seizedWealthPool);
      const fractionalRemainder = seizedWealthPool - integerPool;
      const equalShares = distributeProRata(
        integerPool,
        survivorUpdates.map(() => 1),
      );
      const seizedUBI = seizedWealthPool / survivorUpdates.length;
      for (let i = 0; i < survivorUpdates.length; i++) {
        const update = survivorUpdates[i];
        const share = (equalShares[i] ?? 0) + (i === 0 ? fractionalRemainder : 0);
        update.wealth = clampWealth(update.wealth + share);
        const actionRow = actionRowByAgentId.get(update.id);
        if (actionRow?.outcome) {
          try {
            const parsed = JSON.parse(actionRow.outcome) as {
              wealthDelta?: number;
              finalWealth?: number;
            };
            parsed.wealthDelta = Number(parsed.wealthDelta ?? 0) + share;
            parsed.finalWealth = update.wealth;
            actionRow.outcome = JSON.stringify(parsed);
          } catch {
            // Leave malformed payloads untouched
          }
        }
      }
      simulationManager.broadcast(sessionId, {
        type: 'resolution',
        iteration: iterNum,
        narrativeSummary: `State enforcement: ${seizedWealthPool.toFixed(1)} fiat redistributed equally among ${survivorUpdates.length} survivors (+${seizedUBI.toFixed(1)}/citizen).`,
        lifecycleEvents: [],
      });
    } else {
      const treasury = scope.sessionStateTreasury.get(sessionId) ?? 0;
      scope.sessionStateTreasury.set(sessionId, treasury + seizedWealthPool);
    }
  }

  // ── Telemetry ─────────────────────────────────────────────────────────────
  let iterTelemetry: TelemetryLog | null = null;
  {
    const sessionAMMForTelemetry = scope.sessionAMMRegistry.get(sessionId);
    const multiAMMsForTelemetry = scope.sessionMultiAMMRegistry.get(sessionId);
    const treasury = scope.sessionStateTreasury.get(sessionId) ?? 0;
    const finalWealthByAgentId = new Map(statUpdates.map(update => [update.id, update.wealth]));
    const totalFiatSupply = computeSystemFiatTotal(
      agents,
      sessionAMMForTelemetry,
      multiAMMsForTelemetry,
      treasury,
      finalWealthByAgentId,
      bankingTotalDeposits,
      bankingCollateralEscrow,
    );
    const totalCaloriesBurned = [...weekStateMap.values()].reduce((sum, ws) => sum + ws.caloriesBurned, 0);
    const totalCaloriesProduced = [...weekStateMap.values()].reduce((sum, ws) => sum + ws.caloriesProduced, 0);
    const totalFailedActions = [...weekStateMap.values()].reduce((sum, ws) => sum + ws.failedActionCount, 0);
    const totalActionSlots = aliveAgents.length * 3;
    const actionFailureRate = totalActionSlots > 0
      ? Math.round((totalFailedActions / totalActionSlots) * 1000) / 1000
      : 0;
    const giniCoefficient = gini(statUpdates.map(u => u.wealth));
    const allExecutedActions = [...weekStateMap.values()].flatMap(ws => ws.executedActions);
    const helpCount = allExecutedActions.filter(a => a.actionCode === 'HELP').length;
    const stealCount = allExecutedActions.filter(a => a.actionCode === 'STEAL').length;
    const sabotageCount = allExecutedActions.filter(a => a.actionCode === 'SABOTAGE').length;
    const embezzleCount = allExecutedActions.filter(a => a.actionCode === 'EMBEZZLE').length;
    const totalActions = allExecutedActions.filter(a => a.actionCode !== 'NONE').length;
    const trustDenom = helpCount + stealCount;
    const trustIndex = trustDenom > 0 ? Math.round((helpCount / trustDenom) * 1000) / 1000 : undefined;
    const crimeRate = totalActions > 0
      ? Math.round(((stealCount + sabotageCount + embezzleCount) / totalActions) * 1000) / 1000
      : 0;
    const roleChangeCount = resolution.lifecycleEvents?.filter(
      (e: { type: string }) => e.type === 'role_change'
    ).length ?? 0;
    const socialMobilityIndex = aliveAgents.length > 0
      ? Math.round((roleChangeCount / aliveAgents.length) * 1000) / 1000
      : 0;
    const averageCortisol = statUpdates.length > 0
      ? Math.round(statUpdates.reduce((s, u) => s + u.cortisol, 0) / statUpdates.length)
      : 0;
    const averageDopamine = statUpdates.length > 0
      ? Math.round(statUpdates.reduce((s, u) => s + u.dopamine, 0) / statUpdates.length)
      : 0;

    iterTelemetry = {
      iterationNumber: iterNum,
      totalFiatSupply,
      totalFiatSupplyRounded: Math.round(totalFiatSupply),
      ammFoodReserve_Y: Math.round((sessionAMMForTelemetry?.currentFoodReserve ?? 0) * 100) / 100,
      ammFiatReserve_X: Math.round(sessionAMMForTelemetry?.currentFiatReserve ?? 0),
      ammSpotPrice_Food: Math.round((sessionAMMForTelemetry?.spotPrice ?? 0) * 100) / 100,
      totalCaloriesBurned: Math.round(totalCaloriesBurned * 10) / 10,
      totalCaloriesProduced: Math.round(totalCaloriesProduced),
      actionFailureRate,
      giniCoefficient,
      socialMobilityIndex,
      trustIndex,
      crimeRate,
      averageCortisol,
      averageDopamine,
      m0: totalFiatSupply,
      m1: totalFiatSupply + bankingLoansOutstanding,
      loansOutstanding: bankingLoansOutstanding,
      ...(inflationTelemetry ?? {}),
      ...(fiscalPublicGoodsQuality ? {
        infrastructureQuality: Math.round(fiscalPublicGoodsQuality.infrastructureQuality * 100) / 100,
        educationQuality: Math.round(fiscalPublicGoodsQuality.educationQuality * 100) / 100,
        defenseQuality: Math.round(fiscalPublicGoodsQuality.defenseQuality * 100) / 100,
        welfareQuality: Math.round(fiscalPublicGoodsQuality.welfareQuality * 100) / 100,
      } : {}),
    };

    if (sfcPrevTotalFiat !== null) {
      const sfcDrift = totalFiatSupply - sfcPrevTotalFiat;
      const tolerance = Math.max(0.1, aliveAgents.length * 0.01);
      if (Math.abs(sfcDrift) > tolerance) {
        const agentNote = aliveAgents.length === 0 ? 'with 0 alive agents' : `with ${aliveAgents.length} alive agents`;
        console.warn(`[SFC] iter=${iterNum}: drift=${sfcDrift.toFixed(6)} ${agentNote} — possible unaccounted fiat creation or destruction`);
      }
    }
  }

  return {
    weekStateMap,
    statUpdates,
    deaths,
    economyUpdates,
    actionRows,
    actionRowByAgentId,
    humiliatedAgentIds,
    enterpriseLedgerMap,
    seizedWealthPool,
    bankruptciesThisIter,
    latestMarketBoard,
    marketState,
    bankingTotalDeposits,
    bankingCollateralEscrow,
    bankingLoansOutstanding,
    inflationTelemetry,
    fiscalPublicGoodsQuality,
    iterTelemetry,
    newSfcPrevTotalFiat: iterTelemetry?.totalFiatSupply ?? sfcPrevTotalFiat ?? 0,
  };
}
