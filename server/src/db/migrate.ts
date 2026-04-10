import { sqlite } from './index.js';

export function runMigrations() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      seed_idea TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'idea-input',
      config TEXT,
      law TEXT,
      society_overview TEXT,
      time_scale TEXT,
      society_evaluation TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      background TEXT NOT NULL DEFAULT '',
      initial_stats TEXT NOT NULL DEFAULT '{}',
      current_stats TEXT NOT NULL DEFAULT '{}',
      type TEXT NOT NULL DEFAULT 'citizen',
      status TEXT NOT NULL DEFAULT 'alive',
      born_at_iteration INTEGER,
      died_at_iteration INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_agents_session_id ON agents(session_id);
    CREATE INDEX IF NOT EXISTS idx_agents_session_status ON agents(session_id, status);

    CREATE TABLE IF NOT EXISTS agent_intents (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      iteration_id TEXT,
      intent TEXT NOT NULL,
      reasoning TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_intents_session ON agent_intents(session_id);

    CREATE TABLE IF NOT EXISTS resolved_actions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      iteration_id TEXT,
      action TEXT NOT NULL,
      outcome TEXT,
      resolved_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_resolved_actions_session ON resolved_actions(session_id);

    CREATE TABLE IF NOT EXISTS iterations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      iteration_number INTEGER NOT NULL,
      state_summary TEXT NOT NULL DEFAULT '',
      statistics TEXT NOT NULL DEFAULT '{}',
      lifecycle_events TEXT NOT NULL DEFAULT '[]',
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_iterations_session ON iterations(session_id);

    CREATE TABLE IF NOT EXISTS reflections (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      insights TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      context TEXT NOT NULL,
      agent_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_changes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      from_role TEXT NOT NULL,
      to_role TEXT NOT NULL,
      reason TEXT,
      iteration_number INTEGER NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);

  // Data migration: rename 'refine' context to 'refinement' (spec §5.1 ChatContext)
  sqlite.exec(`
    UPDATE chat_messages SET context = 'refinement' WHERE context = 'refine';
  `);

  // Phase 4 migration: add agent_id to reflections (idempotent via try-catch)
  try {
    sqlite.exec(`ALTER TABLE reflections ADD COLUMN agent_id TEXT;`);
  } catch {
    // Column already exists — safe to ignore
  }

  // ── Phase 1 Economy migrations ──────────────────────────────────────────

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS economy_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      iteration_number INTEGER NOT NULL,
      snapshot_data TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_economy_snapshots_session
      ON economy_snapshots(session_id, iteration_number);

    CREATE TABLE IF NOT EXISTS agent_economy (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      skills TEXT NOT NULL DEFAULT '{}',
      inventory TEXT NOT NULL DEFAULT '{}',
      last_updated INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_economy_agent
      ON agent_economy(agent_id);

    CREATE INDEX IF NOT EXISTS idx_agent_economy_session
      ON agent_economy(session_id);

    CREATE TABLE IF NOT EXISTS market_prices (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      iteration_number INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      last_price REAL NOT NULL DEFAULT 0,
      vwap REAL NOT NULL DEFAULT 0,
      volume INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_market_prices_session
      ON market_prices(session_id, iteration_number);
  `);

  // Fix H10: Migrate unique index to include session_id for multi-session support.
  // Drop the old agent_id-only index and create a composite one.
  try {
    sqlite.exec(`DROP INDEX IF EXISTS idx_agent_economy_agent;`);
    sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_economy_agent_session ON agent_economy(agent_id, session_id);`);
  } catch { /* index migration already applied */ }

  // AMM snapshots: persist AMM reserve state for SFC resilience across server restarts
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS amm_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      iteration_number INTEGER NOT NULL,
      snapshot_data TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_amm_snapshots_session
      ON amm_snapshots(session_id, iteration_number);
  `);

  // Agent intents: add actionCode and actionTarget columns (idempotent)
  try {
    sqlite.exec(`ALTER TABLE agent_intents ADD COLUMN action_code TEXT NOT NULL DEFAULT 'NONE';`);
  } catch { /* column already exists */ }
  try {
    sqlite.exec(`ALTER TABLE agent_intents ADD COLUMN action_target TEXT;`);
  } catch { /* column already exists */ }
  try {
    sqlite.exec(`ALTER TABLE agent_intents ADD COLUMN action_queue TEXT;`);
  } catch { /* column already exists */ }

  // Allostatic state persistence: adds physiological strain/load columns to agents
  try {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN allostatic_strain REAL NOT NULL DEFAULT 0;`);
  } catch { /* column already exists */ }
  try {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN allostatic_load REAL NOT NULL DEFAULT 0;`);
  } catch { /* column already exists */ }

  // Personality traits: JSON array of 1–2 trait strings per agent
  try {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN personality_traits TEXT NOT NULL DEFAULT '[]';`);
  } catch { /* column already exists */ }

  // Agent demographics: age and weight for MET metabolism personalization
  try {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN age INTEGER;`);
  } catch { /* column already exists */ }
  try {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN weight_kg REAL;`);
  } catch { /* column already exists */ }

  // Performance indexes for frequently queried columns
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_agent_intents_agent ON agent_intents(agent_id);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_resolved_actions_agent ON resolved_actions(agent_id);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session_context ON chat_messages(session_id, context);`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_public_goods_state_session_iter ON public_goods_state(session_id, iteration_number);`);

  // Order Book persistence: survive server restarts (REL-01 / BUG-02)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS order_book (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      side TEXT NOT NULL,
      item_type TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      filled_quantity INTEGER NOT NULL DEFAULT 0,
      iteration_placed INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_order_book_session_status
      ON order_book(session_id, status);
  `);

  // Banking Foundation (Phase 1): deposit accounts, loan contracts, bank balance sheets
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS deposit_accounts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      owner_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      bank_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      account_type TEXT NOT NULL DEFAULT 'demand',
      balance REAL NOT NULL DEFAULT 0,
      interest_rate REAL NOT NULL DEFAULT 0.002,
      last_updated INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_deposit_accounts_session ON deposit_accounts(session_id);
    CREATE INDEX IF NOT EXISTS idx_deposit_accounts_owner ON deposit_accounts(owner_agent_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_unique
      ON deposit_accounts(owner_agent_id, bank_agent_id, session_id);

    CREATE TABLE IF NOT EXISTS loan_contracts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      borrower_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      lender_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      principal REAL NOT NULL,
      interest_rate REAL NOT NULL,
      term_iterations INTEGER NOT NULL,
      remaining_balance REAL NOT NULL,
      collateral_amount REAL NOT NULL DEFAULT 0,
      consecutive_missed INTEGER NOT NULL DEFAULT 0,
      issued_at_iteration INTEGER NOT NULL,
      due_at_iteration INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_loan_contracts_session ON loan_contracts(session_id);
    CREATE INDEX IF NOT EXISTS idx_loan_contracts_borrower ON loan_contracts(borrower_agent_id);

    CREATE TABLE IF NOT EXISTS bank_balance_sheets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      iteration_number INTEGER NOT NULL,
      reserves REAL NOT NULL,
      loan_assets REAL NOT NULL,
      deposit_liabilities REAL NOT NULL,
      equity REAL NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bank_balance_sheets_session ON bank_balance_sheets(session_id);

    CREATE TABLE IF NOT EXISTS macro_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      iteration_number INTEGER NOT NULL,
      m0 REAL NOT NULL,
      m1 REAL NOT NULL,
      cpi REAL NOT NULL,
      inflation_rate REAL NOT NULL,
      inflation_expectations REAL NOT NULL,
      total_loans_outstanding REAL NOT NULL,
      treasury_balance REAL NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_macro_snapshots_session ON macro_snapshots(session_id);
    CREATE INDEX IF NOT EXISTS idx_macro_snapshots_session_iter
      ON macro_snapshots(session_id, iteration_number);
  `);

  // Capital Markets (Phase 2): equity positions and bond holdings
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS equity_positions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      owner_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      enterprise_owner_id TEXT NOT NULL,
      shares_held INTEGER NOT NULL DEFAULT 0,
      average_cost_basis REAL NOT NULL DEFAULT 0,
      last_updated INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_equity_positions_session ON equity_positions(session_id);
    CREATE INDEX IF NOT EXISTS idx_equity_positions_owner ON equity_positions(owner_agent_id);

    CREATE TABLE IF NOT EXISTS bond_holdings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      owner_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      issuer_id TEXT NOT NULL,
      bond_type TEXT NOT NULL,
      face_value REAL NOT NULL,
      coupon_rate REAL NOT NULL,
      maturity_iteration INTEGER NOT NULL,
      purchase_iteration INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_bond_holdings_session ON bond_holdings(session_id);
    CREATE INDEX IF NOT EXISTS idx_bond_holdings_owner ON bond_holdings(owner_agent_id);
  `);

  // Fiscal Policy (Phase 3): budget allocations and public goods quality state
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS fiscal_budgets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      infrastructure REAL NOT NULL,
      education REAL NOT NULL,
      defense REAL NOT NULL,
      welfare REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fiscal_budgets_session ON fiscal_budgets(session_id);

    CREATE TABLE IF NOT EXISTS public_goods_state (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      iteration_number INTEGER NOT NULL,
      infrastructure_quality REAL NOT NULL DEFAULT 50,
      education_quality REAL NOT NULL DEFAULT 50,
      defense_quality REAL NOT NULL DEFAULT 50,
      welfare_quality REAL NOT NULL DEFAULT 50
    );

    CREATE INDEX IF NOT EXISTS idx_public_goods_state_session ON public_goods_state(session_id);
    CREATE INDEX IF NOT EXISTS idx_public_goods_state_session_iter
      ON public_goods_state(session_id, iteration_number);
  `);

  // Enterprise persistence (Phase 10): enterprise entities per session
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS enterprises (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      sector TEXT NOT NULL,
      industry TEXT NOT NULL,
      commodity_output TEXT NOT NULL,
      initial_capital REAL NOT NULL,
      wage REAL NOT NULL,
      is_service_enterprise INTEGER NOT NULL DEFAULT 0,
      consecutive_insolvency_iterations INTEGER NOT NULL DEFAULT 0,
      is_bankrupt INTEGER NOT NULL DEFAULT 0,
      employees TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_enterprises_session ON enterprises(session_id);
  `);

  console.log('Database migrations applied.');
}
