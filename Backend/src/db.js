const path = require('path');
const fs = require('fs');

/**
 * Camada de dados unificada:
 * - Produção (Railway): Postgres via DATABASE_URL
 * - Local sem DATABASE_URL: SQLite em ./data (dev)
 * API async: get / all / run (placeholders ?)
 */

const usePostgres = !!process.env.DATABASE_URL;
let pool = null;
let sqlite = null;

function toPgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function get(sql, params = []) {
  if (usePostgres) {
    const r = await pool.query(toPgParams(sql), params);
    return r.rows[0];
  }
  return sqlite.prepare(sql).get(...params);
}

async function all(sql, params = []) {
  if (usePostgres) {
    const r = await pool.query(toPgParams(sql), params);
    return r.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

async function run(sql, params = []) {
  if (usePostgres) {
    const r = await pool.query(toPgParams(sql), params);
    return { changes: r.rowCount || 0 };
  }
  const info = sqlite.prepare(sql).run(...params);
  return { changes: info.changes };
}

async function exec(sql) {
  if (usePostgres) {
    await pool.query(sql);
    return;
  }
  sqlite.exec(sql);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  niche TEXT,
  multi_store INTEGER DEFAULT 0,
  onboarding_done INTEGER DEFAULT 0,
  twofa_enabled INTEGER DEFAULT 0,
  twofa_secret TEXT,
  biometry_enabled INTEGER DEFAULT 0,
  theme TEXT DEFAULT 'dark',
  plan TEXT DEFAULT 'pro',
  billing_cycle TEXT DEFAULT 'monthly',
  plan_status TEXT DEFAULT 'trialing',
  plan_started_at TEXT,
  accepted_terms_at TEXT,
  accepted_privacy_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cnpj TEXT,
  color TEXT DEFAULT '#3FDA9A',
  logo_initials TEXT,
  payment_days INTEGER DEFAULT 30,
  rule_type TEXT NOT NULL DEFAULT 'bands',
  rule_json TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commission_rule_versions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  client_name TEXT,
  value DOUBLE PRECISION DEFAULT 0,
  probability INTEGER DEFAULT 50,
  stage TEXT NOT NULL DEFAULT 'lead',
  niche_fields TEXT DEFAULT '{}',
  expected_close TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  client_name TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  sale_date TEXT NOT NULL,
  gross_value DOUBLE PRECISION NOT NULL,
  accessories_value DOUBLE PRECISION DEFAULT 0,
  extras_value DOUBLE PRECISION DEFAULT 0,
  niche_fields TEXT DEFAULT '{}',
  split_enabled INTEGER DEFAULT 0,
  split_partner TEXT,
  split_percent DOUBLE PRECISION DEFAULT 0,
  rule_version_id TEXT,
  snapshot_json TEXT NOT NULL,
  commission_official DOUBLE PRECISION DEFAULT 0,
  commission_extra DOUBLE PRECISION DEFAULT 0,
  commission_total DOUBLE PRECISION DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receivables (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  kind TEXT NOT NULL DEFAULT 'oficial',
  due_date TEXT NOT NULL,
  paid_date TEXT,
  status TEXT NOT NULL DEFAULT 'previsto',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id TEXT,
  filename TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_items (
  id TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  sale_id TEXT,
  label TEXT NOT NULL,
  expected DOUBLE PRECISION DEFAULT 0,
  found DOUBLE PRECISION DEFAULT 0,
  diff DOUBLE PRECISION DEFAULT 0,
  match_status TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offline_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  synced_at TEXT
);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_stores_user ON stores(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_store ON sales(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_receivables_user ON receivables(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
`;

async function ensureColumn(table, column, ddl) {
  if (usePostgres) {
    const rows = await all(
      `SELECT 1 AS ok FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      [table, column]
    );
    if (!rows.length) await exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    return;
  }
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

async function migrate() {
  // Postgres: REAL → already DOUBLE PRECISION in SCHEMA
  // SQLite: DOUBLE PRECISION is accepted as affinity NUMERIC
  const schema = usePostgres
    ? SCHEMA
    : SCHEMA.replace(/DOUBLE PRECISION/g, 'REAL').replace(
        /\s+REFERENCES\s+\w+\([^)]+\)(?:\s+ON\s+DELETE\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi,
        ''
      );

  if (usePostgres) {
    // split statements for pg
    for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
    for (const stmt of INDEXES.split(';').map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
  } else {
    sqlite.exec(schema);
    sqlite.exec(INDEXES);
  }

  await ensureColumn('users', 'plan', "plan TEXT DEFAULT 'pro'");
  await ensureColumn('users', 'billing_cycle', "billing_cycle TEXT DEFAULT 'monthly'");
  await ensureColumn('users', 'plan_status', "plan_status TEXT DEFAULT 'trialing'");
  await ensureColumn('users', 'plan_started_at', 'plan_started_at TEXT');
  await ensureColumn('users', 'accepted_terms_at', 'accepted_terms_at TEXT');
  await ensureColumn('users', 'accepted_privacy_at', 'accepted_privacy_at TEXT');
}

async function init() {
  if (usePostgres) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
      max: Number(process.env.DB_POOL_MAX || 20),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    await pool.query('SELECT 1');
    console.log('[db] Postgres conectado');
  } else {
    const Database = require('better-sqlite3');
    const dataDir = process.env.SQLITE_PATH
      ? path.dirname(process.env.SQLITE_PATH)
      : path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'comissapro.db');
    sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    console.log('[db] SQLite local:', dbPath);
  }
  await migrate();
  return { driver: usePostgres ? 'postgres' : 'sqlite' };
}

async function close() {
  if (pool) await pool.end();
  if (sqlite) sqlite.close();
}

module.exports = {
  init,
  close,
  get,
  all,
  run,
  exec,
  usePostgres,
  get pool() {
    return pool;
  },
};
