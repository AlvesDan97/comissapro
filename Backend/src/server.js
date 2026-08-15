const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');

const authRoutes = require('./routes/auth');
const storeRoutes = require('./routes/stores');
const salesRoutes = require('./routes/sales');
const leadsRoutes = require('./routes/leads');
const dashboardRoutes = require('./routes/dashboard');
const toolsRoutes = require('./routes/tools');
const teamRoutes = require('./routes/team');
const billingRoutes = require('./routes/billing');

const app = express();
const PORT = process.env.PORT || 3847;
const isProd = process.env.NODE_ENV === 'production';
const frontendPath = path.join(__dirname, '..', '..', 'Frontend');

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (!isProd) return cb(null, true);
      if (!allowedOrigins.length) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Origem não permitida pelo CORS'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API || 180),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de requisições excedido. Tente novamente em instantes.' },
});

app.get('/api/health', async (_req, res) => {
  try {
    await db.get('SELECT 1 AS ok');
    res.json({
      ok: true,
      name: 'ComissaPro API',
      version: '1.1.0',
      db: db.usePostgres ? 'postgres' : 'sqlite',
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Banco indisponível' });
  }
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', loginLimiter);
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/billing', billingRoutes);

app.use(express.static(frontendPath, { maxAge: isProd ? '1h' : 0 }));

app.get('/', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.get(['/app', '/app.html'], (_req, res) => {
  res.sendFile(path.join(frontendPath, 'app.html'));
});

const legalPages = {
  '/termos': 'termos.html',
  '/termos.html': 'termos.html',
  '/privacidade': 'privacidade.html',
  '/privacidade.html': 'privacidade.html',
  '/cookies': 'cookies.html',
  '/cookies.html': 'cookies.html',
  '/cancelamento': 'cancelamento.html',
  '/cancelamento.html': 'cancelamento.html',
  '/questionario': 'questionario.html',
  '/questionario.html': 'questionario.html',
};
Object.entries(legalPages).forEach(([route, file]) => {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(frontendPath, file));
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (req.path.includes('.')) return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.message?.includes('CORS') ? 403 : 500;
  res.status(status).json({
    error: isProd && status === 500 ? 'Erro interno' : err.message || 'Erro interno',
  });
});

async function start() {
  console.log(`[boot] NODE_ENV=${process.env.NODE_ENV || 'undefined'} PORT=${PORT}`);
  console.log(`[boot] DATABASE_URL=${process.env.DATABASE_URL ? 'set' : 'missing'}`);
  console.log(`[boot] JWT_SECRET=${process.env.JWT_SECRET ? 'set' : 'missing'}`);

  if (isProd && !process.env.JWT_SECRET) {
    console.error('FATAL: defina JWT_SECRET nas Variables do Railway (Settings → Variables).');
    process.exit(1);
  }

  const info = await db.init();
  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`ComissaPro listening on 0.0.0.0:${PORT}`);
      console.log(`[db] driver=${info.driver}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

start().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});
