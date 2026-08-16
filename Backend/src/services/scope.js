function workspaceId(req) {
  return req.user.workspaceId;
}

function sellerScope(req, explicit) {
  if (explicit) return explicit;
  if (req.user?.canSeeTeam) return req.query?.sellerId || null;
  return req.user.id;
}

function saleFilter(req, { alias = '', sellerId } = {}) {
  const p = alias ? `${alias}.` : '';
  const ws = workspaceId(req);
  const seller = sellerId === undefined ? sellerScope(req) : sellerId;
  if (seller) {
    return { sql: `${p}user_id=? AND COALESCE(${p}seller_id, ${p}user_id)=?`, params: [ws, seller] };
  }
  return { sql: `${p}user_id=?`, params: [ws] };
}

function requireLaunch(req, res, next) {
  if (!req.user?.canLaunch) {
    return res.status(403).json({ error: 'Seu papel não permite lançar.' });
  }
  next();
}

function requireManage(req, res, next) {
  if (!req.user?.canManage) {
    return res.status(403).json({ error: 'Só o dono ou o admin altera regras, metas e equipe.' });
  }
  next();
}

function requireOwner(req, res, next) {
  if (!req.user?.isOwner) {
    return res.status(403).json({ error: 'Só o dono da conta gerencia a assinatura.' });
  }
  next();
}

function requirePipeline(req, res, next) {
  if (!['pro', 'time'].includes(req.user?.plan)) {
    return res.status(403).json({ error: 'Pipeline está no Pro e no Time.' });
  }
  next();
}

function requireActiveWorkspace(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const path = req.originalUrl || '';
  if (path.startsWith('/api/billing') || path.startsWith('/api/auth')) return next();
  const status = req.user?.planStatus;
  if (status === 'expired' || status === 'canceled' || status === 'overdue') {
    return res.status(402).json({
      error: 'Assinatura inativa. Regularize em Planos para continuar lançando.',
      upgradeRequired: true,
      planStatus: status,
    });
  }
  next();
}

module.exports = {
  workspaceId,
  sellerScope,
  saleFilter,
  requireLaunch,
  requireManage,
  requireOwner,
  requirePipeline,
  requireActiveWorkspace,
};
