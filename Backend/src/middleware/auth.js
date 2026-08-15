const jwt = require('jsonwebtoken');

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

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = { signToken, authRequired, JWT_SECRET };
