/**
 * Catálogo comercial. Seed no banco; admin altera preço/limites.
 * getPlan/listPlans são síncronos (cache em memória, recarregado no boot e no save).
 */

const { v4: uuid } = require('uuid');
const db = require('../db');

const DEFAULT_PLANS = {
  solo: {
    id: 'solo',
    name: 'Solo',
    priceMonthly: 49,
    priceYearly: 490,
    currency: 'BRL',
    tagline: 'Sua carteira de comissões',
    maxStores: 3,
    maxTeamMembers: 0,
    extraSeatPrice: null,
    features: [
      'Motor de comissão completo',
      'Painel pessoal, metas e comparativo no tempo',
      'Simulador rápido',
      'Exportação CSV',
      '1 mês grátis · sem reembolso depois',
    ],
    highlighted: false,
    sortOrder: 1,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 89,
    priceYearly: 890,
    currency: 'BRL',
    tagline: 'Para quem vive de várias regras de comissão',
    maxStores: 25,
    maxTeamMembers: 1,
    extraSeatPrice: 59,
    features: [
      'Tudo do Solo',
      'Pipeline comercial',
      '1 parceiro no espaço',
      'Painel do espaço (2 pessoas)',
      'Catálogo de métricas',
      '1 mês grátis · sem reembolso depois',
    ],
    highlighted: true,
    sortOrder: 2,
  },
  time: {
    id: 'time',
    name: 'Time',
    priceMonthly: 149,
    priceYearly: 1490,
    currency: 'BRL',
    tagline: 'Para equipes com papéis e ranking',
    maxStores: 100,
    maxTeamMembers: 3,
    extraSeatPrice: 59,
    features: [
      'Tudo do Pro',
      'Até 3 usuários inclusos',
      'Usuário extra R$ 59/mês',
      'Papéis: ver / lançar / admin',
      'Painel do time, ranking e comparar por vendedor',
      '1 mês grátis · sem reembolso depois',
    ],
    highlighted: false,
    sortOrder: 3,
  },
};

let cache = { ...DEFAULT_PLANS };

function clonePlan(p) {
  return {
    ...p,
    features: Array.isArray(p.features) ? [...p.features] : [],
  };
}

