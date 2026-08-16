const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');

const { workspaceId, requirePipeline } = require('../services/scope');

const router = express.Router();
router.use(authRequired);
router.use(requirePipeline);

function mapLead(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    title: row.title,
    clientName: row.client_name,
    value: row.value,
    probability: row.probability,
    stage: row.stage,
    nicheFields: JSON.parse(row.niche_fields || '{}'),
    expectedClose: row.expected_close,
    notes: row.notes,
    expectedCommission: (row.value || 0) * ((row.probability || 0) / 100) * 0.004,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.all('SELECT * FROM leads WHERE user_id=? ORDER BY updated_at DESC', [
      workspaceId(req),
    ]);
    res.json({ leads: rows.map(mapLead) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'Título obrigatório' });
    const now = new Date().toISOString();
    const id = uuid();
    await db.run(
      `INSERT INTO leads (id, user_id, store_id, title, client_name, value, probability, stage, niche_fields, expected_close, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        workspaceId(req),
        b.storeId || null,
        b.title,
        b.clientName || null,
        Number(b.value) || 0,
        Number(b.probability) ?? 50,
        b.stage || 'lead',
        JSON.stringify(b.nicheFields || {}),
        b.expectedClose || null,
        b.notes || null,
        now,
        now,
      ]
    );
    const lead = mapLead(await db.get('SELECT * FROM leads WHERE id=?', [id]));
    await audit(req.user.id, 'CREATE', 'lead', id, null, lead);
    res.status(201).json({ lead });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM leads WHERE id=? AND user_id=?', [
      req.params.id,
      workspaceId(req),
    ]);
    if (!row) return res.status(404).json({ error: 'Lead não encontrado' });
    const before = mapLead(row);
    const b = req.body || {};
    await db.run(
      `UPDATE leads SET store_id=?, title=?, client_name=?, value=?, probability=?, stage=?, niche_fields=?, expected_close=?, notes=?, updated_at=?
       WHERE id=?`,
      [
        b.storeId !== undefined ? b.storeId : row.store_id,
        b.title ?? row.title,
        b.clientName !== undefined ? b.clientName : row.client_name,
        b.value !== undefined ? Number(b.value) : row.value,
        b.probability !== undefined ? Number(b.probability) : row.probability,
        b.stage ?? row.stage,
        b.nicheFields ? JSON.stringify(b.nicheFields) : row.niche_fields,
        b.expectedClose !== undefined ? b.expectedClose : row.expected_close,
        b.notes !== undefined ? b.notes : row.notes,
        new Date().toISOString(),
        row.id,
      ]
    );
    const lead = mapLead(await db.get('SELECT * FROM leads WHERE id=?', [row.id]));
    await audit(req.user.id, 'UPDATE', 'lead', row.id, before, lead);
    res.json({ lead });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM leads WHERE id=? AND user_id=?', [
      req.params.id,
      workspaceId(req),
    ]);
    if (!row) return res.status(404).json({ error: 'Lead não encontrado' });
    await db.run('DELETE FROM leads WHERE id=?', [row.id]);
    await audit(req.user.id, 'DELETE', 'lead', row.id, mapLead(row), null);
    res.json({ ok: true });
  })
);

module.exports = router;
