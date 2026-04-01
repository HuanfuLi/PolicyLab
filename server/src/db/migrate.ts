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

    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);

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

  // Order Book persistence: survive server restarts (REL-01 / BUG-02)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS order_book (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
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

  console.log('Database migrations applied.');
}
