import { describe, expect, it } from 'vitest';
import type { Agent, EconomyConfig } from '@policylab/shared';
import { DEFAULT_ECONOMY_CONFIG } from '@policylab/shared';
import { buildNaturalIntentPrompt } from '../llm/prompts.js';
import { resolveAction } from '../mechanics/physicsEngine.js';
import { computeInflation } from '../mechanics/inflationEngine.js';
import { AutomatedMarketMaker } from '../mechanics/automatedMarketMaker.js';

function makeAgent(id: string, role: Agent['role'] = 'farmer', wealth = 100): Agent {
  return {
    id,
    sessionId: 'inflation-test-session',
    name: id,
    role,
    background: `${role} background`,
    initialStats: { wealth, health: 70, happiness: 60, cortisol: 20, dopamine: 50 },
    currentStats: { wealth, health: 70, happiness: 60, cortisol: 20, dopamine: 50 },
    isAlive: true,
    status: 'alive',
    type: role === 'bank' ? 'bank' : 'citizen',
    bornAtIteration: null,
    diedAtIteration: null,
  };
}

function makeEconomyConfig(overrides: Partial<EconomyConfig> = {}): EconomyConfig {
  return {
    ...DEFAULT_ECONOMY_CONFIG,
    bankingEnabled: true,
    reserveRequirement: 0.1,
    baseLoanInterestRate: 0.005,
    defaultLoanTermIterations: 20,
    defaultThresholdIterations: 3,
    depositInterestRate: 0.002,
    inflationEnabled: true,
    cpiBasePrices: {
      food: 100,
      tools: 100,
      luxury_goods: 100,
      raw_materials: 100,
    },
    ...overrides,
  };
}

function computeSystemFiatTotal(agentWealth: number, amm: AutomatedMarketMaker): number {
  return agentWealth + amm.currentFiatReserve;
}

function applyAmmFeedback(amm: AutomatedMarketMaker, factor: number): void {
  if (Math.abs(factor - 1) <= 0.001) return;
  if (factor > 1) {
    amm.withdrawGoodsReserve(amm.currentFoodReserve * (1 - 1 / factor));
    return;
  }
  amm.injectGoodsReserve(amm.currentFoodReserve * ((1 / factor) - 1));
}

