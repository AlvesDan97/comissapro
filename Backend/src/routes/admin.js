const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');
const { signToken, addDays } = require('../middleware/auth');
const {
  adminRequired,
  signAdminToken,
  publicAdmin,
  emailAllowed,
  ipAllowed,
  clientIp,
} = require('../middleware/adminAuth');
const { adminAudit } = require('../services/adminAudit');
const support = require('../services/supportTickets');
const { listPlans, getPlan, planLimits, planMrr, updatePlan } = require('../services/plans');

const router = express.Router();

function money(n) {
  return Number(n || 0);
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    if (!ipAllowed(req)) {
      return res.status(403).json({ error: 'Acesso admin não permitido neste IP.' });
    }
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios' });
    if (!emailAllowed(email)) {
      return res.status(403).json({
        error: 'Este e-mail não está na lista do portal. Use o mesmo e-mail de ADMIN_EMAIL no Railway.',
      });
    }

    const admin = await db.get('SELECT * FROM admin_users WHERE email=?', [email]);
    if (!admin || !admin.active || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    await db.run(`UPDATE admin_users SET last_login_at=?, updated_at=? WHERE id=?`, [
      new Date().toISOString(),
      new Date().toISOString(),
      admin.id,
    ]);
    req.admin = publicAdmin(admin);
    req.adminIp = clientIp(req);
    await adminAudit(req, 'LOGIN', 'admin', admin.id);
    res.json({ token: signAdminToken(admin), admin: publicAdmin(admin) });
  })
);

router.use(adminRequired);

router.get('/me', (req, res) => {
  res.json({
    admin: req.admin,
    asaasEnabled: !!process.env.ASAAS_API_KEY,
    resendEnabled: !!process.env.RESEND_API_KEY,
  });
});

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const owners = await db.all(`SELECT * FROM users WHERE id = workspace_id`);
    const members = await db.all(`SELECT id FROM users WHERE id != workspace_id`);
    const sales = await db.get(`SELECT COUNT(*) as c, COALESCE(SUM(commission_total),0) as comm FROM sales WHERE status!='cancelada'`);
    const month = new Date().toISOString().slice(0, 7);
    const salesMonth = await db.get(
      `SELECT COUNT(*) as c FROM sales WHERE substr(sale_date,1,7)=? AND status!='cancelada'`,
      [month]
    );
    const byStatus = {};
    const byPlan = {};
    let mrr = 0;
    let trials = 0;
    let blocked = 0;
    for (const o of owners) {
      byStatus[o.plan_status || 'trialing'] = (byStatus[o.plan_status || 'trialing'] || 0) + 1;
      byPlan[o.plan || 'solo'] = (byPlan[o.plan || 'solo'] || 0) + 1;
      mrr += planMrr(o);
      if (o.plan_status === 'trialing') trials += 1;
      if (o.blocked_at) blocked += 1;
    }
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const newWeek = await db.get(
      `SELECT COUNT(*) as c FROM users WHERE id = workspace_id AND created_at>=?`,
      [weekAgo]
    );
    const today = new Date().toISOString().slice(0, 10);
    const newToday = await db.get(
      `SELECT COUNT(*) as c FROM users WHERE id = workspace_id AND substr(created_at,1,10)=?`,
      [today]
    );
    const inbox = await support.stats();
    res.json({
      kpis: {
        accounts: owners.length,
        members: members.length,
        trials,
        blocked,
        mrr: Math.round(mrr * 100) / 100,
        sales: Number(sales?.c) || 0,
        salesMonth: Number(salesMonth?.c) || 0,
        commissionAll: money(sales?.comm),
        newToday: Number(newToday?.c) || 0,
        newWeek: Number(newWeek?.c) || 0,
        inboxUnread: inbox.unread,
        inboxWaiting: inbox.waitingStaff,
      },
      byStatus,
      byPlan,
      inbox,
    });
  })
);