function parseFeatures(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function rowToPlan(row) {
  return {
    id: row.id,
    name: row.name,
    priceMonthly: Number(row.price_monthly),
    priceYearly: Number(row.price_yearly),
    currency: row.currency || 'BRL',
    tagline: row.tagline || '',
    maxStores: Number(row.max_stores) || 0,
    maxTeamMembers: Number(row.max_team_members) || 0,
    extraSeatPrice: row.extra_seat_price == null ? null : Number(row.extra_seat_price),
    features: parseFeatures(row.features_json),
    highlighted: !!row.highlighted,
    sortOrder: Number(row.sort_order) || 0,
    updatedAt: row.updated_at || null,
  };
}

function listPlans() {
  return Object.values(cache)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map(clonePlan);
}

function getPlan(planId) {
  return cache[planId] ? clonePlan(cache[planId]) : null;
}

function planLimits(planId) {
  const p = getPlan(planId) || cache.solo;
  return {
    maxStores: p.maxStores,
    maxTeamMembers: p.maxTeamMembers,
    extraSeatPrice: p.extraSeatPrice || null,
  };
}

function seatCap(owner) {
  const limits = planLimits(owner?.plan || 'solo');
  return (limits.maxTeamMembers || 0) + (Number(owner?.extra_seats) || 0);
}

function planMrr(row) {
  if (!row || row.plan_status !== 'active') return 0;
  const plan = getPlan(row.plan || 'solo');
  if (!plan) return 0;
  const extra = Number(row.extra_seats) || 0;
  const extraMonth = extra * (plan.extraSeatPrice || 0);
  if (row.billing_cycle === 'yearly') return plan.priceYearly / 12 + extraMonth;
  return plan.priceMonthly + extraMonth;
}

async function refreshCache() {
  const rows = await db.all(`SELECT * FROM plan_catalog ORDER BY sort_order ASC`);
  if (!rows.length) return;
  for (const key of Object.keys(cache)) delete cache[key];
  for (const row of rows) cache[row.id] = rowToPlan(row);
}

async function loadFromDb() {
  for (const p of Object.values(DEFAULT_PLANS)) {
    const exists = await db.get('SELECT id FROM plan_catalog WHERE id=?', [p.id]);
    if (exists) continue;
    await db.run(
      `INSERT INTO plan_catalog (
        id, name, tagline, price_monthly, price_yearly, currency,
        max_stores, max_team_members, extra_seat_price, features_json,
        highlighted, sort_order, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.id,
        p.name,
        p.tagline,
        p.priceMonthly,
        p.priceYearly,
        p.currency,
        p.maxStores,
        p.maxTeamMembers,
        p.extraSeatPrice,
        JSON.stringify(p.features),
        p.highlighted ? 1 : 0,
        p.sortOrder,
        new Date().toISOString(),
      ]
    );
  }
  await refreshCache();
}

function sanitizePatch(body) {
  const features = Array.isArray(body.features)
    ? body.features.map((f) => String(f).trim()).filter(Boolean)
    : parseFeatures(body.features);
  const priceMonthly = Number(body.priceMonthly);
  const priceYearly = Number(body.priceYearly);
  if (!Number.isFinite(priceMonthly) || priceMonthly < 0) {
    throw Object.assign(new Error('Preço mensal inválido'), { status: 400 });
  }
  if (!Number.isFinite(priceYearly) || priceYearly < 0) {
    throw Object.assign(new Error('Preço anual inválido'), { status: 400 });
  }
  const extraRaw = body.extraSeatPrice;
  const extraSeatPrice =
    extraRaw === '' || extraRaw == null ? null : Number(extraRaw);
  if (extraSeatPrice != null && (!Number.isFinite(extraSeatPrice) || extraSeatPrice < 0)) {
    throw Object.assign(new Error('Preço do assento extra inválido'), { status: 400 });
  }
  return {
    name: String(body.name || '').trim(),
    tagline: String(body.tagline || '').trim(),
    priceMonthly,
    priceYearly,
    maxStores: Math.max(0, Number(body.maxStores) || 0),
    maxTeamMembers: Math.max(0, Number(body.maxTeamMembers) || 0),
    extraSeatPrice,
    features,
    highlighted: !!body.highlighted,
  };
}

async function updatePlan(planId, body) {
  const current = await db.get('SELECT * FROM plan_catalog WHERE id=?', [planId]);
  if (!current) {
    throw Object.assign(new Error('Plano não encontrado'), { status: 404 });
  }
  const base = rowToPlan(current);
  const merged = { ...base, ...body };
  if (body.highlighted == null) merged.highlighted = base.highlighted;
  if (body.features == null || body.features === '') merged.features = base.features;
  const patch = sanitizePatch(merged);
  if (!patch.name) {
    throw Object.assign(new Error('Nome obrigatório'), { status: 400 });
  }
  const now = new Date().toISOString();
  await db.run(
    `UPDATE plan_catalog SET
      name=?, tagline=?, price_monthly=?, price_yearly=?,
      max_stores=?, max_team_members=?, extra_seat_price=?,
      features_json=?, highlighted=?, updated_at=?
     WHERE id=?`,
    [
      patch.name,
      patch.tagline,
      patch.priceMonthly,
      patch.priceYearly,
      patch.maxStores,
      patch.maxTeamMembers,
      patch.extraSeatPrice,
      JSON.stringify(patch.features),
      patch.highlighted ? 1 : 0,
      now,
      planId,
    ]
  );
  await refreshCache();
  const before = rowToPlan(current);
  const after = getPlan(planId);
  await db.run(
    `INSERT INTO plan_price_history (id, plan_id, admin_id, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), planId, body?.adminId || null, JSON.stringify(before), JSON.stringify(after), now]
  );
  return { before, after };
}

module.exports = {
  PLANS: cache,
  DEFAULT_PLANS,
  listPlans,
  getPlan,
  planLimits,
  seatCap,
  planMrr,
  loadFromDb,
  updatePlan,
};
