/* ── State ─────────────────────────────────────────────────── */
const App = {
  user: null, kitchen: null, planStatus: null,
  branches: [], currentBranchId: null,
  settings: { kitchen_name: 'My Baking Kitchen', currency: 'KES' },
  materials: [], products: [], purchases: [], productions: [], sales: [],
  currentPage: 'dashboard',
  saleTab: 'all', analyticTab: 'overview', settingsTab: 'general',
  prodMaterialRows: [],
  isRegisterMode: false,
};

const PAGE_META = {
  dashboard:   { label: 'Dashboard', icon: 'ti-layout-dashboard', section: 'Overview' },
  procurement: { label: 'Procurement', icon: 'ti-shopping-cart', section: 'Operations' },
  stock:       { label: 'Stock', icon: 'ti-box', section: 'Operations' },
  production:  { label: 'Production', icon: 'ti-tools-kitchen-2', section: 'Operations' },
  sales:       { label: 'Sales', icon: 'ti-receipt', section: 'Operations' },
  analytics:   { label: 'Analytics & P&L', icon: 'ti-chart-bar', section: 'Finance' },
  branches:    { label: 'Branches', icon: 'ti-building-store', section: 'Setup' },
  settings:    { label: 'Settings', icon: 'ti-settings', section: 'Setup' },
  users:       { label: 'Team & Permissions', icon: 'ti-users', section: 'Setup' },
  billing:     { label: 'Billing & Plan', icon: 'ti-credit-card', section: 'Setup' },
  account:     { label: 'My Account', icon: 'ti-user-circle', section: 'Setup' },
  platform:    { label: 'All Kitchens', icon: 'ti-building-store', section: 'Platform' },
};

const PLAN_FEATURES_DISPLAY = {
  starter: { name: 'Starter', price: 999, branches: 1, users: 1, points: ['1 branch', '1 user account', 'Procurement & production tracking', 'Stock alerts', 'Sales recording', 'No analytics dashboard'] },
  advanced: { name: 'Advanced', price: 1999, branches: 2, users: 2, points: ['Up to 2 branches', 'Up to 2 user accounts', 'Everything in Starter', 'Full analytics & P&L', 'Team permission controls'] },
  pro: { name: 'Pro', price: 2999, branches: 5, users: 10, points: ['Up to 5 branches', 'Up to 10 user accounts', 'Everything in Advanced', 'Consolidated multi-branch reports', 'Data export'] },
  enterprise: { name: 'Enterprise', price: null, branches: null, users: null, points: ['Unlimited / custom branches', 'Unlimited / custom users', 'Everything in Pro', 'Priority support', 'Custom onboarding'] },
};

/* ── API ───────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (r.status === 402 && data.error === 'TRIAL_EXPIRED') {
    handleTrialExpired(data.planStatus);
    throw new Error(data.message || 'Trial expired');
  }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const GET  = p => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT  = (p, b) => api('PUT', p, b);
const DEL  = p => api('DELETE', p);

function branchQS() {
  return (App.user && App.user.role === 'admin' && App.currentBranchId) ? `?branch_id=${App.currentBranchId}` : '';
}

/* ── Helpers ───────────────────────────────────────────────── */
function fmt(n) { return Number(n||0).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2}); }
function fmtMoney(n) { return App.settings.currency + ' ' + fmt(n); }
function today() { return new Date().toISOString().split('T')[0]; }
function getMat(id) { return App.materials.find(m => m.id === id); }
function getProd(id) { return App.products.find(p => p.id === id); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
function pill(label, cls) { return `<span class="pill pill-${cls}">${label}</span>`; }
function toast(msg, dur=2800) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}
function can(page) {
  if (!App.user) return false;
  if (App.user.is_super_admin) return true;
  if (App.user.role === 'admin') return true;
  return (App.user.permissions || []).includes(page);
}
function isAdmin() { return App.user && (App.user.role === 'admin' || App.user.is_super_admin); }

/* ════════════════════════════════════════════════════════════
   LANDING PAGE
   ════════════════════════════════════════════════════════════ */
function goToAuth(registerMode) {
  document.getElementById('landingPage').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  if (registerMode !== App.isRegisterMode) toggleAuthMode();
}

function goToLanding() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('landingPage').style.display = 'block';
}

function renderPricingGrid() {
  const grid = document.getElementById('pricingGrid');
  if (!grid) return;
  const order = ['starter','advanced','pro','enterprise'];
  grid.innerHTML = order.map(key => {
    const p = PLAN_FEATURES_DISPLAY[key];
    const featured = key === 'advanced';
    const priceHtml = p.price === null
      ? `<div class="land-plan-price">Custom</div>`
      : `<div class="land-plan-price">KES ${p.price}<small>/month</small></div>`;
    return `<div class="land-plan ${featured?'featured':''}">
      <div class="land-plan-name">${p.name}</div>
      ${priceHtml}
      <div class="land-plan-desc">${key==='enterprise' ? 'For growing chains needing custom limits' : `Up to ${p.branches} branch(es), ${p.users} user(s)`}</div>
      <ul class="land-plan-list">${p.points.map(pt => `<li><i class="ti ti-check"></i>${pt}</li>`).join('')}</ul>
      <button class="btn ${featured?'btn-primary':'btn-outline'} btn-block" onclick="goToAuth(true)">${key==='enterprise'?'Contact us':'Start free trial'}</button>
    </div>`;
  }).join('');
}

document.getElementById('landYear').textContent = new Date().getFullYear();
renderPricingGrid();

/* ════════════════════════════════════════════════════════════
   AUTH FLOW
   ════════════════════════════════════════════════════════════ */
function toggleAuthMode() {
  App.isRegisterMode = !App.isRegisterMode;
  document.getElementById('loginForm').style.display = App.isRegisterMode ? 'none' : 'block';
  document.getElementById('registerForm').style.display = App.isRegisterMode ? 'block' : 'none';
  document.getElementById('authSubtitle').textContent = App.isRegisterMode ? 'Start your 14-day free trial' : 'Sign in to your kitchen account';
  document.getElementById('authSwitch').innerHTML = App.isRegisterMode
    ? `Already have an account? <a onclick="toggleAuthMode()">Sign in</a>`
    : `Don't have a kitchen account? <a onclick="toggleAuthMode()">Start your free trial</a>`;
  document.getElementById('authError').classList.remove('show');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  try { await POST('/api/auth/login', { username, password }); await onAuthSuccess(); }
  catch (err) { showAuthError(err.message); }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const kitchen_name = document.getElementById('regKitchenName').value.trim();
  const currency = document.getElementById('regCurrency').value;
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  try { await POST('/api/auth/register', { kitchen_name, currency, username, password }); await onAuthSuccess(); }
  catch (err) { showAuthError(err.message); }
});

async function onAuthSuccess() {
  document.getElementById('authError').classList.remove('show');
  await checkSession();
}

async function checkSession() {
  try {
    const data = await GET('/api/auth/me');
    App.user = data.user; App.kitchen = data.kitchen; App.planStatus = data.planStatus;
    App.currentBranchId = App.user.branch_id;
    document.getElementById('landingPage').style.display = 'none';
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    if (!App.user.is_super_admin) {
      App.branches = await GET('/api/branches');
    }
    buildNav();
    renderTrialBanner();
    await loadAll();
    showPage(App.user.is_super_admin ? 'platform' : 'dashboard');
  } catch (err) {
    document.getElementById('app').style.display = 'none';
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('landingPage').style.display = 'block';
  }
}

async function logout() {
  try { await POST('/api/auth/logout'); } catch(e) {}
  App.user = null; App.kitchen = null;
  location.reload();
}

function handleTrialExpired(planStatus) {
  App.planStatus = planStatus;
  toast('Your trial/subscription has expired. Redirecting to billing...', 4000);
  setTimeout(() => showPage('billing'), 600);
}

/* ── Trial / subscription banner in sidebar ──────────────────── */
function renderTrialBanner() {
  const el = document.getElementById('trialBanner');
  if (!App.planStatus || App.user.is_super_admin) { el.style.display = 'none'; return; }
  const ps = App.planStatus;
  el.style.display = 'block';
  if (ps.plan === 'trial') {
    if (ps.is_locked) {
      el.className = 'danger';
      el.innerHTML = `<i class="ti ti-alert-triangle"></i> Trial expired. <a onclick="showPage('billing')">Upgrade now</a>`;
    } else {
      el.className = '';
      el.innerHTML = `<i class="ti ti-clock"></i> ${ps.days_left} day${ps.days_left===1?'':'s'} left in free trial. <a onclick="showPage('billing')">Upgrade</a>`;
    }
  } else if (ps.is_locked) {
    el.className = 'danger';
    el.innerHTML = `<i class="ti ti-alert-triangle"></i> Subscription expired. <a onclick="showPage('billing')">Renew now</a>`;
  } else {
    el.style.display = 'none';
  }
}

