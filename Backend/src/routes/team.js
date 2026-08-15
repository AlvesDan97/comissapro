const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit, listAudit } = require('../services/audit');

const router = express.Router();
router.use(authRequired);

router.get(
  '/members',
  asyncHandler(async (req, res) => {
    const members = (
      await db.all('SELECT * FROM team_members WHERE owner_user_id=? ORDER BY created_at DESC', [
        req.user.id,
      ])
    ).map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      role: m.role,
      status: m.status,
      createdAt: m.created_at,
    }));
    res.json({ members });
  })
);

router.post(
  '/members',
  asyncHandler(async (req, res) => {
    const { email, name, role } = req.body || {};
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });
    const id = uuid();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO team_members (id, owner_user_id, email, name, role, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, req.user.id, email.toLowerCase(), name || null, role || 'viewer', now]
    );
    const member = {
      id,
      email: email.toLowerCase(),
      name: name || null,
      role: role || 'viewer',
      status: 'pending',
      createdAt: now,
    };
    await audit(req.user.id, 'INVITE', 'team_member', id, null, member);
    res.status(201).json({ member });
  })
);

router.patch(
  '/members/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM team_members WHERE id=? AND owner_user_id=?', [
      req.params.id,
      req.user.id,
    ]);
    if (!row) return res.status(404).json({ error: 'Membro não encontrado' });
    const { role, status } = req.body || {};
    await db.run('UPDATE team_members SET role=?, status=? WHERE id=?', [
      role || row.role,
      status || row.status,
      row.id,
    ]);
    res.json({ ok: true });
  })
);

router.delete(
  '/members/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM team_members WHERE id=? AND owner_user_id=?', [
      req.params.id,
      req.user.id,
    ]);
    if (!row) return res.status(404).json({ error: 'Membro não encontrado' });
    await db.run('DELETE FROM team_members WHERE id=?', [row.id]);
    await audit(req.user.id, 'DELETE', 'team_member', row.id, row, null);
    res.json({ ok: true });
  })
);

router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    res.json({ logs: await listAudit(req.user.id, Number(req.query.limit) || 100) });
  })
);

router.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const sales = await db.all(
      `SELECT s.sale_date, s.title, s.client_name, s.status, s.gross_value,
              s.commission_official, s.commission_extra, s.commission_total,
              s.snapshot_json, st.name as store_name
       FROM sales s JOIN stores st ON st.id=s.store_id
       WHERE s.user_id=? ORDER BY s.sale_date`,
      [req.user.id]
    );

    const header = [
      'data',
      'loja',
      'titulo',
      'cliente',
      'status',
      'valor',
      'comissao_oficial',
      'comissao_por_fora',
      'comissao_total',
      'faixa_snapshot',
    ];
    const lines = [header.join(';')];
    for (const s of sales) {
      const snap = JSON.parse(s.snapshot_json || '{}');
      lines.push(
        [
          s.sale_date,
          s.store_name,
          `"${(s.title || '').replace(/"/g, '""')}"`,
          `"${(s.client_name || '').replace(/"/g, '""')}"`,
          s.status,
          String(s.gross_value).replace('.', ','),
          String(s.commission_official).replace('.', ','),
          String(s.commission_extra).replace('.', ','),
          String(s.commission_total).replace('.', ','),
          `"${(snap.bandLabel || '').replace(/"/g, '""')}"`,
        ].join(';')
      );
    }
    await audit(req.user.id, 'EXPORT', 'sales', null, null, { count: sales.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="comiss-export.csv"');
    res.send('\uFEFF' + lines.join('\n'));
  })
);

module.exports = router;
