const db = require('../db');
const { calculateEntry, usesMonthRecalc, round2 } = require('./commissionTypes');
const { safeJson } = require('./safeJson');

/**
 * Recalcula a faixa do mês POR VENDEDOR (não pelo volume do time).
 */
async function recalcMonthSales(workspaceId, type, saleDate, sellerId) {
  if (!type || !usesMonthRecalc(type)) return { updated: 0, monthCount: 0 };
  const calcType = type.calcType || type.calc_type;
  if (calcType === 'flex' || calcType === 'prize') return { updated: 0, monthCount: 0 };
  if (!sellerId) return { updated: 0, monthCount: 0 };

  const month = (saleDate || new Date().toISOString()).slice(0, 7);
  const sales = await db.all(
    `SELECT * FROM sales
     WHERE user_id=? AND commission_type_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'
       AND COALESCE(seller_id, user_id)=?
     ORDER BY sale_date ASC, created_at ASC`,
    [workspaceId, type.id, month, sellerId]
  );

  const monthCount = sales.length;
  const monthRevenue = sales.reduce((sum, s) => sum + (Number(s.gross_value) || 0), 0);
  const now = new Date().toISOString();
  let updated = 0;
  let bandLabel = '';

  for (const sale of sales) {
    if (sale.status === 'quitada') continue;
    const niche = safeJson(sale.niche_fields);
    const snap = safeJson(sale.snapshot_json);
    if (snap.calcType === 'flex' || snap.calcType === 'prize') continue;
    const calc = calculateEntry(type, {
      grossValue: sale.gross_value,
      quantity: niche.quantity,
      costValue: niche.cost,
      flexAmount: niche.flexAmount,
      flexPercent: niche.flexPercent,
      commissionAmount: niche.commissionAmount,
      monthCount,
      monthRevenue,
      includeCurrent: false,
    });
    bandLabel = calc.bandLabel;
    const extra = Number(sale.commission_extra) || 0;
    const nextOfficial = calc.amount;
    const nextTotal = round2(nextOfficial + extra);
    if (round2(sale.commission_official) === nextOfficial && round2(sale.commission_total) === nextTotal) {
      continue;
    }
    snap.bandLabel = calc.bandLabel;
    snap.engineNote = calc.note;
    snap.monthCountAtSale = monthCount;
    snap.monthRecalc = true;
    snap.recalculatedAt = now;
    snap.sellerId = sellerId;

    await db.run(
      `UPDATE sales SET commission_official=?, commission_total=?, snapshot_json=?, updated_at=? WHERE id=?`,
      [nextOfficial, nextTotal, JSON.stringify(snap), now, sale.id]
    );
    await db.run(
      `UPDATE receivables SET amount=?, updated_at=?
       WHERE sale_id=? AND kind='oficial' AND status IN ('previsto','parcial','atrasado')`,
      [nextOfficial, now, sale.id]
    );
    updated += 1;
  }

  return { updated, monthCount, monthRevenue, bandLabel };
}

async function healUserMonth(workspaceId, saleDate) {
  const { mapRow } = require('./commissionTypes');
  const month = (saleDate || new Date().toISOString()).slice(0, 7);
  const rows = await db.all(
    'SELECT * FROM commission_types WHERE user_id=? AND active=1',
    [workspaceId]
  );
  const sellers = await db.all(
    `SELECT DISTINCT COALESCE(seller_id, user_id) as sid FROM sales
     WHERE user_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'`,
    [workspaceId, month]
  );
  let total = 0;
  for (const row of rows) {
    const type = mapRow(row);
    if (!usesMonthRecalc(type)) continue;
    for (const s of sellers) {
      const result = await recalcMonthSales(workspaceId, type, `${month}-01`, s.sid);
      total += result.updated;
    }
  }
  return total;
}

module.exports = { recalcMonthSales, healUserMonth };
