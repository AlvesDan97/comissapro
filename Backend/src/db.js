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
  profession TEXT,
  company TEXT,
  currency TEXT DEFAULT 'BRL',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commission_types (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  calc_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  generated_when TEXT NOT NULL DEFAULT 'on_entry',
  receive_when TEXT NOT NULL DEFAULT 'next_month',
  receive_days INTEGER,
  receive_date TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
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
  commission_type_id TEXT REFERENCES commission_types(id) ON DELETE SET NULL,
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
CREATE INDEX IF NOT EXISTS idx_commission_types_user ON commission_types(user_id);
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
  await ensureColumn('users', 'profession', 'profession TEXT');
  await ensureColumn('users', 'company', 'company TEXT');
  await ensureColumn('users', 'currency', "currency TEXT DEFAULT 'BRL'");
  await ensureColumn('sales', 'commission_type_id', 'commission_type_id TEXT');
  await ensureColumn('sales', 'seller_id', 'seller_id TEXT');
  await ensureColumn('users', 'workspace_id', 'workspace_id TEXT');
  await ensureColumn('users', 'workspace_role', "workspace_role TEXT DEFAULT 'owner'");
  await ensureColumn('users', 'trial_ends_at', 'trial_ends_at TEXT');
  await ensureColumn('users', 'extra_seats', 'extra_seats INTEGER DEFAULT 0');
  await ensureColumn('users', 'asaas_customer_id', 'asaas_customer_id TEXT');
  await ensureColumn('users', 'asaas_subscription_id', 'asaas_subscription_id TEXT');
  await ensureColumn('users', 'reset_token', 'reset_token TEXT');
  await ensureColumn('users', 'reset_token_expires', 'reset_token_expires TEXT');
  await ensureColumn('team_members', 'member_user_id', 'member_user_id TEXT');
  await ensureColumn('team_members', 'invite_token', 'invite_token TEXT');
  await ensureColumn('team_members', 'invite_expires_at', 'invite_expires_at TEXT');
  await ensureColumn('users', 'notify_prefs_json', "notify_prefs_json TEXT DEFAULT '{}'");
  await ensureColumn('users', 'blocked_at', 'blocked_at TEXT');
  await ensureColumn('users', 'blocked_reason', 'blocked_reason TEXT');
  await ensureColumn('users', 'email_verified_at', 'email_verified_at TEXT');
  await ensureColumn('users', 'email_confirm_token', 'email_confirm_token TEXT');
  await ensureColumn('users', 'email_confirm_expires', 'email_confirm_expires TEXT');
  await exec(`UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL OR email_verified_at = ''`);
  await exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      before_json TEXT,
      after_json TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS account_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      admin_id TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_admin_audit ON admin_audit_logs(created_at)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_account_notes_user ON account_notes(user_id)`);

  const goalType = usePostgres ? 'DOUBLE PRECISION' : 'REAL';
  await exec(`
    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'percent',
      value ${goalType} NOT NULL DEFAULT 0,
      max_redemptions INTEGER,
      redeemed INTEGER DEFAULT 0,
      plans_json TEXT DEFAULT '[]',
      expires_at TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      seller_id TEXT,
      commission_type_id TEXT,
      period_type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      metric TEXT NOT NULL DEFAULT 'commission',
      target ${goalType} NOT NULL DEFAULT 0,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS saved_metrics (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      catalog_key TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      pin_dashboard INTEGER DEFAULT 0,
      pin_compare INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      link TEXT,
      read_at TEXT,
      email_sent_at TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS followups (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      seller_id TEXT,
      type TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      notified_once INTEGER DEFAULT 0,
      last_notified_at TEXT,
      done_at TEXT,
      done_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_followups_ws ON followups(workspace_id, status)`);

  const moneyType = usePostgres ? 'DOUBLE PRECISION' : 'REAL';
  await exec(`
    CREATE TABLE IF NOT EXISTS plan_catalog (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT,
      price_monthly ${moneyType} NOT NULL,
      price_yearly ${moneyType} NOT NULL,
      currency TEXT DEFAULT 'BRL',
      max_stores INTEGER DEFAULT 0,
      max_team_members INTEGER DEFAULT 0,
      extra_seat_price ${moneyType},
      features_json TEXT DEFAULT '[]',
      highlighted INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS plan_price_history (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      admin_id TEXT,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      category TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      rating INTEGER,
      assigned_admin_id TEXT,
      last_author_type TEXT,
      user_read_at TEXT,
      admin_read_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      author_type TEXT NOT NULL,
      author_id TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_support_ws ON support_tickets(workspace_id, created_at)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_support_status ON support_tickets(status, kind)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_support_msgs ON support_messages(ticket_id, created_at)`);
  await ensureColumn('support_messages', 'author_name', 'author_name TEXT');

  await exec(`UPDATE users SET workspace_id = id WHERE workspace_id IS NULL OR workspace_id = ''`);
  await exec(`UPDATE users SET workspace_role = 'owner' WHERE workspace_id = id AND (workspace_role IS NULL OR workspace_role = '')`);
  await exec(`UPDATE sales SET seller_id = user_id WHERE seller_id IS NULL OR seller_id = ''`);
  const needTrial = await all(
    `SELECT id, plan_started_at FROM users WHERE trial_ends_at IS NULL AND plan_started_at IS NOT NULL`
  );
  for (const u of needTrial) {
    const d = new Date(u.plan_started_at);
    if (Number.isNaN(d.getTime())) continue;
    d.setDate(d.getDate() + 30);
    await run(`UPDATE users SET trial_ends_at=? WHERE id=?`, [d.toISOString(), u.id]);
  }
}

async function init() {
  if (usePostgres) {
    const { Pool } = require('pg');
    const url = process.env.DATABASE_URL || '';
    const sslEnv = process.env.DATABASE_SSL;
    const needsSsl =
      sslEnv === 'true' ||
      (sslEnv !== 'false' &&
        (url.includes('railway') ||
          url.includes('sslmode=require') ||
          url.includes('proxy.rlwy.net')));

    pool = new Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.DB_POOL_MAX || 20),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });

    let lastErr;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await pool.query('SELECT 1');
        console.log('[db] Postgres conectado' + (needsSsl ? ' (ssl)' : ''));
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[db] tentativa ${attempt}/10 falhou:`, err.message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (lastErr) throw lastErr;
  } else {
    const Database = require('better-sqlite3');
    const dataDir = process.env.SQLITE_PATH
      ? path.dirname(process.env.SQLITE_PATH)
      : path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'comiss.db');
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
