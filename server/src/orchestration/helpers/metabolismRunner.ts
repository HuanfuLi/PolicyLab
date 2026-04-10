import {
  runFullMetabolicTick,
  getMetCategory,
} from '../../mechanics/allostaticEngine.js';
import { sessionAMMRegistry, getEnterpriseRegistry } from '../simulationState.js';
import type { AgentWeekState } from './weekState.js';

/**
 * MET-based weekly metabolism — replaces flat -1 food deduction.
 *
 * Satiety cost is now aggregated across ALL actions in the agent's weekly queue
 * (BUG-06 / REL-03).  Previously only the primary (first) action was billed,
 * which under-charged agents that performed multiple high-intensity actions and
 * broke the SFC food-supply balance.
 *
 *   REST / cognitive actions: ~1 food/week each
 *   WORK_MODERATE_MANUAL:     ~4.5 food/week each
 *   WORK_HEAVY_MANUAL:        ~7.25 food/week each
 *
 * Luxury goods are consumed here to reduce Cortisol before the starvation check.
 */
export function applyMETMetabolism(
  state: AgentWeekState,
  agent: { id: string; role: string; age?: number; weightKg?: number; currentWealth: number },
  sessionId: string,
  iterationNumber: number,
): void {
  // ── Luxury services: consume 1 unit to sharply reduce Cortisol ──────────
  if (state.inventory.luxury_goods.quantity > 0) {
    state.inventory.luxury_goods.quantity -= 1;
    state.cortisolDelta -= 20;
    state.happinessDelta += 5;
    state.events.push('Enjoyed luxury services — stress reduced');
  }

  // ── Determine enterprise industry for MET lookup ─────────────────────────
  const enterpriseIndustry = (() => {
    const enterprises = getEnterpriseRegistry(sessionId);
    for (const ent of enterprises.values()) {
      if (ent.employees.has(agent.id)) return ent.industry;
    }
    return undefined;
  })();

  // ── Aggregate MET satiety cost across ALL actions in the queue (BUG-06) ──
  // If no actions were executed, fall back to a minimal REST-equivalent cost.
  const actionsToMeter = state.executedActions.length > 0
    ? state.executedActions
    : [{ actionCode: 'NONE' as const }];

  let totalSatietyCost = 0;
  let primaryMetCategory = 'rest'; // for event logging
  for (let i = 0; i < actionsToMeter.length; i++) {
    const metCategory = getMetCategory(actionsToMeter[i].actionCode, agent.role, enterpriseIndustry);
    if (i === 0) primaryMetCategory = metCategory;
    const metResult = runFullMetabolicTick({
      cortisol: 0, // cortisol processed separately in allostatic loop
      weightKg: agent.weightKg ?? 70,
      age: agent.age ?? 35,
      metCategory,
      allostaticState: { allostaticStrain: 0, allostaticLoad: 0 }, // allostatic handled separately
    });
    totalSatietyCost += metResult.satietyCost;
  }

  // Keep fractional — rounding here destroys 0.1-0.3 fiat per agent per iteration.
  // Math.ceil would charge agents up to 2× for fractional costs (e.g. 1.05 → 2).
  const satietyCost = Math.max(1, totalSatietyCost);
  const metCategory = primaryMetCategory;

  // ── Fulfill metabolic demand: inventory first, then AMM auto-buy, then penalties ──
  // Order matters: attempt auto-buy BEFORE applying starvation penalties so agents
  // with wealth are never penalised for a gap that the market can immediately cover.
  state.caloriesBurned += satietyCost;

  let foodToConsume = satietyCost;

  // Step 1: eat from inventory
  const foodFromInventory = Math.min(state.inventory.food.quantity, foodToConsume);
  state.inventory.food.quantity -= foodFromInventory;
  foodToConsume -= foodFromInventory;

  // Step 2: if still hungry, auto-buy the remaining deficit from the AMM.
  // If the AMM can't fill the full request (low reserves), fall back to buying
  // the maximum available so agents aren't forced into full starvation when
  // partial food is on offer.
  let foodFromAMM = 0;
  if (foodToConsume > 0) {
    const ammForAutoEat = sessionAMMRegistry.get(sessionId);
    if (ammForAutoEat) {
      const availableWealth = agent.currentWealth + state.wealthDelta;
      const maxBuyable = ammForAutoEat.maxBuyableFood();

      // Cascading fallback: try decreasing amounts until one is affordable and executable.
      // This prevents starvation when the agent has some wealth but can't afford full need.
      const amountsToTry = [
        foodToConsume,                          // First: full request
        Math.min(foodToConsume, maxBuyable),    // Second: limited by AMM reserves
        Math.max(0.5, maxBuyable * 0.5),        // Third: half of max available
        maxBuyable * 0.25,                      // Fourth: quarter
        0.1,                                    // Fifth: tiny amount
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
            break;  // CRITICAL: exit on first success to prevent multi-purchase
          }
        }
      }
    }
  }

  // Step 3: apply penalties only for what remains unfulfilled after auto-buy
  if (foodToConsume <= 0) {
    // Fully fed
    const ammNote = foodFromAMM > 0 ? ', AMM top-up' : '';
    state.events.push(`Consumed ${satietyCost} food (${metCategory}×${actionsToMeter.length} actions${ammNote})`);
  } else if (foodToConsume < satietyCost) {
    // Partial nutrition — scale penalties to actual deficit fraction
    const deficitRatio = foodToConsume / satietyCost;
    state.healthDelta -= 5 * deficitRatio;
    state.cortisolDelta += 8 * deficitRatio;
    state.events.push(`Partial nutrition: ${(satietyCost - foodToConsume).toFixed(0)}/${satietyCost} food (hungry)`);
  } else {
    // Full starvation — no food from any source
    state.healthDelta -= 10;
    state.cortisolDelta += 15;
    state.events.push('Starvation — no food available');
  }
}
