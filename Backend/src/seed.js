const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('./db');
const { DEFAULT_RULES, calculateCommission } = require('./services/commissionEngine');

async function clearAll() {
  const tables = [
    'reconciliation_items',
    'reconciliations',
    'receivables',
    'sales',
    'leads',
    'commission_rule_versions',
    'commission_types',
    'stores',
    'team_members',
    'audit_logs',
    'offline_queue',
    'users',
  ];
  for (const t of tables) {
    await db.run(`DELETE FROM ${t}`);
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  await db.init();
  await clearAll();

  const now = new Date().toISOString();
  const userId = uuid();
  const password_hash = bcrypt.hashSync('demo1234', 12);

  await db.run(
    `INSERT INTO users (id, email, password_hash, name, niche, multi_store, onboarding_done, twofa_enabled, biometry_enabled, theme, plan, billing_cycle, plan_status, plan_started_at, accepted_terms_at, accepted_privacy_at, profession, company, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'automotivo', 1, 1, 0, 1, 'dark', 'pro', 'monthly', 'active', ?, ?, ?, 'Consultora de Vendas', 'Ford Sul / Chevrolet Norte', 'BRL', ?, ?)`,
    [userId, 'marina.souza@exemplo.com', password_hash, 'Marina Souza', now, now, now, now, now]
  );

  const storesDef = [
    {
      name: 'Concessionária Ford Sul',
      color: '#3FDA9A',
      cnpj: '12.345.678/0001-90',
      ruleType: 'bands',
      rule: DEFAULT_RULES.bands,
    },
    {
      name: 'Chevrolet Norte',
      color: '#F0605C',
      cnpj: '98.765.432/0001-10',
      ruleType: 'fixed',
      rule: { percent: 0.0035, extraBonus: 0 },
    },
    {
      name: 'Fiat Vale Motors',
      color: '#E8A33D',
      cnpj: '11.222.333/0001-44',
      ruleType: 'bands',
      rule: {
        volumeBasis: 'units',
        bands: [
          { min: 1, max: 3, percent: 0.0025 },
          { min: 4, max: 6, percent: 0.0035 },
          { min: 7, max: null, percent: 0.005 },
        ],
        extraBonus: 0,
      },
    },
  ];

  const storeIds = {};
  for (const s of storesDef) {
    const id = uuid();
    storeIds[s.name] = id;
    const initials = s.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
    await db.run(
      `INSERT INTO stores (id, user_id, name, cnpj, color, logo_initials, payment_days, rule_type, rule_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 30, ?, ?, ?, ?)`,
      [id, userId, s.name, s.cnpj, s.color, initials, s.ruleType, JSON.stringify(s.rule), now, now]
    );
    await db.run(
      `INSERT INTO commission_rule_versions (id, store_id, user_id, rule_type, rule_json, effective_from, created_at)
       VALUES (?, ?, ?, ?, ?, '2026-01-01', ?)`,
      [uuid(), id, userId, s.ruleType, JSON.stringify(s.rule), now]
    );
  }

  const demoSales = [
    { store: 'Concessionária Ford Sul', title: 'Ford Ranger XLT 2026', client: 'P. Nogueira', date: daysAgo(2), value: 210000, status: 'pendente', extra: 150, fields: { vehicle: 'Ford Ranger XLT 2026', origin: 'Estoque', protect: 3400, armor: true } },
    { store: 'Concessionária Ford Sul', title: 'EcoSport SE 2025', client: 'T. Lima', date: daysAgo(8), value: 98000, status: 'quitada', extra: 0, fields: { vehicle: 'EcoSport SE 2025', origin: 'Estoque' } },
    { store: 'Chevrolet Norte', title: 'Onix LTZ 2026', client: 'D. Martins', date: daysAgo(12), value: 88000, status: 'quitada', extra: 80, fields: { vehicle: 'Onix LTZ 2026', origin: 'Venda direta' } },
    { store: 'Fiat Vale Motors', title: 'Ka Sedan SE', client: 'L. Ferreira', date: daysAgo(18), value: 76000, status: 'cancelada', extra: 0, fields: { vehicle: 'Ka Sedan SE' } },
    { store: 'Concessionária Ford Sul', title: 'Territory Titanium', client: 'R. Alves', date: daysAgo(22), value: 189000, status: 'quitada', extra: 200, fields: { vehicle: 'Territory Titanium', origin: 'Estoque' } },
    { store: 'Concessionária Ford Sul', title: 'Bronco Sport', client: 'A. Costa', date: daysAgo(4), value: 245000, status: 'pendente', extra: 0, fields: { vehicle: 'Bronco Sport', origin: 'Venda direta' } },
    { store: 'Chevrolet Norte', title: 'Tracker Premier', client: 'M. Dias', date: daysAgo(6), value: 152000, status: 'pendente', extra: 100, fields: { vehicle: 'Tracker Premier' } },
    { store: 'Concessionária Ford Sul', title: 'Maverick Lariat', client: 'S. Rocha', date: daysAgo(40), value: 198000, status: 'quitada', extra: 120, fields: { vehicle: 'Maverick Lariat', origin: 'Estoque' } },
    { store: 'Fiat Vale Motors', title: 'Pulse Audace', client: 'F. Andrade', date: daysAgo(55), value: 112000, status: 'quitada', extra: 0, fields: { vehicle: 'Pulse Audace' } },
  ];

  const volumeCounter = {};
  for (const s of demoSales) {
    const storeId = storeIds[s.store];
    const store = await db.get('SELECT * FROM stores WHERE id=?', [storeId]);
    const key = `${storeId}:${s.date.slice(0, 7)}`;
    if (s.status !== 'cancelada') volumeCounter[key] = (volumeCounter[key] || 0) + 1;
    const vol = volumeCounter[key] || 0;
    const rule = JSON.parse(store.rule_json);
    const calc =
      s.status === 'cancelada'
        ? { commissionOfficial: 0, commissionExtra: 0, bandLabel: '—', engineNote: 'Cancelada' }
        : calculateCommission({
            ruleType: store.rule_type,
            rule,
            grossValue: s.value,
            monthlyVolume: vol,
          });

    const id = uuid();
    const snapshot = {
      ruleType: store.rule_type,
      rule,
      effectiveFrom: '2026-01-01',
      bandLabel: calc.bandLabel,
      engineNote: calc.engineNote,
      calculatedAt: now,
      monthlyVolumeAtSale: vol,
    };

    await db.run(
      `INSERT INTO sales (
        id, user_id, store_id, title, client_name, status, sale_date, gross_value,
        accessories_value, extras_value, niche_fields, split_enabled, split_percent,
        snapshot_json, commission_official, commission_extra, commission_total, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        storeId,
        s.title,
        s.client,
        s.status,
        s.date,
        s.value,
        JSON.stringify(s.fields),
        JSON.stringify(snapshot),
        calc.commissionOfficial,
        s.extra,
        calc.commissionOfficial + s.extra,
        now,
        now,
      ]
    );

    if (s.status !== 'cancelada') {
      const due = new Date(s.date);
      due.setDate(due.getDate() + 30);
      const dueStr = due.toISOString().slice(0, 10);
      await db.run(
        `INSERT INTO receivables (id, sale_id, user_id, label, amount, kind, due_date, paid_date, status, created_at, updated_at)
         VALUES (?, ?, ?, 'Comissão oficial', ?, 'oficial', ?, ?, ?, ?, ?)`,
        [
          uuid(),
          id,
          userId,
          calc.commissionOfficial,
          dueStr,
          s.status === 'quitada' ? s.date : null,
          s.status === 'quitada' ? 'quitado' : 'previsto',
          now,
          now,
        ]
      );
      if (s.extra > 0) {
        await db.run(
          `INSERT INTO receivables (id, sale_id, user_id, label, amount, kind, due_date, paid_date, status, created_at, updated_at)
           VALUES (?, ?, ?, 'Comissão por fora', ?, 'por_fora', ?, ?, ?, ?, ?)`,
          [
            uuid(),
            id,
            userId,
            s.extra,
            dueStr,
            s.status === 'quitada' ? s.date : null,
            s.status === 'quitada' ? 'quitado' : 'previsto',
            now,
            now,
          ]
        );
      }
    }
  }

  await db.run(
    `INSERT INTO leads (id, user_id, store_id, title, client_name, value, probability, stage, niche_fields, expected_close, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'Cliente interessado em Territory', 'J. Mendes', 195000, 70, 'proposta', '{}', ?, 'Retornar quinta', ?, ?)`,
    [uuid(), userId, storeIds['Concessionária Ford Sul'], daysAgo(-10), now, now]
  );

  await db.run(
    `INSERT INTO team_members (id, owner_user_id, email, name, role, status, created_at)
     VALUES (?, ?, 'parceiro@exemplo.com', 'Carlos Split', 'editor', 'accepted', ?)`,
    [uuid(), userId, now]
  );

  const demoCommissions = [
    {
      name: 'Comissão principal',
      calcType: 'percent',
      config: { percent: 0.5, appliedOn: 'entry_value' },
      generatedWhen: 'on_entry',
      receiveWhen: 'next_month',
    },
    {
      name: 'Documentação',
      calcType: 'bands',
      config: {
        appliedOn: 'entry_value',
        mode: 'percent',
        bands: [
          { min: 0, max: 80000, value: 0.2 },
          { min: 80000, max: 150000, value: 0.35 },
          { min: 150000, max: null, value: 0.5 },
        ],
      },
      generatedWhen: 'on_entry',
      receiveWhen: 'next_month',
    },
    {
      name: 'Acessórios',
      calcType: 'goal',
      config: {
        basis: 'units',
        bands: [
          { min: 1, max: 4, percent: 0.3 },
          { min: 5, max: 7, percent: 0.4 },
          { min: 8, max: 10, percent: 0.55 },
          { min: 11, max: null, percent: 0.7 },
        ],
      },
      generatedWhen: 'on_entry',
      receiveWhen: 'next_month',
    },
  ];

  for (let i = 0; i < demoCommissions.length; i++) {
    const c = demoCommissions[i];
    await db.run(
      `INSERT INTO commission_types (
        id, user_id, name, calc_type, config_json, generated_when,
        receive_when, receive_days, receive_date, sort_order, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?)`,
      [
        uuid(),
        userId,
        c.name,
        c.calcType,
        JSON.stringify(c.config),
        c.generatedWhen,
        c.receiveWhen,
        i,
        now,
        now,
      ]
    );
  }

  console.log('Seed OK');
  console.log('Login: marina.souza@exemplo.com / demo1234');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