/* ── Build sidebar nav based on permissions & plan features ──── */
function buildNav() {
  const isSuperAdmin = App.user.is_super_admin;
  let pages;
  if (isSuperAdmin) {
    pages = ['platform'];
  } else {
    pages = Object.keys(PAGE_META).filter(p => p !== 'platform' && p !== 'account' && can(p));
    pages.push('account'); // always visible to everyone
  }
  const sections = {};
  pages.forEach(p => {
    const sec = PAGE_META[p].section;
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(p);
  });
  let html = '';
  Object.entries(sections).forEach(([sec, pageList]) => {
    html += `<div class="nav-section"><div class="nav-label">${sec}</div>`;
    pageList.forEach(p => {
      const meta = PAGE_META[p];
      const dot = p === 'stock' ? '<span class="alert-dot" style="display:none"></span>' : '';
      html += `<div class="nav-item" data-page="${p}" onclick="showPage('${p}')"><i class="ti ${meta.icon}"></i> ${meta.label} ${dot}</div>`;
    });
    html += `</div>`;
  });
  document.getElementById('navContainer').innerHTML = html;

  document.getElementById('userChipName').textContent = App.user.username;
  document.getElementById('userChipRole').textContent = App.user.is_super_admin ? 'Platform owner' : App.user.role;
  document.getElementById('userAvatar').textContent = App.user.username.charAt(0).toUpperCase();
  document.getElementById('sidebarKitchenName').textContent = App.kitchen ? App.kitchen.name : 'Platform Admin';

  const curBranch = App.branches.find(b => b.id === App.currentBranchId);
  document.getElementById('sidebarBranchName').textContent = curBranch ? curBranch.name : 'Management System';

  renderBranchSwitcher();
}

function renderBranchSwitcher() {
  const container = document.getElementById('branchSwitcherContainer');
  if (!container) return;
  if (App.user.is_super_admin || !isAdmin() || App.branches.length <= 1) { container.innerHTML = ''; return; }
  container.innerHTML = `<select class="branch-switcher" id="branchSwitcher" onchange="switchBranch(this.value)">
    ${App.branches.map(b => `<option value="${b.id}" ${b.id===App.currentBranchId?'selected':''}>${b.name}</option>`).join('')}
  </select>`;
}

async function switchBranch(branchId) {
  App.currentBranchId = branchId;
  const curBranch = App.branches.find(b => b.id === branchId);
  document.getElementById('sidebarBranchName').textContent = curBranch ? curBranch.name : '';
  await loadAll();
  renderPage(App.currentPage);
}

/* ── Load all tenant data for current branch ─────────────────── */
async function loadAll() {
  if (App.user.is_super_admin) return;
  const qs = branchQS();
  const [settings, materials, products, purchases, productions, sales] = await Promise.all([
    GET('/api/settings'), GET('/api/materials'+qs), GET('/api/products'+qs),
    GET('/api/purchases'+qs), GET('/api/productions'+qs), GET('/api/sales'+qs),
  ]);
  App.settings = settings;
  App.materials = materials; App.products = products;
  App.purchases = purchases; App.productions = productions; App.sales = sales;
}

/* ── Navigation ────────────────────────────────────────────── */
function showPage(name) {
  if (name !== 'platform' && name !== 'account' && !can(name)) { toast("You don't have permission to view this page"); return; }
  App.currentPage = name;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === name));
  document.getElementById('pageTitle').textContent = PAGE_META[name]?.label || name;
  renderPage(name);
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

async function renderPage(name) {
  const el = document.getElementById('content');
  el.innerHTML = '';
  try {
    if (name === 'dashboard') await renderDashboard(el);
    else if (name === 'procurement') await renderProcurement(el);
    else if (name === 'stock') await renderStock(el);
    else if (name === 'production') await renderProduction(el);
    else if (name === 'sales') await renderSales(el);
    else if (name === 'analytics') await renderAnalytics(el);
    else if (name === 'settings') await renderSettings(el);
    else if (name === 'users') await renderUsers(el);
    else if (name === 'branches') await renderBranches(el);
    else if (name === 'billing') await renderBilling(el);
    else if (name === 'account') await renderAccount(el);
    else if (name === 'platform') await renderPlatform(el);
  } catch (err) {
    if (err.message !== 'Trial expired') {
      el.innerHTML = `<div class="card"><div class="empty"><i class="ti ti-alert-circle"></i>${err.message}</div></div>`;
    }
  }
  updateAlertDot();
}

async function refresh() {
  await loadAll();
  renderPage(App.currentPage);
}

function updateAlertDot() {
  if (App.user.is_super_admin) return;
  const alerts = App.materials.filter(m => m.stock <= m.alert_level);
  document.querySelectorAll('.alert-dot').forEach(d => d.style.display = alerts.length ? 'block' : 'none');
}

