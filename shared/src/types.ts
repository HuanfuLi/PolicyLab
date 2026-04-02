// Core stage progression per spec. Implementation may include sub-stages.
export type Stage =
  | 'idea-input'
  | 'brainstorming'
  | 'designing'
  | 'design-review'
  | 'refining'
  | 'simulating'
  | 'simulation-paused'
  | 'simulation-complete'
  | 'reflecting'
  | 'reflection-complete'
  | 'reviewing'
  | 'completed';

/** @alias Stage — kept for backward compat */
export type SessionStage = Stage;

/** Chat context: 'brainstorm' during Stage 1A, 'refinement' during Stage 1C,
 *  'review:<agentId>' during Stage 4 agent Q&A. */
export type ChatContext = 'brainstorm' | 'refinement' | `review:${string}`;

export interface Session {
  id: string;
  /** Society display name (auto-generated from brainstorm or user-provided) */
  title: string;
  /** Raw user idea entered at Stage 0 */
  idea: string;
  stage: Stage;
  config: Record<string, unknown> | null;
  law: string | null;
  societyOverview: string | null;
  timeScale: string | null;
  societyEvaluation: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface SessionMetadata {
  id: string;
  title: string;
  idea: string;
  stage: Stage;
  agentCount: number;
  totalIterations: number;
  completedIterations: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentStats {
  wealth: number;
  health: number;
  happiness: number;
  cortisol: number;    // 0-100, hidden stress level
  dopamine: number;    // 0-100, hidden satisfaction
}

export interface Agent {
  id: string;
  sessionId: string;
  name: string;
  role: string;
  background: string;
  /** Stats at creation (never changes after design) */
  initialStats: AgentStats;
  /** Current stats, updated each iteration */
  currentStats: AgentStats;
  /** Convenience alias: currentStats.wealth >= 0 && status === 'alive' */
  isAlive: boolean;
  /** True for the Central Agent */
  isCentralAgent?: boolean;
  /** 'alive' | 'dead' | 'new' — raw DB value */
  status: string;
  /** 'citizen' | 'central' — raw DB value */
  type: string;
  bornAtIteration: number | null;
  diedAtIteration: number | null;
  /** Agent age in years — used by the MET age-inefficiency modifier (physical labour penalty >60). */
  age?: number;
  /** Agent body weight in kg — used by the MET satiety-cost formula (BMR baseline). */
  weightKg?: number;
  /** Reversible accumulated physiological stress — persisted to DB for pause/resume continuity. */
  allostaticStrain?: number;
  /** Irreversible physiological wear accumulating over long stressful simulations. */
  allostaticLoad?: number;
  /** 1–2 immutable personality traits that bias decision-making via prompt context. */
  personalityTraits?: PersonalityTrait[];
}

export type PersonalityTrait =
  | 'risk-tolerant' | 'risk-averse'
  | 'cooperative' | 'competitive'
  | 'authoritarian' | 'libertarian'
  | 'materialistic' | 'idealistic'
  | 'impulsive' | 'calculating'
  | 'empathetic' | 'ruthless';

export const PERSONALITY_TRAITS: PersonalityTrait[] = [
  'risk-tolerant', 'risk-averse',
  'cooperative', 'competitive',
  'authoritarian', 'libertarian',
  'materialistic', 'idealistic',
  'impulsive', 'calculating',
  'empathetic', 'ruthless',
];

/** @alias Agent — kept for backward compat with Phase 1/2 imports */
export type AgentDefinition = Agent;

export interface ChatMessage {
  id: string;
  sessionId: string;
  context: ChatContext | string;
  agentId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

// ── Phase 3 types ──────────────────────────────────────────────────────────

export interface AgentAction {
  id: string;
  iterationId: string;
  agentId: string;
  intent: string;
  resolvedOutcome: string;
  wealthDelta: number;
  healthDelta: number;
  happinessDelta: number;
}

export interface Iteration {
  id: string;
  sessionId: string;
  /** 1-based */
  number: number;
  narrativeSummary: string;
  timestamp: string;
}

/** @alias Iteration — implementation-side record with extra fields */
export interface IterationRecord {
  id: string;
  sessionId: string;
  iterationNumber: number;
  stateSummary: string;
  statistics: Record<string, unknown>;
  lifecycleEvents: unknown[];
  timestamp: string;
}

export interface IterationStats {
  iterationNumber: number;
  avgWealth: number;
  avgHealth: number;
  avgHappiness: number;
  minWealth: number;
  maxWealth: number;
  minHealth: number;
  maxHealth: number;
  minHappiness: number;
  maxHappiness: number;
  aliveCount: number;
  totalCount: number;
  /** Gini coefficient for wealth inequality (0=perfect equality, 1=perfect inequality) */
  giniWealth?: number;
  /** Gini coefficient for happiness inequality */
  giniHappiness?: number;
  /** Society-wide averages for hidden biological signals */
  avgCortisol?: number;
  avgDopamine?: number;
}

export interface SocietyDesign {
  overview: string;
  lawDocument: string;
  agents: Agent[];
  timeScale: string;
}

// ── Phase 4 types ──────────────────────────────────────────────────────────

export interface AgentReflection {
  agentId: string;
  sessionId: string;
  pass1: string;
  /** Phase 5: post-briefing addendum */
  pass2?: string;
}

export interface SocietyEvaluation {
  sessionId: string;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  analysis: string;
}

// ── Phase 5 types ──────────────────────────────────────────────────────────

export interface ComparisonDimension {
  name: string;
  /** Score for session 1, 0–100 */
  score1: number;
  /** Score for session 2, 0–100 */
  score2: number;
  analysis: string;
}

export interface ComparisonResult {
  session1Id: string;
  session2Id: string;
  /** Multi-paragraph prose summary */
  narrative: string;
  dimensions: ComparisonDimension[];
  /** 1-2 sentence takeaway */
  verdict: string;
}

/** Budget categories for fiscal spending allocation */
export type FiscalCategory = 'infrastructure' | 'education' | 'defense' | 'welfare';

/**
 * Per-iteration deterministic economy telemetry.
 * Computed by the physics engine — no LLM inference involved.
 */
export interface TelemetryLog {
  iterationNumber: number;
  /** Sum of all living agent wealth + AMM fiat reserve (unrounded for SFC accuracy) */
  totalFiatSupply: number;
  /** totalFiatSupply rounded for UI display only — do not use in SFC calculations */
  totalFiatSupplyRounded?: number;
  /** AMM food reserve (Y in x·y=k) */
  ammFoodReserve_Y: number;
  /** AMM fiat reserve (X in x·y=k) */
  ammFiatReserve_X: number;
  /** AMM spot price: fiat per food unit */
  ammSpotPrice_Food: number;
  /** Total food units consumed by MET metabolism across all agents */
  totalCaloriesBurned: number;
  /** Total food units produced (via PRODUCE_AND_SELL + sys_farm injection) */
  totalCaloriesProduced: number;
  /** Fraction of actions that explicitly failed/were rejected (0–1) */
  actionFailureRate: number;

  // ── Analytical metrics ──────────────────────────────────────────────────
  /** Gini coefficient: 0 = perfect equality, 1 = one agent holds all wealth */
  giniCoefficient?: number;
  /** Fraction of agents who changed role tier this iteration */
  socialMobilityIndex?: number;
  /** HELP actions / (HELP + STEAL actions). 1 = full cooperation, 0 = full predation */
  trustIndex?: number;
  /** (STEAL + SABOTAGE + EMBEZZLE) / total actions */
  crimeRate?: number;
  /** Population mean cortisol (0–100) */
  averageCortisol?: number;
  /** Population mean dopamine (0–100) */
  averageDopamine?: number;
  /** Base money M0 (should be constant) */
  m0?: number;
  /** M1 = M0 + demand deposits created by lending */
  m1?: number;
  /** Total outstanding loan principals */
  loansOutstanding?: number;
  /** Consumer price index (base = 100) */
  cpi?: number;
  /** Iteration-over-iteration CPI inflation rate in percent */
  inflationRate?: number;
  /** Smoothed inflation expectations signal in percent */
  inflationExpectations?: number;
  /** Central bank base interest rate as of this iteration */
  centralBankRate?: number;
  /** Yield snapshot keyed by bond type at iteration end */
  bondYields?: {
    /** Weighted avg coupon of active government bonds */
    governmentYield?: number;
    /** Weighted avg coupon of active corporate bonds */
    corporateYield?: number;
  };

  // ── Fiscal Policy telemetry ──────────────────────────────────────────────
  /** Infrastructure public goods quality score 0–100 (undefined when fiscal disabled) */
  infrastructureQuality?: number;
  /** Education public goods quality score 0–100 (undefined when fiscal disabled) */
  educationQuality?: number;
  /** Defense public goods quality score 0–100 (undefined when fiscal disabled) */
  defenseQuality?: number;
  /** Welfare public goods quality score 0–100 (undefined when fiscal disabled) */
  welfareQuality?: number;
  /** M2 = M1 + time deposits / savings deposits */
  m2?: number;
  /** Per-category fiscal spending amounts for current iteration */
  fiscalSpending?: Partial<Record<FiscalCategory, number>>;
  /** Current public goods quality score per category (0-1 normalized) */
  publicGoodsQuality?: Partial<Record<FiscalCategory, number>>;
}

/** Full-fidelity export envelope */
export interface SessionExport {
  version: 1;
  exportedAt: string;
  session: Session;
  agents: Agent[];
  iterations: Array<{
    iterationNumber: number;
    stateSummary: string;
    statistics: string;
    lifecycleEvents: string;
    timestamp: string;
  }>;
  reflections: Array<{
    agentId: string | null;
    content: string;
    insights: string | null;
    createdAt: string;
  }>;
  chatMessages: Array<{
    context: string;
    agentId: string | null;
    role: string;
    content: string;
    timestamp: string;
  }>;
  roleChanges: Array<{
    agentId: string;
    fromRole: string;
    toRole: string;
    reason: string | null;
    iterationNumber: number;
    timestamp: string;
  }>;
  /** Deterministic physics telemetry — one snapshot per completed iteration */
  telemetryLogs?: TelemetryLog[];
  /** Banking Foundation: deposit accounts (optional for backward compat with pre-banking exports) */
  depositAccounts?: DepositAccount[];
  /** Banking Foundation: loan contracts (optional for backward compat with pre-banking exports) */
  loanContracts?: LoanContract[];
  /** Banking Foundation: bank balance sheet snapshots (optional for backward compat) */
  bankBalanceSheets?: BankBalanceSheet[];
  /** Capital Markets: equity positions (optional for backward compat) */
  equityPositions?: EquityPosition[];
  /** Capital Markets: bond holdings (optional for backward compat) */
  bondHoldings?: BondHolding[];
  /** Fiscal Policy: active budget allocation (optional for backward compat) */
  fiscalBudget?: BudgetAllocation;
  /** Fiscal Policy: public goods state history (optional for backward compat) */
  publicGoodsState?: PublicGoodsState[];
  /** Inflation Loop: macro snapshots (optional for backward compat) */
  macroSnapshots?: MacroSnapshot[];
}

// ── Settings ───────────────────────────────────────────────────────────────

export interface AppSettings {
  /** LLM provider selection */
  provider: 'claude' | 'openai' | 'gemini' | 'vertex' | 'local';
  /** Active API key — maps to apiKeys[provider]. Kept for backward compat. */
  apiKey: string;
  /** Per-provider API key storage so switching providers doesn't lose keys */
  apiKeys?: Partial<Record<'claude' | 'openai' | 'gemini' | 'vertex', string>>;
  /** GCP parameters for Vertex AI provider */
  vertexProjectId?: string;
  vertexLocation?: string;
  /** Base URL for local/custom OpenAI-compatible providers */
  baseUrl: string;
  centralAgentModel: string;
  citizenAgentModel: string;
  maxConcurrency: number;
  /** Optional separate provider for citizen agent tasks */
  citizenProvider?: 'claude' | 'openai' | 'gemini' | 'vertex' | 'local';
  citizenApiKey?: string;
  citizenBaseUrl?: string;
  citizenVertexProjectId?: string;
  citizenVertexLocation?: string;
  maxMessageLength: number;
}

export interface SettingsResponse {
  provider: AppSettings['provider'];
  hasApiKey: boolean;
  /** Which providers have API keys saved */
  savedApiKeys?: Partial<Record<'claude' | 'openai' | 'gemini' | 'vertex', boolean>>;
  baseUrl: string;
  centralAgentModel: string;
  citizenAgentModel: string;
  maxConcurrency: number;
  citizenProvider?: 'claude' | 'openai' | 'gemini' | 'vertex' | 'local';
  hasCitizenApiKey?: boolean;
  citizenBaseUrl?: string;
  citizenVertexProjectId?: string;
  citizenVertexLocation?: string;
  maxMessageLength: number;
  vertexProjectId?: string;
  vertexLocation?: string;
  apiKeys?: Partial<Record<'claude' | 'openai' | 'gemini' | 'vertex', string>>;
}

export interface TestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  error?: string;
}

// ── Brainstorm / Design helpers ────────────────────────────────────────────

export interface BrainstormChecklist {
  governance: boolean;
  economy: boolean;
  legal: boolean;
  culture: boolean;
  infrastructure: boolean;
}

export interface SessionConfig {
  totalIterations: number;
  checklist: BrainstormChecklist;
  readyForDesign: boolean;
  lockedVariables?: string[];
}

// ── v1.0 Economy Types (Phase 1: Banking Foundation) ─────────────────────
export interface EconomyConfig {
  bankingEnabled: boolean;
  reserveRequirement: number;        // 0.0-1.0, e.g. 0.10
  baseLoanInterestRate: number;      // per-iteration rate, e.g. 0.005
  defaultLoanTermIterations: number; // e.g. 20
  defaultThresholdIterations: number;// consecutive missed before default, e.g. 3
  depositInterestRate: number;       // per-iteration, e.g. 0.002
  capitalMarketsEnabled?: boolean;
  fiscalEnabled?: boolean;
  inflationEnabled?: boolean;
  dividendPayoutRatio?: number;    // fraction of enterprise owner wealth distributed per iteration, e.g. 0.05
  govBondCouponRate?: number;      // per-iteration coupon rate for gov bonds, e.g. 0.008
  govBondTermIterations?: number;  // default bond maturity term in iterations, e.g. 10
  cpiBasketWeights?: CpiBasketWeights;
  m1InflationCoeff?: number;       // blending weight for M1 growth signal, e.g. 0.30
  inflationSmoothingWindow?: number; // rolling mean window, e.g. 3
  productivityGrowthEstimate?: number; // estimated real productivity growth per iteration, e.g. 0.01
  inflationAmmThreshold?: number;  // minimum inflation expectation before AMM feedback triggers, e.g. 0.5
  inflationAmmCap?: number;        // max AMM price change per iteration in percent, e.g. 2.0
  centralBankEnabled?: boolean;
  cpiBasePrices?: Record<string, number>;

  // ── Fiscal policy tuning (Phase 3) ──────────────────────────────────────
  /**
   * Fraction of treasury balance spent per iteration across all budget categories.
   * e.g. 0.10 = 10% of treasury disbursed each tick. Default: 0.10.
   */
  budgetSpendingRate?: number;
  /**
   * Productivity multiplier bonus per infrastructureQuality point.
   * Applied to WORK action output scaling. Default: 0.005.
   */
  infrastructureMultiplier?: number;
  /**
   * Skill gain rate bonus per educationQuality point.
   * Scales learning-by-doing increments. Default: 0.005.
   */
  educationMultiplier?: number;
  /**
   * Enforcement/theft-resistance bonus per defenseQuality point.
   * Reduces STEAL action success probability. Default: 0.003.
   */
  defenseMultiplier?: number;
  /**
   * Direct fiat UBI supplement per welfareQuality point per iteration.
   * Added to the standard demurrage-funded UBI distribution. Default: 0.002.
   */
  welfareMultiplier?: number;
  /**
   * Quality decay applied to all public goods scores per iteration when no spending occurs.
   * Units: quality points per iteration. Default: 0.5.
   */
  publicGoodsDecayRate?: number;
  /**
   * Diminishing returns exponent for public goods quality gains from spending.
   * Applied as: qualityGain = rawSpending^publicGoodsGainDiminishing.
   * Lower values (e.g. 0.7) create sqrt-ish returns. Default: 0.7.
   */
  publicGoodsGainDiminishing?: number;
}

export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  bankingEnabled: true,
  reserveRequirement: 0.10,
  baseLoanInterestRate: 0.005,
  defaultLoanTermIterations: 20,
  defaultThresholdIterations: 3,
  depositInterestRate: 0.002,
  cpiBasketWeights: {
    food: 0.40,
    tools: 0.25,
    luxury_goods: 0.20,
    raw_materials: 0.15,
  },
  m1InflationCoeff: 0.3,
  inflationSmoothingWindow: 3,
  productivityGrowthEstimate: 0.01,
  inflationAmmThreshold: 0.5,
  inflationAmmCap: 2.0,
  centralBankEnabled: false,
  cpiBasePrices: {},
  // Fiscal defaults — active when fiscalEnabled is true
  budgetSpendingRate: 0.10,
  infrastructureMultiplier: 0.005,
  educationMultiplier: 0.005,
  defenseMultiplier: 0.003,
  welfareMultiplier: 0.002,
  publicGoodsDecayRate: 0.5,
  publicGoodsGainDiminishing: 0.7,
};

export interface LoanContract {
  id: string;
  sessionId: string;
  borrowerAgentId: string;
  lenderAgentId: string;
  principal: number;
  interestRate: number;
  termIterations: number;
  remainingBalance: number;
  collateralAmount: number;
  consecutiveMissed: number;
  issuedAtIteration: number;
  dueAtIteration: number;
  status: 'active' | 'repaid' | 'defaulted';
  createdAt: string;
}

export interface DepositAccount {
  id: string;
  sessionId: string;
  ownerAgentId: string;
  bankAgentId: string;
  accountType: 'demand';
  balance: number;
  interestRate: number;
  lastUpdated: number;
}

export interface BankBalanceSheet {
  id: string;
  sessionId: string;
  agentId: string;
  iterationNumber: number;
  reserves: number;
  loanAssets: number;
  depositLiabilities: number;
  equity: number;
  timestamp: string;
}

export interface CpiBasketWeights {
  food: number;
  tools: number;
  luxury_goods: number;
  raw_materials: number;
}

export const DEFAULT_CPI_BASKET_WEIGHTS: CpiBasketWeights = {
  food: 0.40,
  tools: 0.25,
  luxury_goods: 0.20,
  raw_materials: 0.15,
};

export interface MacroSnapshot {
  id: string;
  sessionId: string;
  iterationNumber: number;
  m0: number;
  m1: number;
  cpi: number;
  inflationRate: number;
  inflationExpectations: number;
  totalLoansOutstanding: number;
  treasuryBalance: number;
  timestamp: string;
}

export interface InflationState {
  cpi: number;
  inflationRate: number;
  inflationExpectations: number;
}

// ── v1.0 Fiscal Policy Types (Phase 3) ──────────────────────────────────────

/**
 * Budget allocation fractions for each public spending category.
 * All four fields must sum to 1.0. Each value is 0.0–1.0.
 * Configured at session design time by the policymaker (not governance-voted — per FISC-01, GOV-01 deferral).
 */
export interface BudgetAllocation {
  /** Fraction of treasury spending allocated to infrastructure. Boosts agent productivity. */
  infrastructure: number;
  /** Fraction allocated to education. Accelerates skill gain rates for all agents. */
  education: number;
  /** Fraction allocated to defense/enforcement. Reduces theft and increases compliance. */
  defense: number;
  /** Fraction allocated to welfare. Provides direct fiat supplement to low-wealth agents. */
  welfare: number;
}

/**
 * Persistent public goods quality scores per spending category.
 * Quality accrues with spending and decays without it.
 * One record per session per iteration — latest record is current state.
 */
export interface PublicGoodsState {
  id: string;
  sessionId: string;
  /** Simulation iteration this snapshot was taken at. */
  iterationNumber: number;
  /** Infrastructure quality score 0–100. Higher → higher agent productivity. */
  infrastructureQuality: number;
  /** Education quality score 0–100. Higher → faster skill acquisition for all agents. */
  educationQuality: number;
  /** Defense quality score 0–100. Higher → lower theft success rate, stronger enforcement. */
  defenseQuality: number;
  /** Welfare quality score 0–100. Higher → larger direct fiat transfer to low-wealth agents. */
  welfareQuality: number;
}

/**
 * Default budget allocation: equal 25% split across all four categories.
 * Used when session config does not specify a budget.
 */
export const DEFAULT_BUDGET_ALLOCATION: BudgetAllocation = {
  infrastructure: 0.25,
  education: 0.25,
  defense: 0.25,
  welfare: 0.25,
};

/**
 * Default initial public goods qualities: all at 50 (mid-range).
 * Used when a session starts without inherited public goods state.
 */
export const DEFAULT_PUBLIC_GOODS_INITIAL: Omit<PublicGoodsState, 'id' | 'sessionId' | 'iterationNumber'> = {
  infrastructureQuality: 50,
  educationQuality: 50,
  defenseQuality: 50,
  welfareQuality: 50,
};

// ── v1.0 Capital Markets Types (Phase 2) ─────────────────────────────────────

export interface EquityPosition {
  id: string;
  sessionId: string;
  ownerAgentId: string;
  /** agent.id of the enterprise owner — NOT the ephemeral in-memory enterpriseId */
  enterpriseOwnerId: string;
  sharesHeld: number;
  averageCostBasis: number;
  lastUpdated: number;  // iteration number
}

export interface BondHolding {
  id: string;
  sessionId: string;
  ownerAgentId: string;
  /** 'treasury' for government bonds; agent.id of enterprise owner for corporate bonds */
  issuerId: string;
  bondType: 'government' | 'corporate';
  faceValue: number;
  couponRate: number;       // per-iteration rate
  maturityIteration: number;
  purchaseIteration: number;
  status: 'active' | 'matured' | 'defaulted';
}

/**
 * Live economic policy constants — mutable via the governance cycle.
 * Stored in session.config.policy and re-read each iteration.
 */
export interface SessionPolicy {
  /** Demurrage wealth tax rate per iteration cycle. Default: 0.02 (2%). */
  tax_rate: number;
  /** Fraction of collected tax redistributed as UBI. Default: 1.0 (100%). */
  ubi_allocation: number;
  /** Multiplier applied to theft cortisol penalties (higher = more deterrence). Default: 1.0. */
  enforcement_level: number;
}

export type DesignProgressEvent =
  | { type: 'step_start'; step: 'overview' | 'law' | 'agents'; stepIndex: number; totalSteps: 3 }
  | { type: 'step_done'; step: 'overview' | 'law' | 'agents'; stepIndex: number }
  | { type: 'complete'; sessionStage: Stage }
  | { type: 'error'; step: string; message: string };

export interface ChatResponse {
  reply: string;
  updatedChecklist: BrainstormChecklist | null;
  readyForDesign: boolean;
  artifactsUpdated: Array<'overview' | 'law' | 'agents'>;
  agentsSummary: string | null;
}

export interface SessionDetail {
  id: string;
  title: string;
  idea: string;
  stage: Stage;
  config: SessionConfig | null;
  law: string | null;
  societyOverview: string | null;
  timeScale: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Phase 1 Economy re-exports ────────────────────────────────────────────────
export type {
  SkillCategory,
  SkillEntry,
  SkillMatrix,
  ItemType,
  InventoryItem,
  Inventory,
  ItemProperties,
  MarketOrder,
  TradeMatch,
  PriceIndex,
  MarketState,
  EmploymentContract,
  EconomySnapshot,
} from './economyTypes.js';

export {
  DEFAULT_SKILL_MATRIX,
  DEFAULT_INVENTORY,
  SKILL_CATEGORIES,
  ITEM_TYPES,
  ITEM_PROPERTIES,
} from './economyTypes.js';

export { distributeProRata } from './math.js';

