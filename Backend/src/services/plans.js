/**
 * Planos comerciais Comiss
 * Solo R$49 · Pro R$89 · Time R$149
 */

const PLANS = {
  solo: {
    id: 'solo',
    name: 'Solo',
    priceMonthly: 49,
    priceYearly: 490,
    currency: 'BRL',
    tagline: 'Sua carteira de comissões',
    maxStores: 3,
    maxTeamMembers: 0,
    features: [
      'Motor de comissão completo',
      'Painel pessoal, metas e comparativo no tempo',
      'Simulador rápido',
      'Exportação CSV',
      '1 mês grátis · sem reembolso depois',
    ],
    highlighted: false,
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
  },
};

function listPlans() {
  return Object.values(PLANS);
}

function getPlan(planId) {
  return PLANS[planId] || null;
}

function planLimits(planId) {
  const p = getPlan(planId) || PLANS.solo;
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

module.exports = { PLANS, listPlans, getPlan, planLimits, seatCap };
