const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { signToken, authRequired, buildSession, addDays } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');
const { NICHE_FIELDS } = require('../services/commissionEngine');
const { getPlan } = require('../services/plans');
const { sendTemplate, appBaseUrl } = require('../services/mail');
const { notify } = require('../services/notify');

const router = express.Router();

function token() {
  return crypto.randomBytes(24).toString('hex');
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
    const trialEnds = addDays(now, 30);
    await db.run(
      `INSERT INTO users (id, email, password_hash, name, plan, billing_cycle, plan_status, plan_started_at, trial_ends_at, workspace_id, workspace_role, accepted_terms_at, accepted_privacy_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'trialing', ?, ?, ?, 'owner', ?, ?, ?, ?)`,
      [id, email.toLowerCase(), password_hash, name, plan.id, cycle, now, trialEnds, id, now, now, now, now]
    );

    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    const session = await buildSession(user);
    await audit(id, 'CREATE', 'user', id, null, session);
    res.status(201).json({ token: signToken(user), user: session, nicheFields: NICHE_FIELDS });
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
    const session = await buildSession(user);
    await audit(user.id, 'LOGIN', 'user', user.id, null, { email: user.email });
    res.json({ token: signToken(user), user: session, nicheFields: NICHE_FIELDS });
  })
);

router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user, nicheFields: NICHE_FIELDS });
  })
);

router.patch(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const before = await buildSession(user);
    const {
      name,
      niche,
      multiStore,
      onboardingDone,
      twofaEnabled,
      biometryEnabled,
      theme,
      profession,
      company,
      currency,
    } = req.body || {};

    const next = {
      name: name ?? user.name,
      niche: niche ?? user.niche,
      multi_store: multiStore !== undefined ? (multiStore ? 1 : 0) : user.multi_store,
      onboarding_done: onboardingDone !== undefined ? (onboardingDone ? 1 : 0) : user.onboarding_done,
      twofa_enabled: twofaEnabled !== undefined ? (twofaEnabled ? 1 : 0) : user.twofa_enabled,
      twofa_secret: twofaEnabled ? user.twofa_secret || '123456' : user.twofa_secret,
      biometry_enabled: biometryEnabled !== undefined ? (biometryEnabled ? 1 : 0) : user.biometry_enabled,
      theme: theme ?? user.theme,
      profession: profession !== undefined ? String(profession).slice(0, 80) : user.profession,
      company: company !== undefined ? String(company).slice(0, 80) : user.company,
      currency: currency && ['BRL', 'USD', 'EUR'].includes(currency) ? currency : user.currency || 'BRL',
    };

    await db.run(
      `UPDATE users SET name=?, niche=?, multi_store=?, onboarding_done=?, twofa_enabled=?,
       twofa_secret=?, biometry_enabled=?, theme=?, profession=?, company=?, currency=?, updated_at=? WHERE id=?`,
      [
        next.name,
        next.niche,
        next.multi_store,
        next.onboarding_done,
        next.twofa_enabled,
        next.twofa_secret,
        next.biometry_enabled,
        next.theme,
        next.profession,
        next.company,
        next.currency,
        new Date().toISOString(),
        user.id,
      ]
    );

    const updated = await buildSession(await db.get('SELECT * FROM users WHERE id = ?', [user.id]));
    await audit(user.id, 'UPDATE', 'user', user.id, before, updated);
    res.json({ user: updated });
  })
);

router.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const user = email ? await db.get('SELECT * FROM users WHERE email=?', [email]) : null;
    if (user) {
      const reset = token();
      const expires = addDays(new Date().toISOString(), 1);
      await db.run(`UPDATE users SET reset_token=?, reset_token_expires=?, updated_at=? WHERE id=?`, [
        reset,
        expires,
        new Date().toISOString(),
        user.id,
      ]);
      const link = `${appBaseUrl()}/app?reset=${reset}`;
      await sendTemplate('reset', { to: user.email, vars: { link } });
    }
    res.json({ ok: true, message: 'Se o e-mail existir, enviamos o link de redefinição.' });
  })
);

