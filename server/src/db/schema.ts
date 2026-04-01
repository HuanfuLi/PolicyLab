import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('name').notNull(),
  idea: text('seed_idea').notNull(),
  stage: text('stage').notNull().default('idea-input'),
  config: text('config'),
  law: text('law'),
  societyOverview: text('society_overview'),
  timeScale: text('time_scale'),
  societyEvaluation: text('society_evaluation'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role').notNull(),
  background: text('background').notNull().default(''),
  initialStats: text('initial_stats').notNull().default('{}'),
  currentStats: text('current_stats').notNull().default('{}'),
  type: text('type').notNull().default('citizen'),
  status: text('status').notNull().default('alive'),
  bornAtIteration: integer('born_at_iteration'),
  diedAtIteration: integer('died_at_iteration'),
  allostaticStrain: real('allostatic_strain').notNull().default(0),
  allostaticLoad: real('allostatic_load').notNull().default(0),
  personalityTraits: text('personality_traits').notNull().default('[]'),
});

export const agentIntents = sqliteTable('agent_intents', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  iterationId: text('iteration_id'),
  intent: text('intent').notNull(),
  reasoning: text('reasoning'),
  actionCode: text('action_code').notNull().default('NONE'),
  actionTarget: text('action_target'),
  actionQueue: text('action_queue'),
  createdAt: text('created_at').notNull(),
});

export const resolvedActions = sqliteTable('resolved_actions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  iterationId: text('iteration_id'),
  action: text('action').notNull(),
  outcome: text('outcome'),
  resolvedAt: text('resolved_at').notNull(),
});

export const iterations = sqliteTable('iterations', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  iterationNumber: integer('iteration_number').notNull(),
  stateSummary: text('state_summary').notNull().default(''),
  statistics: text('statistics').notNull().default('{}'),
  lifecycleEvents: text('lifecycle_events').notNull().default('[]'),
  timestamp: text('timestamp').notNull(),
});

export const reflections = sqliteTable('reflections', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id'),
  content: text('content').notNull(),
  insights: text('insights'),
  createdAt: text('created_at').notNull(),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  context: text('context').notNull(),
  agentId: text('agent_id'),
  role: text('role').notNull(),
  content: text('content').notNull(),
  timestamp: text('timestamp').notNull(),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const roleChanges = sqliteTable('role_changes', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  fromRole: text('from_role').notNull(),
  toRole: text('to_role').notNull(),
  reason: text('reason'),
  iterationNumber: integer('iteration_number').notNull(),
  timestamp: text('timestamp').notNull(),
});

// ── Phase 1 Economy Tables ──────────────────────────────────────────────────

/** Stores per-iteration economy snapshots (skills, inventory, market state). */
export const economySnapshots = sqliteTable('economy_snapshots', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  iterationNumber: integer('iteration_number').notNull(),
  /** JSON: full EconomySnapshot (market state, contracts, summary stats). */
  snapshotData: text('snapshot_data').notNull().default('{}'),
  timestamp: text('timestamp').notNull(),
});

/** Stores per-agent economy state (skills + inventory), updated each iteration. */
export const agentEconomy = sqliteTable('agent_economy', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  /** JSON: SkillMatrix */
  skills: text('skills').notNull().default('{}'),
  /** JSON: Inventory */
  inventory: text('inventory').notNull().default('{}'),
  /** Last iteration this was updated. */
  lastUpdated: integer('last_updated').notNull().default(0),
});

/** Stores AMM reserve state per iteration for SFC resilience across server restarts. */
export const ammSnapshots = sqliteTable('amm_snapshots', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  iterationNumber: integer('iteration_number').notNull(),
  /** JSON: { primary: AMMState, multi: Record<string, AMMState> } */
  snapshotData: text('snapshot_data').notNull().default('{}'),
  timestamp: text('timestamp').notNull(),
});

/** Stores market price history for charting/analytics. */
export const marketPrices = sqliteTable('market_prices', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  iterationNumber: integer('iteration_number').notNull(),
  /** Item type (food, tools, luxury_goods, raw_materials). */
  itemType: text('item_type').notNull(),
  /** Last traded price. */
  lastPrice: real('last_price').notNull().default(0),
  /** Volume-weighted average price. */
  vwap: real('vwap').notNull().default(0),
  /** Total volume traded. */
  volume: integer('volume').notNull().default(0),
});

/** Persists open (good-till-cancelled) orders in the Order Book across server restarts. */
export const orderBook = sqliteTable('order_book', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull(),
  /** 'buy' or 'sell'. */
  side: text('side').notNull(),
  /** Item type: food, tools, luxury_goods, raw_materials. */
  itemType: text('item_type').notNull(),
  /** Limit price in fiat. */
  price: real('price').notNull(),
  /** Original order quantity. */
  quantity: integer('quantity').notNull(),
  /** Quantity already filled (for partial fills). */
  filledQuantity: integer('filled_quantity').notNull().default(0),
  /** Iteration when the order was placed. */
  iterationPlaced: integer('iteration_placed').notNull(),
  /** 'open' | 'filled' | 'cancelled'. */
  status: text('status').notNull().default('open'),
  createdAt: text('created_at').notNull(),
});

