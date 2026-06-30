const bcrypt = require('bcryptjs');
const { uid, run, get, all, PLANS } = require('./db');

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession(userId) {
  const token = uid() + uid() + uid();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', [token, userId, expiresAt]);
  return { token, expiresAt };
}

function destroySession(token) {
  run('DELETE FROM sessions WHERE token=?', [token]);
}

function getSessionUser(token) {
  if (!token) return null;
  const session = get('SELECT * FROM sessions WHERE token=?', [token]);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    run('DELETE FROM sessions WHERE token=?', [token]);
    return null;
  }
  const user = get('SELECT * FROM users WHERE id=?', [session.user_id]);
  if (!user || user.status !== 'active') return null;
  return user;
}

function sanitizeUser(user) {
  if (!user) return null;
  let permissions = [];
  try { permissions = JSON.parse(user.permissions || '[]'); } catch (e) { permissions = []; }
  return {
    id: user.id,
    kitchen_id: user.kitchen_id,
    branch_id: user.branch_id,
    username: user.username,
    role: user.role,
    permissions,
    is_super_admin: !!user.is_super_admin,
    status: user.status,
  };
}

// Compute effective plan info for a kitchen: active plan, trial countdown, lockout status
function getKitchenPlanStatus(kitchen) {
  if (!kitchen) return null;
  const now = new Date();
  const plan = PLANS[kitchen.plan] || PLANS.trial;
  let isLocked = false;
  let daysLeft = null;

  if (kitchen.plan === 'trial') {
    const ends = kitchen.trial_ends_at ? new Date(kitchen.trial_ends_at) : null;
    if (ends) {
      daysLeft = Math.ceil((ends - now) / (1000*60*60*24));
      if (now > ends) isLocked = true;
    }
  } else {
    if (kitchen.subscription_active_until) {
      const activeUntil = new Date(kitchen.subscription_active_until);
      if (now > activeUntil) isLocked = true;
    }
  }

  return {
    plan: kitchen.plan,
    plan_label: plan.label,
    price: plan.price,
    max_branches: plan.max_branches,
    max_users: plan.max_users,
    features: plan.features,
    is_locked: isLocked,
    days_left: daysLeft,
    trial_ends_at: kitchen.trial_ends_at,
    subscription_active_until: kitchen.subscription_active_until,
    payment_status: kitchen.payment_status,
  };
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session_token;
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  req.kitchenId = user.kitchen_id;
  req.branchId = user.branch_id;
  next();
}

// Block access if kitchen is locked (trial expired / subscription lapsed) — except billing/settings/users
const ALWAYS_ALLOWED_WHEN_LOCKED = ['/auth/', '/billing', '/account', '/settings', '/branches', '/users'];

function requireActiveSubscription(req, res, next) {
  if (req.user.is_super_admin) return next();
  if (!req.kitchenId) return next();
  if (ALWAYS_ALLOWED_WHEN_LOCKED.some(p => req.path.startsWith(p))) return next();
  const kitchen = get('SELECT * FROM kitchens WHERE id=?', [req.kitchenId]);
  if (!kitchen) return res.status(404).json({ error: 'Kitchen not found' });
  const status = getKitchenPlanStatus(kitchen);
  if (status.is_locked) {
    return res.status(402).json({ error: 'TRIAL_EXPIRED', message: 'Your trial or subscription has expired. Please upgrade to continue.', planStatus: status });
  }
  next();
}

function requirePermission(page) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (user.is_super_admin) return next();
    let perms = [];
    try { perms = JSON.parse(user.permissions || '[]'); } catch (e) {}
    if (user.role === 'admin' || perms.includes(page)) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.is_super_admin) return res.status(403).json({ error: 'Super admin only' });
  next();
}

module.exports = {
  createSession, destroySession, getSessionUser, sanitizeUser, getKitchenPlanStatus,
  requireAuth, requirePermission, requireSuperAdmin, requireActiveSubscription,
};
