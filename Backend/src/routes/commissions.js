const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');
const { catalog, mapRow, validatePayload, usesMonthRecalc } = require('../services/commissionTypes');
const { recalcMonthSales } = require('../services/monthLadder');
const { workspaceId, requireManage, requireActiveWorkspace } = require('../services/scope');

const router = express.Router();
router.use(authRequired);
router.use(requireActiveWorkspace);

async function userCurrency(userId) {
  const row = await db.get('SELECT currency FROM users WHERE id=?', [userId]);
  return row?.currency || 'BRL';
}

router.get(
  '/catalog',
  asyncHandler(async (_req, res) => {
    res.json(catalog());
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const currency = await userCurrency(workspaceId(req));
    const rows = await db.all(
      `SELECT * FROM commission_types
       WHERE user_id=? AND active=1
       ORDER BY sort_order ASC, created_at ASC`,
      [workspaceId(req)]
    );
    res.json({ commissions: rows.map((r) => mapRow(r, currency)) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get(
      'SELECT * FROM commission_types WHERE id=? AND user_id=? AND active=1',
      [req.params.id, workspaceId(req)]
    );
    if (!row) return res.status(404).json({ error: 'Comissão não encontrada' });
    const currency = await userCurrency(workspaceId(req));
    res.json({ commission: mapRow(row, currency) });
  })
);

router.post(
  '/',
  requireManage,
  asyncHandler(async (req, res) => {
    const parsed = validatePayload(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const now = new Date().toISOString();
    const id = uuid();
    const ws = workspaceId(req);
    const maxSort = await db.get(
      'SELECT COALESCE(MAX(sort_order), -1) as n FROM commission_types WHERE user_id=?',
      [ws]
    );

    await db.run(
      `INSERT INTO commission_types (
        id, user_id, name, calc_type, config_json, generated_when,
        receive_when, receive_days, receive_date, sort_order, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        ws,
        parsed.name,
        parsed.calcType,
        JSON.stringify(parsed.config),
        parsed.generatedWhen,
        parsed.receiveWhen,
        parsed.receiveDays,
        parsed.receiveDate,
        (maxSort?.n ?? -1) + 1,
        now,
        now,
      ]
    );

    const row = await db.get('SELECT * FROM commission_types WHERE id=?', [id]);
    const currency = await userCurrency(workspaceId(req));
    const commission = mapRow(row, currency);
    await audit(req.user.id, 'CREATE', 'commission_type', id, null, commission);
    res.status(201).json({ commission });
  })
);

router.patch(
  '/:id',
  requireManage,
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    const row = await db.get(
      'SELECT * FROM commission_types WHERE id=? AND user_id=? AND active=1',
      [req.params.id, ws]
    );
    if (!row) return res.status(404).json({ error: 'Comissão não encontrada' });

    const parsed = validatePayload({
      name: req.body?.name ?? row.name,
      calcType: req.body?.calcType ?? row.calc_type,
      config: req.body?.config ?? JSON.parse(row.config_json || '{}'),
      generatedWhen: req.body?.generatedWhen ?? row.generated_when,
      receiveWhen: req.body?.receiveWhen ?? row.receive_when,
      receiveDays: req.body?.receiveDays ?? row.receive_days,
      receiveDate: req.body?.receiveDate ?? row.receive_date,
    });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const currency = await userCurrency(ws);
    const now = new Date().toISOString();

    await db.run(
      `UPDATE commission_types SET
        name=?, calc_type=?, config_json=?, generated_when=?,
        receive_when=?, receive_days=?, receive_date=?, updated_at=?
       WHERE id=? AND user_id=?`,
      [
        parsed.name,
        parsed.calcType,
        JSON.stringify(parsed.config),
        parsed.generatedWhen,
        parsed.receiveWhen,
        parsed.receiveDays,
        parsed.receiveDate,
        now,
        row.id,
        ws,
      ]
    );

    const updated = await db.get('SELECT * FROM commission_types WHERE id=?', [row.id]);
    const commission = mapRow(updated, currency);
    if (usesMonthRecalc(commission)) {
      const { healUserMonth } = require('../services/monthLadder');
      await healUserMonth(ws, new Date().toISOString().slice(0, 10));
    }
    await audit(req.user.id, 'UPDATE', 'commission_type', row.id, before, commission);
    res.json({ commission });
  })
);

router.delete(
  '/:id',
  requireManage,
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    const row = await db.get(
      'SELECT * FROM commission_types WHERE id=? AND user_id=? AND active=1',
      [req.params.id, ws]
    );
    if (!row) return res.status(404).json({ error: 'Comissão não encontrada' });
    const currency = await userCurrency(ws);
    await db.run(
      'UPDATE commission_types SET active=0, updated_at=? WHERE id=? AND user_id=?',
      [new Date().toISOString(), row.id, ws]
    );
    await audit(req.user.id, 'DELETE', 'commission_type', row.id, mapRow(row, currency), null);
    res.json({ ok: true });
  })
);

module.exports = router;
