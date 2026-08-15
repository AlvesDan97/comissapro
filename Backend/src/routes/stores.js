const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');
const { DEFAULT_RULES } = require('../services/commissionEngine');
const { planLimits } = require('../services/plans');

const router = express.Router();
router.use(authRequired);

function mapStore(row) {
  return {
    id: row.id,
    name: row.name,
    cnpj: row.cnpj,
    color: row.color,
    logoInitials: row.logo_initials,
    paymentDays: row.payment_days,
    ruleType: row.rule_type,
    rule: JSON.parse(row.rule_json),
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function initials(name) {
  return (name || 'XX')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      'SELECT * FROM stores WHERE user_id = ? AND active = 1 ORDER BY name',
      [req.user.id]
    );
    const stores = [];
    for (const s of rows) {
      const mapped = mapStore(s);
      const month = new Date().toISOString().slice(0, 7);
      const stats = await db.get(
        `SELECT COUNT(*) as salesCount,
                COALESCE(SUM(gross_value),0) as revenue,
                COALESCE(SUM(commission_total),0) as commission
         FROM sales WHERE user_id=? AND store_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'`,
        [req.user.id, s.id, month]
      );
      const pending = (
        await db.get(
          `SELECT COUNT(*) as c FROM receivables WHERE user_id=? AND sale_id IN
           (SELECT id FROM sales WHERE store_id=?) AND status IN ('previsto','parcial','atrasado')`,
          [req.user.id, s.id]
        )
      ).c;
      stores.push({
        ...mapped,
        monthlyRevenue: stats.revenue,
        monthlyCommission: stats.commission,
        salesCount: stats.salesCount,
        payoutStatus: pending > 0 ? 'pendente' : 'quitado',
      });
    }
    res.json({ stores });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, cnpj, color, paymentDays, ruleType, rule } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome da loja é obrigatório' });

    const user = await db.get('SELECT plan FROM users WHERE id=?', [req.user.id]);
    const limits = planLimits(user?.plan || 'solo');
    const count = (await db.get('SELECT COUNT(*) as c FROM stores WHERE user_id=? AND active=1', [req.user.id])).c;
    if (count >= limits.maxStores) {
      return res.status(403).json({
        error: `Seu plano permite até ${limits.maxStores} lojas. Faça upgrade para continuar.`,
        upgradeRequired: true,
      });
    }

    const type = ruleType || 'bands';
    const ruleObj = rule || DEFAULT_RULES[type] || DEFAULT_RULES.bands;
    const now = new Date().toISOString();
    const id = uuid();
    const versionId = uuid();

    await db.run(
      `INSERT INTO stores (id, user_id, name, cnpj, color, logo_initials, payment_days, rule_type, rule_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user.id,
        name,
        cnpj || null,
        color || '#3FDA9A',
        initials(name),
        paymentDays ?? 30,
        type,
        JSON.stringify(ruleObj),
        now,
        now,
      ]
    );

    await db.run(
      `INSERT INTO commission_rule_versions (id, store_id, user_id, rule_type, rule_json, effective_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [versionId, id, req.user.id, type, JSON.stringify(ruleObj), now.slice(0, 10), now]
    );

    const store = mapStore(await db.get('SELECT * FROM stores WHERE id = ?', [id]));
    await audit(req.user.id, 'CREATE', 'store', id, null, store);
    res.status(201).json({ store });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM stores WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    if (!row) return res.status(404).json({ error: 'Loja não encontrada' });
    const versions = (
      await db.all(
        `SELECT id, rule_type as ruleType, rule_json, effective_from as effectiveFrom, created_at as createdAt
         FROM commission_rule_versions WHERE store_id=? ORDER BY effective_from DESC`,
        [row.id]
      )
    ).map((v) => ({ ...v, rule: JSON.parse(v.rule_json), rule_json: undefined }));
    res.json({ store: mapStore(row), versions });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get('SELECT * FROM stores WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    if (!row) return res.status(404).json({ error: 'Loja não encontrada' });

    const before = mapStore(row);
    const { name, cnpj, color, paymentDays, ruleType, rule, active } = req.body || {};
    const nextType = ruleType || row.rule_type;
    const nextRule = rule || JSON.parse(row.rule_json);
    const ruleChanged =
      (ruleType && ruleType !== row.rule_type) ||
      (rule && JSON.stringify(rule) !== row.rule_json);

    const now = new Date().toISOString();
    await db.run(
      `UPDATE stores SET name=?, cnpj=?, color=?, logo_initials=?, payment_days=?, rule_type=?, rule_json=?, active=?, updated_at=?
       WHERE id=? AND user_id=?`,
      [
        name ?? row.name,
        cnpj !== undefined ? cnpj : row.cnpj,
        color ?? row.color,
        initials(name ?? row.name),
        paymentDays ?? row.payment_days,
        nextType,
        JSON.stringify(nextRule),
        active !== undefined ? (active ? 1 : 0) : row.active,
        now,
        row.id,
        req.user.id,
      ]
    );

    if (ruleChanged) {
      await db.run(
        `INSERT INTO commission_rule_versions (id, store_id, user_id, rule_type, rule_json, effective_from, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), row.id, req.user.id, nextType, JSON.stringify(nextRule), now.slice(0, 10), now]
      );
    }

    const store = mapStore(await db.get('SELECT * FROM stores WHERE id = ?', [row.id]));
    await audit(req.user.id, ruleChanged ? 'UPDATE_RULE' : 'UPDATE', 'store', row.id, before, store);
    res.json({ store });
  })
);

module.exports = router;
