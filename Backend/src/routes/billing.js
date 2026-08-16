const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');
const { listPlans, getPlan, planLimits, seatCap } = require('../services/plans');
const { requireOwner, workspaceId } = require('../services/scope');
const asaas = require('../services/asaas');

const router = express.Router();

router.get('/plans', (_req, res) => {
  res.json({
    plans: listPlans(),
    trialDays: 30,
    currency: 'BRL',
    asaasEnabled: asaas.enabled(),
    note: '1 mês grátis para testar. Pagamento via Asaas (Pix/cartão) na produção.',
  });
});

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const secret = process.env.ASAAS_WEBHOOK_TOKEN;
    if (secret) {
      const header = req.headers['asaas-access-token'] || req.headers['asaas_access_token'];
      if (header !== secret) return res.status(401).json({ error: 'Webhook não autorizado' });
    }
    const event = req.body?.event || req.body?.type;
    const payment = req.body?.payment || req.body?.subscription || {};
    const customer = payment.customer || req.body?.customer;
    const status = asaas.mapWebhookEvent(event);
    if (status && customer) {
      const user = await db.get(
        'SELECT * FROM users WHERE asaas_customer_id=? OR asaas_subscription_id=?',
        [customer, payment.subscription || payment.id]
      );
      if (user) {
        await db.run(`UPDATE users SET plan_status=?, updated_at=? WHERE id=?`, [
          status,
          new Date().toISOString(),
          user.id,
        ]);
        await audit(user.id, 'WEBHOOK', 'billing', user.id, { event }, { status });
      }
    }
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const owner = await db.get('SELECT * FROM users WHERE id=?', [workspaceId(req)]);
    if (!owner) return res.status(404).json({ error: 'Usuário não encontrado' });
    const plan = getPlan(owner.plan || 'solo') || getPlan('solo');
    const extra = Number(owner.extra_seats) || 0;
    const base =
      (owner.billing_cycle || 'monthly') === 'yearly' ? plan.priceYearly : plan.priceMonthly;
    const asaasSub = await asaas.getSubscription(owner.asaas_subscription_id);
    const payments = (await asaas.listSubscriptionPayments(owner.asaas_subscription_id)).map(asaas.mapPayment).filter(Boolean);
    const openPay = payments.find((p) => p.open);
    const failedPay = payments.find((p) => p.failed);
    res.json({
      subscription: {
        planId: owner.plan || 'solo',
        planName: plan.name,
        billingCycle: owner.billing_cycle || 'monthly',
        status: req.user.planStatus,
        startedAt: owner.plan_started_at,
        trialEndsAt: owner.trial_ends_at,
        extraSeats: extra,
        price: base + extra * (plan.extraSeatPrice || 0) * ((owner.billing_cycle || 'monthly') === 'yearly' ? 12 : 1),
        limits: { ...planLimits(owner.plan || 'solo'), extraSeats: extra, maxTeamMembers: seatCap(owner) },
        asaasEnabled: asaas.enabled(),
        asaasLinked: !!owner.asaas_subscription_id,
        nextDueDate: asaasSub?.nextDueDate || owner.trial_ends_at?.slice(0, 10) || null,
        billingType: asaasSub?.billingType || null,
        asaasStatus: asaasSub?.status || null,
        payUrl: openPay?.invoiceUrl || failedPay?.invoiceUrl || null,
        openInvoice: openPay || failedPay || null,
      },
      invoices: payments,
      plan,
      isOwner: req.user.isOwner,
    });
  })
);

