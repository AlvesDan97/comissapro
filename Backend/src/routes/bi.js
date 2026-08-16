const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { workspaceId } = require('../services/scope');

const router = express.Router();
router.use(authRequired);

const FUNNEL_STAGES = [
  { id: 'lead', label: 'Lead' },
  { id: 'proposta', label: 'Proposta' },
  { id: 'negociacao', label: 'Negociação' },
  { id: 'fechado', label: 'Fechado' },
  { id: 'perdido', label: 'Perdido' },
];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDay(iso) {
  return new Date(`${iso}T12:00:00`);
}

function lastDayOfMonth(year, monthIndex) {
  return ymd(new Date(year, monthIndex + 1, 0));
}

function resolveRange(period, fromQ, toQ, today) {
  const now = parseDay(today);
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'month') {
    return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: today };
  }
  if (period === '6m') {
    const start = new Date(y, m - 5, 1);
    return { from: ymd(start), to: today };
  }
  if (period === 'year') {
    return { from: `${y}-01-01`, to: lastDayOfMonth(y, 11) };
  }
  if (period === 'custom' && fromQ && toQ) {
    return { from: fromQ, to: toQ };
  }
  return { from: `${y}-01-01`, to: today };
}

function previousRange(from, to) {
  const start = parseDay(from);
  const end = parseDay(to);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return { from: ymd(prevStart), to: ymd(prevEnd) };
}