/* ── DASHBOARD ─────────────────────────────────────────────── */
async function renderDashboard(el) {
  const summary = await GET('/api/analytics/summary'+branchQS());
  const alerts = App.materials.filter(m => m.stock <= m.alert_level);

  const alertsHtml = alerts.map(m => `
    <div class="alert-banner"><i class="ti ti-alert-triangle"></i>
      <div><strong>${m.name}</strong> is running low — <strong>${fmt(m.stock)} ${m.unit}</strong> left (alert at ${m.alert_level} ${m.unit}). Please restock.</div>
    </div>`).join('');

  const profit = summary.profit;
  const metricsHtml = `<div class="metrics-grid">
    <div class="metric"><div class="metric-label">Total revenue</div><div class="metric-value">${fmtMoney(summary.totalRevenue)}</div><div class="metric-sub">All time</div></div>
    <div class="metric"><div class="metric-label">Today's sales</div><div class="metric-value">${fmtMoney(summary.todayRev)}</div></div>
    <div class="metric"><div class="metric-label">Total expenses</div><div class="metric-value">${fmtMoney(summary.totalExpenses)}</div><div class="metric-sub">Procurement</div></div>
    <div class="metric"><div class="metric-label">Net profit</div><div class="metric-value ${profit>=0?'metric-up':'metric-down'}">${fmtMoney(profit)}</div><div class="metric-sub">${profit>=0?'Profit':'Loss'}</div></div>
  </div>`;

  const stockRows = App.materials.map(m => {
    const pct = Math.min(100, Math.round((m.stock / Math.max(m.alert_level*4, m.stock+0.01))*100));
    const status = m.stock <= m.alert_level ? 'danger' : m.stock <= m.alert_level*2 ? 'warn' : 'ok';
    const colors = { ok: '#1d9e75', warn: '#ef9f27', danger: '#e24b4a' };
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span>${m.name}</span><span style="color:var(--text-muted)">${fmt(m.stock)} ${m.unit}</span>
      </div>
      <div class="pbar"><div class="pbar-fill" style="width:${pct}%;background:${colors[status]}"></div></div>
    </div>`;
  }).join('');

  let prodRows = '';
  if (can('analytics')) {
    const prodData = await GET('/api/analytics/products'+branchQS());
    prodRows = prodData.map(p => `<tr>
      <td>${p.name}</td><td>${p.units_sold} ${p.unit}s</td><td>${fmtMoney(p.revenue)}</td>
      <td>${pill(p.margin+'%', p.margin>=40?'ok':p.margin>=10?'warn':'danger')}</td>
    </tr>`).join('');
  }

  const recentTx = [
    ...App.purchases.map(p => ({ date:p.date, type:'Purchase', desc: getMat(p.material_id)?.name||'', amount: -p.total })),
    ...App.sales.map(s => ({ date:s.date, type:'Sale', desc: getProd(s.product_id)?.name||'', amount: s.revenue })),
  ].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
  const txRows = recentTx.map(t => `<tr>
    <td>${t.date}</td><td>${pill(t.type, t.type==='Sale'?'ok':'info')}</td><td>${t.desc}</td>
    <td style="text-align:right;color:${t.amount>=0?'var(--green)':'var(--red)'}">${t.amount>=0?'+':''}${fmtMoney(Math.abs(t.amount))}</td>
  </tr>`).join('');

  el.innerHTML = `
    ${alertsHtml}${metricsHtml}
    <div class="grid2">
      <div class="card"><div class="card-header"><span class="card-title">Stock levels</span></div>${stockRows}</div>
      ${can('analytics') ? `<div class="card"><div class="card-header"><span class="card-title">Product performance</span></div>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Sold</th><th>Revenue</th><th>Margin</th></tr></thead><tbody>${prodRows}</tbody></table></div></div>` : ''}
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Recent transactions</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead><tbody>${txRows||'<tr><td colspan="4"><div class="empty">No transactions yet</div></td></tr>'}</tbody></table></div>
    </div>`;
}

/* ── PROCUREMENT ───────────────────────────────────────────── */
async function renderProcurement(el) {
  const matOpts = App.materials.map(m => `<option value="${m.id}">${m.name} (${m.unit}) — ${fmtMoney(m.unit_price)}/${m.unit}</option>`).join('');
  const rows = App.purchases.map(p => {
    const m = getMat(p.material_id);
    return `<tr>
      <td>${p.date}</td><td>${m?.name||p.material_id}</td><td>${fmt(p.qty)} ${m?.unit||''}</td>
      <td>${fmtMoney(p.cost_per_unit)}/${m?.unit||''}</td><td>${fmtMoney(p.total)}</td><td>${p.supplier||'—'}</td>
      <td style="display:flex;gap:4px">
        ${isAdmin() ? `<button class="btn btn-sm btn-icon" onclick="openEditPurchase('${p.id}')" title="Edit"><i class="ti ti-edit"></i></button>` : ''}
        <button class="btn btn-sm btn-danger btn-icon" onclick="deletePurchase('${p.id}')"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="form-section">
      <div class="form-section-title"><i class="ti ti-plus"></i> Record purchase</div>
      <div class="form-row cols3">
        <div class="form-group"><label>Raw material</label><select id="procMat">${matOpts}</select></div>
        <div class="form-group"><label>Quantity</label><input type="number" id="procQty" placeholder="0" min="0" step="0.01"></div>
        <div class="form-group"><label>Cost per unit (${App.settings.currency})</label><input type="number" id="procCost" placeholder="0" min="0" step="0.01"></div>
      </div>
      <div class="form-row cols2">
        <div class="form-group"><label>Supplier (optional)</label><input type="text" id="procSupplier" placeholder="Supplier name"></div>
        <div class="form-group"><label>Date</label><input type="date" id="procDate" value="${today()}"></div>
      </div>
      <button class="btn btn-primary" onclick="addPurchase()"><i class="ti ti-check"></i> Record purchase</button>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Purchase history</span><span class="card-sub">${App.purchases.length} records</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Material</th><th>Quantity</th><th>Unit cost</th><th>Total</th><th>Supplier</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7"><div class="empty"><i class="ti ti-shopping-cart"></i>No purchases yet</div></td></tr>'}</tbody></table></div>
    </div>
    <div id="modalContainer"></div>`;
}

async function addPurchase() {
  const material_id = document.getElementById('procMat').value;
  const qty = parseFloat(document.getElementById('procQty').value);
  const cost_per_unit = parseFloat(document.getElementById('procCost').value);
  const supplier = document.getElementById('procSupplier').value;
  const date = document.getElementById('procDate').value || today();
  if (!material_id || !qty || !cost_per_unit) { toast('Please fill material, quantity and cost'); return; }
  try { await POST('/api/purchases'+branchQS(), { material_id, qty, cost_per_unit, supplier, date }); toast('Purchase recorded ✓'); await refresh(); }
  catch (e) { toast(e.message); }
}

function openEditPurchase(id) {
  const p = App.purchases.find(x => x.id === id);
  if (!p) return;
  const m = getMat(p.material_id);
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <div class="modal-box">
        <div class="card-header"><span class="card-title">Edit purchase</span><button class="btn btn-icon" onclick="closeModal()"><i class="ti ti-x"></i></button></div>
        <div class="form-group"><label>Material</label><input type="text" value="${m?.name||''}" disabled></div>
        <div class="form-row cols2">
          <div class="form-group"><label>Quantity</label><input type="number" id="editPQty" value="${p.qty}" step="0.01"></div>
          <div class="form-group"><label>Cost per unit</label><input type="number" id="editPCost" value="${p.cost_per_unit}" step="0.01"></div>
        </div>
        <div class="form-row cols2">
          <div class="form-group"><label>Supplier</label><input type="text" id="editPSupplier" value="${p.supplier||''}"></div>
          <div class="form-group"><label>Date</label><input type="date" id="editPDate" value="${p.date}"></div>
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="saveEditPurchase('${p.id}')"><i class="ti ti-check"></i> Save changes</button>
      </div>
    </div>`;
}

async function saveEditPurchase(id) {
  const qty = parseFloat(document.getElementById('editPQty').value);
  const cost_per_unit = parseFloat(document.getElementById('editPCost').value);
  const supplier = document.getElementById('editPSupplier').value;
  const date = document.getElementById('editPDate').value;
  try { await PUT(`/api/purchases/${id}`, { qty, cost_per_unit, supplier, date }); toast('Purchase updated ✓'); closeModal(); await refresh(); }
  catch (e) { toast(e.message); }
}

function closeModal() { const c = document.getElementById('modalContainer'); if (c) c.innerHTML = ''; }

async function deletePurchase(id) {
  if (!confirm('Delete this purchase record? Stock will be adjusted.')) return;
  await DEL(`/api/purchases/${id}`); toast('Deleted'); await refresh();
}

/* ── STOCK ─────────────────────────────────────────────────── */
async function renderStock(el) {
  const alerts = App.materials.filter(m => m.stock <= m.alert_level);
  const alertsHtml = alerts.map(m => `
    <div class="alert-banner"><i class="ti ti-alert-triangle"></i>
      <div><strong>${m.name}</strong> — only <strong>${fmt(m.stock)} ${m.unit}</strong> remaining. Alert level: ${m.alert_level} ${m.unit}. Restock now.</div>
    </div>`).join('');

  const rows = App.materials.map(m => {
    const pct = Math.min(100, Math.round((m.stock / Math.max(m.alert_level*4, m.stock+0.01))*100));
    const status = m.stock <= m.alert_level ? 'danger' : m.stock <= m.alert_level*2 ? 'warn' : 'ok';
    const labels = { ok:'OK', warn:'Low', danger:'Critical' };
    const colors = { ok:'#1d9e75', warn:'#ef9f27', danger:'#e24b4a' };
    return `<tr class="${status==='danger'?'row-danger':''}">
      <td><strong>${m.name}</strong></td><td>${fmt(m.stock)} ${m.unit}</td>
      <td>${fmtMoney(m.unit_price)}/${m.unit}</td><td>${fmtMoney(m.stock * m.unit_price)}</td>
      <td>${m.alert_level} ${m.unit}</td>
      <td style="width:100px"><div class="pbar" style="width:90px"><div class="pbar-fill" style="width:${pct}%;background:${colors[status]}"></div></div></td>
      <td>${pill(labels[status], status)}</td>
    </tr>`;
  }).join('');

  const totalValue = App.materials.reduce((a,m) => a + m.stock * m.unit_price, 0);
  el.innerHTML = `
    ${alertsHtml}
    <div class="card">
      <div class="card-header"><span class="card-title">Raw material inventory</span><span class="card-sub">Total value: <strong>${fmtMoney(totalValue)}</strong></span></div>
      <div class="table-wrap"><table><thead><tr><th>Material</th><th>In stock</th><th>Unit price</th><th>Stock value</th><th>Alert level</th><th>Level</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

/* ── PRODUCTION ────────────────────────────────────────────── */
async function renderProduction(el) {
  if (!App.prodMaterialRows.length) App.prodMaterialRows = [uid()];
  const prodOpts = App.products.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  const matOpts = App.materials.map(m => `<option value="${m.id}">${m.name} (${m.unit})</option>`).join('');

  const matRowsHtml = App.prodMaterialRows.map((rowId,i) => `
    <div class="form-row cols2" id="pmrow-${rowId}" style="align-items:end;margin-bottom:6px">
      <div class="form-group"><label>Material</label><select id="pmMat-${rowId}">${matOpts}</select></div>
      <div style="display:flex;gap:6px;align-items:flex-end">
        <div class="form-group" style="flex:1"><label>Quantity used</label><input type="number" id="pmQty-${rowId}" placeholder="0" min="0" step="0.01"></div>
        ${i>0?`<button class="btn btn-sm btn-danger btn-icon" style="margin-bottom:1px" onclick="removeProdRow('${rowId}')"><i class="ti ti-x"></i></button>`:''}
      </div>
    </div>`).join('');

  const rows = App.productions.map(b => {
    const p = getProd(b.product_id);
    const mats = (b.materials||[]).map(m => `${fmt(m.qty)} ${m.unit||''} ${m.material_name||''}`).join(', ');
    const cpu = b.units > 0 ? b.total_cost/b.units : 0;
    return `<tr>
      <td>${b.date}</td><td>${p?.name||b.product_id}</td><td>${b.units} ${p?.unit||''}</td>
      <td style="font-size:12px;color:var(--text-muted);max-width:200px">${mats}</td>
      <td>${fmtMoney(b.total_cost)}</td><td>${fmtMoney(cpu)}</td>
      <td style="display:flex;gap:4px">
        ${isAdmin() ? `<button class="btn btn-sm btn-icon" onclick='openEditProduction(${JSON.stringify(b.id)})' title="Edit"><i class="ti ti-edit"></i></button>` : ''}
        <button class="btn btn-sm btn-danger btn-icon" onclick="deleteProd('${b.id}')"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="form-section">
      <div class="form-section-title"><i class="ti ti-tools-kitchen-2"></i> Log production batch</div>
      <div class="form-row cols2">
        <div class="form-group"><label>Product</label><select id="prodProduct">${prodOpts}</select></div>
        <div class="form-group"><label>Units produced</label><input type="number" id="prodUnits" placeholder="0" min="1"></div>
      </div>
      <div class="form-row cols2"><div class="form-group"><label>Production date</label><input type="date" id="prodDate" value="${today()}" style="max-width:200px"></div></div>
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Materials used</div>
      <div id="prodMatsContainer">${matRowsHtml}</div>
      <button class="btn" style="margin-bottom:12px" onclick="addProdMatRow()"><i class="ti ti-plus"></i> Add material</button><br>
      <button class="btn btn-primary" onclick="addProduction()"><i class="ti ti-check"></i> Log batch</button>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Production log</span><span class="card-sub">${App.productions.length} batches</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Units</th><th>Materials used</th><th>Total cost</th><th>Cost/unit</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7"><div class="empty"><i class="ti ti-tools-kitchen-2"></i>No production logged yet</div></td></tr>'}</tbody></table></div>
    </div>
    <div id="modalContainer"></div>`;
}

function addProdMatRow() { App.prodMaterialRows.push(uid()); renderPage('production'); }
function removeProdRow(rowId) { App.prodMaterialRows = App.prodMaterialRows.filter(r => r !== rowId); renderPage('production'); }

async function addProduction() {
  const product_id = document.getElementById('prodProduct').value;
  const units = parseInt(document.getElementById('prodUnits').value);
  const date = document.getElementById('prodDate').value || today();
  if (!product_id || !units) { toast('Please fill product and units'); return; }
  const materials = [];
  for (const rowId of App.prodMaterialRows) {
    const mid = document.getElementById(`pmMat-${rowId}`)?.value;
    const qty = parseFloat(document.getElementById(`pmQty-${rowId}`)?.value||0);
    if (mid && qty > 0) materials.push({ material_id: mid, qty });
  }
  if (!materials.length) { toast('Add at least one material'); return; }
  try { await POST('/api/productions'+branchQS(), { product_id, units, date, materials }); App.prodMaterialRows = [uid()]; toast('Batch logged ✓'); await refresh(); }
  catch (e) { toast(e.message); }
}

function openEditProduction(id) {
  const b = App.productions.find(x => x.id === id);
  if (!b) return;
  const prodOpts = App.products.map(p => `<option value="${p.id}" ${p.id===b.product_id?'selected':''}>${p.name}</option>`).join('');
  const matOpts = App.materials.map(m => `<option value="${m.id}">${m.name} (${m.unit})</option>`).join('');
  const existingRows = (b.materials||[]).length ? b.materials : [{material_id:'', qty:0}];
  const rowsHtml = existingRows.map((m,i) => `
    <div class="form-row cols2" style="margin-bottom:6px">
      <div class="form-group"><label>Material</label><select id="editPmMat-${i}">${App.materials.map(mm=>`<option value="${mm.id}" ${mm.id===m.material_id?'selected':''}>${mm.name} (${mm.unit})</option>`).join('')}</select></div>
      <div class="form-group"><label>Quantity used</label><input type="number" id="editPmQty-${i}" value="${m.qty}" step="0.01"></div>
    </div>`).join('');
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <div class="modal-box">
        <div class="card-header"><span class="card-title">Edit production batch</span><button class="btn btn-icon" onclick="closeModal()"><i class="ti ti-x"></i></button></div>
        <div class="form-row cols2">
          <div class="form-group"><label>Product</label><select id="editProdProduct">${prodOpts}</select></div>
          <div class="form-group"><label>Units</label><input type="number" id="editProdUnits" value="${b.units}"></div>
        </div>
        <div class="form-group"><label>Date</label><input type="date" id="editProdDate" value="${b.date}"></div>
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin:10px 0 6px">Materials used</div>
        <div id="editProdMatsContainer">${rowsHtml}</div>
        <div style="font-size:11px;color:var(--text-muted);margin:6px 0">Editing recalculates stock — old usage is restored, then new usage applied.</div>
        <button class="btn btn-primary btn-block" style="margin-top:10px" onclick="saveEditProduction('${b.id}', ${existingRows.length})"><i class="ti ti-check"></i> Save changes</button>
      </div>
    </div>`;
}

async function saveEditProduction(id, rowCount) {
  const product_id = document.getElementById('editProdProduct').value;
  const units = parseInt(document.getElementById('editProdUnits').value);
  const date = document.getElementById('editProdDate').value;
  const materials = [];
  for (let i = 0; i < rowCount; i++) {
    const mid = document.getElementById(`editPmMat-${i}`)?.value;
    const qty = parseFloat(document.getElementById(`editPmQty-${i}`)?.value || 0);
    if (mid && qty > 0) materials.push({ material_id: mid, qty });
  }
  try { await PUT(`/api/productions/${id}`, { product_id, units, date, materials }); toast('Batch updated ✓'); closeModal(); await refresh(); }
  catch (e) { toast(e.message); }
}

async function deleteProd(id) {
  if (!confirm('Delete this production batch? Stock will be restored.')) return;
  await DEL(`/api/productions/${id}`); toast('Deleted'); await refresh();
}

/* ── SALES ─────────────────────────────────────────────────── */
async function renderSales(el) {
  const salesData = await GET(`/api/sales${App.saleTab!=='all'?'?period='+App.saleTab:''}${branchQS() ? (App.saleTab!=='all'?'&':'?')+branchQS().slice(1) : ''}`);
  const prodOpts = App.products.map(p => `<option value="${p.id}">${p.name} — ${fmtMoney(p.selling_price)}/${p.unit}</option>`).join('');

  const totalRev = salesData.reduce((a,s) => a+s.revenue, 0);
  const totalUnits = salesData.reduce((a,s) => a+s.units, 0);
  const byProd = {};
  salesData.forEach(s => { if(!byProd[s.product_id]) byProd[s.product_id]={units:0,revenue:0}; byProd[s.product_id].units+=s.units; byProd[s.product_id].revenue+=s.revenue; });
  const topProd = Object.entries(byProd).sort((a,b)=>b[1].revenue-a[1].revenue)[0];

  const metricsHtml = `<div class="metrics-grid">
    <div class="metric"><div class="metric-label">Revenue</div><div class="metric-value">${fmtMoney(totalRev)}</div></div>
    <div class="metric"><div class="metric-label">Units sold</div><div class="metric-value">${totalUnits}</div></div>
    <div class="metric"><div class="metric-label">Transactions</div><div class="metric-value">${salesData.length}</div></div>
    <div class="metric"><div class="metric-label">Top product</div><div class="metric-value" style="font-size:14px">${topProd?getProd(topProd[0])?.name:'—'}</div></div>
  </div>`;

  const rows = salesData.map(s => {
    const p = getProd(s.product_id);
    return `<tr><td>${s.date}</td><td>${p?.name||s.product_id}</td><td>${s.units} ${p?.unit||''}</td>
      <td>${fmtMoney(p?.selling_price||0)}</td><td>${fmtMoney(s.revenue)}</td>
      <td style="display:flex;gap:4px">
        ${isAdmin() ? `<button class="btn btn-sm btn-icon" onclick="openEditSale('${s.id}')" title="Edit"><i class="ti ti-edit"></i></button>` : ''}
        <button class="btn btn-sm btn-danger btn-icon" onclick="deleteSale('${s.id}')"><i class="ti ti-trash"></i></button>
      </td></tr>`;
  }).join('');

  const tabs = ['all','day','week','month','year'];
  const tabLabels = { all:'All', day:'Today', week:'This week', month:'This month', year:'This year' };
  const tabsHtml = tabs.map(t => `<div class="tab ${App.saleTab===t?'active':''}" onclick="setSaleTab('${t}')">${tabLabels[t]}</div>`).join('');

  el.innerHTML = `
    <div class="form-section">
      <div class="form-section-title"><i class="ti ti-plus"></i> Record sale</div>
      <div class="form-row cols3">
        <div class="form-group"><label>Product</label><select id="saleProd" onchange="updateSalePrice()">${prodOpts}</select></div>
        <div class="form-group"><label>Units sold</label><input type="number" id="saleUnits" placeholder="0" min="1"></div>
        <div class="form-group"><label>Date</label><input type="date" id="saleDate" value="${today()}"></div>
      </div>
      <div id="salePriceHint" style="font-size:12px;color:var(--text-muted);margin-bottom:10px"></div>
      <button class="btn btn-primary" onclick="addSale()"><i class="ti ti-check"></i> Record sale</button>
    </div>
    <div class="tabs">${tabsHtml}</div>
    ${metricsHtml}
    <div class="card">
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Units</th><th>Unit price</th><th>Total</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6"><div class="empty"><i class="ti ti-receipt"></i>No sales in this period</div></td></tr>'}</tbody></table></div>
    </div>
    <div id="modalContainer"></div>`;
  updateSalePrice();
}

function updateSalePrice() {
  const sel = document.getElementById('saleProd');
  if (!sel) return;
  const p = getProd(sel.value);
  const hint = document.getElementById('salePriceHint');
  if (hint && p) hint.textContent = `Selling price: ${fmtMoney(p.selling_price)} per ${p.unit}`;
}

function setSaleTab(tab) { App.saleTab = tab; renderPage('sales'); }

async function addSale() {
  const product_id = document.getElementById('saleProd').value;
  const units = parseInt(document.getElementById('saleUnits').value);
  const date = document.getElementById('saleDate').value || today();
  if (!product_id || !units) { toast('Please fill product and units'); return; }
  try { await POST('/api/sales'+branchQS(), { product_id, units, date }); toast('Sale recorded ✓'); await refresh(); }
  catch (e) { toast(e.message); }
}

function openEditSale(id) {
  const s = App.sales.find(x => x.id === id) || {};
  const prodOpts = App.products.map(p => `<option value="${p.id}" ${p.id===s.product_id?'selected':''}>${p.name}</option>`).join('');
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <div class="modal-box">
        <div class="card-header"><span class="card-title">Edit sale</span><button class="btn btn-icon" onclick="closeModal()"><i class="ti ti-x"></i></button></div>
        <div class="form-group"><label>Product</label><select id="editSaleProd">${prodOpts}</select></div>
        <div class="form-row cols2">
          <div class="form-group"><label>Units</label><input type="number" id="editSaleUnits" value="${s.units}"></div>
          <div class="form-group"><label>Date</label><input type="date" id="editSaleDate" value="${s.date}"></div>
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="saveEditSale('${id}')"><i class="ti ti-check"></i> Save changes</button>
      </div>
    </div>`;
}

async function saveEditSale(id) {
  const product_id = document.getElementById('editSaleProd').value;
  const units = parseInt(document.getElementById('editSaleUnits').value);
  const date = document.getElementById('editSaleDate').value;
  try { await PUT(`/api/sales/${id}`, { product_id, units, date }); toast('Sale updated ✓'); closeModal(); await refresh(); }
  catch (e) { toast(e.message); }
}

async function deleteSale(id) {
  if (!confirm('Delete this sale record?')) return;
  await DEL(`/api/sales/${id}`); toast('Deleted'); await refresh();
}

/* ── ANALYTICS ─────────────────────────────────────────────── */
async function renderAnalytics(el) {
  const tabs = ['overview','products','materials'];
  if (App.planStatus && App.planStatus.features && App.planStatus.features.includes('multi_branch_reports') && App.branches.length > 1) tabs.push('branches');
  const tabLabels = { overview:'Overview', products:'By product', materials:'Material costs', branches:'By branch' };
  const tabsHtml = tabs.map(t => `<div class="tab ${App.analyticTab===t?'active':''}" onclick="setAnalyticTab('${t}')">${tabLabels[t]}</div>`).join('');
  el.innerHTML = `<div class="tabs">${tabsHtml}</div><div id="analyticBody"></div>`;
  const body = document.getElementById('analyticBody');
  if (App.analyticTab === 'overview') await renderAnalyticOverview(body);
  else if (App.analyticTab === 'products') await renderAnalyticProducts(body);
  else if (App.analyticTab === 'branches') await renderAnalyticBranches(body);
  else await renderAnalyticMaterials(body);
}

async function renderAnalyticOverview(el) {
  const s = await GET('/api/analytics/summary'+branchQS());
  const margin = s.totalRevenue>0 ? Math.round((s.profit/s.totalRevenue)*100) : 0;
  el.innerHTML = `
    <div class="metrics-grid">
      <div class="metric"><div class="metric-label">Today</div><div class="metric-value">${fmtMoney(s.todayRev)}</div></div>
      <div class="metric"><div class="metric-label">This week</div><div class="metric-value">${fmtMoney(s.weekRev)}</div></div>
      <div class="metric"><div class="metric-label">This month</div><div class="metric-value">${fmtMoney(s.monthRev)}</div></div>
      <div class="metric"><div class="metric-label">This year</div><div class="metric-value">${fmtMoney(s.yearRev)}</div></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="card-header"><span class="card-title">Profit & Loss</span></div>
        <div class="summary-row"><span>Total revenue</span><span style="color:var(--green)">${fmtMoney(s.totalRevenue)}</span></div>
        <div class="summary-row"><span>Total procurement costs</span><span style="color:var(--red)">−${fmtMoney(s.totalExpenses)}</span></div>
        <div class="summary-row"><span>Net ${s.profit>=0?'profit':'loss'}</span><span style="color:${s.profit>=0?'var(--green)':'var(--red)'}">${s.profit>=0?'':'-'}${fmtMoney(Math.abs(s.profit))}</span></div>
        <div style="margin-top:6px;font-size:12px;color:var(--text-muted)">Profit margin: <strong>${margin}%</strong></div>
      </div>
      <div class="card"><div class="card-header"><span class="card-title">Revenue by period</span></div>
        <div class="summary-row"><span>Today</span><span>${fmtMoney(s.todayRev)}</span></div>
        <div class="summary-row"><span>This week</span><span>${fmtMoney(s.weekRev)}</span></div>
        <div class="summary-row"><span>This month</span><span>${fmtMoney(s.monthRev)}</span></div>
        <div class="summary-row"><span>This year</span><span>${fmtMoney(s.yearRev)}</span></div>
      </div>
    </div>`;
}

async function renderAnalyticProducts(el) {
  const data = await GET('/api/analytics/products'+branchQS());
  const rows = data.map(p => `<tr>
    <td><strong>${p.name}</strong></td><td>${p.units_sold} ${p.unit}s</td><td>${fmtMoney(p.selling_price)}</td>
    <td>${fmtMoney(p.cost_per_unit)}</td><td>${fmtMoney(p.total_cost)}</td><td>${fmtMoney(p.revenue)}</td>
    <td style="color:${p.profit>=0?'var(--green)':'var(--red)'}">${p.profit>=0?'+':''}${fmtMoney(p.profit)}</td>
    <td>${pill(p.margin+'%', p.margin>=40?'ok':p.margin>=10?'warn':'danger')}</td>
  </tr>`).join('');
  el.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">Product-level P&L</span><span class="card-sub">Cost vs revenue per product</span></div>
    <div class="table-wrap"><table><thead><tr><th>Product</th><th>Units sold</th><th>Selling price</th><th>Cost/unit</th><th>Total cost</th><th>Revenue</th><th>Profit</th><th>Margin</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

async function renderAnalyticMaterials(el) {
  const data = await GET('/api/analytics/materials'+branchQS());
  const rows = data.map(m => `<tr><td>${m.name}</td><td>${fmt(m.total_purchased)} ${m.unit}</td><td>${fmtMoney(m.unit_price)}/${m.unit}</td>
    <td>${fmtMoney(m.total_spent)}</td><td>${fmt(m.total_used)} ${m.unit}</td><td>${fmt(m.stock)} ${m.unit}</td><td>${fmtMoney(m.stock * m.unit_price)}</td></tr>`).join('');
  el.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">Raw material costs</span></div>
    <div class="table-wrap"><table><thead><tr><th>Material</th><th>Total purchased</th><th>Unit price</th><th>Total spent</th><th>Used in production</th><th>In stock</th><th>Stock value</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

async function renderAnalyticBranches(el) {
  try {
    const data = await GET('/api/analytics/branches');
    const rows = data.map(b => `<tr><td><strong>${b.name}</strong></td><td>${b.location||'—'}</td>
      <td>${fmtMoney(b.revenue)}</td><td>${fmtMoney(b.expenses)}</td>
      <td style="color:${b.profit>=0?'var(--green)':'var(--red)'}">${b.profit>=0?'+':''}${fmtMoney(b.profit)}</td></tr>`).join('');
    el.innerHTML = `<div class="card"><div class="card-header"><span class="card-title">Consolidated branch report</span><span class="card-sub">Pro/Enterprise feature</span></div>
      <div class="table-wrap"><table><thead><tr><th>Branch</th><th>Location</th><th>Revenue</th><th>Expenses</th><th>Profit</th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  } catch (e) {
    el.innerHTML = `<div class="card"><div class="empty"><i class="ti ti-lock"></i>${e.message}</div></div>`;
  }
}

function setAnalyticTab(tab) { App.analyticTab = tab; renderPage('analytics'); }

/* ── SETTINGS ──────────────────────────────────────────────── */
async function renderSettings(el) {
  const tabs = ['general','materials','products'];
  const tabLabels = { general:'General', materials:'Raw materials', products:'Products' };
  const tabsHtml = tabs.map(t => `<div class="tab ${App.settingsTab===t?'active':''}" onclick="setSettingsTab('${t}')">${tabLabels[t]}</div>`).join('');
  el.innerHTML = `<div class="tabs">${tabsHtml}</div><div id="settingsBody"></div>`;
  const body = document.getElementById('settingsBody');
  if (App.settingsTab === 'general') renderSettingsGeneral(body);
  else if (App.settingsTab === 'materials') renderSettingsMaterials(body);
  else renderSettingsProducts(body);
}

function setSettingsTab(tab) { App.settingsTab = tab; renderPage('settings'); }

function renderSettingsGeneral(el) {
  el.innerHTML = `
    <div class="card" style="max-width:480px">
      <div class="card-header"><span class="card-title">Kitchen settings</span></div>
      <div class="form-group"><label>Kitchen name</label><input type="text" id="setName" value="${App.settings.kitchen_name}"></div>
      <div class="form-group" style="margin-top:12px"><label>Currency</label>
        <select id="setCurrency">
          ${[['KES','KES — Kenyan Shilling'],['USD','USD — US Dollar'],['UGX','UGX — Ugandan Shilling'],['TZS','TZS — Tanzanian Shilling'],['NGN','NGN — Nigerian Naira'],['GHS','GHS — Ghanaian Cedi'],['ZAR','ZAR — South African Rand'],['EUR','EUR — Euro'],['GBP','GBP — British Pound']].map(([v,l])=>`<option value="${v}" ${App.settings.currency===v?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" style="margin-top:16px" onclick="saveGeneral()"><i class="ti ti-check"></i> Save settings</button>
    </div>`;
}

async function saveGeneral() {
  const kitchen_name = document.getElementById('setName').value || 'My Baking Kitchen';
  const currency = document.getElementById('setCurrency').value;
  await PUT('/api/settings', { kitchen_name, currency });
  await checkSession();
  toast('Settings saved ✓');
}

function renderSettingsMaterials(el) {
  const rowsHtml = App.materials.map((m,i) => `
    <tr>
      <td><input type="text" value="${m.name}" onchange="App.materials[${i}].name=this.value" style="width:130px"></td>
      <td><select onchange="App.materials[${i}].unit=this.value" style="width:90px">
        ${['kg','g','litres','ml','pieces','cups','tbsp','tsp','packs'].map(u=>`<option ${m.unit===u?'selected':''}>${u}</option>`).join('')}
      </select></td>
      <td><input type="number" value="${m.unit_price}" min="0" step="0.01" onchange="App.materials[${i}].unit_price=+this.value" style="width:90px"></td>
      <td><input type="number" value="${m.alert_level}" min="0" step="0.01" onchange="App.materials[${i}].alert_level=+this.value" style="width:80px"></td>
      <td><input type="number" value="${m.stock}" min="0" step="0.01" onchange="App.materials[${i}].stock=+this.value" style="width:90px"></td>
      <td><button class="btn btn-sm btn-danger btn-icon" onclick="deleteMaterial('${m.id}')"><i class="ti ti-trash"></i></button></td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-title">Raw materials</span><button class="btn btn-primary" onclick="addMaterial()"><i class="ti ti-plus"></i> Add material</button></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Unit</th><th>Unit price (${App.settings.currency})</th><th>Alert level</th><th>Current stock</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <button class="btn btn-primary" style="margin-top:14px" onclick="saveMaterials()"><i class="ti ti-check"></i> Save all changes</button>
    </div>`;
}

async function addMaterial() { await POST('/api/materials'+branchQS(), { name:'New material', unit:'kg', alert_level:1, stock:0, unit_price:0 }); await refresh(); }
async function deleteMaterial(id) { if (!confirm('Delete this material?')) return; await DEL(`/api/materials/${id}`); toast('Material deleted'); await refresh(); }
async function saveMaterials() {
  for (const m of App.materials) { await PUT(`/api/materials/${m.id}`, { name:m.name, unit:m.unit, alert_level:m.alert_level, stock:m.stock, unit_price:m.unit_price }); }
  toast('Materials saved ✓'); await refresh();
}

function renderSettingsProducts(el) {
  const rowsHtml = App.products.map((p,i) => `
    <tr>
      <td><input type="text" value="${p.name}" onchange="App.products[${i}].name=this.value" style="width:150px"></td>
      <td><input type="text" value="${p.unit}" onchange="App.products[${i}].unit=this.value" style="width:80px" placeholder="loaf,piece..."></td>
      <td><input type="number" value="${p.selling_price}" min="0" step="0.5" onchange="App.products[${i}].selling_price=+this.value" style="width:100px"></td>
      <td><button class="btn btn-sm btn-danger btn-icon" onclick="deleteProduct('${p.id}')"><i class="ti ti-trash"></i></button></td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="card">
      <div class="card-header"><span class="card-title">Products</span><button class="btn btn-primary" onclick="addProduct()"><i class="ti ti-plus"></i> Add product</button></div>
      <div class="table-wrap"><table><thead><tr><th>Product name</th><th>Unit</th><th>Selling price (${App.settings.currency})</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <button class="btn btn-primary" style="margin-top:14px" onclick="saveProducts()"><i class="ti ti-check"></i> Save all changes</button>
    </div>`;
}

async function addProduct() { await POST('/api/products'+branchQS(), { name:'New product', unit:'piece', selling_price:0 }); await refresh(); }
async function deleteProduct(id) { if (!confirm('Delete this product?')) return; await DEL(`/api/products/${id}`); toast('Product deleted'); await refresh(); }
async function saveProducts() {
  for (const p of App.products) { await PUT(`/api/products/${p.id}`, { name:p.name, unit:p.unit, selling_price:p.selling_price }); }
  toast('Products saved ✓'); await refresh();
}

/* ── BRANCHES ──────────────────────────────────────────────── */
async function renderBranches(el) {
  App.branches = await GET('/api/branches');
  const max = App.planStatus ? App.planStatus.max_branches : null;
  const limitText = max === null ? 'Unlimited branches on your plan' : `${App.branches.length} / ${max} branches used on your ${App.planStatus.plan_label} plan`;
  const rows = App.branches.map(b => `
    <tr>
      <td><strong>${b.name}</strong>${b.is_default ? ' <span class="pill pill-info">Default</span>' : ''}</td>
      <td>${b.location || '—'}</td>
      <td>${new Date(b.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn btn-sm btn-icon" onclick="openEditBranch('${b.id}')" title="Edit"><i class="ti ti-edit"></i></button>
        ${!b.is_default ? `<button class="btn btn-sm btn-danger btn-icon" onclick="deleteBranch('${b.id}','${b.name.replace(/'/g,"\\'")}')" title="Delete"><i class="ti ti-trash"></i></button>` : ''}
      </td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="form-section">
      <div class="form-section-title"><i class="ti ti-building-store"></i> Add branch</div>
      <div class="card-sub" style="margin-bottom:10px">${limitText}</div>
      <div class="form-row cols2">
        <div class="form-group"><label>Branch name</label><input type="text" id="newBranchName" placeholder="e.g. Westlands Branch"></div>
        <div class="form-group"><label>Location (optional)</label><input type="text" id="newBranchLocation" placeholder="e.g. Westlands, Nairobi"></div>
      </div>
      <button class="btn btn-primary" onclick="addBranch()"><i class="ti ti-check"></i> Create branch</button>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Your branches</span></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Location</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-top:10px">Each branch has its own separate stock, production, and sales — like a mini sub-kitchen.</div>
    </div>
    <div id="modalContainer"></div>`;
}

async function addBranch() {
  const name = document.getElementById('newBranchName').value.trim();
  const location = document.getElementById('newBranchLocation').value.trim();
  if (!name) { toast('Branch name is required'); return; }
  try { await POST('/api/branches', { name, location }); toast('Branch created ✓'); App.branches = await GET('/api/branches'); buildNav(); renderPage('branches'); }
  catch (e) { toast(e.message); }
}

function openEditBranch(id) {
  const b = App.branches.find(x => x.id === id);
  if (!b) return;
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <div class="modal-box">
        <div class="card-header"><span class="card-title">Edit branch</span><button class="btn btn-icon" onclick="closeModal()"><i class="ti ti-x"></i></button></div>
        <div class="form-group"><label>Branch name</label><input type="text" id="editBranchName" value="${b.name}"></div>
        <div class="form-group"><label>Location</label><input type="text" id="editBranchLocation" value="${b.location||''}"></div>
        <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="saveEditBranch('${id}')"><i class="ti ti-check"></i> Save changes</button>
      </div>
    </div>`;
}

async function saveEditBranch(id) {
  const name = document.getElementById('editBranchName').value.trim();
  const location = document.getElementById('editBranchLocation').value.trim();
  try { await PUT(`/api/branches/${id}`, { name, location }); toast('Branch updated ✓'); closeModal(); App.branches = await GET('/api/branches'); buildNav(); renderPage('branches'); }
  catch (e) { toast(e.message); }
}

async function deleteBranch(id, name) {
  if (!confirm(`Delete "${name}" and all its stock/production/sales data? This cannot be undone.`)) return;
  try {
    await DEL(`/api/branches/${id}`);
    toast('Branch deleted');
    App.branches = await GET('/api/branches');
    if (App.currentBranchId === id) App.currentBranchId = App.branches.find(b=>b.is_default)?.id;
    buildNav();
    renderPage('branches');
  } catch (e) { toast(e.message); }
}

/* ── TEAM & PERMISSIONS (per-kitchen user management) ──────── */
const ASSIGNABLE_PAGES = ['dashboard','procurement','stock','production','sales','analytics','settings','users','branches','billing'];
const ROLE_DEFAULTS = {
  admin: ASSIGNABLE_PAGES,
  manager: ['dashboard','procurement','stock','production','sales','analytics'],
  staff: ['dashboard','stock','sales'],
};

async function renderUsers(el) {
  const users = await GET('/api/users');
  const max = App.planStatus ? App.planStatus.max_users : null;
  const limitText = max === null ? 'Unlimited users on your plan' : `${users.length} / ${max} users used on your ${App.planStatus.plan_label} plan`;
  const branchOpts = App.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');

  const rows = users.map(u => `
    <tr>
      <td><strong>${u.username}</strong></td>
      <td><span class="pill pill-info" style="text-transform:capitalize">${u.role}</span></td>
      <td style="font-size:12px;color:var(--text-muted)">${App.branches.find(b=>b.id===u.branch_id)?.name || '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${u.permissions.join(', ')}</td>
      <td>${pill(u.status, u.status==='active'?'ok':'danger')}</td>
      <td style="display:flex;gap:4px">
        <button class="btn btn-sm btn-icon" onclick="openEditUser('${u.id}')" title="Edit"><i class="ti ti-edit"></i></button>
        <button class="btn btn-sm btn-icon" onclick="toggleUserStatus('${u.id}','${u.status}')" title="${u.status==='active'?'Suspend':'Activate'}"><i class="ti ti-${u.status==='active'?'lock':'lock-open'}"></i></button>
        <button class="btn btn-sm btn-danger btn-icon" onclick="deleteUser('${u.id}')" title="Delete"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="form-section">
      <div class="form-section-title"><i class="ti ti-user-plus"></i> Add team member</div>
      <div class="card-sub" style="margin-bottom:10px">${limitText}</div>
      <div class="form-row cols3">
        <div class="form-group"><label>Username</label><input type="text" id="newUserName" placeholder="e.g. jane"></div>
        <div class="form-group"><label>Password</label><input type="password" id="newUserPass" placeholder="min. 6 characters"></div>
        <div class="form-group"><label>Role</label><select id="newUserRole" onchange="applyRoleDefaults()">
          <option value="manager">Manager</option><option value="staff" selected>Staff</option><option value="admin">Admin</option>
        </select></div>
      </div>
      ${App.branches.length > 1 ? `<div class="form-group"><label>Assign to branch</label><select id="newUserBranch">${branchOpts}</select></div>` : ''}
      <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-top:10px">Page access</div>
      <div class="perm-grid" id="newUserPerms"></div>
      <button class="btn btn-primary" style="margin-top:14px" onclick="addUser()"><i class="ti ti-check"></i> Create user</button>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Team members</span><span class="card-sub">${users.length} users</span></div>
      <div class="table-wrap"><table><thead><tr><th>Username</th><th>Role</th><th>Branch</th><th>Permissions</th><th>Status</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6"><div class="empty">No team members yet</div></td></tr>'}</tbody></table></div>
    </div>
    <div id="modalContainer"></div>`;
  applyRoleDefaults();
}

function permCheckboxesHtml(idPrefix, selected) {
  return ASSIGNABLE_PAGES.map(p => `
    <label class="perm-check">
      <input type="checkbox" id="${idPrefix}-${p}" value="${p}" ${selected.includes(p)?'checked':''}>
      ${PAGE_META[p].label}
    </label>`).join('');
}

function applyRoleDefaults() {
  const role = document.getElementById('newUserRole').value;
  const defaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.staff;
  document.getElementById('newUserPerms').innerHTML = permCheckboxesHtml('newUserPerm', defaults);
}

function collectPerms(idPrefix) {
  return ASSIGNABLE_PAGES.filter(p => document.getElementById(`${idPrefix}-${p}`)?.checked);
}

async function addUser() {
  const username = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPass').value;
  const role = document.getElementById('newUserRole').value;
  const permissions = collectPerms('newUserPerm');
  const branchSel = document.getElementById('newUserBranch');
  const branch_id = branchSel ? branchSel.value : (App.branches[0] ? App.branches[0].id : null);
  if (!username || !password) { toast('Username and password required'); return; }
  try { await POST('/api/users', { username, password, role, permissions, branch_id }); toast('User created ✓'); renderPage('users'); }
  catch (e) { toast(e.message); }
}

async function openEditUser(id) {
  const users = await GET('/api/users');
  const u = users.find(x => x.id === id);
  if (!u) return;
  const branchOpts = App.branches.map(b => `<option value="${b.id}" ${b.id===u.branch_id?'selected':''}>${b.name}</option>`).join('');
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <div class="modal-box">
        <div class="card-header"><span class="card-title">Edit ${u.username}</span><button class="btn btn-icon" onclick="closeModal()"><i class="ti ti-x"></i></button></div>
        <div class="form-group"><label>Role</label><select id="editUserRole">
          <option value="manager" ${u.role==='manager'?'selected':''}>Manager</option>
          <option value="staff" ${u.role==='staff'?'selected':''}>Staff</option>
          <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
        </select></div>
        ${App.branches.length > 1 ? `<div class="form-group"><label>Branch</label><select id="editUserBranch">${branchOpts}</select></div>` : ''}
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-top:12px">Page access</div>
        <div class="perm-grid" id="editUserPerms">${permCheckboxesHtml('editUserPerm', u.permissions)}</div>
        <div class="form-group" style="margin-top:12px"><label>Reset password (optional)</label><input type="password" id="editUserPass" placeholder="Leave blank to keep current"></div>
        <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="saveEditUser('${u.id}')"><i class="ti ti-check"></i> Save changes</button>
      </div>
    </div>`;
}

async function saveEditUser(id) {
  const role = document.getElementById('editUserRole').value;
  const permissions = collectPerms('editUserPerm');
  const password = document.getElementById('editUserPass').value;
  const branchSel = document.getElementById('editUserBranch');
  const body = { role, permissions };
  if (password) body.password = password;
  if (branchSel) body.branch_id = branchSel.value;
  try { await PUT(`/api/users/${id}`, body); toast('User updated ✓'); closeModal(); renderPage('users'); }
  catch (e) { toast(e.message); }
}

async function toggleUserStatus(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  await PUT(`/api/users/${id}`, { status: newStatus });
  toast(`User ${newStatus}`);
  renderPage('users');
}

async function deleteUser(id) {
  if (!confirm('Delete this user permanently?')) return;
  try { await DEL(`/api/users/${id}`); toast('User deleted'); renderPage('users'); }
  catch (e) { toast(e.message); }
}

/* ── BILLING & PLAN ────────────────────────────────────────── */
async function renderBilling(el) {
  const data = await GET('/api/billing');
  const ps = data.planStatus;
  const order = ['starter','advanced','pro','enterprise'];

  let statusBanner = '';
  if (ps.plan === 'trial') {
    statusBanner = ps.is_locked
      ? `<div class="alert-banner danger"><i class="ti ti-alert-triangle"></i><div>Your free trial has expired. Choose a plan below to continue using the system.</div></div>`
      : `<div class="alert-banner"><i class="ti ti-clock"></i><div>You're on a free trial — <strong>${ps.days_left} day${ps.days_left===1?'':'s'} left</strong>. Choose a plan below anytime to continue without interruption.</div></div>`;
  } else if (ps.is_locked) {
    statusBanner = `<div class="alert-banner danger"><i class="ti ti-alert-triangle"></i><div>Your <strong>${ps.plan_label}</strong> subscription has expired. Renew below to regain access.</div></div>`;
  } else if (ps.payment_status === 'pending_review' || ps.payment_status === 'contact_pending') {
    statusBanner = `<div class="alert-banner"><i class="ti ti-hourglass"></i><div>Your payment for <strong>${ps.plan_label}</strong> is awaiting confirmation from our team.</div></div>`;
  } else if (ps.plan !== 'trial') {
    statusBanner = `<div class="alert-banner" style="background:var(--green-light);color:var(--green-text);border-color:var(--green)"><i class="ti ti-check"></i><div>You're on the <strong>${ps.plan_label}</strong> plan${ps.subscription_active_until ? ', active until '+new Date(ps.subscription_active_until).toLocaleDateString() : ''}.</div></div>`;
  }

  const plansHtml = order.map(key => {
    const p = PLAN_FEATURES_DISPLAY[key];
    const isCurrent = ps.plan === key;
    const priceHtml = p.price === null ? `<div class="land-plan-price" style="font-size:20px">Custom</div>` : `<div class="land-plan-price" style="font-size:22px">${App.settings.currency} ${p.price}<small>/mo</small></div>`;
    return `<div class="plan-card ${isCurrent?'current':''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="land-plan-name">${p.name}</div>
        ${isCurrent ? pill('Current plan','ok') : ''}
      </div>
      ${priceHtml}
      <div class="land-plan-desc">${key==='enterprise' ? 'Custom limits' : `${p.branches} branch(es), ${p.users} user(s)`}</div>
      <ul class="land-plan-list">${p.points.slice(0,4).map(pt => `<li><i class="ti ti-check"></i>${pt}</li>`).join('')}</ul>
      <button class="btn ${isCurrent?'btn-outline':'btn-primary'} btn-block" onclick="openPlanSelector('${key}')">${isCurrent ? 'Renew / Resubmit' : (key==='enterprise'?'Contact us':'Choose plan')}</button>
    </div>`;
  }).join('');

  el.innerHTML = `
    ${statusBanner}
    <div class="card">
      <div class="card-header"><span class="card-title">Choose your plan</span></div>
      <div class="grid2" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">${plansHtml}</div>
    </div>
    ${ps.payment_reference ? `<div class="card"><div class="card-header"><span class="card-title">Last payment reference submitted</span></div><div class="summary-row"><span>Reference</span><span>${ps.payment_reference || '—'}</span></div><div class="summary-row"><span>Status</span><span>${pill(ps.payment_status, ps.payment_status==='confirmed'?'ok':ps.payment_status==='rejected'?'danger':'warn')}</span></div></div>` : ''}
    <div id="modalContainer"></div>`;
}

function openPlanSelector(planKey) {
  const p = PLAN_FEATURES_DISPLAY[planKey];
  if (planKey === 'enterprise') {
    document.getElementById('modalContainer').innerHTML = `
      <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
        <div class="modal-box">
          <div class="card-header"><span class="card-title">Enterprise plan</span><button class="btn btn-icon" onclick="closeModal()"><i class="ti ti-x"></i></button></div>
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Enterprise plans are custom-priced based on your number of branches and users. Submit your interest and our team will reach out to set up your account.</p>
          <button class="btn btn-primary btn-block" onclick="submitEnterpriseInterest()"><i class="ti ti-send"></i> Request Enterprise plan</button>
        </div>
      </div>`;
    return;
  }
  document.getElementById('modalContainer').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <div class="modal-box">
        <div class="card-header"><span class="card-title">${p.name} — ${App.settings.currency} ${p.price}/mo</span><button class="btn btn-icon" onclick="closeModal()"><i class="ti ti-x"></i></button></div>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Send <strong>${App.settings.currency} ${p.price}</strong> via M-Pesa to our paybill, then enter the confirmation reference below. Your plan activates once our team confirms the payment.</p>
        <div class="form-group"><label>M-Pesa / payment reference</label><input type="text" id="payRef" placeholder="e.g. QFT4XXXXX1"></div>
        <button class="btn btn-primary btn-block" style="margin-top:14px" onclick="submitPlanPayment('${planKey}')"><i class="ti ti-send"></i> Submit payment reference</button>
      </div>
    </div>`;
}

async function submitPlanPayment(planKey) {
  const payment_reference = document.getElementById('payRef').value.trim();
  if (!payment_reference) { toast('Please enter your payment reference'); return; }
  try {
    const res = await POST('/api/billing/select-plan', { plan: planKey, payment_reference });
    toast(res.message || 'Submitted ✓');
    closeModal();
    await checkSession();
    renderPage('billing');
  } catch (e) { toast(e.message); }
}

async function submitEnterpriseInterest() {
  try {
    const res = await POST('/api/billing/select-plan', { plan: 'enterprise' });
    toast(res.message || 'Request sent ✓');
    closeModal();
    await checkSession();
    renderPage('billing');
  } catch (e) { toast(e.message); }
}

/* ── MY ACCOUNT (password change for ANY logged in user, incl. super admin) ── */
async function renderAccount(el) {
  el.innerHTML = `
    <div class="card" style="max-width:440px">
      <div class="card-header"><span class="card-title">My account</span></div>
      <div class="summary-row"><span>Username</span><span>${App.user.username}</span></div>
      <div class="summary-row"><span>Role</span><span style="text-transform:capitalize">${App.user.is_super_admin ? 'Platform owner' : App.user.role}</span></div>
      ${App.kitchen ? `<div class="summary-row"><span>Kitchen</span><span>${App.kitchen.name}</span></div>` : ''}
    </div>
    <div class="card" style="max-width:440px">
      <div class="card-header"><span class="card-title">Change password</span></div>
      <div class="form-group"><label>Current password</label><input type="password" id="curPass"></div>
      <div class="form-group"><label>New password (min. 6 characters)</label><input type="password" id="newPass" minlength="6"></div>
      <div class="form-group"><label>Confirm new password</label><input type="password" id="confirmPass" minlength="6"></div>
      <button class="btn btn-primary" style="margin-top:14px" onclick="changeMyPassword()"><i class="ti ti-check"></i> Update password</button>
    </div>`;
}

async function changeMyPassword() {
  const current_password = document.getElementById('curPass').value;
  const new_password = document.getElementById('newPass').value;
  const confirmPass = document.getElementById('confirmPass').value;
  if (!current_password || !new_password) { toast('Please fill all fields'); return; }
  if (new_password !== confirmPass) { toast('New passwords do not match'); return; }
  if (new_password.length < 6) { toast('New password must be at least 6 characters'); return; }
  try {
    await PUT('/api/account/password', { current_password, new_password });
    toast('Password updated ✓');
    document.getElementById('curPass').value = '';
    document.getElementById('newPass').value = '';
    document.getElementById('confirmPass').value = '';
  } catch (e) { toast(e.message); }
}

/* ── PLATFORM (super-admin: manage all kitchens & payments) ──── */
async function renderPlatform(el) {
  const kitchens = await GET('/api/platform/kitchens');
  const totalKitchens = kitchens.length;
  const activeKitchens = kitchens.filter(k => k.status === 'active').length;
  const pendingPayments = kitchens.filter(k => k.payment_status === 'pending_review').length;
  const totalRevenue = kitchens.reduce((a,k) => a+k.total_revenue, 0);

  const rows = kitchens.map(k => {
    const ps = k.planStatus;
    let paymentCell = pill(k.payment_status || 'none', k.payment_status==='confirmed'?'ok':k.payment_status==='pending_review'?'warn':'neutral');
    if (k.payment_status === 'pending_review') {
      paymentCell += ` <button class="btn btn-sm btn-primary" onclick="confirmPayment('${k.id}')">Confirm</button> <button class="btn btn-sm btn-danger" onclick="rejectPayment('${k.id}')">Reject</button>`;
    }
    return `<tr>
      <td><strong>${k.name}</strong></td>
      <td>${ps.plan_label}</td>
      <td>${k.branch_count}</td>
      <td>${k.user_count}</td>
      <td>${fmt(k.total_revenue)}</td>
      <td>${ps.plan==='trial' ? (ps.is_locked ? pill('Expired','danger') : `${ps.days_left}d left`) : (ps.is_locked ? pill('Lapsed','danger') : pill('Active','ok'))}</td>
      <td>${paymentCell}</td>
      <td>${pill(k.status, k.status==='active'?'ok':'danger')}</td>
      <td style="display:flex;gap:4px">
        <button class="btn btn-sm btn-icon" onclick="toggleKitchenStatus('${k.id}','${k.status}')" title="${k.status==='active'?'Suspend':'Activate'}"><i class="ti ti-${k.status==='active'?'lock':'lock-open'}"></i></button>
        <button class="btn btn-sm btn-danger btn-icon" onclick="deleteKitchen('${k.id}','${k.name.replace(/'/g,"\\'")}')" title="Delete"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="metrics-grid">
      <div class="metric"><div class="metric-label">Total kitchens</div><div class="metric-value">${totalKitchens}</div></div>
      <div class="metric"><div class="metric-label">Active kitchens</div><div class="metric-value">${activeKitchens}</div></div>
      <div class="metric"><div class="metric-label">Pending payments</div><div class="metric-value ${pendingPayments?'metric-down':''}">${pendingPayments}</div></div>
      <div class="metric"><div class="metric-label">Combined revenue</div><div class="metric-value" style="font-size:16px">${fmt(totalRevenue)}</div></div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">All kitchens</span></div>
      <div class="table-wrap"><table><thead><tr><th>Kitchen</th><th>Plan</th><th>Branches</th><th>Users</th><th>Revenue</th><th>Trial/Sub</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="9"><div class="empty">No kitchens registered yet</div></td></tr>'}</tbody></table></div>
    </div>`;
}

async function confirmPayment(id) {
  try { await POST(`/api/platform/kitchens/${id}/confirm-payment`); toast('Payment confirmed, plan activated ✓'); renderPage('platform'); }
  catch (e) { toast(e.message); }
}
async function rejectPayment(id) {
  if (!confirm('Reject this payment reference?')) return;
  await POST(`/api/platform/kitchens/${id}/reject-payment`); toast('Payment rejected'); renderPage('platform');
}
async function toggleKitchenStatus(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  await PUT(`/api/platform/kitchens/${id}`, { status: newStatus });
  toast(`Kitchen ${newStatus}`);
  renderPage('platform');
}
async function deleteKitchen(id, name) {
  if (!confirm(`Permanently delete "${name}" and ALL its data? This cannot be undone.`)) return;
  await DEL(`/api/platform/kitchens/${id}`);
  toast('Kitchen deleted');
  renderPage('platform');
}

/* ── Mobile menu (FIXED) ───────────────────────────────────── */
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('open');
});
document.getElementById('sidebarClose').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
});
document.getElementById('overlay').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
});

/* ── PWA install prompt ─────────────────────────────────────── */
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  btn.style.display = 'flex';
  btn.addEventListener('click', () => {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { btn.style.display='none'; deferredPrompt=null; });
  });
});

/* ── Service worker ─────────────────────────────────────────── */
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }

/* ── Date ───────────────────────────────────────────────────── */
document.getElementById('topbarDate').textContent = new Date().toLocaleDateString(undefined, { weekday:'short', year:'numeric', month:'short', day:'numeric' });

/* ── Init: show landing page by default, but auto-login if session exists ── */
(async function init() {
  try {
    const data = await GET('/api/auth/me');
    App.user = data.user; App.kitchen = data.kitchen; App.planStatus = data.planStatus;
    App.currentBranchId = App.user.branch_id;
    document.getElementById('landingPage').style.display = 'none';
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    if (!App.user.is_super_admin) App.branches = await GET('/api/branches');
    buildNav();
    renderTrialBanner();
    await loadAll();
    showPage(App.user.is_super_admin ? 'platform' : 'dashboard');
  } catch (err) {
    document.getElementById('landingPage').style.display = 'block';
  }
})();
