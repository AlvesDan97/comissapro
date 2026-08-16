const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { mapRow } = require('../services/commissionTypes');
const { healUserMonth } = require('../services/monthLadder');
const { workspaceId } = require('../services/scope');
const { computeMetric } = require('../services/metricsCatalog');

const router = express.Router();
router.use(authRequired);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const month = new Date().toISOString().slice(0, 7);
    const ws = workspaceId(req);
    await healUserMonth(ws, `${month}-01`);
    const scope = req.query.scope === 'workspace' && req.user.canSeeTeam ? 'workspace' : 'me';
    const sellerId = scope === 'me' ? req.user.id : req.query.sellerId || null;
    const sellerSql = sellerId ? ' AND COALESCE(seller_id, user_id)=?' : '';
    const sellerSqlA = sellerId ? ' AND COALESCE(s.seller_id, s.user_id)=?' : '';
    const saleParams = sellerId ? [ws, month, sellerId] : [ws, month];

    const monthSales = await db.all(
      `SELECT * FROM sales WHERE user_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'${sellerSql}`,
      saleParams
    );

    const commissionMonth = monthSales.reduce((s, x) => s + x.commission_total, 0);
    const revenueMonth = monthSales.reduce((s, x) => s + x.gross_value, 0);
    const recJoin = sellerId
      ? ` AND sale_id IN (SELECT id FROM sales WHERE user_id=? AND COALESCE(seller_id, user_id)=?)`
      : '';
    const recParams = sellerId ? [ws, month, ws, sellerId] : [ws, month];
    const received = (
      await db.get(
        `SELECT COALESCE(SUM(amount),0) as v FROM receivables
       WHERE user_id=? AND status='quitado' AND substr(COALESCE(paid_date, due_date),1,7)=?${recJoin}`,
        recParams
      )
    ).v;

    const pipeParams = sellerId ? [ws, ws, sellerId] : [ws];
    const pipeline = (
      await db.get(
        `SELECT COALESCE(SUM(amount),0) as v FROM receivables WHERE user_id=? AND status IN ('previsto','parcial','atrasado')${recJoin.replace(' AND substr(COALESCE(paid_date, due_date),1,7)=?', '')}`,
        pipeParams
      )
    ).v;

    const series = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const params = sellerId ? [ws, key, sellerId] : [ws, key];
      const row = await db.get(
        `SELECT COALESCE(SUM(commission_total),0) as commission,
                COALESCE(SUM(gross_value),0) as revenue
         FROM sales WHERE user_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'${sellerSql}`,
        params
      );
      series.push({
        month: key,
        label: d.toLocaleDateString('pt-BR', { month: 'short' }),
        commission: row.commission,
        revenue: row.revenue,
      });
    }

    const recent = await db.all(
      `SELECT s.*, st.name as store_name, ct.name as commission_name, u.name as seller_name FROM sales s
       LEFT JOIN stores st ON st.id=s.store_id
       LEFT JOIN commission_types ct ON ct.id=s.commission_type_id
       LEFT JOIN users u ON u.id=COALESCE(s.seller_id, s.user_id)
       WHERE s.user_id=? ${sellerSqlA}
       ORDER BY s.created_at DESC LIMIT ?`,
      sellerId ? [ws, sellerId, 8] : [ws, 8]
    );

    const saleJoinExtra = sellerId ? ' AND COALESCE(s.seller_id, s.user_id)=?' : '';
    const byCommissionParams = sellerId
      ? [month, sellerId, month, sellerId, month, sellerId, new Date().toISOString().slice(0, 10), sellerId, ws]
      : [month, month, month, new Date().toISOString().slice(0, 10), ws];
    const byCommissionRows = await db.all(
      `SELECT ct.id, ct.name, ct.calc_type, ct.config_json, ct.receive_when, ct.sort_order,
              COALESCE(SUM(CASE WHEN substr(s.sale_date,1,7)=? AND s.status!='cancelada'${saleJoinExtra} THEN s.commission_total ELSE 0 END),0) as month_commission,
              COALESCE(SUM(CASE WHEN substr(s.sale_date,1,7)=? AND s.status!='cancelada'${saleJoinExtra} THEN 1 ELSE 0 END),0) as month_count,
              COALESCE(SUM(CASE WHEN substr(s.sale_date,1,7)=? AND s.status!='cancelada'${saleJoinExtra} THEN s.gross_value ELSE 0 END),0) as month_revenue,
              COALESCE(SUM(CASE WHEN s.sale_date=? AND s.status!='cancelada'${saleJoinExtra} THEN s.commission_total ELSE 0 END),0) as today_commission
       FROM commission_types ct
       LEFT JOIN sales s ON s.commission_type_id=ct.id AND s.user_id=ct.user_id
       WHERE ct.user_id=? AND ct.active=1
       GROUP BY ct.id
       ORDER BY ct.sort_order ASC, ct.created_at ASC`,
      byCommissionParams
    );

    const today = new Date().toISOString().slice(0, 10);
    await db.run(
      `UPDATE receivables SET status='atrasado', updated_at=?
       WHERE user_id=? AND status='previsto' AND due_date < ?`,
      [new Date().toISOString(), ws, today]
    );
    const dueRows = await db.all(
      `SELECT r.*, s.title as sale_title, ct.name as commission_name
       FROM receivables r
       JOIN sales s ON s.id=r.sale_id
       LEFT JOIN commission_types ct ON ct.id=s.commission_type_id
       WHERE r.user_id=? AND r.status IN ('previsto','parcial','atrasado') AND r.due_date <= ?
       ${sellerId ? 'AND COALESCE(s.seller_id, s.user_id)=?' : ''}
       ORDER BY r.due_date ASC`,
      sellerId ? [ws, today, sellerId] : [ws, today]
    );
    const dueToConfirm = dueRows.map((r) => ({
      id: r.id,
      saleId: r.sale_id,
      saleTitle: r.sale_title,
      commissionName: r.commission_name,
      label: r.label,
      amount: r.amount,
      dueDate: r.due_date,
      status: r.status,
    }));
    const dueTotal = dueToConfirm.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    let ranking = [];
    let alerts = [];
    if (scope === 'workspace' && req.user.canSeeTeam) {
      ranking = await db.all(
        `SELECT COALESCE(s.seller_id, s.user_id) as sellerId,
                COALESCE(u.name, '—') as name,
                COALESCE(SUM(s.commission_total),0) as commission,
                COUNT(*) as launches
         FROM sales s
         LEFT JOIN users u ON u.id=COALESCE(s.seller_id, s.user_id)
         WHERE s.user_id=? AND substr(s.sale_date,1,7)=? AND s.status!='cancelada'
         GROUP BY sellerId ORDER BY commission DESC`,
        [ws, month]
      );
      const team = await db.all(
        `SELECT COALESCE(member_user_id, email) as sid, name, email, member_user_id
         FROM team_members WHERE owner_user_id=? AND status='accepted'`,
        [ws]
      );
      const launched = new Set(ranking.map((r) => r.sellerId));
      launched.add(ws);
      alerts = team
        .filter((m) => m.member_user_id && !launched.has(m.member_user_id))
        .map((m) => ({ type: 'no_launch', name: m.name || m.email, sellerId: m.member_user_id }));
    }

    const mix = await computeMetric(ws, 'mix_by_type', {
      from: `${month}-01`,
      to: today,
      sellerId,
    });

    const first = new Date();
    const monthStart = `${month}-01`;
    const monthEnd = new Date(first.getFullYear(), first.getMonth() + 1, 0).toISOString().slice(0, 10);
    let goalRow = null;
    if (sellerId) {
      goalRow = await db.get(
        `SELECT * FROM goals WHERE workspace_id=? AND period_start=? AND period_end=? AND seller_id=? LIMIT 1`,
        [ws, monthStart, monthEnd, sellerId]
      );
    }
    if (!goalRow) {
      goalRow = await db.get(
        `SELECT * FROM goals WHERE workspace_id=? AND period_start=? AND period_end=? AND seller_id IS NULL LIMIT 1`,
        [ws, monthStart, monthEnd]
      );
    }
    let goal = null;
    if (goalRow) {
      const current =
        goalRow.metric === 'quantity' ? monthSales.length : commissionMonth;
      const target = Number(goalRow.target) || 0;
      goal = {
        id: goalRow.id,
        name: goalRow.name,
        metric: goalRow.metric,
        target,
        current,
        percent: target ? Math.min(999, (current / target) * 100) : 0,
        remaining: Math.max(0, target - current),
      };
    }

    res.json({
      scope,
      canSeeTeam: !!req.user.canSeeTeam,
      canLaunch: !!req.user.canLaunch,
      kpis: {
        commissionMonth,
        commissionReceived: received,
        pipeline,
        revenueMonth,
        salesCount: monthSales.length,
      },
      goal,
      ranking,
      alerts,
      mix: mix.mix || [],
      series,
      dueToConfirm,
      dueTotal,
      recent: recent.map((r) => ({
        id: r.id,
        title: r.title,
        storeName: r.store_name,
        commissionName: r.commission_name,
        sellerName: r.seller_name,
        status: r.status,
        saleDate: r.sale_date,
        commissionTotal: r.commission_total,
        grossValue: r.gross_value,
      })),
      byCommission: byCommissionRows.map((r) => ({
        ...mapRow(r),
        monthCommission: r.month_commission,
        monthCount: r.month_count,
        monthRevenue: r.month_revenue,
        todayCommission: r.today_commission,
      })),
    });
  })
);