function monthsBetween(from, to) {
  const out = [];
  const cur = parseDay(`${from.slice(0, 7)}-01`);
  const end = parseDay(`${to.slice(0, 7)}-01`);
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
    out.push({
      month: key,
      label: cur.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function sum(rows, key) {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

function deltaPct(curr, prev) {
  if (!prev && !curr) return null;
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ws = workspaceId(req);
    const today = new Date().toISOString().slice(0, 10);
    const period = String(req.query.period || 'ytd');
    const range = resolveRange(period, req.query.from, req.query.to, today);
    const prev = previousRange(range.from, range.to);
    const scope = req.query.scope === 'workspace' && req.user.canSeeTeam ? 'workspace' : 'me';
    const sellerId = scope === 'me' ? req.user.id : req.user.canSeeTeam ? req.query.sellerId || null : req.user.id;
    const sellerSql = sellerId ? ' AND COALESCE(seller_id, user_id)=?' : '';
    const sellerSqlS = sellerId ? ' AND COALESCE(s.seller_id, s.user_id)=?' : '';

    const saleParams = sellerId
      ? [ws, prev.from, range.to, sellerId]
      : [ws, prev.from, range.to];
    const sales = await db.all(
      `SELECT s.id, s.sale_date, s.gross_value, s.commission_total, s.status, s.title,
              s.commission_type_id, COALESCE(s.seller_id, s.user_id) as seller_id,
              ct.name as commission_name
       FROM sales s
       LEFT JOIN commission_types ct ON ct.id=s.commission_type_id
       WHERE s.user_id=? AND s.sale_date>=? AND s.sale_date<=? AND s.status!='cancelada'${sellerSqlS}
       ORDER BY s.sale_date ASC`,
      saleParams
    );

    const currentSales = sales.filter((s) => s.sale_date >= range.from && s.sale_date <= range.to);
    const prevSales = sales.filter((s) => s.sale_date >= prev.from && s.sale_date <= prev.to);

    const cancelledRow = await db.get(
      `SELECT COUNT(*) as c FROM sales
       WHERE user_id=? AND sale_date>=? AND sale_date<=? AND status='cancelada'${sellerSql}`,
      sellerId ? [ws, range.from, range.to, sellerId] : [ws, range.from, range.to]
    );

    const recJoin = sellerId
      ? ' AND COALESCE(s.seller_id, s.user_id)=?'
      : '';
    const receivedNow = await db.get(
      `SELECT COALESCE(SUM(r.amount),0) as v FROM receivables r
       JOIN sales s ON s.id=r.sale_id
       WHERE r.user_id=? AND r.status='quitado'
         AND substr(COALESCE(r.paid_date, r.due_date),1,10)>=?
         AND substr(COALESCE(r.paid_date, r.due_date),1,10)<=?${recJoin}`,
      sellerId ? [ws, range.from, range.to, sellerId] : [ws, range.from, range.to]
    );
    const receivedPrev = await db.get(
      `SELECT COALESCE(SUM(r.amount),0) as v FROM receivables r
       JOIN sales s ON s.id=r.sale_id
       WHERE r.user_id=? AND r.status='quitado'
         AND substr(COALESCE(r.paid_date, r.due_date),1,10)>=?
         AND substr(COALESCE(r.paid_date, r.due_date),1,10)<=?${recJoin}`,
      sellerId ? [ws, prev.from, prev.to, sellerId] : [ws, prev.from, prev.to]
    );
    const openRows = await db.all(
      `SELECT r.amount, r.due_date, r.status FROM receivables r
       JOIN sales s ON s.id=r.sale_id
       WHERE r.user_id=? AND r.status IN ('previsto','parcial','atrasado')${recJoin}`,
      sellerId ? [ws, sellerId] : [ws]
    );

    const launched = sum(currentSales, 'commission_total');
    const revenue = sum(currentSales, 'gross_value');
    const count = currentSales.length;
    const received = Number(receivedNow?.v) || 0;
    const pipeline = sum(openRows, 'amount');
    const prevLaunched = sum(prevSales, 'commission_total');
    const prevRevenue = sum(prevSales, 'gross_value');
    const prevCount = prevSales.length;
    const prevReceived = Number(receivedPrev?.v) || 0;

    const kpis = {
      launched,
      received,
      pipeline,
      revenue,
      count,
      avgTicket: count ? revenue / count : 0,
      avgCommission: count ? launched / count : 0,
      cancelled: Number(cancelledRow?.c) || 0,
      deltas: {
        launched: deltaPct(launched, prevLaunched),
        received: deltaPct(received, prevReceived),
        revenue: deltaPct(revenue, prevRevenue),
        count: deltaPct(count, prevCount),
      },
    };

    const buckets = monthsBetween(range.from, range.to);
    const series = buckets.map((b) => {
      const rows = currentSales.filter((s) => s.sale_date.slice(0, 7) === b.month);
      return {
        month: b.month,
        label: b.label,
        commission: sum(rows, 'commission_total'),
        revenue: sum(rows, 'gross_value'),
        count: rows.length,
      };
    });

    const mixMap = new Map();
    for (const s of currentSales) {
      const id = s.commission_type_id || 'none';
      const cur = mixMap.get(id) || { id, name: s.commission_name || 'Sem tipo', commission: 0, launches: 0 };
      cur.commission += Number(s.commission_total) || 0;
      cur.launches += 1;
      mixMap.set(id, cur);
    }
    const mixTotal = launched || 1;
    const mix = [...mixMap.values()]
      .sort((a, b) => b.commission - a.commission)
      .map((m) => ({ ...m, share: m.commission / mixTotal }));

    const aging = {
      upcoming: { label: 'A vencer', amount: 0, count: 0 },
      d7: { label: '1–7 dias', amount: 0, count: 0 },
      d30: { label: '8–30 dias', amount: 0, count: 0 },
      d90: { label: '31+ dias', amount: 0, count: 0 },
    };
    for (const r of openRows) {
      const amt = Number(r.amount) || 0;
      if (r.due_date >= today) {
        aging.upcoming.amount += amt;
        aging.upcoming.count += 1;
      } else {
        const late = daysBetween(r.due_date, today);
        const key = late <= 7 ? 'd7' : late <= 30 ? 'd30' : 'd90';
        aging[key].amount += amt;
        aging[key].count += 1;
      }
    }

    let funnel = [];
    if (['pro', 'time'].includes(req.user.plan)) {
      try {
        const leads = await db.all('SELECT stage, value FROM leads WHERE user_id=?', [ws]);
        const by = Object.fromEntries(FUNNEL_STAGES.map((s) => [s.id, { ...s, count: 0, value: 0 }]));
        for (const l of leads) {
          const key = by[l.stage] ? l.stage : 'lead';
          by[key].count += 1;
          by[key].value += Number(l.value) || 0;
        }
        funnel = FUNNEL_STAGES.map((s) => by[s.id]);
      } catch (e) {
        console.error('[bi] funnel', e.message);
      }
    }

    let ranking = [];
    if (scope === 'workspace' && req.user.canSeeTeam) {
      try {
        ranking = await db.all(
          `SELECT COALESCE(s.seller_id, s.user_id) as "sellerId",
                  MAX(COALESCE(u.name, '—')) as name,
                  COALESCE(SUM(s.commission_total),0) as commission,
                  COUNT(*) as launches,
                  COALESCE(SUM(s.gross_value),0) as revenue
           FROM sales s
           LEFT JOIN users u ON u.id=COALESCE(s.seller_id, s.user_id)
           WHERE s.user_id=? AND s.sale_date>=? AND s.sale_date<=? AND s.status!='cancelada'
           GROUP BY COALESCE(s.seller_id, s.user_id)
           ORDER BY commission DESC`,
          [ws, range.from, range.to]
        );
      } catch (e) {
        console.error('[bi] ranking', e.message);
      }
    }

    let goals = [];
    try {
      const goalRows = await db.all(
        `SELECT * FROM goals WHERE workspace_id=? AND period_start<=? AND period_end>=?
         ORDER BY period_start DESC LIMIT 12`,
        [ws, range.to, range.from]
      );
      for (const g of goalRows) {
        if (sellerId && g.seller_id && g.seller_id !== sellerId) continue;
        const inGoal = currentSales.filter(
          (s) =>
            s.sale_date >= g.period_start &&
            s.sale_date <= g.period_end &&
            (!g.seller_id || s.seller_id === g.seller_id) &&
            (!g.commission_type_id || s.commission_type_id === g.commission_type_id)
        );
        const current = g.metric === 'quantity' ? inGoal.length : sum(inGoal, 'commission_total');
        const target = Number(g.target) || 0;
        goals.push({
          id: g.id,
          name: g.name,
          metric: g.metric,
          target,
          current,
          percent: target ? Math.min(999, (current / target) * 100) : 0,
          remaining: Math.max(0, target - current),
          periodStart: g.period_start,
          periodEnd: g.period_end,
        });
      }
    } catch (e) {
      console.error('[bi] goals', e.message);
    }

    const weekday = WEEKDAYS.map((label, i) => ({ label, count: 0, commission: 0 }));
    for (const s of currentSales) {
      const d = parseDay(s.sale_date).getDay();
      weekday[d].count += 1;
      weekday[d].commission += Number(s.commission_total) || 0;
    }

    const titleMap = new Map();
    for (const s of currentSales) {
      const name = String(s.title || '—').trim() || '—';
      const cur = titleMap.get(name) || { name, launches: 0, commission: 0, revenue: 0 };
      cur.launches += 1;
      cur.commission += Number(s.commission_total) || 0;
      cur.revenue += Number(s.gross_value) || 0;
      titleMap.set(name, cur);
    }
    const topItems = [...titleMap.values()].sort((a, b) => b.launches - a.launches).slice(0, 8);

    const best = series.reduce((a, b) => (b.commission > (a?.commission || 0) ? b : a), series[0] || null);
    const worst = series
      .filter((s) => s.count)
      .reduce((a, b) => (b.commission < (a?.commission ?? Infinity) ? b : a), null);

    res.json({
      scope,
      canSeeTeam: !!req.user.canSeeTeam,
      period,
      range,
      previous: prev,
      kpis,
      series,
      mix,
      aging: Object.entries(aging).map(([key, v]) => ({ key, ...v })),
      funnel,
      ranking,
      goals,
      weekday,
      topItems,
      insight: best
        ? {
            bestMonth: best.month,
            bestLabel: best.label,
            bestCommission: best.commission,
            worstMonth: worst?.month || null,
            worstLabel: worst?.label || null,
          }
        : null,
    });
  })
);

module.exports = router;