router.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const plan = String(req.query.plan || '').trim();
    const status = String(req.query.status || '').trim();
    let rows = await db.all(
      `SELECT id, email, name, plan, billing_cycle, plan_status, trial_ends_at, plan_started_at,
              extra_seats, asaas_customer_id, asaas_subscription_id, workspace_id, workspace_role,
              blocked_at, blocked_reason, created_at, onboarding_done, company, profession
       FROM users WHERE id = workspace_id
       ORDER BY created_at DESC`
    );
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.email || '').toLowerCase().includes(q) ||
          (r.name || '').toLowerCase().includes(q) ||
          (r.company || '').toLowerCase().includes(q)
      );
    }
    if (plan) rows = rows.filter((r) => r.plan === plan);
    if (status) rows = rows.filter((r) => (r.plan_status || '') === status);
    res.json({
      accounts: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        company: r.company,
        plan: r.plan,
        planName: getPlan(r.plan)?.name || r.plan,
        billingCycle: r.billing_cycle,
        status: r.plan_status,
        trialEndsAt: r.trial_ends_at,
        extraSeats: Number(r.extra_seats) || 0,
        asaasLinked: !!r.asaas_subscription_id,
        blocked: !!r.blocked_at,
        onboardingDone: !!r.onboarding_done,
        createdAt: r.created_at,
        mrr: planMrr(r),
      })),
    });
  })
);

router.get(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Conta não encontrada' });
    const team = await db.all(
      `SELECT id, email, name, role, status, created_at FROM team_members WHERE owner_user_id=? ORDER BY created_at DESC`,
      [user.workspace_id || user.id]
    );
    const sales = await db.get(
      `SELECT COUNT(*) as c, COALESCE(SUM(commission_total),0) as comm, COALESCE(SUM(gross_value),0) as rev
       FROM sales WHERE user_id=? AND status!='cancelada'`,
      [user.workspace_id || user.id]
    );
    const types = await db.get(
      `SELECT COUNT(*) as c FROM commission_types WHERE user_id=? AND active=1`,
      [user.workspace_id || user.id]
    );
    const notes = await db.all(
      `SELECT n.*, a.email as admin_email FROM account_notes n
       LEFT JOIN admin_users a ON a.id=n.admin_id
       WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 30`,
      [user.id]
    );
    const plan = getPlan(user.plan);
    res.json({
      account: {
        id: user.id,
        email: user.email,
        name: user.name,
        company: user.company,
        profession: user.profession,
        plan: user.plan,
        planName: plan?.name,
        billingCycle: user.billing_cycle,
        status: user.plan_status,
        trialEndsAt: user.trial_ends_at,
        planStartedAt: user.plan_started_at,
        extraSeats: Number(user.extra_seats) || 0,
        limits: planLimits(user.plan),
        asaasCustomerId: user.asaas_customer_id,
        asaasSubscriptionId: user.asaas_subscription_id,
        blocked: !!user.blocked_at,
        blockedReason: user.blocked_reason,
        onboardingDone: !!user.onboarding_done,
        createdAt: user.created_at,
        mrr: planMrr(user),
      },
      team,
      usage: {
        sales: Number(sales?.c) || 0,
        commission: money(sales?.comm),
        revenue: money(sales?.rev),
        commissionTypes: Number(types?.c) || 0,
        seats: team.length,
      },
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        adminEmail: n.admin_email,
        createdAt: n.created_at,
      })),
    });
  })
);

router.post(
  '/accounts/:id/note',
  asyncHandler(async (req, res) => {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Nota vazia' });
    const user = await db.get('SELECT id FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Conta não encontrada' });
    const id = uuid();
    await db.run(`INSERT INTO account_notes (id, user_id, admin_id, body, created_at) VALUES (?, ?, ?, ?, ?)`, [
      id,
      user.id,
      req.admin.id,
      body,
      new Date().toISOString(),
    ]);
    await adminAudit(req, 'NOTE', 'account', user.id, null, { body });
    res.status(201).json({ ok: true, id });
  })
);

router.post(
  '/accounts/:id/plan',
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Conta não encontrada' });
    const planId = req.body?.planId;
    const plan = getPlan(planId);
    if (!plan) return res.status(400).json({ error: 'Plano inválido' });
    const cycle = req.body?.billingCycle === 'yearly' ? 'yearly' : user.billing_cycle || 'monthly';
    await db.run(`UPDATE users SET plan=?, billing_cycle=?, updated_at=? WHERE id=?`, [
      planId,
      cycle,
      new Date().toISOString(),
      user.id,
    ]);
    await adminAudit(req, 'PLAN', 'account', user.id, { plan: user.plan }, { plan: planId, cycle });
    res.json({ ok: true });
  })
);

