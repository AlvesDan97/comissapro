const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { nextBandProgress } = require('../services/commissionEngine');

const router = express.Router();
router.use(authRequired);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { storeId } = req.query;
    const month = new Date().toISOString().slice(0, 7);
    const storeFilter = storeId ? ' AND store_id = ?' : '';
    const saleParams = storeId ? [req.user.id, month, storeId] : [req.user.id, month];

    const monthSales = await db.all(
      `SELECT * FROM sales WHERE user_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'${storeFilter}`,
      saleParams
    );

    const commissionMonth = monthSales.reduce((s, x) => s + x.commission_total, 0);
    const revenueMonth = monthSales.reduce((s, x) => s + x.gross_value, 0);
    const received = (
      await db.get(
        `SELECT COALESCE(SUM(amount),0) as v FROM receivables
       WHERE user_id=? AND status='quitado' AND substr(COALESCE(paid_date, due_date),1,7)=?`,
        [req.user.id, month]
      )
    ).v;

    let pipelineSql = `SELECT COALESCE(SUM(amount),0) as v FROM receivables WHERE user_id=? AND status IN ('previsto','parcial','atrasado')`;
    const pipeParams = [req.user.id];
    if (storeId) {
      pipelineSql += ` AND sale_id IN (SELECT id FROM sales WHERE store_id=?)`;
      pipeParams.push(storeId);
    }
    const pipeline = (await db.get(pipelineSql, pipeParams)).v;

    // série 6 meses
    const series = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const params = storeId ? [req.user.id, key, storeId] : [req.user.id, key];
      const row = await db.get(
        `SELECT COALESCE(SUM(commission_total),0) as commission,
                COALESCE(SUM(gross_value),0) as revenue
         FROM sales WHERE user_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'${storeFilter}`,
        params
      );
      series.push({
        month: key,
        label: d.toLocaleDateString('pt-BR', { month: 'short' }),
        commission: row.commission,
        revenue: row.revenue,
      });
    }

    // meta / escada da primeira loja filtrada
    let ladder = null;
    const store = storeId
      ? await db.get('SELECT * FROM stores WHERE id=? AND user_id=?', [storeId, req.user.id])
      : await db.get('SELECT * FROM stores WHERE user_id=? AND active=1 ORDER BY name LIMIT ?', [
          req.user.id,
          1,
        ]);

    if (store && store.rule_type === 'bands') {
      const rule = JSON.parse(store.rule_json);
      const vol =
        rule.volumeBasis === 'revenue'
          ? monthSales.filter((s) => s.store_id === store.id).reduce((a, b) => a + b.gross_value, 0)
          : monthSales.filter((s) => s.store_id === store.id).length;
      ladder = {
        storeId: store.id,
        storeName: store.name,
        units: vol,
        progress: nextBandProgress(rule, vol),
        bands: rule.bands,
      };
    }

    const recent = await db.all(
      `SELECT s.*, st.name as store_name FROM sales s
       JOIN stores st ON st.id=s.store_id
       WHERE s.user_id=? ${storeId ? 'AND s.store_id=?' : ''}
       ORDER BY s.sale_date DESC LIMIT ?`,
      storeId ? [req.user.id, storeId, 6] : [req.user.id, 6]
    );

    const byStore = await db.all(
      `SELECT st.id, st.name, st.color,
              COALESCE(SUM(s.commission_total),0) as commission,
              COUNT(s.id) as salesCount
       FROM stores st
       LEFT JOIN sales s ON s.store_id=st.id AND s.user_id=st.user_id
         AND substr(s.sale_date,1,7)=? AND s.status!='cancelada'
       WHERE st.user_id=? AND st.active=1
       GROUP BY st.id ORDER BY commission DESC`,
      [month, req.user.id]
    );

    res.json({
      kpis: {
        commissionMonth,
        commissionReceived: received,
        pipeline,
        revenueMonth,
        salesCount: monthSales.length,
      },
      series,
      ladder,
      byStore,
      recent: recent.map((r) => ({
        id: r.id,
        title: r.title,
        storeName: r.store_name,
        status: r.status,
        saleDate: r.sale_date,
        commissionTotal: r.commission_total,
        grossValue: r.gross_value,
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
      [req.user.id]
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

router.patch(
  '/receivables/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM receivables WHERE id=? AND user_id=?', [
      req.params.id,
      req.user.id,
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
