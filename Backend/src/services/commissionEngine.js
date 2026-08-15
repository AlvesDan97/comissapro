/**
 * Motor universal de comissões — ComissaPro
 * Tipos: fixed | bands | margin | product_table | cash_on_receipt | milestones
 */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pickBandPercent(bands, volume) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  let pct = sorted[0]?.percent ?? 0;
  for (const b of sorted) {
    if (volume >= b.min) pct = b.percent;
  }
  return pct;
}

function resolveBandLabel(bands, volume) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (volume >= sorted[i].min) {
      const max = sorted[i].max ?? '∞';
      return `${(sorted[i].percent * 100).toFixed(2).replace('.', ',')}% (${sorted[i].min}–${max})`;
    }
  }
  return '—';
}

/**
 * @param {object} params
 * @param {'fixed'|'bands'|'margin'|'product_table'|'cash_on_receipt'|'milestones'} params.ruleType
 * @param {object} params.rule
 * @param {number} params.grossValue
 * @param {number} [params.costValue]
 * @param {number} [params.monthlyVolume] unidades ou R$ conforme rule.volumeBasis
 * @param {string} [params.productCode]
 * @param {number} [params.splitPercent] 0-100 parceiro
 */
function calculateCommission(params) {
  const {
    ruleType,
    rule,
    grossValue,
    costValue = 0,
    monthlyVolume = 0,
    productCode,
    splitPercent = 0,
  } = params;

  let base = Number(grossValue) || 0;
  let percent = 0;
  let official = 0;
  let bandLabel = '—';
  let engineNote = '';

  switch (ruleType) {
    case 'fixed': {
      percent = Number(rule.percent) || 0;
      official = base * percent;
      bandLabel = `${(percent * 100).toFixed(2).replace('.', ',')}% fixo`;
      engineNote = 'Percentual fixo sobre o valor da venda';
      break;
    }
    case 'bands': {
      const bands = rule.bands || [];
      percent = pickBandPercent(bands, monthlyVolume);
      official = base * percent;
      bandLabel = resolveBandLabel(bands, monthlyVolume);
      engineNote = `Faixa progressiva por ${rule.volumeBasis === 'revenue' ? 'faturamento' : 'unidades'}`;
      break;
    }
    case 'margin': {
      const margin = Math.max(0, base - (Number(costValue) || Number(rule.defaultCost) || 0));
      percent = Number(rule.percentOnMargin) || 0;
      official = margin * percent;
      bandLabel = `${(percent * 100).toFixed(2).replace('.', ',')}% da margem`;
      engineNote = `Margem R$ ${margin.toFixed(2)}`;
      base = margin;
      break;
    }
    case 'product_table': {
      const table = rule.products || {};
      const row = table[productCode] || table.default || { percent: 0 };
      percent = Number(row.percent) || 0;
      official = base * percent;
      bandLabel = `${productCode || 'default'}: ${(percent * 100).toFixed(2).replace('.', ',')}%`;
      engineNote = 'Tabela por produto/SKU';
      break;
    }
    case 'cash_on_receipt': {
      percent = Number(rule.percent) || 0;
      official = base * percent;
      bandLabel = `${(percent * 100).toFixed(2).replace('.', ',')}% no recebimento`;
      engineNote = 'Comissão reconhecida apenas no caixa (recebimento)';
      break;
    }
    case 'milestones': {
      const marks = rule.milestones || [];
      percent = marks.reduce((s, m) => s + (Number(m.percent) || 0), 0);
      official = base * percent;
      bandLabel = marks.map((m) => `${m.label}:${(m.percent * 100).toFixed(1)}%`).join(' + ');
      engineNote = 'Comissão por marcos (sinal/escritura/entrega)';
      break;
    }
    default: {
      official = 0;
      engineNote = 'Tipo de regra desconhecido';
    }
  }

  const extraFlat = Number(rule.extraBonus) || 0;
  const extra = extraFlat;
  let total = official + extra;

  const partnerShare = clamp(Number(splitPercent) || 0, 0, 100) / 100;
  const userShare = 1 - partnerShare;
  const userOfficial = official * userShare;
  const userExtra = extra * userShare;
  const userTotal = total * userShare;

  return {
    percent,
    bandLabel,
    engineNote,
    baseValue: base,
    commissionOfficial: round2(userOfficial),
    commissionExtra: round2(userExtra),
    commissionTotal: round2(userTotal),
    partnerOfficial: round2(official * partnerShare),
    partnerTotal: round2(total * partnerShare),
    splitPercent: partnerShare * 100,
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function nextBandProgress(rule, monthlyVolume) {
  const bands = [...(rule.bands || [])].sort((a, b) => a.min - b.min);
  if (!bands.length) return null;
  let current = bands[0];
  let next = null;
  for (let i = 0; i < bands.length; i++) {
    if (monthlyVolume >= bands[i].min) current = bands[i];
    if (monthlyVolume < bands[i].min) {
      next = bands[i];
      break;
    }
  }
  if (!next) {
    return {
      currentPercent: current.percent,
      missingUnits: 0,
      message: 'Você já está na faixa máxima.',
    };
  }
  const missing = next.min - monthlyVolume;
  return {
    currentPercent: current.percent,
    nextPercent: next.percent,
    missingUnits: missing,
    message: `Faltam ${missing} ${rule.volumeBasis === 'revenue' ? 'em volume' : 'vendas'} para subir para ${(next.percent * 100).toFixed(2).replace('.', ',')}%`,
  };
}

function simulateWhatIf({ ruleType, rule, currentUnits, currentTicket, extraUnits, ticket }) {
  const units = currentUnits + extraUnits;
  const gross = units * ticket;
  const calc = calculateCommission({
    ruleType,
    rule,
    grossValue: gross,
    monthlyVolume: rule.volumeBasis === 'revenue' ? gross : units,
  });
  const currentCalc = calculateCommission({
    ruleType,
    rule,
    grossValue: currentUnits * currentTicket,
    monthlyVolume: rule.volumeBasis === 'revenue' ? currentUnits * currentTicket : currentUnits,
  });
  return {
    projectedUnits: units,
    projectedCommission: calc.commissionTotal,
    currentCommission: currentCalc.commissionTotal,
    diff: round2(calc.commissionTotal - currentCalc.commissionTotal),
    bandLabel: calc.bandLabel,
    progress: ruleType === 'bands' ? nextBandProgress(rule, units) : null,
  };
}

function incomeSmoothing(monthlySeries) {
  if (!monthlySeries.length) {
    return {
      average: 0,
      safeWithdrawal: 0,
      reserveTax: 0,
      reserveEmergency: 0,
      volatility: 0,
      suggestion: 'Lance vendas por alguns meses para gerar a análise.',
    };
  }
  const values = monthlySeries.map((m) => m.total);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - average) ** 2, 0) / values.length;
  const volatility = Math.sqrt(variance);
  const reserveTax = average * 0.27;
  const reserveEmergency = average * 0.15;
  const safeWithdrawal = Math.max(0, average - reserveTax - reserveEmergency - volatility * 0.25);
  return {
    average: round2(average),
    safeWithdrawal: round2(safeWithdrawal),
    reserveTax: round2(reserveTax),
    reserveEmergency: round2(reserveEmergency),
    volatility: round2(volatility),
    suggestion:
      safeWithdrawal > 0
        ? `Retire até ${formatBRL(safeWithdrawal)}/mês para manter estabilidade (imposto + reserva + sazonalidade).`
        : 'Sua média ainda é baixa ou muito volátil — priorize reserva antes de retirar.',
  };
}