router.post(
  '/accounts/:id/status',
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Conta não encontrada' });
    const allowed = ['trialing', 'active', 'overdue', 'canceled', 'expired'];
    const status = req.body?.status;
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido' });
    await db.run(`UPDATE users SET plan_status=?, updated_at=? WHERE id=?`, [
      status,
      new Date().toISOString(),
      user.id,
    ]);
    await adminAudit(req, 'STATUS', 'account', user.id, { status: user.plan_status }, { status });
    res.json({ ok: true });
  })
);

router.post(
  '/accounts/:id/extend-trial',
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Conta não encontrada' });
    const days = Math.max(1, Number(req.body?.days) || 7);
    const base = user.trial_ends_at && new Date(user.trial_ends_at) > new Date() ? user.trial_ends_at : new Date().toISOString();
    const trialEnds = addDays(base, days);
    await db.run(`UPDATE users SET trial_ends_at=?, plan_status='trialing', updated_at=? WHERE id=?`, [
      trialEnds,
      new Date().toISOString(),
      user.id,
    ]);
    await adminAudit(req, 'EXTEND_TRIAL', 'account', user.id, { trial_ends_at: user.trial_ends_at }, { trialEnds, days });
    res.json({ ok: true, trialEndsAt: trialEnds });
  })
);

router.post(
  '/accounts/:id/block',
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Conta não encontrada' });
    const reason = String(req.body?.reason || 'bloqueado pelo operador').slice(0, 240);
    await db.run(`UPDATE users SET blocked_at=?, blocked_reason=?, updated_at=? WHERE id=?`, [
      new Date().toISOString(),
      reason,
      new Date().toISOString(),
      user.id,
    ]);
    await adminAudit(req, 'BLOCK', 'account', user.id, null, { reason });
    res.json({ ok: true });
  })
);

router.post(
  '/accounts/:id/unblock',
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Conta não encontrada' });
    await db.run(`UPDATE users SET blocked_at=NULL, blocked_reason=NULL, updated_at=? WHERE id=?`, [
      new Date().toISOString(),
      user.id,
    ]);
    await adminAudit(req, 'UNBLOCK', 'account', user.id);
    res.json({ ok: true });
  })
);

router.post(
  '/accounts/:id/impersonate',
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'Conta não encontrada' });
    await adminAudit(req, 'IMPERSONATE', 'account', user.id, null, { email: user.email });
    res.json({ token: signToken(user), email: user.email });
  })
);

