const db = require('../db');

const CATALOG = [
  { key: 'commission_launched', label: 'Comissão lançada', unit: 'money' },
  { key: 'commission_received', label: 'Comissão já recebida', unit: 'money' },
  { key: 'commission_receivable', label: 'Comissão a receber', unit: 'money' },
  { key: 'launch_count', label: 'Quantidade de lançamentos', unit: 'count' },
  { key: 'avg_ticket', label: 'Ticket médio da venda', unit: 'money' },
  { key: 'avg_commission', label: 'Comissão média por lançamento', unit: 'money' },
  { key: 'goal_percent', label: '% da meta', unit: 'percent' },
  { key: 'mix_by_type', label: 'Mix por tipo de comissão', unit: 'share' },
  { key: 'due_week', label: 'Vencendo nesta semana', unit: 'money' },
  { key: 'overdue', label: 'Atrasado', unit: 'money' },
];

function listCatalog() {
  return CATALOG;
}

function shiftPeriod(from, to, groupBy) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (groupBy === 'year') {
    start.setFullYear(start.getFullYear() - 1);
    end.setFullYear(end.getFullYear() - 1);
  } else if (groupBy === 'day') {
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
    start.setDate(start.getDate() - days);
    end.setDate(end.getDate() - days);
  } else {
    start.setMonth(start.getMonth() - 1);
    end.setMonth(end.getMonth() - 1);
  }
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function samePeriodLastYear(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  start.setFullYear(start.getFullYear() - 1);
  end.setFullYear(end.getFullYear() - 1);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function groupExpr(groupBy, col = 'sale_date') {
  if (groupBy === 'day') return `substr(${col},1,10)`;
  if (groupBy === 'year') return `substr(${col},1,4)`;
  return `substr(${col},1,7)`;
}

async function salesBase(workspaceId, { from, to, sellerId, commissionTypeId }) {
  let sql = `SELECT * FROM sales WHERE user_id=? AND status!='cancelada' AND sale_date>=? AND sale_date<=?`;
  const params = [workspaceId, from, to];
  if (sellerId) {
    sql += ' AND COALESCE(seller_id, user_id)=?';
    params.push(sellerId);
  }
  if (commissionTypeId) {
    sql += ' AND commission_type_id=?';
    params.push(commissionTypeId);
  }
  return db.all(sql, params);
}

async function computeMetric(workspaceId, key, filters = {}) {
  const from = filters.from || '2000-01-01';
  const to = filters.to || '2099-12-31';
  const sales = await salesBase(workspaceId, { ...filters, from, to });
  const count = sales.length;
  const commission = sales.reduce((s, x) => s + (Number(x.commission_total) || 0), 0);
  const revenue = sales.reduce((s, x) => s + (Number(x.gross_value) || 0), 0);

  if (key === 'commission_launched') return { value: commission, count };
  if (key === 'launch_count') return { value: count, count };
  if (key === 'avg_ticket') return { value: count ? revenue / count : 0, count };
  if (key === 'avg_commission') return { value: count ? commission / count : 0, count };

  let recSql = `SELECT COALESCE(SUM(amount),0) as v FROM receivables r
    JOIN sales s ON s.id=r.sale_id
    WHERE r.user_id=?`;
  const recParams = [workspaceId];
  if (filters.sellerId) {
    recSql += ' AND COALESCE(s.seller_id, s.user_id)=?';
    recParams.push(filters.sellerId);
  }
  if (filters.commissionTypeId) {
    recSql += ' AND s.commission_type_id=?';
    recParams.push(filters.commissionTypeId);
  }

  if (key === 'commission_received') {
    const row = await db.get(
      `${recSql} AND r.status='quitado' AND substr(COALESCE(r.paid_date, r.due_date),1,10)>=? AND substr(COALESCE(r.paid_date, r.due_date),1,10)<=?`,
      [...recParams, from, to]
    );
    return { value: Number(row?.v) || 0, count };
  }
  if (key === 'commission_receivable') {
    const row = await db.get(
      `${recSql} AND r.status IN ('previsto','parcial','atrasado')`,
      recParams
    );
    return { value: Number(row?.v) || 0, count };
  }
  if (key === 'due_week') {
    const today = new Date().toISOString().slice(0, 10);
    const week = new Date();
    week.setDate(week.getDate() + 7);
    const weekStr = week.toISOString().slice(0, 10);
    const row = await db.get(
      `${recSql} AND r.status IN ('previsto','parcial','atrasado') AND r.due_date>=? AND r.due_date<=?`,
      [...recParams, today, weekStr]
    );
    return { value: Number(row?.v) || 0, count };
  }
  if (key === 'overdue') {
    const today = new Date().toISOString().slice(0, 10);
    const row = await db.get(
      `${recSql} AND r.status IN ('previsto','parcial','atrasado') AND r.due_date<?`,
      [...recParams, today]
    );
    return { value: Number(row?.v) || 0, count };
  }
  if (key === 'mix_by_type') {
    const rows = await db.all(
      `SELECT ct.id, ct.name,
              COALESCE(SUM(s.commission_total),0) as commission,
              COUNT(s.id) as launches
       FROM commission_types ct
       LEFT JOIN sales s ON s.commission_type_id=ct.id AND s.user_id=ct.user_id
         AND s.status!='cancelada' AND s.sale_date>=? AND s.sale_date<=?
         ${filters.sellerId ? 'AND COALESCE(s.seller_id, s.user_id)=?' : ''}
       WHERE ct.user_id=? AND ct.active=1
       GROUP BY ct.id, ct.name ORDER BY commission DESC`,
      filters.sellerId ? [from, to, filters.sellerId, workspaceId] : [from, to, workspaceId]
    );
    const total = rows.reduce((s, r) => s + Number(r.commission), 0) || 1;
    return {
      value: total,
      count,
      mix: rows.map((r) => ({
        id: r.id,
        name: r.name,
        commission: Number(r.commission) || 0,
        launches: Number(r.launches) || 0,
        share: (Number(r.commission) || 0) / total,
      })),
    };
  }
  if (key === 'goal_percent') {
    return { value: 0, count, note: 'Calculado no Painel com a meta cadastrada' };
  }
  return { value: 0, count };
}

async function compareSeries(workspaceId, { from, to, groupBy = 'month', sellerId, commissionTypeId, metric = 'commission_launched' }) {
  const expr = groupExpr(groupBy);
  let sql = `SELECT ${expr} as bucket,
            COALESCE(SUM(commission_total),0) as commission,
            COALESCE(SUM(gross_value),0) as revenue,
            COUNT(*) as launches
     FROM sales
     WHERE user_id=? AND status!='cancelada' AND sale_date>=? AND sale_date<=?`;
  const params = [workspaceId, from, to];
  if (sellerId) {
    sql += ' AND COALESCE(seller_id, user_id)=?';
    params.push(sellerId);
  }
  if (commissionTypeId) {
    sql += ' AND commission_type_id=?';
    params.push(commissionTypeId);
  }
  sql += ` GROUP BY ${expr} ORDER BY ${expr}`;
  const rows = await db.all(sql, params);

  const valueOf = (r) => {
    if (metric === 'launch_count') return Number(r.launches) || 0;
    if (metric === 'avg_ticket') return r.launches ? Number(r.revenue) / Number(r.launches) : 0;
    if (metric === 'avg_commission') return r.launches ? Number(r.commission) / Number(r.launches) : 0;
    return Number(r.commission) || 0;
  };

  return rows.map((r) => ({
    bucket: r.bucket,
    commission: Number(r.commission) || 0,
    revenue: Number(r.revenue) || 0,
    launches: Number(r.launches) || 0,
    value: valueOf(r),
  }));
}

module.exports = {
  CATALOG,
  listCatalog,
  computeMetric,
  compareSeries,
  shiftPeriod,
  samePeriodLastYear,
};
