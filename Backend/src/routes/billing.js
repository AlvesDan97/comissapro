const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');
const { listPlans, getPlan, planLimits } = require('../services/plans');

const router = express.Router();

router.get('/plans', (_req, res) => {
  res.json({
    plans: listPlans(),
    trialDays: 14,
    currency: 'BRL',
    note: 'Pagamento real (Pix/cartão) conecta-se na produção. Aqui a troca de plano é imediata.',
  });
});

router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const plan = getPlan(user.plan || 'solo') || getPlan('solo');
    res.json({
      subscription: {
        planId: user.plan || 'solo',
        planName: plan.name,
        billingCycle: user.billing_cycle || 'monthly',
        status: user.plan_status || 'trialing',
        startedAt: user.plan_started_at,
        price:
          (user.billing_cycle || 'monthly') === 'yearly'
            ? plan.priceYearly
            : plan.priceMonthly,
        limits: planLimits(user.plan || 'solo'),
      },
      plan,
    });
  })
);

router.post(
  '/subscribe',
  authRequired,
  asyncHandler(async (req, res) => {
    const { planId, billingCycle = 'monthly' } = req.body || {};
    const plan = getPlan(planId);
    if (!plan) return res.status(400).json({ error: 'Plano inválido. Use: solo, pro ou time.' });
    if (!['monthly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ error: 'Ciclo inválido. Use monthly ou yearly.' });
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const before = {
      plan: user.plan,
      billingCycle: user.billing_cycle,
      status: user.plan_status,
    };
    const now = new Date().toISOString();

    await db.run(
      `UPDATE users SET plan=?, billing_cycle=?, plan_status=?, plan_started_at=COALESCE(plan_started_at, ?), updated_at=?
     WHERE id=?`,
      [planId, billingCycle, 'active', now, now, user.id]
    );

    const updated = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
    const after = {
      plan: updated.plan,
      billingCycle: updated.billing_cycle,
      status: updated.plan_status,
      price: billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly,
    };
    await audit(user.id, 'SUBSCRIBE', 'billing', planId, before, after);

    res.json({
      ok: true,
      subscription: {
        planId: updated.plan,
        planName: plan.name,
        billingCycle: updated.billing_cycle,
        status: updated.plan_status,
        startedAt: updated.plan_started_at,
        price: after.price,
        limits: planLimits(updated.plan),
      },
      message: `Plano ${plan.name} ativado com sucesso.`,
    });
  })
);

module.exports = router;
