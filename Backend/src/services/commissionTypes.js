/**
 * Tipos de comissão do vendedor (regras financeiras, independentes de loja).
 * percent | fixed | bands | quantity | goal | prize | flex
 */

const { fifthBusinessDayNextMonth } = require('./businessDays');

const CALC_TYPES = [
  {
    id: 'percent',
    name: 'Percentual',
    short: 'Percentual sobre venda',
    hint: 'Um % fixo sobre o valor escolhido.',
  },
  {
    id: 'fixed',
    name: 'Valor fixo',
    short: 'Valor fixo por lançamento',
    hint: 'Um valor em dinheiro a cada venda ou unidade.',
  },
  {
    id: 'bands',
    name: 'Faixas',
    short: 'Faixas por valor ou quantidade',
    hint: 'O % muda conforme quantidade no mês ou valor. Ao subir de faixa, o mês inteiro é recalculado.',
  },
  {
    id: 'quantity',
    name: 'Quantidade',
    short: 'Por quantidade',
    hint: 'Um valor para cada unidade vendida.',
  },
  {
    id: 'goal',
    name: 'Meta',
    short: 'Por meta/faixa',
    hint: 'O percentual sobe com o volume do mês e vale para todos os lançamentos do período.',
  },
  {
    id: 'prize',
    name: 'Premiação',
    short: 'Valor informado no lançamento',
    hint: 'Você digita o valor do item e o valor da premiação em cada lançamento. Os dois são variáveis.',
  },
  {
    id: 'flex',
    name: 'Flexibilização',
    short: 'Comissão conforme o desconto dado',
    hint: 'O % cai se você flexibilizar acima do limite. Cada venda tem o próprio cálculo — os lançamentos anteriores não mudam.',
  },
];

const APPLIED_ON = [
  { id: 'entry_value', name: 'Valor do lançamento' },
  { id: 'net_value', name: 'Valor líquido' },
  { id: 'margin', name: 'Margem' },
  { id: 'accessories', name: 'Acessórios' },
];

const GENERATED_WHEN = [
  { id: 'on_entry', name: 'Ao registrar o lançamento' },
  { id: 'on_receipt', name: 'Quando o cliente pagar' },
  { id: 'on_invoice', name: 'Na emissão da nota' },
  { id: 'manual', name: 'Manualmente' },
];

const RECEIVE_WHEN = [
  { id: 'same_month', name: 'Mesmo mês' },
  { id: 'next_month', name: '1º dia do próximo mês' },
  { id: 'next_month_5th_bd', name: '5º dia útil do próximo mês' },
  { id: 'days_after', name: 'X dias depois' },
  { id: 'specific_date', name: 'Data específica' },
  { id: 'per_entry', name: 'Definir em cada lançamento' },
];

const CURRENCIES = [
  { id: 'BRL', name: 'R$ — Real Brasileiro' },
  { id: 'USD', name: 'US$ — Dólar' },
  { id: 'EUR', name: '€ — Euro' },
];

function catalog() {
  return { calcTypes: CALC_TYPES, appliedOn: APPLIED_ON, generatedWhen: GENERATED_WHEN, receiveWhen: RECEIVE_WHEN, currencies: CURRENCIES };
}

function labelOf(list, id) {
  return list.find((x) => x.id === id)?.name || id || '—';
}

function defaultConfig(calcType) {
  switch (calcType) {
    case 'fixed':
      return { amount: 0, per: 'entry' };
    case 'bands':
      return {
        appliedOn: 'entry_value',
        bandBasis: 'units',
        recalcMonth: true,
        mode: 'percent',
        bands: [{ min: 0, max: null, value: 0.5 }],
      };
    case 'prize':
      return { itemLabel: 'Valor do item' };
    case 'flex':
      return {
        recalcMonth: false,
        bands: [
          { min: 0, max: 3, percent: 0.5 },
          { min: 3, max: null, percent: 0.4 },
        ],
      };
    case 'quantity':
      return { amountPerUnit: 0, unitLabel: 'unidade' };
    case 'goal':
      return {
        basis: 'units',
        bands: [
          { min: 1, max: 4, percent: 0.3 },
          { min: 5, max: 7, percent: 0.4 },
          { min: 8, max: 10, percent: 0.55 },
          { min: 11, max: null, percent: 0.7 },
        ],
      };
    case 'percent':
    default:
      return { percent: 0.5, appliedOn: 'entry_value' };
  }
}