router.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const { token: resetToken, password } = req.body || {};
    if (!resetToken || !password) return res.status(400).json({ error: 'Token e senha são obrigatórios' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Senha deve ter pelo menos 8 caracteres' });
    const user = await db.get(
      'SELECT * FROM users WHERE reset_token=? AND reset_token_expires >= ?',
      [resetToken, new Date().toISOString()]
    );
    if (!user) return res.status(400).json({ error: 'Link inválido ou expirado' });
    await db.run(
      `UPDATE users SET password_hash=?, reset_token=NULL, reset_token_expires=NULL, updated_at=? WHERE id=?`,
      [bcrypt.hashSync(password, 12), new Date().toISOString(), user.id]
    );
    const session = await buildSession(user);
    res.json({ ok: true, token: signToken(user), user: session, nicheFields: NICHE_FIELDS });
  })
);

router.get(
  '/invite/:token',
  asyncHandler(async (req, res) => {
    const row = await db.get(
      `SELECT t.*, u.name as owner_name, u.plan as owner_plan
       FROM team_members t JOIN users u ON u.id=t.owner_user_id
       WHERE t.invite_token=?`,
      [req.params.token]
    );
    if (!row || row.status === 'accepted') {
      return res.status(404).json({ error: 'Convite inválido ou já usado' });
    }
    if (row.invite_expires_at && row.invite_expires_at < new Date().toISOString()) {
      return res.status(400).json({ error: 'Convite expirado' });
    }
    res.json({
      invite: {
        email: row.email,
        name: row.name,
        role: row.role,
        ownerName: row.owner_name,
        plan: row.owner_plan,
      },
    });
  })
);

router.post(
  '/accept-invite',
  asyncHandler(async (req, res) => {
    const { token: inviteToken, password, name, acceptedTerms, acceptedPrivacy } = req.body || {};
    if (!inviteToken || !password) return res.status(400).json({ error: 'Token e senha são obrigatórios' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Senha deve ter pelo menos 8 caracteres' });
    if (!acceptedTerms || !acceptedPrivacy) {
      return res.status(400).json({ error: 'Aceite os Termos e a Privacidade.' });
    }
    const invite = await db.get('SELECT * FROM team_members WHERE invite_token=?', [inviteToken]);
    if (!invite || invite.status === 'accepted') {
      return res.status(400).json({ error: 'Convite inválido ou já usado' });
    }
    if (invite.invite_expires_at && invite.invite_expires_at < new Date().toISOString()) {
      return res.status(400).json({ error: 'Convite expirado' });
    }
    const exists = await db.get('SELECT id FROM users WHERE email=?', [invite.email]);
    if (exists) return res.status(409).json({ error: 'Este e-mail já tem conta. Entre e peça um novo convite se necessário.' });

    const now = new Date().toISOString();
    const id = uuid();
    const owner = await db.get('SELECT * FROM users WHERE id=?', [invite.owner_user_id]);
    await db.run(
      `INSERT INTO users (id, email, password_hash, name, plan, billing_cycle, plan_status, plan_started_at, trial_ends_at, workspace_id, workspace_role, onboarding_done, accepted_terms_at, accepted_privacy_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      [
        id,
        invite.email,
        bcrypt.hashSync(password, 12),
        name || invite.name || invite.email,
        owner?.plan || 'solo',
        owner?.billing_cycle || 'monthly',
        owner?.plan_status || 'trialing',
        owner?.plan_started_at || now,
        owner?.trial_ends_at || now,
        invite.owner_user_id,
        invite.role || 'viewer',
        now,
        now,
        now,
        now,
      ]
    );
    await db.run(
      `UPDATE team_members SET status='accepted', member_user_id=?, name=?, invite_token=NULL WHERE id=?`,
      [id, name || invite.name, invite.id]
    );
    const user = await db.get('SELECT * FROM users WHERE id=?', [id]);
    const session = await buildSession(user);
    await audit(invite.owner_user_id, 'ACCEPT', 'team_member', invite.id, invite, { memberUserId: id });
    await notify({
      userId: invite.owner_user_id,
      workspaceId: invite.owner_user_id,
      type: 'invite',
      title: `${name || invite.name || invite.email} entrou no espaço`,
      body: `${invite.email} aceitou o convite`,
      link: `${appBaseUrl()}/app`,
    });
    res.status(201).json({ token: signToken(user), user: session, nicheFields: NICHE_FIELDS });
  })
);

module.exports = router;
