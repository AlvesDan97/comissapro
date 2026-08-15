const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { signToken, authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');
const { NICHE_FIELDS } = require('../services/commissionEngine');
const { getPlan, planLimits } = require('../services/plans');

const router = express.Router();

function publicUser(row) {
  const planId = row.plan || 'solo';
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
    plan: planId,
    planName: plan?.name || 'Solo',
    billingCycle: row.billing_cycle || 'monthly',
    planStatus: row.plan_status || 'trialing',
    planStartedAt: row.plan_started_at,
    planLimits: planLimits(planId),
    createdAt: row.created_at,
  };
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, password, name, planId = 'pro', billingCycle = 'monthly' } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    }
    if (!req.body?.acceptedTerms || !req.body?.acceptedPrivacy) {
      return res.status(400).json({ error: 'É necessário aceitar os Termos de Uso e a Política de Privacidade.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 8 caracteres' });
    }
    const plan = getPlan(planId) || getPlan('pro');
    const cycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';
    const exists = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (exists) return res.status(409).json({ error: 'E-mail já cadastrado' });

    const now = new Date().toISOString();
    const id = uuid();
    const password_hash = bcrypt.hashSync(password, 12);
    await db.run(
      `INSERT INTO users (id, email, password_hash, name, plan, billing_cycle, plan_status, plan_started_at, accepted_terms_at, accepted_privacy_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'trialing', ?, ?, ?, ?, ?)`,
      [id, email.toLowerCase(), password_hash, name, plan.id, cycle, now, now, now, now, now]
    );

    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    await audit(id, 'CREATE', 'user', id, null, publicUser(user));
    res.status(201).json({ token: signToken(user), user: publicUser(user), nicheFields: NICHE_FIELDS });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password, otp } = req.body || {};
    const user = await db.get('SELECT * FROM users WHERE email = ?', [(email || '').toLowerCase()]);
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    if (user.twofa_enabled) {
      const ok = otp === '123456' || otp === user.twofa_secret;
      if (!ok) {
        return res.status(401).json({
          error: 'OTP necessário',
          requireOtp: true,
          hint: 'Use 123456 neste ambiente de demonstração',
        });
      }
    }
    await audit(user.id, 'LOGIN', 'user', user.id, null, { email: user.email });
    res.json({ token: signToken(user), user: publicUser(user), nicheFields: NICHE_FIELDS });
  })
);

router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ user: publicUser(user), nicheFields: NICHE_FIELDS });
  })
);

router.patch(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const before = publicUser(user);
    const { name, niche, multiStore, onboardingDone, twofaEnabled, biometryEnabled, theme } = req.body || {};

    const next = {
      name: name ?? user.name,
      niche: niche ?? user.niche,
      multi_store: multiStore !== undefined ? (multiStore ? 1 : 0) : user.multi_store,
      onboarding_done: onboardingDone !== undefined ? (onboardingDone ? 1 : 0) : user.onboarding_done,
      twofa_enabled: twofaEnabled !== undefined ? (twofaEnabled ? 1 : 0) : user.twofa_enabled,
      twofa_secret: twofaEnabled ? user.twofa_secret || '123456' : user.twofa_secret,
      biometry_enabled: biometryEnabled !== undefined ? (biometryEnabled ? 1 : 0) : user.biometry_enabled,
      theme: theme ?? user.theme,
    };

    await db.run(
      `UPDATE users SET name=?, niche=?, multi_store=?, onboarding_done=?, twofa_enabled=?,
       twofa_secret=?, biometry_enabled=?, theme=?, updated_at=? WHERE id=?`,
      [
        next.name,
        next.niche,
        next.multi_store,
        next.onboarding_done,
        next.twofa_enabled,
        next.twofa_secret,
        next.biometry_enabled,
        next.theme,
        new Date().toISOString(),
        user.id,
      ]
    );

    const updated = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
    await audit(user.id, 'UPDATE', 'user', user.id, before, publicUser(updated));
    res.json({ user: publicUser(updated) });
  })
);

module.exports = router;