function inferBandBasis(config) {
  if (config.bandBasis === 'units' || config.bandBasis === 'revenue' || config.bandBasis === 'sale_value') {
    return config.bandBasis;
  }
  const caps = (config.bands || [])
    .map((b) => b.max)
    .filter((m) => m !== '' && m != null && Number.isFinite(Number(m)))
    .map(Number);
  if (caps.length && Math.max(...caps) <= 100) return 'units';
  return 'sale_value';
}

function sanitizeBands(raw, valueKey = 'value') {
  if (!Array.isArray(raw) || !raw.length) return [{ min: 0, max: null, [valueKey]: 0 }];
  return raw.slice(0, 20).map((b) => {
    const min = Number(b.min);
    const max = b.max === '' || b.max === null || b.max === undefined ? null : Number(b.max);
    const val = Number(b[valueKey] ?? b.percent ?? b.value ?? 0);
    return {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : null,
      [valueKey]: Number.isFinite(val) ? val : 0,
    };
  });
}

function normalizeConfig(calcType, config = {}) {
  const type = CALC_TYPES.some((t) => t.id === calcType) ? calcType : 'percent';
  const src = config && typeof config === 'object' ? config : {};
  switch (type) {
    case 'fixed':
      return {
        amount: Number(src.amount) || 0,
        per: src.per === 'unit' ? 'unit' : 'entry',
      };
    case 'bands': {
      const bandBasis = inferBandBasis(src);
      return {
        appliedOn: APPLIED_ON.some((a) => a.id === src.appliedOn) ? src.appliedOn : 'entry_value',
        bandBasis,
        recalcMonth: bandBasis === 'sale_value' ? false : src.recalcMonth !== false,
        mode: src.mode === 'fixed' ? 'fixed' : 'percent',
        bands: sanitizeBands(src.bands, 'value'),
      };
    }
    case 'prize':
      return {
        itemLabel: String(src.itemLabel || 'Valor do item').trim().slice(0, 40) || 'Valor do item',
      };
    case 'flex':
      return {
        recalcMonth: false,
        bands: sanitizeBands(src.bands, 'percent').map((b) => ({
          min: b.min,
          max: b.max,
          percent: b.percent,
        })),
      };
    case 'quantity':
      return {
        amountPerUnit: Number(src.amountPerUnit) || 0,
        unitLabel: String(src.unitLabel || 'unidade').slice(0, 40),
      };
    case 'goal':
      return {
        basis: src.basis === 'revenue' ? 'revenue' : 'units',
        bands: sanitizeBands(src.bands, 'percent').map((b) => ({
          min: b.min,
          max: b.max,
          percent: b.percent,
        })),
      };
    case 'percent':
    default:
      return {
        percent: Number(src.percent) || 0,
        appliedOn: APPLIED_ON.some((a) => a.id === src.appliedOn) ? src.appliedOn : 'entry_value',
      };
  }
}

function fmtPct(n) {
  const v = Number(n) || 0;
  return `${String(v).replace('.', ',')}%`;
}

function fmtMoney(n, currency = 'BRL') {
  try {
    return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency });
  } catch {
    return `R$ ${Number(n || 0).toFixed(2)}`;
  }
}

