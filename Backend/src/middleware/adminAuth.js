const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('./auth');

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return xf || req.ip || req.socket?.remoteAddress || '';
}

function ipAllowed(req) {
  const allow = (process.env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allow.length) return true;
  const ip = clientIp(req);
  return allow.some((a) => ip === a || ip.endsWith(a) || ip.includes(a));
}

function emailAllowed(email) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return true;
  return list.includes(String(email || '').toLowerCase());
}

function signAdminToken(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email, typ: 'admin', role: admin.role },
    JWT_SECRET,
    { expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '12h' }
  );
}

function publicAdmin(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

function adminRequired(req, res, next) {
  if (!ipAllowed(req)) {
    return res.status(403).json({ error: 'Acesso admin não permitido neste IP.' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token admin ausente' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Sessão admin inválida ou expirada' });
  }
  if (payload.typ !== 'admin') {
    return res.status(403).json({ error: 'Esta sessão não é do portal admin.' });
  }
  db.get('SELECT * FROM admin_users WHERE id=?', [payload.sub])
    .then((row) => {
      if (!row || !row.active) return res.status(401).json({ error: 'Admin não encontrado' });
      if (!emailAllowed(row.email)) {
        return res.status(403).json({ error: 'E-mail admin não autorizado.' });
      }
      req.admin = publicAdmin(row);
      req.adminIp = clientIp(req);
      next();
    })
    .catch(next);
}

module.exports = {
  clientIp,
  ipAllowed,
  emailAllowed,
  signAdminToken,
  publicAdmin,
  adminRequired,
};
