import { describe, it, expect } from 'vitest';
import {
  EconomyConfig,
  DEFAULT_ECONOMY_CONFIG,
  LoanContract,
  DepositAccount,
  BankBalanceSheet,
  TelemetryLog,
} from '@policylab/shared';
import { getEconomyConfig } from '../mechanics/economyConfigUtils.js';

describe('EconomyConfig type and DEFAULT_ECONOMY_CONFIG', () => {
  it('DEFAULT_ECONOMY_CONFIG has bankingEnabled=true', () => {
    expect(DEFAULT_ECONOMY_CONFIG.bankingEnabled).toBe(true);
  });

  it('DEFAULT_ECONOMY_CONFIG has reserveRequirement=0.10', () => {
    expect(DEFAULT_ECONOMY_CONFIG.reserveRequirement).toBe(0.10);
  });

  it('DEFAULT_ECONOMY_CONFIG has baseLoanInterestRate=0.005', () => {
    expect(DEFAULT_ECONOMY_CONFIG.baseLoanInterestRate).toBe(0.005);
  });

  it('DEFAULT_ECONOMY_CONFIG has defaultLoanTermIterations=20', () => {
    expect(DEFAULT_ECONOMY_CONFIG.defaultLoanTermIterations).toBe(20);
  });

  it('DEFAULT_ECONOMY_CONFIG has defaultThresholdIterations=3', () => {
    expect(DEFAULT_ECONOMY_CONFIG.defaultThresholdIterations).toBe(3);
  });

  it('DEFAULT_ECONOMY_CONFIG has depositInterestRate=0.002', () => {
    expect(DEFAULT_ECONOMY_CONFIG.depositInterestRate).toBe(0.002);
  });

  it('EconomyConfig type has all 6 required banking fields', () => {
    const config: EconomyConfig = {
      bankingEnabled: true,
      reserveRequirement: 0.10,
      baseLoanInterestRate: 0.005,
      defaultLoanTermIterations: 20,
      defaultThresholdIterations: 3,
      depositInterestRate: 0.002,
    };
    expect(config).toBeDefined();
    expect(config.bankingEnabled).toBe(true);
    expect(config.reserveRequirement).toBe(0.10);
    expect(config.baseLoanInterestRate).toBe(0.005);
    expect(config.defaultLoanTermIterations).toBe(20);
    expect(config.defaultThresholdIterations).toBe(3);
    expect(config.depositInterestRate).toBe(0.002);
  });
});

describe('getEconomyConfig', () => {
  it('returns bankingEnabled=false for null input', () => {
    const result = getEconomyConfig(null);
    expect(result.bankingEnabled).toBe(false);
  });

  it('returns bankingEnabled=false for empty object', () => {
    const result = getEconomyConfig({});
    expect(result.bankingEnabled).toBe(false);
  });

  it('merges partial config with defaults and preserves overrides', () => {
    const result = getEconomyConfig({
      economyConfig: { bankingEnabled: true, reserveRequirement: 0.15 },
    });
    expect(result.bankingEnabled).toBe(true);
    expect(result.reserveRequirement).toBe(0.15);
    // Other fields fall back to defaults
    expect(result.baseLoanInterestRate).toBe(0.005);
    expect(result.defaultLoanTermIterations).toBe(20);
    expect(result.defaultThresholdIterations).toBe(3);
    expect(result.depositInterestRate).toBe(0.002);
  });

  it('returns full default config (with bankingEnabled=true) when economyConfig provided without overrides', () => {
    const result = getEconomyConfig({ economyConfig: {} });
    expect(result.reserveRequirement).toBe(0.10);
    expect(result.baseLoanInterestRate).toBe(0.005);
  });
});

describe('LoanContract type shape', () => {
  it('LoanContract can be instantiated with all required fields', () => {
    const loan: LoanContract = {
      id: 'loan-1',
      sessionId: 'session-1',
      borrowerAgentId: 'agent-1',
      lenderAgentId: 'agent-2',
      principal: 100,
      interestRate: 0.005,
      termIterations: 20,
      remainingBalance: 100,
      collateralAmount: 0,
      consecutiveMissed: 0,
      issuedAtIteration: 1,
      dueAtIteration: 21,
      status: 'active',
      createdAt: '2026-04-01T00:00:00Z',
    };
    expect(loan.id).toBe('loan-1');
    expect(loan.borrowerAgentId).toBe('agent-1');
    expect(loan.status).toBe('active');
  });
});

describe('DepositAccount type shape', () => {
  it('DepositAccount can be instantiated with all required fields', () => {
    const account: DepositAccount = {
      id: 'acct-1',
      sessionId: 'session-1',
      ownerAgentId: 'agent-1',
      bankAgentId: 'agent-bank',
      accountType: 'demand',
      balance: 500,
      interestRate: 0.002,
      lastUpdated: 1,
    };
    expect(account.id).toBe('acct-1');
    expect(account.accountType).toBe('demand');
    expect(account.balance).toBe(500);
  });
});

describe('BankBalanceSheet type shape', () => {
  it('BankBalanceSheet can be instantiated with all required fields', () => {
    const sheet: BankBalanceSheet = {
      id: 'bbs-1',
      sessionId: 'session-1',
      agentId: 'bank-agent-1',
      iterationNumber: 5,
      reserves: 200,
      loanAssets: 800,
      depositLiabilities: 1000,
      equity: 0,
      timestamp: '2026-04-01T00:00:00Z',
    };
    expect(sheet.id).toBe('bbs-1');
    expect(sheet.reserves).toBe(200);
    expect(sheet.equity).toBe(0);
  });
});

describe('TelemetryLog optional banking fields', () => {
  it('TelemetryLog accepts optional m0, m1, loansOutstanding fields', () => {
    const log: TelemetryLog = {
      iterationNumber: 1,
      totalFiatSupply: 10000,
      ammFoodReserve_Y: 500,
      ammFiatReserve_X: 2000,
      ammSpotPrice_Food: 4,
      totalCaloriesBurned: 100,
      totalCaloriesProduced: 120,
      actionFailureRate: 0.05,
      m0: 10000,
      m1: 11500,
      loansOutstanding: 1500,
    };
    expect(log.m0).toBe(10000);
    expect(log.m1).toBe(11500);
    expect(log.loansOutstanding).toBe(1500);
  });

  it('TelemetryLog works without optional banking fields', () => {
    const log: TelemetryLog = {
      iterationNumber: 1,
      totalFiatSupply: 10000,
      ammFoodReserve_Y: 500,
      ammFiatReserve_X: 2000,
      ammSpotPrice_Food: 4,
      totalCaloriesBurned: 100,
      totalCaloriesProduced: 120,
      actionFailureRate: 0.05,
    };
    expect(log.m0).toBeUndefined();
    expect(log.m1).toBeUndefined();
    expect(log.loansOutstanding).toBeUndefined();
  });
});