function highlight(calcType, config, currency = 'BRL') {
  if (calcType === 'percent') return fmtPct(config.percent);
  if (calcType === 'fixed') return fmtMoney(config.amount, currency);
  if (calcType === 'bands') {
    const n = (config.bands || []).length;
    return n ? `${n} faixa${n === 1 ? '' : 's'} configurada${n === 1 ? '' : 's'}` : 'Sem faixas';
  }
  if (calcType === 'quantity') {
    return `${fmtMoney(config.amountPerUnit, currency)} / ${config.unitLabel || 'un.'}`;
  }
  if (calcType === 'goal') {
    const n = (config.bands || []).length;
    return n ? `${n} faixa${n === 1 ? '' : 's'} configurada${n === 1 ? '' : 's'}` : 'Sem metas';
  }
  if (calcType === 'prize') return 'Informado no lançamento';
  if (calcType === 'flex') {
    const n = (config.bands || []).length;
    return n ? `${n} faixa${n === 1 ? '' : 's'} de flex` : 'Sem faixas';
  }
  return '—';
}

function mapRow(row, currency = 'BRL') {
  const calcType = row.calc_type;
  let config = JSON.parse(row.config_json || '{}');
  if (calcType === 'bands') {
    const bandBasis = inferBandBasis(config);
    config = {
      ...config,
      bandBasis,
      recalcMonth: bandBasis === 'sale_value' ? false : config.recalcMonth !== false,
    };
  }
  const typeMeta = CALC_TYPES.find((t) => t.id === calcType);
  return {
    id: row.id,
    name: row.name,
    calcType,
    typeLabel: typeMeta?.name || calcType,
    detail: typeMeta?.short || '',
    config,
    generatedWhen: row.generated_when,
    generatedLabel: labelOf(GENERATED_WHEN, row.generated_when),
    receiveWhen: row.receive_when,
    receiveLabel: labelOf(RECEIVE_WHEN, row.receive_when),
    receiveDays: row.receive_days,
    receiveDate: row.receive_date,
    highlight: highlight(calcType, config, currency),
    sortOrder: row.sort_order,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pickBandInclusive(bands, volume, valueKey) {
  const sorted = [...(bands || [])].sort((a, b) => (Number(a.min) || 0) - (Number(b.min) || 0));
  if (!sorted.length) return { min: 0, [valueKey]: 0 };
  const matches = sorted.filter((b) => {
    const min = Number(b.min) || 0;
    const max = b.max === '' || b.max == null ? null : Number(b.max);
    if (volume < min) return false;
    if (max != null && Number.isFinite(max) && volume > max) return false;
    return true;
  });
  if (!matches.length) return sorted[sorted.length - 1];
  matches.sort((a, b) => {
    const am = a.max == null || a.max === '' ? Infinity : Number(a.max);
    const bm = b.max == null || b.max === '' ? Infinity : Number(b.max);
    return am - bm;
  });
  return matches[0];
}

function flexPercentOfSale(grossValue, flexAmount, flexPercent) {
  if (flexPercent !== undefined && flexPercent !== null && flexPercent !== '') {
    const n = Number(flexPercent);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  const gross = Number(grossValue) || 0;
  const flex = Number(flexAmount) || 0;
  if (gross <= 0) return 0;
  return (flex / gross) * 100;
}

function pickBand(bands, volume, valueKey) {
  const sorted = [...(bands || [])].sort((a, b) => (Number(a.min) || 0) - (Number(b.min) || 0));
  if (!sorted.length) return { min: 0, [valueKey]: 0 };
  let picked = sorted[0];
  for (const b of sorted) {
    if (volume >= (Number(b.min) || 0)) picked = b;
  }
  return picked;
}

function baseAmount(appliedOn, grossValue, costValue) {
  const gross = Number(grossValue) || 0;
  const cost = Number(costValue) || 0;
  if (appliedOn === 'margin' || appliedOn === 'net_value') return Math.max(0, gross - cost);
  return gross;
}

/**
 * A faixa do mês (quantidade/faturamento) vale para todos os lançamentos do período.
 */
function usesMonthRecalc(type) {
  const calcType = type.calcType || type.calc_type;
  const config =
    type.config ||
    (typeof type.config_json === 'string' ? JSON.parse(type.config_json || '{}') : {});
  if (calcType === 'flex' || calcType === 'prize' || calcType === 'percent' || calcType === 'fixed' || calcType === 'quantity') {
    return false;
  }
  if (calcType === 'goal') return true;
  if (calcType === 'bands') {
    const basis = inferBandBasis(config);
    if (basis === 'sale_value') return false;
    return config.recalcMonth !== false;
  }
  return false;
}

function monthVolume(calcType, config, input = {}) {
  const includeCurrent = input.includeCurrent !== false;
  const monthCount = Number(input.monthCount) || 0;
  const monthRevenue = Number(input.monthRevenue) || 0;
  const gross = Number(input.grossValue) || 0;
  const units = includeCurrent ? monthCount + 1 : monthCount;
  const revenue = includeCurrent ? monthRevenue + gross : monthRevenue;
  if (calcType === 'goal') {
    return config.basis === 'revenue' ? revenue : units;
  }
  const basis = inferBandBasis(config);
  if (basis === 'units') return units;
  if (basis === 'revenue') return revenue;
  return baseAmount(config.appliedOn, gross, Number(input.costValue) || 0);
}

function calculateEntry(type, input = {}) {
  const calcType = type.calcType || type.calc_type;
  const config =
    type.config ||
    (typeof type.config_json === 'string' ? JSON.parse(type.config_json || '{}') : {});
  const gross = Number(input.grossValue) || 0;
  const qty = Math.max(1, Number(input.quantity) || 1);
  const cost = Number(input.costValue) || 0;
  const monthLadder = usesMonthRecalc({ calcType, config });

  let amount = 0;
  let note = '';
  let bandLabel = type.highlight || '';

  if (calcType === 'percent') {
    const base = baseAmount(config.appliedOn, gross, cost);
    amount = base * ((Number(config.percent) || 0) / 100);
    note = `${fmtPct(config.percent)} sobre o valor`;
    bandLabel = fmtPct(config.percent);
  } else if (calcType === 'fixed') {
    amount = (Number(config.amount) || 0) * (config.per === 'unit' ? qty : 1);
    note = config.per === 'unit' ? `Fixo × ${qty}` : 'Valor fixo por lançamento';
    bandLabel = fmtMoney(config.amount);
  } else if (calcType === 'bands') {
    const base = baseAmount(config.appliedOn, gross, cost);
    const basis = inferBandBasis(config);
    const vol = monthVolume(calcType, config, input);
    const band = pickBand(config.bands, vol, 'value');
    const basisNote = monthLadder
      ? `${vol} lançamento${vol === 1 ? '' : 's'} no mês · vale para todos`
      : basis === 'units'
        ? `${vol}º lançamento no mês`
        : basis === 'revenue'
          ? 'faturamento do mês'
          : 'valor desta venda';
    if (config.mode === 'fixed') {
      amount = Number(band.value) || 0;
      note = `Faixa ${basisNote}`;
      bandLabel = fmtMoney(band.value);
    } else {
      amount = base * ((Number(band.value) || 0) / 100);
      note = `${fmtPct(band.value)} · ${basisNote}`;
      bandLabel = fmtPct(band.value);
    }
  } else if (calcType === 'quantity') {
    amount = (Number(config.amountPerUnit) || 0) * qty;
    note = `${fmtMoney(config.amountPerUnit)} × ${qty} ${config.unitLabel || 'un.'}`;
    bandLabel = `${fmtMoney(config.amountPerUnit)} / ${config.unitLabel || 'un.'}`;
  } else if (calcType === 'goal') {
    const vol = monthVolume(calcType, config, input);
    const band = pickBand(config.bands, vol, 'percent');
    amount = gross * ((Number(band.percent) || 0) / 100);
    note = `${fmtPct(band.percent)} · ${vol} no mês · vale para todos`;
    bandLabel = fmtPct(band.percent);
  } else if (calcType === 'prize') {
    amount = Number(input.commissionAmount) || 0;
    note = 'Premiação lançada manualmente';
    bandLabel = 'Manual';
  } else if (calcType === 'flex') {
    const pctFlex = flexPercentOfSale(gross, input.flexAmount, input.flexPercent);
    const band = pickBandInclusive(config.bands, pctFlex, 'percent');
    amount = gross * ((Number(band.percent) || 0) / 100);
    note = `Flex ${fmtPct(round2(pctFlex))} da venda · comissão ${fmtPct(band.percent)}`;
    bandLabel = fmtPct(band.percent);
  }

  return { amount: round2(amount), note, bandLabel, monthLadder };
}

function resolveDueDate(type, saleDate, perEntryDate) {
  const when = type.receiveWhen || type.receive_when || 'next_month';
  const base = new Date(`${saleDate}T12:00:00`);
  if (Number.isNaN(base.getTime())) return saleDate;
  if (when === 'same_month') return saleDate;
  if (when === 'next_month') {
    base.setMonth(base.getMonth() + 1);
    base.setDate(1);
    return base.toISOString().slice(0, 10);
  }
  if (when === 'next_month_5th_bd') {
    return fifthBusinessDayNextMonth(saleDate);
  }
  if (when === 'days_after') {
    const days = Number(type.receiveDays ?? type.receive_days) || 0;
    base.setDate(base.getDate() + days);
    return base.toISOString().slice(0, 10);
  }
  if (when === 'specific_date') {
    return type.receiveDate || type.receive_date || saleDate;
  }
  if (when === 'per_entry') return perEntryDate || saleDate;
  return saleDate;
}

function validatePayload(body) {
  const name = String(body?.name || '').trim();
  if (!name) return { error: 'Informe o nome da comissão.' };
  if (name.length > 80) return { error: 'Nome deve ter no máximo 80 caracteres.' };

  const calcType = CALC_TYPES.some((t) => t.id === body.calcType) ? body.calcType : null;
  if (!calcType) return { error: 'Tipo de cálculo inválido.' };

  const generatedWhen = GENERATED_WHEN.some((g) => g.id === body.generatedWhen)
    ? body.generatedWhen
    : 'on_entry';
  const receiveWhen = RECEIVE_WHEN.some((r) => r.id === body.receiveWhen)
    ? body.receiveWhen
    : 'next_month';

  let receiveDays = null;
  let receiveDate = null;
  if (receiveWhen === 'days_after') {
    receiveDays = Number(body.receiveDays);
    if (!Number.isFinite(receiveDays) || receiveDays < 0) {
      return { error: 'Informe quantos dias depois você recebe.' };
    }
  }
  if (receiveWhen === 'specific_date') {
    receiveDate = String(body.receiveDate || '').slice(0, 10);
    if (!receiveDate) return { error: 'Informe a data específica de recebimento.' };
  }

  const config = normalizeConfig(calcType, body.config);
  if (calcType === 'percent' && !(config.percent >= 0)) {
    return { error: 'Informe o percentual da comissão.' };
  }

  return {
    name,
    calcType,
    config,
    generatedWhen,
    receiveWhen,
    receiveDays,
    receiveDate,
  };
}

module.exports = {
  CALC_TYPES,
  APPLIED_ON,
  GENERATED_WHEN,
  RECEIVE_WHEN,
  CURRENCIES,
  catalog,
  defaultConfig,
  normalizeConfig,
  mapRow,
  validatePayload,
  labelOf,
  calculateEntry,
  resolveDueDate,
  round2,
  inferBandBasis,
  usesMonthRecalc,
};