describe('sfcInflation', () => {
  it('computes CPI from market prices using the Laspeyres basket', () => {
    const result = computeInflation({
      iterationNumber: 2,
      currentPrices: { food: 200, tools: 100, luxury_goods: 100, raw_materials: 100 },
      basePrices: { food: 100, tools: 100, luxury_goods: 100, raw_materials: 100 },
      m1Current: 1000,
      m1Previous: 1000,
      previousCpi: 100,
      recentCpiHistory: [100],
      economyConfig: makeEconomyConfig(),
    });

    expect(result.cpi).toBeCloseTo(140, 5);
    expect(result.inflationRate).toBeCloseTo(40, 5);
  });

  it('anchors base prices at 100 on iteration 1 and increases correctly on iteration 2', () => {
    const iterationOne = computeInflation({
      iterationNumber: 1,
      currentPrices: { food: 100, tools: 100, luxury_goods: 100, raw_materials: 100 },
      basePrices: { food: 100, tools: 100, luxury_goods: 100, raw_materials: 100 },
      m1Current: 1000,
      m1Previous: null,
      previousCpi: null,
      recentCpiHistory: [],
      economyConfig: makeEconomyConfig(),
    });
    const iterationTwo = computeInflation({
      iterationNumber: 2,
      currentPrices: { food: 120, tools: 100, luxury_goods: 100, raw_materials: 100 },
      basePrices: { food: 100, tools: 100, luxury_goods: 100, raw_materials: 100 },
      m1Current: 1000,
      m1Previous: 1000,
      previousCpi: iterationOne.cpi,
      recentCpiHistory: [iterationOne.cpi],
      economyConfig: makeEconomyConfig(),
    });

    expect(iterationOne.cpi).toBe(100);
    expect(iterationTwo.cpi).toBeCloseTo(108, 5);
  });

  it('preserves SFC when AMM inflation feedback scales reserves', () => {
    const agentWealth = 500;
    const amm = new AutomatedMarketMaker(1000, 200, 0);
    const before = computeSystemFiatTotal(agentWealth, amm);

    applyAmmFeedback(amm, 1.02);

    const after = computeSystemFiatTotal(agentWealth, amm);
    expect(after).toBeCloseTo(before, 5);
    expect(amm.spotPrice).toBeGreaterThan(5);
  });

  it('does not adjust AMM when inflation stays below threshold', () => {
    const result = computeInflation({
      iterationNumber: 2,
      currentPrices: { food: 100.1, tools: 100, luxury_goods: 100, raw_materials: 100 },
      basePrices: { food: 100, tools: 100, luxury_goods: 100, raw_materials: 100 },
      m1Current: 1000,
      m1Previous: 1000,
      previousCpi: 100,
      recentCpiHistory: [100, 100.1],
      economyConfig: makeEconomyConfig(),
    });

    expect(result.ammFeedbackFactor).toBe(1);
  });

  it('clamps SET_RESERVE_RATIO to [0.05, 0.50]', () => {
    const centralBank = makeAgent('cb', 'central_bank');
    const outputHigh = resolveAction({
      agent: centralBank,
      actionCode: 'SET_RESERVE_RATIO',
      actionParameters: { value: 0.8 },
      allAgents: [centralBank],
    });
    const outputLow = resolveAction({
      agent: centralBank,
      actionCode: 'SET_RESERVE_RATIO',
      actionParameters: { value: 0.02 },
      allAgents: [centralBank],
    });

    expect(outputHigh.policyValue).toBe(0.5);
    expect(outputLow.policyValue).toBe(0.05);
  });

  it('clamps SET_BASE_RATE to [0.001, 0.05]', () => {
    const centralBank = makeAgent('cb', 'central_bank');
    const outputHigh = resolveAction({
      agent: centralBank,
      actionCode: 'SET_BASE_RATE',
      actionParameters: { value: 0.5 },
      allAgents: [centralBank],
    });
    const outputLow = resolveAction({
      agent: centralBank,
      actionCode: 'SET_BASE_RATE',
      actionParameters: { value: 0.0001 },
      allAgents: [centralBank],
    });

    expect(outputHigh.policyValue).toBe(0.05);
    expect(outputLow.policyValue).toBe(0.001);
  });

  it('smooths inflation expectations over the recent CPI window', () => {
    const result = computeInflation({
      iterationNumber: 4,
      currentPrices: { food: 133.1, tools: 100, luxury_goods: 100, raw_materials: 100 },
      basePrices: { food: 100, tools: 100, luxury_goods: 100, raw_materials: 100 },
      m1Current: 1030,
      m1Previous: 1020,
      previousCpi: 121,
      recentCpiHistory: [100, 110, 121],
      economyConfig: makeEconomyConfig(),
    });

    expect(result.inflationExpectations).toBeCloseTo(10, 5);
  });

  it('keeps the inflationContext prompt fragment short and includes CPI', () => {
    const inflationContext = 'Economic conditions: CPI is 104.2 (up 4.2% from base). Inflation running at 4.2% this period. Consider adjusting wage demands or consumption strategy.';
    const messages = buildNaturalIntentPrompt(
      makeAgent('citizen-1'),
      { idea: 'Test society', societyOverview: 'Overview', law: 'Law', timeScale: '1 week' },
      null,
      2,
      undefined,
      undefined,
      false,
      ['citizen-1'],
      ['WORK'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      inflationContext,
      undefined,
    );

    const promptText = JSON.stringify(messages);
    expect(inflationContext.split(/\s+/).length).toBeLessThan(60);
    expect(promptText).toContain('CPI is 104.2');
  });

  it('maintains SFC stability over five inflation-adjusted iterations', () => {
    const amm = new AutomatedMarketMaker(1000, 200, 0);
    const baseline = computeSystemFiatTotal(500, amm);
    const config = makeEconomyConfig({ inflationAmmThreshold: 0.5, inflationAmmCap: 2.0 });
    const cpiSeries = [100, 102, 104, 106, 108];

    for (let i = 1; i < cpiSeries.length; i++) {
      const result = computeInflation({
        iterationNumber: i + 1,
        currentPrices: {
          food: cpiSeries[i],
          tools: 100,
          luxury_goods: 100,
          raw_materials: 100,
        },
        basePrices: { food: 100, tools: 100, luxury_goods: 100, raw_materials: 100 },
        m1Current: 1000 + i * 10,
        m1Previous: 1000 + (i - 1) * 10,
        previousCpi: cpiSeries[i - 1],
        recentCpiHistory: cpiSeries.slice(0, i),
        economyConfig: config,
      });
      applyAmmFeedback(amm, result.ammFeedbackFactor);
    }

    expect(computeSystemFiatTotal(500, amm)).toBeCloseTo(baseline, 2);
  });
});
