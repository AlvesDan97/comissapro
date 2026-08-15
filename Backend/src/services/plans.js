/**
 * Planos comerciais ComissaPro
 * Solo R$49 · Pro R$89 · Time R$149
 */

const PLANS = {
  solo: {
    id: 'solo',
    name: 'Solo',
    priceMonthly: 49,
    priceYearly: 490, // ~2 meses grátis
    currency: 'BRL',
    tagline: 'Para quem vende em poucas empresas',
    maxStores: 3,
    maxTeamMembers: 0,
    features: [
      'Até 3 lojas / fornecedores',
      'Vendas com snapshot histórico',
      'Dashboard e metas em faixas',
      'Simulador What-If',
      'Exportação CSV',
      'Suporte por e-mail',
    ],
    highlighted: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 89,
    priceYearly: 890,
    currency: 'BRL',
    tagline: 'Para multilojas e conferência de extrato',
    maxStores: 25,
    maxTeamMembers: 1,
    features: [
      'Tudo do Solo',
      'Até 25 lojas',
      'Conciliação Smart (PDF/Excel)',
      'Pipeline + recebíveis',
      'Alisamento de renda',
      '2FA e trilha de auditoria',
      '1 convite de parceiro (split)',
    ],
    highlighted: true,
  },
  time: {
    id: 'time',
    name: 'Time',
    priceMonthly: 149,
    priceYearly: 1490,
    currency: 'BRL',
    tagline: 'Para equipes e splits com papéis',
    maxStores: 100,
    maxTeamMembers: 3,
    extraSeatPrice: 59,
    features: [
      'Tudo do Pro',
      'Até 3 usuários inclusos',
      'Usuário extra R$ 59/mês',
      'Papéis: ver / lançar / admin',
      'Split com acordo rastreado',
      'Prioridade no suporte',
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

module.exports = { PLANS, listPlans, getPlan, planLimits };
