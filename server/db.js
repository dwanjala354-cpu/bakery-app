const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'bakery.db');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let db;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function saveDb() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function runNoSave(sql, params = []) {
  db.run(sql, params);
}

function get(sql, params = []) {
  const s = db.prepare(sql);
  s.bind(params);
  const row = s.step() ? s.getAsObject() : null;
  s.free();
  return row;
}

function all(sql, params = []) {
  const s = db.prepare(sql);
  s.bind(params);
  const out = [];
  while (s.step()) out.push(s.getAsObject());
  s.free();
  return out;
}

const ALL_PAGES = ['dashboard', 'procurement', 'stock', 'production', 'sales', 'analytics', 'settings', 'users', 'branches', 'billing'];

const DEFAULT_ROLE_PERMISSIONS = {
  admin: ALL_PAGES,
  manager: ['dashboard', 'procurement', 'stock', 'production', 'sales', 'analytics'],
  staff: ['dashboard', 'stock', 'sales'],
};

// ── Plan definitions (source of truth for limits & features) ──────────
const PLANS = {
  trial: {
    key: 'trial', label: 'Free Trial', price: 0,
    max_branches: 1, max_users: 2,
    features: ALL_PAGES,
    duration_days: 14,
  },
  starter: {
    key: 'starter', label: 'Starter', price: 999,
    max_branches: 1, max_users: 1,
    features: ['dashboard', 'procurement', 'stock', 'production', 'sales', 'settings', 'users', 'billing'],
  },
  advanced: {
    key: 'advanced', label: 'Advanced', price: 1999,
    max_branches: 2, max_users: 2,
    features: ALL_PAGES,
  },
  pro: {
    key: 'pro', label: 'Pro', price: 2999,
    max_branches: 5, max_users: 10,
    features: ALL_PAGES.concat(['multi_branch_reports', 'data_export']),
  },
  enterprise: {
    key: 'enterprise', label: 'Enterprise', price: null, // custom — contact us
    max_branches: null, max_users: null, // unlimited / negotiated
    features: ALL_PAGES.concat(['multi_branch_reports', 'data_export', 'priority_support']),
  },
};

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  // ── Platform-level tables ─────────────────────────────────
  runNoSave(`CREATE TABLE IF NOT EXISTS kitchens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KES',
    status TEXT NOT NULL DEFAULT 'active',
    plan TEXT NOT NULL DEFAULT 'trial',
    trial_ends_at TEXT,
    subscription_active_until TEXT,
    payment_reference TEXT,
    payment_status TEXT DEFAULT 'none',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  runNoSave(`CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    kitchen_id TEXT NOT NULL,
    name TEXT NOT NULL,
    location TEXT DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  runNoSave(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    kitchen_id TEXT,
    branch_id TEXT,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    permissions TEXT,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(kitchen_id, username)
  )`);

  runNoSave(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // ── Tenant-scoped tables (carry kitchen_id AND branch_id) ───────────
  runNoSave(`CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY, kitchen_id TEXT NOT NULL, branch_id TEXT NOT NULL, name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg', alert_level REAL NOT NULL DEFAULT 1,
    stock REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0
  )`);

  runNoSave(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, kitchen_id TEXT NOT NULL, branch_id TEXT NOT NULL, name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'piece', selling_price REAL NOT NULL DEFAULT 0
  )`);

  runNoSave(`CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY, kitchen_id TEXT NOT NULL, branch_id TEXT NOT NULL, material_id TEXT NOT NULL,
    qty REAL NOT NULL, cost_per_unit REAL NOT NULL, total REAL NOT NULL,
    supplier TEXT DEFAULT '', date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
  )`);

  runNoSave(`CREATE TABLE IF NOT EXISTS productions (
    id TEXT PRIMARY KEY, kitchen_id TEXT NOT NULL, branch_id TEXT NOT NULL, product_id TEXT NOT NULL,
    units INTEGER NOT NULL, total_cost REAL NOT NULL DEFAULT 0,
    date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
  )`);

  runNoSave(`CREATE TABLE IF NOT EXISTS production_materials (
    id TEXT PRIMARY KEY, kitchen_id TEXT NOT NULL, branch_id TEXT NOT NULL, production_id TEXT NOT NULL,
    material_id TEXT NOT NULL, qty REAL NOT NULL, cost REAL NOT NULL DEFAULT 0
  )`);

  runNoSave(`CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY, kitchen_id TEXT NOT NULL, branch_id TEXT NOT NULL, product_id TEXT NOT NULL,
    units INTEGER NOT NULL, revenue REAL NOT NULL,
    date TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
  )`);

  saveDb();

  // ── Migration safety net: add columns if upgrading from older DB ────
  function columnExists(table, col) {
    const cols = all(`PRAGMA table_info(${table})`);
    return cols.some(c => c.name === col);
  }
  function ensureColumn(table, colDef, colName) {
    if (!columnExists(table, colName)) {
      try { runNoSave(`ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch (e) {}
    }
  }
  ['materials','products','purchases','productions','production_materials','sales'].forEach(t => {
    ensureColumn(t, 'branch_id TEXT', 'branch_id');
  });
  ensureColumn('kitchens', "plan TEXT DEFAULT 'trial'", 'plan');
  ensureColumn('kitchens', 'trial_ends_at TEXT', 'trial_ends_at');
  ensureColumn('kitchens', 'subscription_active_until TEXT', 'subscription_active_until');
  ensureColumn('kitchens', 'payment_reference TEXT', 'payment_reference');
  ensureColumn('kitchens', "payment_status TEXT DEFAULT 'none'", 'payment_status');
  ensureColumn('users', 'branch_id TEXT', 'branch_id');
  saveDb();

  // ── Seed: platform super-admin (only if no users exist at all) ─
  const userCount = get('SELECT COUNT(*) as c FROM users').c;
  if (!userCount || userCount === 0) {
    const bcrypt = require('bcryptjs');
    const superId = uid();
    const hash = bcrypt.hashSync('admin123', 10);
    run('INSERT INTO users (id,kitchen_id,branch_id,username,password_hash,role,permissions,is_super_admin,status) VALUES (?,?,?,?,?,?,?,?,?)',
      [superId, null, null, 'superadmin', hash, 'super_admin', JSON.stringify(ALL_PAGES), 1, 'active']);
    console.log('🔑 Seeded platform super-admin → username: superadmin / password: admin123 (CHANGE THIS after first login via Account Settings)');
  }
}

module.exports = {
  get db() { return db; },
  uid, run, runNoSave, get, all, saveDb,
  DEFAULT_ROLE_PERMISSIONS, ALL_PAGES, PLANS,
  initDb,
};