router.get(
  '/receivables',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT r.*, s.title as sale_title, st.name as store_name
       FROM receivables r
       JOIN sales s ON s.id=r.sale_id
       JOIN stores st ON st.id=s.store_id
       WHERE r.user_id=?
       ORDER BY r.due_date ASC`,
      [workspaceId(req)]
    );
    res.json({
      receivables: rows.map((r) => ({
        id: r.id,
        saleId: r.sale_id,
        saleTitle: r.sale_title,
        storeName: r.store_name,
        label: r.label,
        amount: r.amount,
        kind: r.kind,
        dueDate: r.due_date,
        paidDate: r.paid_date,
        status: r.status,
      })),
    });
  })
);

router.post(
  '/receivables/confirm-due',
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : null;
    let rows;
    if (ids && ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      rows = await db.all(
        `SELECT * FROM receivables WHERE user_id=? AND id IN (${placeholders}) AND status IN ('previsto','parcial','atrasado')`,
        [workspaceId(req), ...ids]
      );
    } else {
      rows = await db.all(
        `SELECT * FROM receivables
         WHERE user_id=? AND status IN ('previsto','parcial','atrasado') AND due_date <= ?`,
        [workspaceId(req), today]
      );
    }
    for (const row of rows) {
      await db.run(
        `UPDATE receivables SET status='quitado', paid_date=?, updated_at=? WHERE id=?`,
        [today, now, row.id]
      );
      const pending = await db.get(
        `SELECT COUNT(*) as c FROM receivables WHERE sale_id=? AND status IN ('previsto','parcial','atrasado')`,
        [row.sale_id]
      );
      if (!Number(pending?.c)) {
        await db.run(`UPDATE sales SET status='quitada', updated_at=? WHERE id=? AND user_id=? AND status!='cancelada'`, [
          now,
          row.sale_id,
          workspaceId(req),
        ]);
      }
    }
    res.json({ ok: true, confirmed: rows.length });
  })
);

router.patch(
  '/receivables/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM receivables WHERE id=? AND user_id=?', [
      req.params.id,
      workspaceId(req),
    ]);
    if (!row) return res.status(404).json({ error: 'Recebível não encontrado' });
    const { status, paidDate } = req.body || {};
    await db.run(`UPDATE receivables SET status=?, paid_date=?, updated_at=? WHERE id=?`, [
      status || row.status,
      paidDate || (status === 'quitado' ? new Date().toISOString().slice(0, 10) : row.paid_date),
      new Date().toISOString(),
      row.id,
    ]);
    res.json({ ok: true });
  })
);

module.exports = router;