router.post(
  '/subscribe',
  authRequired,
  requireOwner,
  asyncHandler(async (req, res) => {
    const { planId, billingCycle = 'monthly' } = req.body || {};
    const plan = getPlan(planId);
    if (!plan) return res.status(400).json({ error: 'Plano inválido. Use: solo, pro ou time.' });
    if (!['monthly', 'yearly'].includes(billingCycle)) {
      return res.status(400).json({ error: 'Ciclo inválido. Use monthly ou yearly.' });
    }

    const user = await db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
    const used = (
      await db.get(
        `SELECT COUNT(*) as c FROM team_members WHERE owner_user_id=? AND status IN ('pending','accepted')`,
        [user.id]
      )
    ).c;
    const nextCap = (planLimits(planId).maxTeamMembers || 0) + (Number(user.extra_seats) || 0);
    if (used > nextCap) {
      return res.status(403).json({
        error: `Há ${used} pessoas no espaço. Remova convites ou adicione assentos extras antes de descer de plano.`,
      });
    }

    const before = { plan: user.plan, billingCycle: user.billing_cycle, status: user.plan_status };
    const now = new Date().toISOString();
    let asaasSub = user.asaas_subscription_id;
    let payUrl = null;
    let message = `Plano ${plan.name} ativado.`;

    if (asaas.enabled()) {
      const customerId = await asaas.ensureCustomer(user);
      if (customerId && customerId !== user.asaas_customer_id) {
        await db.run(`UPDATE users SET asaas_customer_id=? WHERE id=?`, [customerId, user.id]);
      }
      if (user.asaas_subscription_id) {
        await asaas.cancelSubscription(user.asaas_subscription_id);
      }
      const stillTrial =
        user.plan_status === 'trialing' && user.trial_ends_at && new Date(user.trial_ends_at) > new Date();
      const created = await asaas.createSubscription({
        customerId: customerId || user.asaas_customer_id,
        plan,
        billingCycle,
        extraSeats: Number(user.extra_seats) || 0,
        nextDueDate: stillTrial ? user.trial_ends_at : null,
      });
      asaasSub = created?.id || null;
      const pays = (await asaas.listSubscriptionPayments(asaasSub)).map(asaas.mapPayment).filter(Boolean);
      payUrl = pays.find((p) => p.invoiceUrl)?.invoiceUrl || created?.invoiceUrl || null;
      message = stillTrial
        ? `Plano ${plan.name} reservado. A 1ª cobrança fica para o fim do mês grátis. Abra a fatura para cadastrar Pix ou cartão.`
        : `Plano ${plan.name} no Asaas. Pague a fatura para ativar a recorrência.`;
    }

    const status = asaas.enabled() ? user.plan_status || 'trialing' : 'active';
    await db.run(
      `UPDATE users SET plan=?, billing_cycle=?, plan_status=?, plan_started_at=COALESCE(plan_started_at, ?),
        asaas_subscription_id=?, updated_at=? WHERE id=?`,
      [planId, billingCycle, status, now, asaasSub, now, user.id]
    );

    const updated = await db.get('SELECT * FROM users WHERE id=?', [user.id]);
    await audit(user.id, 'SUBSCRIBE', 'billing', planId, before, {
      plan: updated.plan,
      billingCycle: updated.billing_cycle,
      asaasSub,
    });

    res.json({
      ok: true,
      subscription: {
        planId: updated.plan,
        planName: plan.name,
        billingCycle: updated.billing_cycle,
        status: updated.plan_status,
        startedAt: updated.plan_started_at,
        price: billingCycle === 'yearly' ? plan.priceYearly : plan.priceMonthly,
        limits: planLimits(updated.plan),
      },
      message,
      payUrl,
    });
  })
);

router.post(
  '/extra-seats',
  authRequired,
  requireOwner,
  asyncHandler(async (req, res) => {
    const extraSeats = Math.max(0, Number(req.body?.extraSeats) || 0);
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (user.plan !== 'time') {
      return res.status(403).json({ error: 'Assento extra só no plano Time.' });
    }
    const used = (
      await db.get(
        `SELECT COUNT(*) as c FROM team_members WHERE owner_user_id=? AND status IN ('pending','accepted')`,
        [user.id]
      )
    ).c;
    const included = planLimits('time').maxTeamMembers || 3;
    if (used > included + extraSeats) {
      return res.status(400).json({ error: 'Há mais pessoas no espaço do que o total de assentos.' });
    }
    await db.run(`UPDATE users SET extra_seats=?, updated_at=? WHERE id=?`, [
      extraSeats,
      new Date().toISOString(),
      user.id,
    ]);
    const plan = getPlan('time');
    if (asaas.enabled() && user.asaas_subscription_id) {
      const value =
        ((user.billing_cycle || 'monthly') === 'yearly' ? plan.priceYearly : plan.priceMonthly) +
        extraSeats * (plan.extraSeatPrice || 0) * ((user.billing_cycle || 'monthly') === 'yearly' ? 12 : 1);
      await asaas.updateSubscription(user.asaas_subscription_id, { value });
    }
    res.json({ ok: true, extraSeats, monthlyExtra: extraSeats * (plan.extraSeatPrice || 0) });
  })
);

router.post(
  '/cancel',
  authRequired,
  requireOwner,
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (user.asaas_subscription_id) {
      await asaas.cancelSubscription(user.asaas_subscription_id);
    }
    await db.run(`UPDATE users SET plan_status='canceled', asaas_subscription_id=NULL, updated_at=? WHERE id=?`, [
      new Date().toISOString(),
      user.id,
    ]);
    await audit(user.id, 'CANCEL', 'billing', user.id, { status: user.plan_status }, { status: 'canceled' });
    res.json({
      ok: true,
      message: 'Assinatura cancelada. O acesso segue até o fim do período já pago ou do mês grátis.',
    });
  })
);

module.exports = router;