router.get(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT id, email, name, plan, billing_cycle, plan_status, trial_ends_at, extra_seats,
              asaas_customer_id, asaas_subscription_id, created_at
       FROM users WHERE id = workspace_id ORDER BY created_at DESC`
    );
    res.json({
      subscriptions: rows.map((r) => ({
        accountId: r.id,
        email: r.email,
        name: r.name,
        plan: r.plan,
        planName: getPlan(r.plan)?.name || r.plan,
        billingCycle: r.billing_cycle,
        status: r.plan_status,
        trialEndsAt: r.trial_ends_at,
        extraSeats: Number(r.extra_seats) || 0,
        asaasCustomerId: r.asaas_customer_id,
        asaasSubscriptionId: r.asaas_subscription_id,
        mrr: planMrr(r),
        createdAt: r.created_at,
      })),
    });
  })
);

router.get('/plans', (_req, res) => {
  res.json({
    plans: listPlans(),
    note: 'Preço novo vale para cadastro e novas assinaturas. Quem já paga no Asaas permanece no valor da assinatura até migrar.',
  });
});

router.patch(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    try {
      const { before, after } = await updatePlan(req.params.id, { ...(req.body || {}), adminId: req.admin?.id });
      await adminAudit(req, 'PLAN_PRICE', 'plan', after.id, before, after);
      res.json({ ok: true, plan: after, before });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  })
);

router.get(
  '/revenue',
  asyncHandler(async (req, res) => {
    const owners = await db.all(`SELECT * FROM users WHERE id = workspace_id`);
    const mixMap = {};
    const cycle = { monthly: { accounts: 0, mrr: 0 }, yearly: { accounts: 0, mrr: 0 } };
    let mrr = 0;
    let trials = 0;
    let overdue = 0;
    let canceled = 0;
    let extraSeats = 0;
    let extraMrr = 0;
    for (const o of owners) {
      const planId = o.plan || 'solo';
      const plan = getPlan(planId);
      const value = planMrr(o);
      mrr += value;
      if (!mixMap[planId]) mixMap[planId] = { id: planId, name: plan?.name || planId, accounts: 0, paying: 0, mrr: 0 };
      mixMap[planId].accounts += 1;
      mixMap[planId].mrr += value;
      if (o.plan_status === 'active') mixMap[planId].paying += 1;
      const cyc = o.billing_cycle === 'yearly' ? 'yearly' : 'monthly';
      cycle[cyc].accounts += 1;
      cycle[cyc].mrr += value;
      if (o.plan_status === 'trialing') trials += 1;
      if (o.plan_status === 'overdue') overdue += 1;
      if (o.plan_status === 'canceled' || o.plan_status === 'expired') canceled += 1;
      extraSeats += Number(o.extra_seats) || 0;
      extraMrr += (Number(o.extra_seats) || 0) * (plan?.extraSeatPrice || 0) * (o.plan_status === 'active' ? 1 : 0);
    }
    const mix = Object.values(mixMap).map((row) => ({
      ...row,
      mrr: Math.round(row.mrr * 100) / 100,
      pct: mrr ? Math.round((row.mrr / mrr) * 1000) / 10 : 0,
    }));

    const signups = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      const inMonth = owners.filter((o) => String(o.created_at || '').slice(0, 7) === key);
      signups.push({
        month: key,
        label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        accounts: inMonth.length,
        mrrNow: Math.round(inMonth.reduce((s, o) => s + planMrr(o), 0) * 100) / 100,
      });
    }

    const thisMonth = monthKey(now);
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = monthKey(lastMonthDate);
    const newMrr = owners
      .filter((o) => String(o.created_at || '').slice(0, 7) === thisMonth && o.plan_status === 'active')
      .reduce((s, o) => s + planMrr(o), 0);
    const lastNew = owners
      .filter((o) => String(o.created_at || '').slice(0, 7) === lastMonth && o.plan_status === 'active')
      .reduce((s, o) => s + planMrr(o), 0);

    res.json({
      kpis: {
        mrr: Math.round(mrr * 100) / 100,
        arr: Math.round(mrr * 12 * 100) / 100,
        paying: owners.filter((o) => o.plan_status === 'active').length,
        accounts: owners.length,
        trials,
        overdue,
        canceled,
        extraSeats,
        extraMrr: Math.round(extraMrr * 100) / 100,
      },
      mix,
      cycle: {
        monthly: { ...cycle.monthly, mrr: Math.round(cycle.monthly.mrr * 100) / 100 },
        yearly: { ...cycle.yearly, mrr: Math.round(cycle.yearly.mrr * 100) / 100 },
      },
      signups,
      waterfall: {
        newMrr: Math.round(newMrr * 100) / 100,
        lastMonthNewMrr: Math.round(lastNew * 100) / 100,
        extraMrr: Math.round(extraMrr * 100) / 100,
        overdueAtRisk: Math.round(
          owners.filter((o) => o.plan_status === 'overdue').reduce((s, o) => {
            const p = getPlan(o.plan || 'solo');
            if (!p) return s;
            const extra = (Number(o.extra_seats) || 0) * (p.extraSeatPrice || 0);
            return s + (o.billing_cycle === 'yearly' ? p.priceYearly / 12 : p.priceMonthly) + extra;
          }, 0) * 100
        ) / 100,
      },
      note: 'MRR usa o catálogo atual nas contas ativas. Assinaturas Asaas antigas podem ter outro valor até a migração.',
    });
  })
);

router.get(
  '/inbox',
  asyncHandler(async (req, res) => {
    const tickets = await support.listForAdmin({
      kind: req.query.kind || '',
      status: req.query.status || '',
      q: req.query.q || '',
    });
    res.json({ tickets, stats: await support.stats() });
  })
);

router.get(
  '/inbox/:id',
  asyncHandler(async (req, res) => {
    const ticket = await support.getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });
    await support.markRead(ticket, 'admin');
    const messages = await support.messages(ticket.id);
    res.json({
      ticket: support.publicTicket(ticket, {
        plan: ticket.plan,
        planStatus: ticket.plan_status,
        company: ticket.company,
      }),
      messages,
    });
  })
);

router.post(
  '/inbox/:id/reply',
  asyncHandler(async (req, res) => {
    const ticket = await support.getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });
    try {
      await support.replyAsAdmin(ticket, req.admin, req.body?.body);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    await adminAudit(req, 'REPLY', 'ticket', ticket.id, null, { preview: String(req.body?.body || '').slice(0, 80) });
    const next = await support.getTicket(ticket.id);
    res.json({ ok: true, ticket: support.publicTicket(next), messages: await support.messages(ticket.id) });
  })
);

router.post(
  '/inbox/:id/status',
  asyncHandler(async (req, res) => {
    const ticket = await support.getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });
    try {
      await support.setStatus(ticket.id, req.body?.status, ticket.kind);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    await adminAudit(req, 'TICKET_STATUS', 'ticket', ticket.id, { status: ticket.status }, { status: req.body?.status });
    const next = await support.getTicket(ticket.id);
    res.json({ ok: true, ticket: support.publicTicket(next) });
  })
);

router.get(
  '/coupons',
  asyncHandler(async (req, res) => {
    const rows = await db.all(`SELECT * FROM coupons ORDER BY created_at DESC`);
    res.json({
      coupons: rows.map((c) => ({
        id: c.id,
        code: c.code,
        kind: c.kind,
        value: c.value,
        maxRedemptions: c.max_redemptions,
        redeemed: c.redeemed,
        expiresAt: c.expires_at,
        active: !!c.active,
        createdAt: c.created_at,
      })),
    });
  })
);

router.post(
  '/coupons',
  asyncHandler(async (req, res) => {
    const code = String(req.body?.code || '')
      .trim()
      .toUpperCase();
    if (!code) return res.status(400).json({ error: 'Código obrigatório' });
    const id = uuid();
    await db.run(
      `INSERT INTO coupons (id, code, kind, value, max_redemptions, expires_at, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        code,
        req.body?.kind === 'fixed' ? 'fixed' : 'percent',
        Number(req.body?.value) || 0,
        req.body?.maxRedemptions ? Number(req.body.maxRedemptions) : null,
        req.body?.expiresAt || null,
        new Date().toISOString(),
      ]
    );
    await adminAudit(req, 'CREATE', 'coupon', id, null, { code });
    res.status(201).json({ ok: true, id, code });
  })
);

