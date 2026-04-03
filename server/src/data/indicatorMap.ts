/**
 * World Bank Open Data API v2 indicator code mappings.
 * Source: https://data.worldbank.org/indicator
 *
 * All indicator codes used by the location data service are defined here.
 * Never hardcode indicator codes inline — always reference WB_INDICATORS.
 */

export const WB_INDICATORS = {
  // ── Demographics ──────────────────────────────────────────────────────────
  population: 'SP.POP.TOTL',
  populationGrowth: 'SP.POP.GROW',
  urbanPopulationPct: 'SP.URB.TOTL.IN.ZS',
  lifeExpectancy: 'SP.DYN.LE00.IN',
  ageDepRatio: 'SP.POP.DPND',

  // ── Employment / Sector ───────────────────────────────────────────────────
  unemployment: 'SL.UEM.TOTL.ZS',
  employmentAgriculture: 'SL.AGR.EMPL.ZS',
  employmentIndustry: 'SL.IND.EMPL.ZS',
  employmentServices: 'SL.SRV.EMPL.ZS',
  laborForceParticipation: 'SL.TLF.CACT.ZS',

  // ── Economic ──────────────────────────────────────────────────────────────
  gdpPerCapita: 'NY.GDP.PCAP.CD',
  gdpGrowth: 'NY.GDP.MKTP.KD.ZG',
  giniIndex: 'SI.POV.GINI',
  inflationCPI: 'FP.CPI.TOTL.ZG',
  realInterestRate: 'FR.INR.RINR',

  // ── Banking / Interest Rates ─────────────────────────────────────────────
  lendingInterestRate: 'FR.INR.LEND',   // Commercial bank lending rate (annual %)
  depositInterestRate: 'FR.INR.DPST',   // Commercial bank deposit rate (annual %)
  interestRateSpread: 'FR.INR.LNDP',    // Lending rate minus deposit rate (pp)
  stockMarketCap: 'CM.MKT.LCAP.GD.ZS', // Stock market cap % GDP (capital markets maturity proxy)

  // ── Fiscal ────────────────────────────────────────────────────────────────
  taxRevenuePctGdp: 'GC.TAX.TOTL.GD.ZS',
  govExpensePctGdp: 'GC.XPN.TOTL.GD.ZS',
  militaryExpPctGdp: 'MS.MIL.XPND.GD.ZS',
  healthExpPctGdp: 'SH.XPD.CHEX.GD.ZS',
  educationExpPctGdp: 'SE.XPD.TOTL.GD.ZS',
  govDebtPctGdp: 'GC.DOD.TOTL.GD.ZS',  // Central gov debt % GDP (bond yield proxy)

  // ── Infrastructure ────────────────────────────────────────────────────────
  electricityAccess: 'EG.ELC.ACCS.ZS',
  internetUsers: 'IT.NET.USER.ZS',
  renewableEnergyPct: 'EG.FEC.RNEW.ZS',
} as const;

/** All indicator codes joined by semicolons for multi-indicator batch queries. */
export const ALL_INDICATOR_CODES = Object.values(WB_INDICATORS).join(';');

export type IndicatorKey = keyof typeof WB_INDICATORS;
