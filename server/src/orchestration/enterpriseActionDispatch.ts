import type { Agent } from '@policylab/shared';
import type { QueuedActionInstruction } from '../llm/prompts/index.js';
import type { AutomatedMarketMaker, MultiAMMItemType } from '../mechanics/automatedMarketMaker.js';
import { getOrderBook } from '../mechanics/orderBook.js';
import { getActionMultiplier, getSkillMultiplier } from '../mechanics/skillSystem.js';
import { sessionStateTreasury } from './simulationState.js';
import type { EnterpriseRecord, EmploymentRecord, EnterpriseLedger } from './simulationState.js';
import { normalizeItemType, industryToItemType, getAgentPeakSkill } from './helpers/physicsUtils.js';
import type { AgentWeekState } from './helpers/weekState.js';

export function applyEnterpriseAction(params: {
  sessionId: string;
  iterationNumber: number;
  agent: Agent;
  action: QueuedActionInstruction;
  state: AgentWeekState;
  allWeekStates: Map<string, AgentWeekState>;
  enterpriseRegistry: Map<string, EnterpriseRecord>;
  employmentRegistry: Map<string, EmploymentRecord>;
  orderBook: ReturnType<typeof getOrderBook>;
  /** AMM instance for this session — food trades route through it instead of order book. */
  amm?: AutomatedMarketMaker;
  /** Multi-commodity AMM pools for non-food items. */
  multiAMMs?: Map<MultiAMMItemType, AutomatedMarketMaker>;
  /** Per-enterprise ledger for this iteration — updated by WORK_AT_ENTERPRISE. */
  enterpriseLedger?: Map<string, EnterpriseLedger>;
}): { wealthDelta: number; healthDelta: number; happinessDelta: number; cortisolDelta: number } {
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
  } = params;
  const economyDelta = { wealthDelta: 0, healthDelta: 0, happinessDelta: 0, cortisolDelta: 0 };
  const getNumber = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  switch (action.actionCode) {
    case 'FOUND_ENTERPRISE': {
      // Require 40 Wealth to start a private enterprise (lowered from 100).
      const FOUNDING_COST = 40;
      const currentWealth = agent.currentStats.wealth + economyDelta.wealthDelta;
      if (currentWealth < FOUNDING_COST) {
        state.failedActionCount++;
        state.events.push(`FOUND_ENTERPRISE failed: need ${FOUNDING_COST} Wealth (have ${Math.round(currentWealth)})`);
        break;
      }
      const industry = String(action.parameters.industry ?? `${agent.role}_enterprise`);
      const enterpriseId = `e-${agent.id.slice(0, 8)}-${iterationNumber}`;
      // Map industry string to EnterpriseSector for production engine
      const sectorFromIndustry = (ind: string): import('@policylab/shared').EnterpriseSector => {
        const lower = ind.toLowerCase();
        if (lower.includes('food') || lower.includes('agri') || lower.includes('farm')) return 'agriculture';
        if (lower.includes('service') || lower.includes('luxury')) return 'services';
        if (lower.includes('gov')) return 'government';
        return 'industry'; // default: manufacturing
      };
      if (!enterpriseRegistry.has(enterpriseId)) {
        enterpriseRegistry.set(enterpriseId, {
          id: enterpriseId,
          ownerId: agent.id,
          ownerName: agent.name,
          industry,
          sector: sectorFromIndustry(industry),
          employees: new Set(),
          applicants: new Set(),
          wage: 0,
          minSkill: 0,
          capacity: 20, // Phase 12 default — downstream plan 12-02 populates
          lastApplicants: 0, // Phase 12 D-03 — populated by matching pass
          lastVacancies: 0,  // Phase 12 D-03 — populated by matching pass
        });
        economyDelta.wealthDelta -= FOUNDING_COST;
        // SFC fix: Registration fee goes to state treasury instead of injecting into
        // AMM (which would mutate k and distort the trading curve). The fiat stays in
        // the closed-loop economy and funds future WORK wages and system purchases.
        {
          const treasury = sessionStateTreasury.get(params.sessionId) ?? 0;
          sessionStateTreasury.set(params.sessionId, treasury + FOUNDING_COST);
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
        // All enterprises are private: add to applicant pool for owner to review via HIRE_EMPLOYEE
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

      // Strict validation: agent must be formally employed at this enterprise.
      // APPLY_FOR_JOB is the ONLY way to obtain employment. Direct WORK_AT_ENTERPRISE
      // without a valid contract is silently rejected (no auto-hire bypass).
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
          // Phase D: owner management skill provides an organizational efficiency multiplier
          const ownerManagementLevel = ownerState?.skills['management']?.level ?? 10;
          const ownerManagementBonus = getSkillMultiplier(ownerManagementLevel);
          const baseQty = getActionMultiplier(state.skills, 'WORK_AT_ENTERPRISE');
          const producedQty = Math.max(1, Math.round(baseQty * ownerManagementBonus));

          // Phase A: sell produced goods directly to AMM for instant fiat liquidity
          // instead of adding to owner inventory (eliminates Inventory-Cash Gap)
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
              // AMM saturated — fall back to inventory so production isn't lost
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

          // Phase B: record revenue in enterprise ledger for owner feedback injection
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
      // Agricultural Yield Rule: 1 farmer must feed ≥ 4 people.
      // MET cost ≈ ceil(4.5) = 5 food/iter per agent → 4 people × 5 = 20 food per farmer.
      // Baseline 20 food gives 20/4.5 = 4.44× surplus over the farmer's own caloric cost.
      const BASE_PRODUCE_QUANTITY = 20;
      const skillMult = getActionMultiplier(state.skills, 'PRODUCE_AND_SELL');
      const quantity = Math.max(BASE_PRODUCE_QUANTITY, getNumber(action.parameters.quantity, Math.round(BASE_PRODUCE_QUANTITY * skillMult)));
      const price = Math.max(1, getNumber(action.parameters.price, 5));
      if (itemType === 'food' && amm) {
        // Food production → sell directly to AMM pool (instant liquidity)
        const receipt = amm.executeSell(quantity, iterationNumber);
        if (receipt.success) {
          const fiatReceived = 'fiatOut' in receipt.quote ? receipt.quote.fiatOut : 0;
          economyDelta.wealthDelta += fiatReceived;
          const effectivePrice = 'effectivePrice' in receipt.quote ? receipt.quote.effectivePrice.toFixed(2) : price.toString();
          state.events.push(`Produced ${quantity} food → sold to market at ${effectivePrice}/unit (+${fiatReceived} fiat)`);
          state.caloriesProduced += quantity;
        } else {
          // AMM pool saturated — keep food in inventory
          state.inventory.food.quantity += quantity;
          state.caloriesProduced += quantity;
          state.events.push(`Produced ${quantity} food (market saturated — kept in inventory)`);
        }
      } else {
        // Non-food: try multi-commodity AMM first for instant liquidity
        const commodityAMMProduce = multiAMMs?.get(itemType as MultiAMMItemType);
        if (commodityAMMProduce) {
          const receipt = commodityAMMProduce.executeSell(quantity, iterationNumber);
          if (receipt.success) {
            const fiatReceived = 'fiatOut' in receipt.quote ? receipt.quote.fiatOut : 0;
            economyDelta.wealthDelta += fiatReceived;
            const effectivePrice = 'effectivePrice' in receipt.quote ? receipt.quote.effectivePrice.toFixed(2) : price.toString();
            state.events.push(`Produced ${quantity} ${itemType} → sold to AMM at ${effectivePrice}/unit (+${fiatReceived} fiat)`);
          } else {
            // AMM saturated — list on order book
            orderBook.submitOrder({ sessionId: params.sessionId, agentId: agent.id, side: 'sell', itemType, price, quantity, iterationPlaced: iterationNumber });
            state.events.push(`Produced and listed ${quantity} ${itemType} at ${price} (AMM saturated)`);
          }
        } else {
          orderBook.submitOrder({
            sessionId: params.sessionId,
            agentId: agent.id,
            side: 'sell',
            itemType,
            price,
            quantity,
            iterationPlaced: iterationNumber,
          });
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
        // Buy food directly from AMM pool
        const fiatToSpend = price * quantity;
        const agentCurrentWealth = agent.currentStats.wealth + economyDelta.wealthDelta;
        if (agentCurrentWealth <= 0) {
          state.events.push(`RECEIPT: FAILED — Insufficient wealth. Need ${fiatToSpend} fiat, have ${Math.round(agentCurrentWealth)}.`);
          state.failedActionCount++;
        } else {
          const affordableFiat = Math.min(fiatToSpend, agentCurrentWealth);
          const currentSpot = amm.spotPrice;
          // Step 1: preview how much food affordableFiat would buy (no state mutation)
          const preview = amm.quoteBuy(affordableFiat);
          if (!preview.executable) {
            state.events.push(`RECEIPT: FAILED — Food buy rejected. Bid ${price}/unit, AMM spot ${currentSpot.toFixed(2)}/unit. Reason: ${preview.rejectReason}`);
            state.failedActionCount++;
          } else {
            // Step 2: floor to integer food units (agents can't hold fractional food)
            const foodReceived = Math.floor(preview.foodOut);
            if (foodReceived <= 0) {
              state.events.push(`RECEIPT: FAILED — Bid too low to purchase even 1 food unit (AMM spot ${currentSpot.toFixed(2)}).`);
              state.failedActionCount++;
            } else {
              // Step 3: compute EXACT fiat cost for precisely foodReceived integer units
              const exactFiat = amm.fiatCostForFood(foodReceived);
              if (exactFiat === null || exactFiat > agentCurrentWealth) {
                state.events.push(`RECEIPT: FAILED — Cannot afford ${foodReceived} food (need ${exactFiat?.toFixed(2) ?? '?'} fiat).`);
                state.failedActionCount++;
              } else {
                // Step 4: execute for exact amount — no fractional remainder leak
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
        // Non-food: try multi-commodity AMM first (guaranteed liquidity)
        const commodityAMM = multiAMMs?.get(itemType as MultiAMMItemType);
        if (commodityAMM) {
          const fiatCost = commodityAMM.fiatCostForFood(quantity);
          const agentCurrentWealth = agent.currentStats.wealth + economyDelta.wealthDelta;
          if (fiatCost !== null && agentCurrentWealth >= fiatCost) {
            const receipt = commodityAMM.executeBuy(fiatCost, iterationNumber);
            if (receipt.success) {
              const buyQuote = receipt.quote as import('../mechanics/automatedMarketMaker.js').BuyQuote;
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
        // Sell food directly to AMM pool
        if (state.inventory.food.quantity >= quantity) {
          state.inventory.food.quantity -= quantity;
          const receipt = amm.executeSell(quantity, iterationNumber);
          if (receipt.success) {
            const fiatReceived = 'fiatOut' in receipt.quote ? receipt.quote.fiatOut : 0;
            economyDelta.wealthDelta += fiatReceived;
            const effectivePrice = 'effectivePrice' in receipt.quote ? receipt.quote.effectivePrice.toFixed(2) : price.toString();
            state.events.push(`Sold ${quantity} food to market at ${effectivePrice}/unit (+${fiatReceived} fiat)`);
          } else {
            state.inventory.food.quantity += quantity; // restore on failure
            state.events.push(`Food sell failed: ${receipt.rejectReason}`);
          }
        }
      } else {
        // Non-food: try multi-commodity AMM first (guaranteed liquidity)
        const commodityAMMSell = multiAMMs?.get(itemType as MultiAMMItemType);
        if (commodityAMMSell && state.inventory[itemType as keyof typeof state.inventory].quantity >= quantity) {
          const receipt = commodityAMMSell.executeSell(quantity, iterationNumber);
          if (receipt.success) {
            const sellQuote = receipt.quote as import('../mechanics/automatedMarketMaker.js').SellQuote;
            state.inventory[itemType as keyof typeof state.inventory].quantity -= quantity;
            economyDelta.wealthDelta += sellQuote.fiatOut;
            state.events.push(`Sold ${quantity} ${itemType} to AMM for ${sellQuote.fiatOut.toFixed(1)} fiat (spot: ${sellQuote.spotPriceBefore.toFixed(2)})`);
          } else {
            // AMM rejected — fall back to order book
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
