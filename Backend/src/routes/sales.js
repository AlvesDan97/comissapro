const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { audit } = require('../services/audit');
const { calculateCommission } = require('../services/commissionEngine');
const { DEFAULT_RULES } = require('../services/commissionEngine');
const { mapRow, calculateEntry, resolveDueDate, usesMonthRecalc } = require('../services/commissionTypes');
const { recalcMonthSales } = require('../services/monthLadder');
const { workspaceId, requireLaunch, requireActiveWorkspace } = require('../services/scope');
const { safeJson } = require('../services/safeJson');

const router = express.Router();
router.use(authRequired);
router.use(requireActiveWorkspace);

function mapSale(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    leadId: row.lead_id,
    sellerId: row.seller_id || row.user_id,
    sellerName: row.seller_name || null,
    title: row.title,
    clientName: row.client_name,
    status: row.status,
    saleDate: row.sale_date,
    grossValue: row.gross_value,
    accessoriesValue: row.accessories_value,
    extrasValue: row.extras_value,
    nicheFields: safeJson(row.niche_fields),
    splitEnabled: !!row.split_enabled,
    splitPartner: row.split_partner,
    splitPercent: row.split_percent,
    ruleVersionId: row.rule_version_id,
    commissionTypeId: row.commission_type_id,
    snapshot: safeJson(row.snapshot_json),
    commissionOfficial: row.commission_official,
    commissionExtra: row.commission_extra,
    commissionTotal: row.commission_total,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureStore(userId) {
  const existing = await db.get(
    'SELECT * FROM stores WHERE user_id=? AND active=1 ORDER BY created_at ASC LIMIT ?',
    [userId, 1]
  );
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = uuid();
  await db.run(
    `INSERT INTO stores (id, user_id, name, color, logo_initials, payment_days, rule_type, rule_json, created_at, updated_at)
     VALUES (?, ?, 'Geral', '#3FDA9A', 'GE', 30, 'fixed', ?, ?, ?)`,
    [id, userId, JSON.stringify(DEFAULT_RULES.fixed), now, now]
  );
  return db.get('SELECT * FROM stores WHERE id=?', [id]);
}

async function monthStatsForType(userId, typeId, saleDate, sellerId) {
  const month = (saleDate || new Date().toISOString()).slice(0, 7);
  const row = await db.get(
    `SELECT COUNT(*) as c, COALESCE(SUM(gross_value),0) as revenue
     FROM sales WHERE user_id=? AND commission_type_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'
       AND COALESCE(seller_id, user_id)=?`,
    [userId, typeId, month, sellerId]
  );
  return { monthCount: Number(row?.c) || 0, monthRevenue: Number(row?.revenue) || 0 };
}

async function loadCommissionType(userId, typeId) {
  const row = await db.get(
    'SELECT * FROM commission_types WHERE id=? AND user_id=? AND active=1',
    [typeId, userId]
  );
  return row ? mapRow(row) : null;
}

async function getRuleForDate(storeId, userId, saleDate) {
  const version = await db.get(
    `SELECT * FROM commission_rule_versions
     WHERE store_id=? AND user_id=? AND effective_from <= ?
     ORDER BY effective_from DESC, created_at DESC LIMIT ?`,
    [storeId, userId, saleDate, 1]
  );
  if (version) {
    return {
      id: version.id,
      ruleType: version.rule_type,
      rule: safeJson(version.rule_json),
      effectiveFrom: version.effective_from,
    };
  }
  const store = await db.get('SELECT * FROM stores WHERE id=? AND user_id=?', [storeId, userId]);
  if (!store) return null;
  return {
    id: null,
    ruleType: store.rule_type,
    rule: safeJson(store.rule_json),
    effectiveFrom: saleDate,
  };
}

async function monthlyVolume(userId, storeId, saleDate, volumeBasis) {
  const month = saleDate.slice(0, 7);
  if (volumeBasis === 'revenue') {
    return (
      await db.get(
        `SELECT COALESCE(SUM(gross_value),0) as v FROM sales
         WHERE user_id=? AND store_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'`,
        [userId, storeId, month]
      )
    ).v;
  }
  return (
    await db.get(
      `SELECT COUNT(*) as v FROM sales
       WHERE user_id=? AND store_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'`,
      [userId, storeId, month]
    )
  ).v;
}

async function createReceivables(sale, store, milestones, userId) {
  await db.run('DELETE FROM receivables WHERE sale_id=?', [sale.id]);
  const now = new Date().toISOString();
  const due = new Date(sale.sale_date);
  due.setDate(due.getDate() + (store.payment_days || 30));
  const dueStr = due.toISOString().slice(0, 10);

  const insertSql = `INSERT INTO receivables (id, sale_id, user_id, label, amount, kind, due_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  if (milestones && milestones.length) {
    for (const m of milestones) {
      const amount = (sale.gross_value * (m.percent || 0)) * ((100 - (sale.split_percent || 0)) / 100);
      await db.run(insertSql, [
        uuid(),
        sale.id,
        userId,
        m.label || 'Marco',
        amount,
        m.kind || 'oficial',
        m.dueDate || dueStr,
        'previsto',
        now,
        now,
      ]);
    }
  } else {
    await db.run(insertSql, [
      uuid(),
      sale.id,
      userId,
      'Comissão oficial',
      sale.commission_official,
      'oficial',
      dueStr,
      sale.status === 'quitada' ? 'quitado' : 'previsto',
      now,
      now,
    ]);
    if (sale.commission_extra > 0) {
      await db.run(insertSql, [
        uuid(),
        sale.id,
        userId,
        'Comissão por fora',
        sale.commission_extra,
        'por_fora',
        dueStr,
        sale.status === 'quitada' ? 'quitado' : 'previsto',
        now,
        now,
      ]);
    }
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, storeId, from, to, q } = req.query;
    let sql = `SELECT s.*, st.name as store_name, ct.name as commission_name, u.name as seller_name
             FROM sales s
             LEFT JOIN stores st ON st.id = s.store_id
             LEFT JOIN commission_types ct ON ct.id = s.commission_type_id
             LEFT JOIN users u ON u.id = COALESCE(s.seller_id, s.user_id)
             WHERE s.user_id = ?`;
    const params = [workspaceId(req)];
    if (!req.user.canSeeTeam) {
      sql += ' AND COALESCE(s.seller_id, s.user_id)=?';
      params.push(req.user.id);
    } else if (req.query.sellerId) {
      sql += ' AND COALESCE(s.seller_id, s.user_id)=?';
      params.push(req.query.sellerId);
    }
    if (status && status !== 'todas') {
      sql += ' AND s.status = ?';
      params.push(status);
    }
    if (storeId) {
      sql += ' AND s.store_id = ?';
      params.push(storeId);
    }
    if (req.query.commissionTypeId) {
      sql += ' AND s.commission_type_id = ?';
      params.push(req.query.commissionTypeId);
    }
    if (from) {
      sql += ' AND s.sale_date >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND s.sale_date <= ?';
      params.push(to);
    }
    if (q) {
      sql += ' AND (s.title LIKE ? OR s.client_name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY s.sale_date DESC, s.created_at DESC';
    const rows = await db.all(sql, params);
    res.json({
      sales: rows.map((r) => ({
        ...mapSale(r),
        storeName: r.store_name,
        commissionName: r.commission_name,
      })),
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await db.get(
      `SELECT s.*, st.name as store_name, ct.name as commission_name
       FROM sales s
       LEFT JOIN stores st ON st.id = s.store_id
       LEFT JOIN commission_types ct ON ct.id = s.commission_type_id
       WHERE s.id=? AND s.user_id=?`,
      [req.params.id, workspaceId(req)]
    );
    if (!row) return res.status(404).json({ error: 'Venda não encontrada' });
    if (!req.user.canSeeTeam && (row.seller_id || row.user_id) !== req.user.id && row.seller_id && row.seller_id !== req.user.id) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }
    const receivables = (
      await db.all('SELECT * FROM receivables WHERE sale_id=? ORDER BY due_date', [row.id])
    ).map((r) => ({
      id: r.id,
      label: r.label,
      amount: r.amount,
      kind: r.kind,
      dueDate: r.due_date,
      paidDate: r.paid_date,
      status: r.status,
    }));
    res.json({
      sale: { ...mapSale(row), storeName: row.store_name, commissionName: row.commission_name },
      receivables,
    });
  })
);

router.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const type = await loadCommissionType(workspaceId(req), body.commissionTypeId);
    if (!type) return res.status(400).json({ error: 'Selecione uma comissão.' });
    const saleDate = body.saleDate || new Date().toISOString().slice(0, 10);
    const stats = await monthStatsForType(workspaceId(req), type.id, saleDate, req.user.id);
    const calc = calculateEntry(type, {
      grossValue: body.grossValue,
      quantity: body.quantity,
      costValue: body.costValue,
      commissionAmount: body.commissionAmount,
      flexAmount: body.flexAmount,
      flexPercent: body.flexPercent,
      ...stats,
    });
    res.json({
      preview: {
        amount: calc.amount,
        note: calc.note,
        bandLabel: calc.bandLabel,
        receiveLabel: type.receiveLabel,
        dueDate: resolveDueDate(type, saleDate, body.receiveDate),
        monthCount: stats.monthCount,
        monthLadder: calc.monthLadder,
      },
    });
  })
);

router.post(
  '/',
  requireLaunch,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const ws = workspaceId(req);

    if (body.commissionTypeId) {
      const type = await loadCommissionType(ws, body.commissionTypeId);
      if (!type) return res.status(400).json({ error: 'Selecione uma comissão.' });
      const saleDate = body.saleDate || new Date().toISOString().slice(0, 10);
      if (type.receiveWhen === 'per_entry' && !body.receiveDate) {
        return res.status(400).json({ error: 'Informe quando você recebe esta comissão.' });
      }
      if (type.calcType === 'prize' && (body.commissionAmount === undefined || body.commissionAmount === null || body.commissionAmount === '')) {
        return res.status(400).json({ error: 'Informe o valor da premiação.' });
      }
      const store = await ensureStore(ws);
      const stats = await monthStatsForType(ws, type.id, saleDate, req.user.id);
      const calc = calculateEntry(type, {
        grossValue: body.grossValue,
        quantity: body.quantity,
        costValue: body.costValue,
        commissionAmount: body.commissionAmount,
        flexAmount: body.flexAmount,
        flexPercent: body.flexPercent,
        ...stats,
      });
      const now = new Date().toISOString();
      const id = uuid();
      const title = String(body.clientName || type.name).trim() || type.name;
      const snapshot = {
        source: 'commission_type',
        commissionTypeId: type.id,
        commissionName: type.name,
        calcType: type.calcType,
        config: type.config,
        bandLabel: calc.bandLabel,
        engineNote: calc.note,
        calculatedAt: now,
        monthCountAtSale: stats.monthCount + 1,
        monthRecalc: type.calcType === 'flex' || type.calcType === 'prize' ? false : usesMonthRecalc(type),
        manualAmount: type.calcType === 'prize' ? calc.amount : undefined,
      };
      const nicheFields = {
        quantity: Number(body.quantity) || 1,
        cost: Number(body.costValue) || 0,
        phone: String(body.phone || '').trim().slice(0, 40),
        email: String(body.email || '').trim().slice(0, 120),
        flexAmount: Number(body.flexAmount) || 0,
        flexPercent: Number(body.flexPercent) || 0,
      };

      await db.run(
        `INSERT INTO sales (
          id, user_id, store_id, lead_id, title, client_name, status, sale_date,
          gross_value, accessories_value, extras_value, niche_fields, split_enabled,
          split_partner, split_percent, rule_version_id, commission_type_id, snapshot_json,
          commission_official, commission_extra, commission_total, notes, created_at, updated_at, seller_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, NULL, 0, NULL, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          id,
          ws,
          store.id,
          body.leadId || null,
          title,
          body.clientName || null,
          'pendente',
          saleDate,
          Number(body.grossValue) || 0,
          JSON.stringify(nicheFields),
          type.id,
          JSON.stringify(snapshot),
          calc.amount,
          calc.amount,
          body.notes || null,
          now,
          now,
          req.user.id,
        ]
      );

      const saleRow = await db.get('SELECT * FROM sales WHERE id=?', [id]);
      const dueStr = resolveDueDate(type, saleDate, body.receiveDate);
      const recNow = new Date().toISOString();
      await db.run(
        `INSERT INTO receivables (id, sale_id, user_id, label, amount, kind, due_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'oficial', ?, 'previsto', ?, ?)`,
        [uuid(), id, ws, type.name, calc.amount, dueStr, recNow, recNow]
      );

      await recalcMonthSales(ws, type, saleDate, req.user.id);

      const refreshed = await db.get('SELECT * FROM sales WHERE id=?', [id]);
      const sale = mapSale(refreshed || saleRow);
      await audit(req.user.id, 'CREATE', 'sale', id, null, sale);
      return res.status(201).json({ sale: { ...sale, commissionName: type.name } });
    }

    const store = await db.get('SELECT * FROM stores WHERE id=? AND user_id=?', [
      body.storeId,
      req.user.id,
    ]);
    if (!store) return res.status(400).json({ error: 'Loja inválida' });

    const saleDate = body.saleDate || new Date().toISOString().slice(0, 10);
    const ruleInfo = await getRuleForDate(store.id, req.user.id, saleDate);
    const volumeBasis = ruleInfo.rule.volumeBasis || 'units';
    // volume inclui a venda atual para bands
    const prior = await monthlyVolume(req.user.id, store.id, saleDate, volumeBasis);
    const currentVol = volumeBasis === 'revenue' ? prior + (Number(body.grossValue) || 0) : prior + 1;

    const calc = calculateCommission({
      ruleType: ruleInfo.ruleType,
      rule: ruleInfo.rule,
      grossValue: (Number(body.grossValue) || 0) + (Number(body.accessoriesValue) || 0),
      costValue: Number(body.costValue) || 0,
      monthlyVolume: currentVol,
      productCode: body.nicheFields?.productCode || body.nicheFields?.brand,
      splitPercent: body.splitEnabled ? Number(body.splitPercent) || 0 : 0,
    });

    const extraManual = Number(body.commissionExtra) || calc.commissionExtra;
    const now = new Date().toISOString();
    const id = uuid();
    const snapshot = {
      ruleType: ruleInfo.ruleType,
      rule: ruleInfo.rule,
      effectiveFrom: ruleInfo.effectiveFrom,
      bandLabel: calc.bandLabel,
      engineNote: calc.engineNote,
      calculatedAt: now,
      monthlyVolumeAtSale: currentVol,
    };

    const title =
      body.title ||
      body.nicheFields?.vehicle ||
      body.nicheFields?.property ||
      body.nicheFields?.brand ||
      body.nicheFields?.policy ||
      body.nicheFields?.description ||
      'Venda';

    await db.run(
      `INSERT INTO sales (
      id, user_id, store_id, lead_id, title, client_name, status, sale_date,
      gross_value, accessories_value, extras_value, niche_fields, split_enabled,
      split_partner, split_percent, rule_version_id, snapshot_json,
      commission_official, commission_extra, commission_total, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user.id,
        store.id,
        body.leadId || null,
        title,
        body.clientName || null,
        body.status || 'pendente',
        saleDate,
        Number(body.grossValue) || 0,
        Number(body.accessoriesValue) || 0,
        Number(body.extrasValue) || 0,
        JSON.stringify(body.nicheFields || {}),
        body.splitEnabled ? 1 : 0,
        body.splitPartner || null,
        body.splitEnabled ? Number(body.splitPercent) || 0 : 0,
        ruleInfo.id,
        JSON.stringify(snapshot),
        calc.commissionOfficial,
        extraManual,
        calc.commissionOfficial + extraManual,
        body.notes || null,
        now,
        now,
      ]
    );

    const saleRow = await db.get('SELECT * FROM sales WHERE id=?', [id]);
    await createReceivables(saleRow, store, body.milestones, req.user.id);

    if (body.leadId) {
      await db.run(`UPDATE leads SET stage='fechado', updated_at=? WHERE id=? AND user_id=?`, [
        now,
        body.leadId,
        req.user.id,
      ]);
    }

    const sale = mapSale(saleRow);
    await audit(req.user.id, 'CREATE', 'sale', id, null, sale);
    res.status(201).json({ sale });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    const row = await db.get('SELECT * FROM sales WHERE id=? AND user_id=?', [req.params.id, ws]);
    if (!row) return res.status(404).json({ error: 'Venda não encontrada' });
    const seller = row.seller_id || row.user_id;
    if (!req.user.canSeeTeam && seller !== req.user.id) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }
    if (!req.user.canLaunch && !req.user.canSeeTeam) {
      return res.status(403).json({ error: 'Seu papel é somente leitura.' });
    }

    const before = mapSale(row);
    const { status, notes, commissionExtra, clientName } = req.body || {};
    const nextExtra = commissionExtra !== undefined ? Number(commissionExtra) : row.commission_extra;
    const nextOfficial = row.commission_official;
    const nextStatus = status || row.status;

    await db.run(
      `UPDATE sales SET status=?, notes=?, commission_extra=?, commission_total=?, client_name=?, updated_at=?
       WHERE id=? AND user_id=?`,
      [
        nextStatus,
        notes !== undefined ? notes : row.notes,
        nextExtra,
        nextOfficial + nextExtra,
        clientName !== undefined ? clientName : row.client_name,
        new Date().toISOString(),
        row.id,
        ws,
      ]
    );

    if (nextStatus === 'quitada') {
      await db.run(
        `UPDATE receivables SET status='quitado', paid_date=?, updated_at=? WHERE sale_id=? AND status!='cancelado'`,
        [new Date().toISOString().slice(0, 10), new Date().toISOString(), row.id]
      );
    }
    if (nextStatus === 'cancelada') {
      await db.run(`UPDATE receivables SET status='cancelado', updated_at=? WHERE sale_id=?`, [
        new Date().toISOString(),
        row.id,
      ]);
    }

    if (row.commission_type_id && nextStatus !== before.status && (nextStatus === 'cancelada' || before.status === 'cancelada')) {
      const type = await loadCommissionType(ws, row.commission_type_id);
      if (type) await recalcMonthSales(ws, type, row.sale_date, seller);
    }

    const updated = mapSale(await db.get('SELECT * FROM sales WHERE id=?', [row.id]));
    await audit(req.user.id, 'UPDATE', 'sale', row.id, before, updated);
    res.json({ sale: updated });
  })
);

router.delete(
  '/:id',
  requireLaunch,
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    const row = await db.get('SELECT * FROM sales WHERE id=? AND user_id=?', [req.params.id, ws]);
    if (!row) return res.status(404).json({ error: 'Venda não encontrada' });
    const seller = row.seller_id || row.user_id;
    if (!req.user.canSeeTeam && seller !== req.user.id) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }
    const before = mapSale(row);
    const typeId = row.commission_type_id;
    const saleDate = row.sale_date;
    await db.run('DELETE FROM sales WHERE id=?', [row.id]);
    if (typeId) {
      const type = await loadCommissionType(ws, typeId);
      if (type) await recalcMonthSales(ws, type, saleDate, seller);
    }
    await audit(req.user.id, 'DELETE', 'sale', row.id, before, null);
    res.json({ ok: true });
  })
);

module.exports = router;
