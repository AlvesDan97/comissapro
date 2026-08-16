const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { workspaceId, requireManage, sellerScope } = require('../services/scope');
const {
  listCatalog,
  computeMetric,
  compareSeries,
  shiftPeriod,
  samePeriodLastYear,
} = require('../services/metricsCatalog');

const router = express.Router();
router.use(authRequired);

router.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    res.json({ catalog: listCatalog() });
  })
);

router.get(
  '/saved',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      'SELECT * FROM saved_metrics WHERE workspace_id=? ORDER BY created_at DESC',
      [workspaceId(req)]
    );
    res.json({
      saved: rows.map((r) => ({
        id: r.id,
        name: r.name,
        catalogKey: r.catalog_key,
        filters: JSON.parse(r.filters_json || '{}'),
        pinDashboard: !!r.pin_dashboard,
        pinCompare: !!r.pin_compare,
      })),
    });
  })
);

router.post(
  '/saved',
  requireManage,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.catalogKey) return res.status(400).json({ error: 'Nome e métrica do catálogo são obrigatórios' });
    const allowed = listCatalog().some((c) => c.key === b.catalogKey);
    if (!allowed) return res.status(400).json({ error: 'Métrica fora do catálogo' });
    const id = uuid();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO saved_metrics (id, workspace_id, name, catalog_key, filters_json, pin_dashboard, pin_compare, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workspaceId(req),
        String(b.name).slice(0, 80),
        b.catalogKey,
        JSON.stringify(b.filters || {}),
        b.pinDashboard ? 1 : 0,
        b.pinCompare === false ? 0 : 1,
        now,
        now,
      ]
    );
    res.status(201).json({ id, name: b.name, catalogKey: b.catalogKey });
  })
);

router.delete(
  '/saved/:id',
  requireManage,
  asyncHandler(async (req, res) => {
    await db.run('DELETE FROM saved_metrics WHERE id=? AND workspace_id=?', [
      req.params.id,
      workspaceId(req),
    ]);
    res.json({ ok: true });
  })
);

router.get(
  '/value',
  asyncHandler(async (req, res) => {
    const key = req.query.key || 'commission_launched';
    const sellerId = sellerScope(req);
    const result = await computeMetric(workspaceId(req), key, {
      from: req.query.from,
      to: req.query.to,
      sellerId,
      commissionTypeId: req.query.commissionTypeId,
    });
    res.json({ key, ...result });
  })
);

router.get(
  '/compare',
  asyncHandler(async (req, res) => {
    const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const groupBy = ['day', 'month', 'year'].includes(req.query.groupBy) ? req.query.groupBy : 'month';
    const metric = req.query.metric || 'commission_launched';
    const sellerId = req.user.canSeeTeam ? req.query.sellerId || null : req.user.id;
    const commissionTypeId = req.query.commissionTypeId || null;
    const ws = workspaceId(req);

    const series = await compareSeries(ws, { from, to, groupBy, sellerId, commissionTypeId, metric });
    const prev = shiftPeriod(from, to, groupBy);
    const prevSeries = await compareSeries(ws, { ...prev, groupBy, sellerId, commissionTypeId, metric });
    const yoy = samePeriodLastYear(from, to);
    const yoySeries = await compareSeries(ws, { ...yoy, groupBy, sellerId, commissionTypeId, metric });

    const sum = (arr) => arr.reduce((s, r) => s + (Number(r.value) || 0), 0);
    const currentTotal = sum(series);
    const prevTotal = sum(prevSeries);
    const yoyTotal = sum(yoySeries);

    let sellers = [];
    if (req.user.canSeeTeam && !sellerId) {
      sellers = await db.all(
        `SELECT COALESCE(s.seller_id, s.user_id) as sellerId,
                COALESCE(u.name, '—') as name,
                COALESCE(SUM(s.commission_total),0) as commission,
                COUNT(*) as launches
         FROM sales s
         LEFT JOIN users u ON u.id=COALESCE(s.seller_id, s.user_id)
         WHERE s.user_id=? AND s.status!='cancelada' AND s.sale_date>=? AND s.sale_date<=?
         ${commissionTypeId ? 'AND s.commission_type_id=?' : ''}
         GROUP BY sellerId ORDER BY commission DESC`,
        commissionTypeId ? [ws, from, to, commissionTypeId] : [ws, from, to]
      );
    }

    const mix = await computeMetric(ws, 'mix_by_type', { from, to, sellerId, commissionTypeId });

    res.json({
      from,
      to,
      groupBy,
      metric,
      series,
      totals: {
        current: currentTotal,
        previous: prevTotal,
        previousDelta: prevTotal ? ((currentTotal - prevTotal) / prevTotal) * 100 : null,
        yearAgo: yoyTotal,
        yearAgoDelta: yoyTotal ? ((currentTotal - yoyTotal) / yoyTotal) * 100 : null,
      },
      sellers,
      mix: mix.mix || [],
    });
  })
);

module.exports = router;
