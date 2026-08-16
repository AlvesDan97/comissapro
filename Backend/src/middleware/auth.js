const jwt = require('jsonwebtoken');
const db = require('../db');
const { getPlan, planLimits } = require('../services/plans');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (!secret || secret === 'comiss-dev-secret-change-in-production') {
    if (isProd) {
      throw new Error('JWT_SECRET obrigatório em produção. Defina no Railway.');
    }
    return 'comiss-dev-secret-change-in-production';
  }
  if (secret.length < 24 && isProd) {
    throw new Error('JWT_SECRET deve ter pelo menos 24 caracteres.');
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function addDays(iso, days) {
  const d = new Date(iso || Date.now());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function trialExpired(owner) {
  if (!owner) return false;
  if (owner.plan_status === 'active') return false;
  const ends = owner.trial_ends_at || addDays(owner.plan_started_at, 30);
  return new Date(ends).getTime() < Date.now() && (owner.plan_status === 'trialing' || !owner.plan_status);
}

async function buildSession(row) {
  if (!row) return null;
  const workspaceId = row.workspace_id || row.id;
  const isOwner = row.id === workspaceId;
  const owner = isOwner ? row : await db.get('SELECT * FROM users WHERE id=?', [workspaceId]);
  let planStatus = owner?.plan_status || 'trialing';
  if (trialExpired(owner) && planStatus === 'trialing') {
    planStatus = 'expired';
    await db.run(`UPDATE users SET plan_status='expired', updated_at=? WHERE id=?`, [
      new Date().toISOString(),
      owner.id,
    ]);
  }
  const role = isOwner ? 'owner' : row.workspace_role || 'viewer';
  const planId = owner?.plan || 'solo';
  const plan = getPlan(planId);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    niche: row.niche,
    multiStore: !!row.multi_store,
    onboardingDone: !!row.onboarding_done,
    twofaEnabled: !!row.twofa_enabled,
    biometryEnabled: !!row.biometry_enabled,
    theme: row.theme,
    profession: row.profession || '',
    company: row.company || '',
    currency: row.currency || 'BRL',
    createdAt: row.created_at,
    workspaceId,
    workspaceRole: role,
    isOwner,
    canManage: role === 'owner' || role === 'admin',
    canLaunch: role === 'owner' || role === 'admin' || role === 'editor',
    canSeeTeam: role === 'owner' || role === 'admin',
    plan: planId,
    planName: plan?.name || 'Solo',
    billingCycle: owner?.billing_cycle || 'monthly',
    planStatus,
    planStartedAt: owner?.plan_started_at,
    trialEndsAt: owner?.trial_ends_at || addDays(owner?.plan_started_at, 30),
    extraSeats: Number(owner?.extra_seats) || 0,
    planLimits: {
      ...planLimits(planId),
      extraSeats: Number(owner?.extra_seats) || 0,
      maxTeamMembers:
        (planLimits(planId).maxTeamMembers || 0) + (Number(owner?.extra_seats) || 0),
    },
    asaasEnabled: !!process.env.ASAAS_API_KEY,
  };
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
  db.get('SELECT * FROM users WHERE id=?', [payload.sub])
    .then((row) => {
      if (!row) return res.status(401).json({ error: 'Usuário não encontrado' });
      if (row.blocked_at) return res.status(403).json({ error: 'Esta conta foi bloqueada.' });
      return buildSession(row).then((session) => {
        req.user = session;
        next();
      });
    })
    .catch(next);
}

module.exports = { signToken, authRequired, JWT_SECRET, buildSession, addDays };