router.get(
  '/leads',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT l.*, u.email as owner_email, u.name as owner_name
       FROM leads l
       LEFT JOIN users u ON u.id=l.user_id
       ORDER BY l.updated_at DESC LIMIT 80`
    );
    res.json({
      leads: rows.map((l) => ({
        id: l.id,
        title: l.title,
        clientName: l.client_name,
        value: l.value,
        stage: l.stage,
        ownerEmail: l.owner_email,
        ownerName: l.owner_name,
        updatedAt: l.updated_at,
      })),
    });
  })
);

router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT a.*, ad.email as admin_email
       FROM admin_audit_logs a
       LEFT JOIN admin_users ad ON ad.id=a.admin_id
       ORDER BY a.created_at DESC LIMIT 120`
    );
    res.json({
      events: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        adminEmail: r.admin_email,
        ip: r.ip,
        createdAt: r.created_at,
      })),
    });
  })
);

router.get(
  '/ops',
  asyncHandler(async (req, res) => {
    await db.get('SELECT 1 as ok');
    res.json({
      api: 'ok',
      db: db.usePostgres ? 'postgres' : 'sqlite',
      asaas: !!process.env.ASAAS_API_KEY,
      asaasUrl: process.env.ASAAS_API_URL || 'https://api-sandbox.asaas.com',
      resend: !!process.env.RESEND_API_KEY,
      appUrl: process.env.APP_URL || '',
      env: process.env.NODE_ENV || 'development',
      time: new Date().toISOString(),
    });
  })
);

module.exports = router;