function formatBRL(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const DEFAULT_RULES = {
  fixed: { percent: 0.03, extraBonus: 0 },
  bands: {
    volumeBasis: 'units',
    bands: [
      { min: 1, max: 4, percent: 0.003 },
      { min: 5, max: 7, percent: 0.004 },
      { min: 8, max: 10, percent: 0.0055 },
      { min: 11, max: null, percent: 0.007 },
    ],
    extraBonus: 0,
  },
  margin: { percentOnMargin: 0.25, defaultCost: 0, extraBonus: 0 },
  product_table: {
    products: {
      default: { percent: 0.04 },
    },
    extraBonus: 0,
  },
  cash_on_receipt: { percent: 0.05, extraBonus: 0 },
  milestones: {
    milestones: [
      { label: 'Sinal', percent: 0.02 },
      { label: 'Escritura', percent: 0.03 },
      { label: 'Entrega', percent: 0.01 },
    ],
    extraBonus: 0,
  },
};

const NICHE_FIELDS = {
  automotivo: [
    { key: 'vehicle', label: 'Veículo', type: 'text' },
    { key: 'origin', label: 'Origem', type: 'select', options: ['Estoque', 'Venda direta'] },
    { key: 'protect', label: 'Protect / Garantia', type: 'money' },
    { key: 'armor', label: 'Blindagem', type: 'toggle' },
  ],
  imobiliario: [
    { key: 'property', label: 'Imóvel', type: 'text' },
    { key: 'type', label: 'Tipo', type: 'select', options: ['Apartamento', 'Casa', 'Terreno', 'Comercial'] },
    { key: 'captador', label: 'Captador', type: 'text' },
  ],
  representacao: [
    { key: 'brand', label: 'Marca', type: 'text' },
    { key: 'orderCode', label: 'Pedido / NF', type: 'text' },
    { key: 'region', label: 'Região', type: 'text' },
  ],
  seguros: [
    { key: 'policy', label: 'Apólice', type: 'text' },
    { key: 'product', label: 'Produto', type: 'text' },
    { key: 'recurring', label: 'Recorrente', type: 'toggle' },
  ],
  personalizado: [
    { key: 'description', label: 'Descrição', type: 'text' },
    { key: 'ref', label: 'Referência', type: 'text' },
  ],
};

module.exports = {
  calculateCommission,
  nextBandProgress,
  simulateWhatIf,
  incomeSmoothing,
  DEFAULT_RULES,
  NICHE_FIELDS,
  formatBRL,
  round2,
};
