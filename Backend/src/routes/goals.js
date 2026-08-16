const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { workspaceId, requireManage } = require('../services/scope');
const { computeMetric } = require('../services/metricsCatalog');

const router = express.Router();
router.use(authRequired);

function mapGoal(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sellerId: row.seller_id,
    commissionTypeId: row.commission_type_id,
    periodType: row.period_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    metric: row.metric,
    target: Number(row.target) || 0,
    name: row.name,
    createdAt: row.created_at,
  };
}

function currentPeriod(type, from, to) {
  const now = new Date();
  if (type === 'year') {
    const y = String(now.getFullYear());
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
  if (type === 'range' && from && to) return { start: from, end: to };
  const m = now.toISOString().slice(0, 7);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { start: `${m}-01`, end: last };
}

async function progressFor(workspaceIdValue, goal) {
  const key = goal.metric === 'quantity' ? 'launch_count' : 'commission_launched';
  const result = await computeMetric(workspaceIdValue, key, {
    from: goal.period_start,
    to: goal.period_end,
    sellerId: goal.seller_id || undefined,
    commissionTypeId: goal.commission_type_id || undefined,
  });
  const current = Number(result.value) || 0;
  const target = Number(goal.target) || 0;
  return {
    current,
    target,
    percent: target > 0 ? Math.min(999, (current / target) * 100) : 0,
    remaining: Math.max(0, target - current),
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    let sql = 'SELECT * FROM goals WHERE workspace_id=?';
    const params = [ws];
    if (!req.user.canSeeTeam) {
      sql += ' AND (seller_id=? OR seller_id IS NULL)';
      params.push(req.user.id);
    }
    sql += ' ORDER BY period_start DESC';
    const rows = await db.all(sql, params);
    const goals = [];
    for (const row of rows) {
      const g = mapGoal(row);
      g.progress = await progressFor(ws, row);
      goals.push(g);
    }
    res.json({ goals });
  })
);

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    const scope = req.query.scope === 'workspace' && req.user.canSeeTeam ? 'workspace' : 'me';
    const sellerId = scope === 'workspace' ? null : req.user.id;
    const month = currentPeriod('month');
    const year = currentPeriod('year');

    async function find(periodStart, periodEnd, forSeller) {
      if (forSeller) {
        const personal = await db.get(
          `SELECT * FROM goals WHERE workspace_id=? AND period_start=? AND period_end=? AND seller_id=?
           ORDER BY created_at DESC LIMIT 1`,
          [ws, periodStart, periodEnd, forSeller]
        );
        if (personal) return personal;
      }
      return db.get(
        `SELECT * FROM goals WHERE workspace_id=? AND period_start=? AND period_end=? AND seller_id IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [ws, periodStart, periodEnd]
      );
    }

    const monthRow = await find(month.start, month.end, sellerId);
    const yearRow = await find(year.start, year.end, sellerId);
    const out = { month: null, year: null };
    if (monthRow) out.month = { ...mapGoal(monthRow), progress: await progressFor(ws, monthRow) };
    if (yearRow) out.year = { ...mapGoal(yearRow), progress: await progressFor(ws, yearRow) };
    res.json(out);
  })
);

router.post(
  '/',
  requireManage,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const periodType = ['month', 'year', 'range'].includes(b.periodType) ? b.periodType : 'month';
    const range = currentPeriod(periodType, b.periodStart, b.periodEnd);
    const id = uuid();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO goals (id, workspace_id, seller_id, commission_type_id, period_type, period_start, period_end, metric, target, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workspaceId(req),
        b.sellerId || null,
        b.commissionTypeId || null,
        periodType,
        b.periodStart || range.start,
        b.periodEnd || range.end,
        b.metric === 'quantity' ? 'quantity' : 'commission',
        Number(b.target) || 0,
        b.name || null,
        now,
        now,
      ]
    );
    const row = await db.get('SELECT * FROM goals WHERE id=?', [id]);
    res.status(201).json({ goal: { ...mapGoal(row), progress: await progressFor(workspaceId(req), row) } });
  })
);

router.patch(
  '/:id',
  requireManage,
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM goals WHERE id=? AND workspace_id=?', [
      req.params.id,
      workspaceId(req),
    ]);
    if (!row) return res.status(404).json({ error: 'Meta não encontrada' });
    const b = req.body || {};
    await db.run(
      `UPDATE goals SET seller_id=?, commission_type_id=?, period_type=?, period_start=?, period_end=?, metric=?, target=?, name=?, updated_at=?
       WHERE id=?`,
      [
        b.sellerId !== undefined ? b.sellerId : row.seller_id,
        b.commissionTypeId !== undefined ? b.commissionTypeId : row.commission_type_id,
        b.periodType || row.period_type,
        b.periodStart || row.period_start,
        b.periodEnd || row.period_end,
        b.metric || row.metric,
        b.target !== undefined ? Number(b.target) : row.target,
        b.name !== undefined ? b.name : row.name,
        new Date().toISOString(),
        row.id,
      ]
    );
    const updated = await db.get('SELECT * FROM goals WHERE id=?', [row.id]);
    res.json({ goal: { ...mapGoal(updated), progress: await progressFor(workspaceId(req), updated) } });
  })
);

router.delete(
  '/:id',
  requireManage,
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM goals WHERE id=? AND workspace_id=?', [
      req.params.id,
      workspaceId(req),
    ]);
    if (!row) return res.status(404).json({ error: 'Meta não encontrada' });
    await db.run('DELETE FROM goals WHERE id=?', [row.id]);
    res.json({ ok: true });
  })
);

module.exports = router;
