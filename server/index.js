const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');

const dbMod = require('./db');
const { uid, run, get, all, DEFAULT_ROLE_PERMISSIONS, ALL_PAGES, PLANS } = dbMod;
const {
  createSession, destroySession, getSessionUser, sanitizeUser, getKitchenPlanStatus,
  requireAuth, requirePermission, requireSuperAdmin, requireActiveSubscription,
} = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 };
const TRIAL_DAYS = 14;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/* ════════════════════════════════════════════════════════════
   PUBLIC: plan info (for landing page pricing section)
   ════════════════════════════════════════════════════════════ */
app.get('/api/plans', (req, res) => {
  res.json(PLANS);
});

/* ════════════════════════════════════════════════════════════
   AUTH ROUTES (no auth required)
   ════════════════════════════════════════════════════════════ */
app.post('/api/auth/register', (req, res) => {
  const { kitchen_name, username, password, currency } = req.body;
  if (!kitchen_name || !username || !password) {
    return res.status(400).json({ error: 'Kitchen name, username, and password are required' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = get('SELECT id FROM users WHERE username=?', [username]);
  if (existing) return res.status(409).json({ error: 'Username already taken. Choose another.' });

  const kitchenId = uid();
  const trialEndsAt = addDays(new Date(), TRIAL_DAYS);
  run('INSERT INTO kitchens (id, name, currency, status, plan, trial_ends_at, payment_status) VALUES (?,?,?,?,?,?,?)',
    [kitchenId, kitchen_name, currency || 'KES', 'active', 'trial', trialEndsAt, 'none']);

  // Default branch
  const branchId = uid();
  run('INSERT INTO branches (id, kitchen_id, name, is_default) VALUES (?,?,?,?)',
    [branchId, kitchenId, 'Main Branch', 1]);

  const userId = uid();
  const hash = bcrypt.hashSync(password, 10);
  run('INSERT INTO users (id,kitchen_id,branch_id,username,password_hash,role,permissions,is_super_admin,status) VALUES (?,?,?,?,?,?,?,?,?)',
    [userId, kitchenId, branchId, username, hash, 'admin', JSON.stringify(ALL_PAGES), 0, 'active']);

  // Seed default materials & products for this new branch
  const defaultMaterials = [
    ['Wheat flour','kg',5,0,0],['Sugar','kg',3,0,0],['Cooking oil','litres',2,0,0],
    ['Salt','kg',1,0,0],['Yeast','g',200,0,0],['Food colours','ml',50,0,0],['Eggs','pieces',12,0,0],
  ];
  defaultMaterials.forEach(([name,unit,alert_level,stock,unit_price]) => {
    run('INSERT INTO materials (id,kitchen_id,branch_id,name,unit,alert_level,stock,unit_price) VALUES (?,?,?,?,?,?,?,?)',
      [uid(), kitchenId, branchId, name, unit, alert_level, stock, unit_price]);
  });
  const defaultProducts = [['White bread','loaf',0],['Sweet buns','piece',0],['Birthday cake','cake',0],['Mandazi','piece',0]];
  defaultProducts.forEach(([name,unit,selling_price]) => {
    run('INSERT INTO products (id,kitchen_id,branch_id,name,unit,selling_price) VALUES (?,?,?,?,?,?)',
      [uid(), kitchenId, branchId, name, unit, selling_price]);
  });

  const { token } = createSession(userId);
  res.cookie('session_token', token, COOKIE_OPTS);
  const user = get('SELECT * FROM users WHERE id=?', [userId]);
  const kitchen = get('SELECT * FROM kitchens WHERE id=?', [kitchenId]);
  res.json({ user: sanitizeUser(user), kitchen, planStatus: getKitchenPlanStatus(kitchen) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = get('SELECT * FROM users WHERE username=?', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  if (user.status !== 'active') return res.status(403).json({ error: 'This account has been disabled. Contact your admin.' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });

  if (user.kitchen_id) {
    const kitchen = get('SELECT * FROM kitchens WHERE id=?', [user.kitchen_id]);
    if (kitchen && kitchen.status !== 'active') {
      return res.status(403).json({ error: 'This kitchen account is suspended. Contact support.' });
    }
  }

  const { token } = createSession(user.id);
  res.cookie('session_token', token, COOKIE_OPTS);
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.session_token;
  if (token) destroySession(token);
  res.clearCookie('session_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies.session_token;
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  let kitchen = null, planStatus = null;
  if (user.kitchen_id) {
    kitchen = get('SELECT * FROM kitchens WHERE id=?', [user.kitchen_id]);
    planStatus = getKitchenPlanStatus(kitchen);
  }
  res.json({ user: sanitizeUser(user), kitchen, planStatus });
});

/* ════════════════════════════════════════════════════════════
   ALL ROUTES BELOW REQUIRE AUTH
   ════════════════════════════════════════════════════════════ */
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/plans') return next();
  requireAuth(req, res, next);
});

// Apply subscription-lock check to everything except account/billing/branches/users/settings
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/plans') return next();
  requireActiveSubscription(req, res, next);
});

/* ── Account (any logged-in user: change own password) ──────── */
app.put('/api/account/password', (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = get('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  run('UPDATE users SET password_hash=? WHERE id=?', [hash, req.user.id]);
  res.json({ ok: true });
});

/* ── Branch context: resolve which branch this request applies to ───
   Users have a "home" branch_id, but admins can switch via ?branch_id= query param. */
function resolveBranchId(req) {
  if (req.query.branch_id && req.user.role === 'admin') return req.query.branch_id;
  return req.branchId;
}

/* ── Branches ───────────────────────────────────────────────── */
app.get('/api/branches', requirePermission('dashboard'), (req, res) => {
  res.json(all('SELECT * FROM branches WHERE kitchen_id=? ORDER BY is_default DESC, name', [req.kitchenId]));
});

app.post('/api/branches', requirePermission('branches'), (req, res) => {
  const kitchen = get('SELECT * FROM kitchens WHERE id=?', [req.kitchenId]);
  const planStatus = getKitchenPlanStatus(kitchen);
  const branchCount = get('SELECT COUNT(*) as c FROM branches WHERE kitchen_id=?', [req.kitchenId]).c;
  if (planStatus.max_branches !== null && branchCount >= planStatus.max_branches) {
    return res.status(403).json({ error: `Your ${planStatus.plan_label} plan allows up to ${planStatus.max_branches} branch(es). Upgrade to add more.` });
  }
  const { name, location } = req.body;
  if (!name) return res.status(400).json({ error: 'Branch name is required' });
  const id = uid();
  run('INSERT INTO branches (id, kitchen_id, name, location, is_default) VALUES (?,?,?,?,0)', [id, req.kitchenId, name, location || '']);

  // Seed default materials & products for the new branch
  const defaultMaterials = [['Wheat flour','kg',5,0,0],['Sugar','kg',3,0,0],['Cooking oil','litres',2,0,0],['Salt','kg',1,0,0],['Yeast','g',200,0,0],['Food colours','ml',50,0,0],['Eggs','pieces',12,0,0]];
  defaultMaterials.forEach(([n,u,a,s,p]) => run('INSERT INTO materials (id,kitchen_id,branch_id,name,unit,alert_level,stock,unit_price) VALUES (?,?,?,?,?,?,?,?)', [uid(), req.kitchenId, id, n,u,a,s,p]));
  const defaultProducts = [['White bread','loaf',0],['Sweet buns','piece',0],['Birthday cake','cake',0],['Mandazi','piece',0]];
  defaultProducts.forEach(([n,u,p]) => run('INSERT INTO products (id,kitchen_id,branch_id,name,unit,selling_price) VALUES (?,?,?,?,?,?)', [uid(), req.kitchenId, id, n,u,p]));

  res.json({ id });
});

app.put('/api/branches/:id', requirePermission('branches'), (req, res) => {
  const { name, location } = req.body;
  run('UPDATE branches SET name=?, location=? WHERE id=? AND kitchen_id=?', [name, location||'', req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

app.delete('/api/branches/:id', requirePermission('branches'), (req, res) => {
  const branch = get('SELECT * FROM branches WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  if (!branch) return res.status(404).json({ error: 'Branch not found' });
  if (branch.is_default) return res.status(400).json({ error: 'Cannot delete the default branch' });
  ['sales','production_materials','productions','purchases','products','materials'].forEach(table => {
    run(`DELETE FROM ${table} WHERE branch_id=?`, [req.params.id]);
  });
  run('UPDATE users SET branch_id = (SELECT id FROM branches WHERE kitchen_id=? AND is_default=1 LIMIT 1) WHERE branch_id=?', [req.kitchenId, req.params.id]);
  run('DELETE FROM branches WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

/* ── Settings (kitchen-level) ──────────────────────────────── */
app.get('/api/settings', requirePermission('dashboard'), (req, res) => {
  const kitchen = get('SELECT * FROM kitchens WHERE id=?', [req.kitchenId]);
  res.json({ kitchen_name: kitchen?.name || '', currency: kitchen?.currency || 'KES' });
});

app.put('/api/settings', requirePermission('settings'), (req, res) => {
  const { kitchen_name, currency } = req.body;
  run('UPDATE kitchens SET name=?, currency=? WHERE id=?', [kitchen_name, currency, req.kitchenId]);
  res.json({ ok: true });
});

/* ── Materials (branch-scoped) ─────────────────────────────── */
app.get('/api/materials', requirePermission('stock'), (req, res) => {
  const bId = resolveBranchId(req);
  res.json(all('SELECT * FROM materials WHERE kitchen_id=? AND branch_id=? ORDER BY name', [req.kitchenId, bId]));
});

app.post('/api/materials', requirePermission('settings'), (req, res) => {
  const bId = resolveBranchId(req);
  const { name, unit, alert_level, stock, unit_price } = req.body;
  const id = uid();
  run('INSERT INTO materials (id,kitchen_id,branch_id,name,unit,alert_level,stock,unit_price) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.kitchenId, bId, name, unit, alert_level || 1, stock || 0, unit_price || 0]);
  res.json({ id });
});

app.put('/api/materials/:id', requirePermission('settings'), (req, res) => {
  const { name, unit, alert_level, stock, unit_price } = req.body;
  run('UPDATE materials SET name=?,unit=?,alert_level=?,stock=?,unit_price=? WHERE id=? AND kitchen_id=?',
    [name, unit, alert_level, stock, unit_price, req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

app.delete('/api/materials/:id', requirePermission('settings'), (req, res) => {
  run('DELETE FROM materials WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

/* ── Products (branch-scoped) ──────────────────────────────── */
app.get('/api/products', requirePermission('dashboard'), (req, res) => {
  const bId = resolveBranchId(req);
  res.json(all('SELECT * FROM products WHERE kitchen_id=? AND branch_id=? ORDER BY name', [req.kitchenId, bId]));
});

app.post('/api/products', requirePermission('settings'), (req, res) => {
  const bId = resolveBranchId(req);
  const { name, unit, selling_price } = req.body;
  const id = uid();
  run('INSERT INTO products (id,kitchen_id,branch_id,name,unit,selling_price) VALUES (?,?,?,?,?,?)',
    [id, req.kitchenId, bId, name, unit, selling_price || 0]);
  res.json({ id });
});

app.put('/api/products/:id', requirePermission('settings'), (req, res) => {
  const { name, unit, selling_price } = req.body;
  run('UPDATE products SET name=?,unit=?,selling_price=? WHERE id=? AND kitchen_id=?',
    [name, unit, selling_price, req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

app.delete('/api/products/:id', requirePermission('settings'), (req, res) => {
  run('DELETE FROM products WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

/* ── Purchases (branch-scoped) ─────────────────────────────── */
app.get('/api/purchases', requirePermission('procurement'), (req, res) => {
  const bId = resolveBranchId(req);
  res.json(all('SELECT * FROM purchases WHERE kitchen_id=? AND branch_id=? ORDER BY date DESC, created_at DESC', [req.kitchenId, bId]));
});

app.post('/api/purchases', requirePermission('procurement'), (req, res) => {
  const bId = resolveBranchId(req);
  const { material_id, qty, cost_per_unit, supplier, date } = req.body;
  const total = qty * cost_per_unit;
  const id = uid();
  run('INSERT INTO purchases (id,kitchen_id,branch_id,material_id,qty,cost_per_unit,total,supplier,date) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, req.kitchenId, bId, material_id, qty, cost_per_unit, total, supplier || '', date]);
  run('UPDATE materials SET stock = stock + ?, unit_price = ? WHERE id=? AND kitchen_id=?',
    [qty, cost_per_unit, material_id, req.kitchenId]);
  res.json({ id, total });
});

// Edit a purchase (admin only) — adjusts stock by the delta
app.put('/api/purchases/:id', requirePermission('procurement'), (req, res) => {
  if (req.user.role !== 'admin' && !req.user.is_super_admin) return res.status(403).json({ error: 'Only admins can edit records' });
  const existing = get('SELECT * FROM purchases WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  if (!existing) return res.status(404).json({ error: 'Purchase not found' });
  const { qty, cost_per_unit, supplier, date } = req.body;
  const newQty = qty != null ? qty : existing.qty;
  const newCost = cost_per_unit != null ? cost_per_unit : existing.cost_per_unit;
  const total = newQty * newCost;
  const qtyDelta = newQty - existing.qty;
  run('UPDATE purchases SET qty=?, cost_per_unit=?, total=?, supplier=?, date=? WHERE id=?',
    [newQty, newCost, total, supplier ?? existing.supplier, date || existing.date, req.params.id]);
  run('UPDATE materials SET stock = stock + ?, unit_price=? WHERE id=? AND kitchen_id=?', [qtyDelta, newCost, existing.material_id, req.kitchenId]);
  res.json({ ok: true, total });
});

app.delete('/api/purchases/:id', requirePermission('procurement'), (req, res) => {
  const p = get('SELECT * FROM purchases WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  if (p) {
    run('UPDATE materials SET stock = MAX(0, stock - ?) WHERE id=? AND kitchen_id=?', [p.qty, p.material_id, req.kitchenId]);
    run('DELETE FROM purchases WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  }
  res.json({ ok: true });
});

/* ── Productions (branch-scoped, editable by admin) ───────────── */
app.get('/api/productions', requirePermission('production'), (req, res) => {
  const bId = resolveBranchId(req);
  const prods = all('SELECT * FROM productions WHERE kitchen_id=? AND branch_id=? ORDER BY date DESC, created_at DESC', [req.kitchenId, bId]);
  const result = prods.map(p => ({
    ...p,
    materials: all(
      'SELECT pm.*, m.name as material_name, m.unit FROM production_materials pm JOIN materials m ON pm.material_id = m.id WHERE pm.production_id=? AND pm.kitchen_id=?',
      [p.id, req.kitchenId]
    )
  }));
  res.json(result);
});

app.post('/api/productions', requirePermission('production'), (req, res) => {
  const bId = resolveBranchId(req);
  const { product_id, units, date, materials } = req.body;
  const id = uid();
  let totalCost = 0;
  materials.forEach(m => {
    const mat = get('SELECT * FROM materials WHERE id=? AND kitchen_id=?', [m.material_id, req.kitchenId]);
    const cost = (mat ? mat.unit_price : 0) * m.qty;
    totalCost += cost;
    run('INSERT INTO production_materials (id,kitchen_id,branch_id,production_id,material_id,qty,cost) VALUES (?,?,?,?,?,?,?)',
      [uid(), req.kitchenId, bId, id, m.material_id, m.qty, cost]);
    run('UPDATE materials SET stock = MAX(0, stock - ?) WHERE id=? AND kitchen_id=?', [m.qty, m.material_id, req.kitchenId]);
  });
  run('INSERT INTO productions (id,kitchen_id,branch_id,product_id,units,total_cost,date) VALUES (?,?,?,?,?,?,?)',
    [id, req.kitchenId, bId, product_id, units, totalCost, date]);
  res.json({ id, total_cost: totalCost });
});

// Edit production batch (admin only) — simplest correct approach: restore old material usage, then re-apply new
app.put('/api/productions/:id', requirePermission('production'), (req, res) => {
  if (req.user.role !== 'admin' && !req.user.is_super_admin) return res.status(403).json({ error: 'Only admins can edit records' });
  const existing = get('SELECT * FROM productions WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  if (!existing) return res.status(404).json({ error: 'Production batch not found' });
  const { product_id, units, date, materials } = req.body;

  // Restore stock from old materials usage
  const oldMats = all('SELECT * FROM production_materials WHERE production_id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  oldMats.forEach(m => run('UPDATE materials SET stock = stock + ? WHERE id=? AND kitchen_id=?', [m.qty, m.material_id, req.kitchenId]));
  run('DELETE FROM production_materials WHERE production_id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);

  // Apply new materials usage
  let totalCost = 0;
  (materials || []).forEach(m => {
    const mat = get('SELECT * FROM materials WHERE id=? AND kitchen_id=?', [m.material_id, req.kitchenId]);
    const cost = (mat ? mat.unit_price : 0) * m.qty;
    totalCost += cost;
    run('INSERT INTO production_materials (id,kitchen_id,branch_id,production_id,material_id,qty,cost) VALUES (?,?,?,?,?,?,?)',
      [uid(), req.kitchenId, existing.branch_id, req.params.id, m.material_id, m.qty, cost]);
    run('UPDATE materials SET stock = MAX(0, stock - ?) WHERE id=? AND kitchen_id=?', [m.qty, m.material_id, req.kitchenId]);
  });

  run('UPDATE productions SET product_id=?, units=?, total_cost=?, date=? WHERE id=?',
    [product_id || existing.product_id, units || existing.units, totalCost, date || existing.date, req.params.id]);
  res.json({ ok: true, total_cost: totalCost });
});

app.delete('/api/productions/:id', requirePermission('production'), (req, res) => {
  const mats = all('SELECT * FROM production_materials WHERE production_id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  mats.forEach(m => run('UPDATE materials SET stock = stock + ? WHERE id=? AND kitchen_id=?', [m.qty, m.material_id, req.kitchenId]));
  run('DELETE FROM production_materials WHERE production_id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  run('DELETE FROM productions WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

/* ── Sales (branch-scoped, editable by admin) ─────────────────── */
app.get('/api/sales', requirePermission('sales'), (req, res) => {
  const bId = resolveBranchId(req);
  const { period } = req.query;
  const todayStr = new Date().toISOString().split('T')[0];
  let where = 'WHERE kitchen_id=? AND branch_id=?';
  const params = [req.kitchenId, bId];
  if (period === 'day') { where += ` AND date = ?`; params.push(todayStr); }
  else if (period === 'week') { where += ` AND date >= date(?, '-7 days')`; params.push(todayStr); }
  else if (period === 'month') { where += ` AND date >= date(?, 'start of month')`; params.push(todayStr); }
  else if (period === 'year') { where += ` AND date >= date(?, 'start of year')`; params.push(todayStr); }
  res.json(all(`SELECT * FROM sales ${where} ORDER BY date DESC, created_at DESC`, params));
});

app.post('/api/sales', requirePermission('sales'), (req, res) => {
  const bId = resolveBranchId(req);
  const { product_id, units, date } = req.body;
  const product = get('SELECT * FROM products WHERE id=? AND kitchen_id=?', [product_id, req.kitchenId]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const revenue = units * product.selling_price;
  const id = uid();
  run('INSERT INTO sales (id,kitchen_id,branch_id,product_id,units,revenue,date) VALUES (?,?,?,?,?,?,?)',
    [id, req.kitchenId, bId, product_id, units, revenue, date]);
  res.json({ id, revenue });
});

// Edit a sale (admin only)
app.put('/api/sales/:id', requirePermission('sales'), (req, res) => {
  if (req.user.role !== 'admin' && !req.user.is_super_admin) return res.status(403).json({ error: 'Only admins can edit records' });
  const existing = get('SELECT * FROM sales WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  if (!existing) return res.status(404).json({ error: 'Sale not found' });
  const { product_id, units, date } = req.body;
  const pid = product_id || existing.product_id;
  const product = get('SELECT * FROM products WHERE id=? AND kitchen_id=?', [pid, req.kitchenId]);
  const newUnits = units != null ? units : existing.units;
  const revenue = newUnits * (product ? product.selling_price : 0);
  run('UPDATE sales SET product_id=?, units=?, revenue=?, date=? WHERE id=?', [pid, newUnits, revenue, date || existing.date, req.params.id]);
  res.json({ ok: true, revenue });
});

app.delete('/api/sales/:id', requirePermission('sales'), (req, res) => {
  run('DELETE FROM sales WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

/* ── Analytics (branch-scoped, or consolidated for multi-branch plans) ── */
app.get('/api/analytics/summary', requirePermission('analytics'), (req, res) => {
  const kId = req.kitchenId;
  const bId = resolveBranchId(req);
  const todayStr = new Date().toISOString().split('T')[0];
  const totalRevenue = (get('SELECT COALESCE(SUM(revenue),0) as v FROM sales WHERE kitchen_id=? AND branch_id=?', [kId, bId]) || {}).v || 0;
  const totalExpenses = (get('SELECT COALESCE(SUM(total),0) as v FROM purchases WHERE kitchen_id=? AND branch_id=?', [kId, bId]) || {}).v || 0;
  const todayRev = (get(`SELECT COALESCE(SUM(revenue),0) as v FROM sales WHERE kitchen_id=? AND branch_id=? AND date=?`, [kId, bId, todayStr]) || {}).v || 0;
  const weekRev = (get(`SELECT COALESCE(SUM(revenue),0) as v FROM sales WHERE kitchen_id=? AND branch_id=? AND date >= date(?,'-7 days')`, [kId, bId, todayStr]) || {}).v || 0;
  const monthRev = (get(`SELECT COALESCE(SUM(revenue),0) as v FROM sales WHERE kitchen_id=? AND branch_id=? AND date >= date(?,'start of month')`, [kId, bId, todayStr]) || {}).v || 0;
  const yearRev = (get(`SELECT COALESCE(SUM(revenue),0) as v FROM sales WHERE kitchen_id=? AND branch_id=? AND date >= date(?,'start of year')`, [kId, bId, todayStr]) || {}).v || 0;
  res.json({ totalRevenue, totalExpenses, profit: totalRevenue - totalExpenses, todayRev, weekRev, monthRev, yearRev });
});

app.get('/api/analytics/products', requirePermission('analytics'), (req, res) => {
  const kId = req.kitchenId;
  const bId = resolveBranchId(req);
  const products = all('SELECT * FROM products WHERE kitchen_id=? AND branch_id=?', [kId, bId]);
  const result = products.map(p => {
    const sold = get(`SELECT COALESCE(SUM(units),0) as u, COALESCE(SUM(revenue),0) as r FROM sales WHERE product_id=? AND kitchen_id=?`, [p.id, kId]) || { u: 0, r: 0 };
    const prod = get(`SELECT COALESCE(SUM(units),0) as u, COALESCE(SUM(total_cost),0) as c FROM productions WHERE product_id=? AND kitchen_id=?`, [p.id, kId]) || { u: 0, c: 0 };
    const costPerUnit = prod.u > 0 ? prod.c / prod.u : 0;
    const profit = sold.r - prod.c;
    const margin = sold.r > 0 ? Math.round((profit / sold.r) * 100) : 0;
    return { ...p, units_sold: sold.u, revenue: sold.r, total_cost: prod.c, units_produced: prod.u, cost_per_unit: costPerUnit, profit, margin };
  });
  res.json(result);
});

app.get('/api/analytics/materials', requirePermission('analytics'), (req, res) => {
  const kId = req.kitchenId;
  const bId = resolveBranchId(req);
  const materials = all('SELECT * FROM materials WHERE kitchen_id=? AND branch_id=?', [kId, bId]);
  const result = materials.map(m => {
    const purch = get('SELECT COALESCE(SUM(qty),0) as q, COALESCE(SUM(total),0) as t FROM purchases WHERE material_id=? AND kitchen_id=?', [m.id, kId]) || { q: 0, t: 0 };
    const used = get('SELECT COALESCE(SUM(qty),0) as q FROM production_materials WHERE material_id=? AND kitchen_id=?', [m.id, kId]) || { q: 0 };
    return { ...m, total_purchased: purch.q, total_spent: purch.t, total_used: used.q };
  });
  res.json(result);
});

// Multi-branch consolidated report (Pro/Enterprise feature)
app.get('/api/analytics/branches', requirePermission('analytics'), (req, res) => {
  const kitchen = get('SELECT * FROM kitchens WHERE id=?', [req.kitchenId]);
  const planStatus = getKitchenPlanStatus(kitchen);
  if (!planStatus.features.includes('multi_branch_reports')) {
    return res.status(403).json({ error: 'Multi-branch reports require the Pro or Enterprise plan.' });
  }
  const branches = all('SELECT * FROM branches WHERE kitchen_id=?', [req.kitchenId]);
  const result = branches.map(b => {
    const revenue = (get('SELECT COALESCE(SUM(revenue),0) as v FROM sales WHERE branch_id=?', [b.id]) || {}).v || 0;
    const expenses = (get('SELECT COALESCE(SUM(total),0) as v FROM purchases WHERE branch_id=?', [b.id]) || {}).v || 0;
    return { ...b, revenue, expenses, profit: revenue - expenses };
  });
  res.json(result);
});

/* ── Alerts ─────────────────────────────────────────────────── */
app.get('/api/alerts', requirePermission('stock'), (req, res) => {
  const bId = resolveBranchId(req);
  res.json(all('SELECT * FROM materials WHERE kitchen_id=? AND branch_id=? AND stock <= alert_level', [req.kitchenId, bId]));
});

/* ── User management (kitchen admin: manage own kitchen's users) ── */
app.get('/api/users', requirePermission('users'), (req, res) => {
  if (req.user.is_super_admin) return res.status(400).json({ error: 'Super admin manages kitchens, not individual kitchen users this way' });
  const users = all('SELECT id,username,role,permissions,status,branch_id,created_at FROM users WHERE kitchen_id=?', [req.kitchenId]);
  res.json(users.map(u => ({ ...u, permissions: JSON.parse(u.permissions || '[]') })));
});

app.post('/api/users', requirePermission('users'), (req, res) => {
  const kitchen = get('SELECT * FROM kitchens WHERE id=?', [req.kitchenId]);
  const planStatus = getKitchenPlanStatus(kitchen);
  const userCount = get('SELECT COUNT(*) as c FROM users WHERE kitchen_id=?', [req.kitchenId]).c;
  if (planStatus.max_users !== null && userCount >= planStatus.max_users) {
    return res.status(403).json({ error: `Your ${planStatus.plan_label} plan allows up to ${planStatus.max_users} user(s). Upgrade to add more team members.` });
  }
  const { username, password, role, permissions, branch_id } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const existing = get('SELECT id FROM users WHERE username=?', [username]);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  let perms = permissions;
  if (!perms || !perms.length) perms = DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.staff;
  const id = uid();
  const hash = bcrypt.hashSync(password, 10);
  const defaultBranch = get('SELECT id FROM branches WHERE kitchen_id=? AND is_default=1', [req.kitchenId]);
  run('INSERT INTO users (id,kitchen_id,branch_id,username,password_hash,role,permissions,is_super_admin,status) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, req.kitchenId, branch_id || (defaultBranch ? defaultBranch.id : null), username, hash, role || 'staff', JSON.stringify(perms), 0, 'active']);
  res.json({ id });
});

app.put('/api/users/:id', requirePermission('users'), (req, res) => {
  const target = get('SELECT * FROM users WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const { role, permissions, status, password, branch_id } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    run('UPDATE users SET password_hash=? WHERE id=?', [hash, req.params.id]);
  }
  const newRole = role || target.role;
  const newPerms = permissions || JSON.parse(target.permissions || '[]');
  const newStatus = status || target.status;
  const newBranch = branch_id || target.branch_id;
  run('UPDATE users SET role=?, permissions=?, status=?, branch_id=? WHERE id=? AND kitchen_id=?',
    [newRole, JSON.stringify(newPerms), newStatus, newBranch, req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requirePermission('users'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account" });
  run('DELETE FROM users WHERE id=? AND kitchen_id=?', [req.params.id, req.kitchenId]);
  res.json({ ok: true });
});

/* ── Billing (kitchen admin: view plan, submit payment reference) ── */
app.get('/api/billing', requirePermission('billing'), (req, res) => {
  const kitchen = get('SELECT * FROM kitchens WHERE id=?', [req.kitchenId]);
  res.json({ kitchen, planStatus: getKitchenPlanStatus(kitchen), plans: PLANS });
});

app.post('/api/billing/select-plan', requirePermission('billing'), (req, res) => {
  const { plan, payment_reference } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan selected' });
  if (plan === 'enterprise') {
    run('UPDATE kitchens SET plan=?, payment_status=? WHERE id=?', [plan, 'contact_pending', req.kitchenId]);
    return res.json({ ok: true, message: 'Our team will contact you shortly to set up your Enterprise plan.' });
  }
  if (!payment_reference) return res.status(400).json({ error: 'Please provide your M-Pesa or payment reference number' });
  run('UPDATE kitchens SET plan=?, payment_reference=?, payment_status=? WHERE id=?',
    [plan, payment_reference, 'pending_review', req.kitchenId]);
  res.json({ ok: true, message: 'Payment reference submitted. Your plan will be activated once confirmed by our team.' });
});

/* ════════════════════════════════════════════════════════════
   SUPER ADMIN (platform owner) — manage all kitchens & payments
   ════════════════════════════════════════════════════════════ */
app.get('/api/platform/kitchens', requireSuperAdmin, (req, res) => {
  const kitchens = all('SELECT * FROM kitchens ORDER BY created_at DESC');
  const result = kitchens.map(k => {
    const userCount = get('SELECT COUNT(*) as c FROM users WHERE kitchen_id=?', [k.id]).c;
    const branchCount = get('SELECT COUNT(*) as c FROM branches WHERE kitchen_id=?', [k.id]).c;
    const revenue = (get('SELECT COALESCE(SUM(revenue),0) as v FROM sales WHERE kitchen_id=?', [k.id]) || {}).v || 0;
    return { ...k, user_count: userCount, branch_count: branchCount, total_revenue: revenue, planStatus: getKitchenPlanStatus(k) };
  });
  res.json(result);
});

app.put('/api/platform/kitchens/:id', requireSuperAdmin, (req, res) => {
  const { status, name, currency } = req.body;
  const k = get('SELECT * FROM kitchens WHERE id=?', [req.params.id]);
  if (!k) return res.status(404).json({ error: 'Kitchen not found' });
  run('UPDATE kitchens SET status=?, name=?, currency=? WHERE id=?',
    [status || k.status, name || k.name, currency || k.currency, req.params.id]);
  res.json({ ok: true });
});

// Super admin confirms a payment → activates plan for 30 days from now
app.post('/api/platform/kitchens/:id/confirm-payment', requireSuperAdmin, (req, res) => {
  const k = get('SELECT * FROM kitchens WHERE id=?', [req.params.id]);
  if (!k) return res.status(404).json({ error: 'Kitchen not found' });
  const activeUntil = addDays(new Date(), 30);
  run('UPDATE kitchens SET payment_status=?, subscription_active_until=? WHERE id=?', ['confirmed', activeUntil, req.params.id]);
  res.json({ ok: true, active_until: activeUntil });
});

app.post('/api/platform/kitchens/:id/reject-payment', requireSuperAdmin, (req, res) => {
  run('UPDATE kitchens SET payment_status=? WHERE id=?', ['rejected', req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/platform/kitchens/:id', requireSuperAdmin, (req, res) => {
  const kId = req.params.id;
  ['sales','production_materials','productions','purchases','products','materials','users','branches'].forEach(table => {
    run(`DELETE FROM ${table} WHERE kitchen_id=?`, [kId]);
  });
  run('DELETE FROM kitchens WHERE id=?', [kId]);
  res.json({ ok: true });
});

/* ── Catch-all (SPA) ────────────────────────────────────────── */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

dbMod.initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Bakery Kitchen Manager (multi-tenant, multi-branch SaaS) running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
