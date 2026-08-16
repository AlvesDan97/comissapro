const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../db');

async function bootstrapAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
  const name = process.env.ADMIN_NAME || 'Dono Comiss';
  const count = await db.get('SELECT COUNT(*) as c FROM admin_users');
  const n = Number(count?.c) || 0;

  if (!email || !password) {
    if (!n) {
      console.warn('[admin] nenhum operador. Defina ADMIN_EMAIL e ADMIN_BOOTSTRAP_PASSWORD no Railway.');
    }
    return;
  }
  if (password.length < 8) {
    console.warn('[admin] ADMIN_BOOTSTRAP_PASSWORD deve ter pelo menos 8 caracteres. Bootstrap ignorado.');
    return;
  }

  const existing = await db.get('SELECT id FROM admin_users WHERE email=?', [email]);
  if (existing) {
    console.log('[admin] operador já existe:', email);
    return;
  }

  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO admin_users (id, email, password_hash, name, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'owner', 1, ?, ?)`,
    [uuid(), email, bcrypt.hashSync(password, 12), name, now, now]
  );
  console.log('[admin] operador inicial criado:', email);
}

module.exports = { bootstrapAdmin };
