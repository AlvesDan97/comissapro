const { v4: uuid } = require('uuid');
const { DEFAULT_RULES } = require('./services/commissionEngine');
const { mapRow, calculateEntry, resolveDueDate, usesMonthRecalc } = require('./services/commissionTypes');
const { healUserMonth } = require('./services/monthLadder');

const FROM = '2026-01-01';
const TODAY = new Date().toISOString().slice(0, 10);

const VEHICLES = [
  'Ranger XLT', 'Ranger Limited', 'Territory Titanium', 'Bronco Sport', 'Maverick Lariat',
  'Onix LTZ', 'Tracker Premier', 'S10 LTZ', 'Spin Premier', 'Equinox Premier',
  'Pulse Audace', 'Fastback Limited', 'Toro Volcano', 'Strada Ultra', 'Argo Trekking',
  'T-Cross Highline', 'Nivus Highline', 'Polo Track', 'Virtus Highline', 'Saveiro Extreme',
  'Kicks Exclusive', 'Versa Exclusive', 'Compass Limited', 'Renegade Longitude', 'Commander Limited',
];
const FIRST = ['Paulo', 'Tatiana', 'Diego', 'Luciana', 'Rafael', 'Amanda', 'Sérgio', 'Fernanda', 'Marcos', 'Camila', 'Bruno', 'Juliana', 'André', 'Patrícia', 'Fábio', 'Helena', 'Ricardo', 'Beatriz', 'Gustavo', 'Larissa'];
const LAST = ['Nogueira', 'Lima', 'Martins', 'Ferreira', 'Alves', 'Costa', 'Dias', 'Rocha', 'Andrade', 'Mendes', 'Silva', 'Oliveira', 'Souza', 'Pereira', 'Gomes', 'Barbosa', 'Cardoso', 'Teixeira', 'Araujo', 'Moreira'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function lerp(rand, min, max) {
  return min + rand() * (max - min);
}
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDaysYmd(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d);
}
function eachDay(from, to) {
  const days = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    days.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
function season(month) {
  const m = Number(month.slice(5, 7));
  if (m === 1) return 0.55;
  if (m === 2) return 0.75;
  if (m === 3 || m === 4) return 1;
  if (m === 5) return 1.1;
  if (m === 6 || m === 7) return 1.25;
  if (m === 8) return 0.95;
  return 1;
}

async function ensureStore(db, userId, name) {
  const existing = await db.get(
    'SELECT * FROM stores WHERE user_id=? AND active=1 ORDER BY created_at ASC LIMIT 1',
    [userId]
  );
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = uuid();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  await db.run(
    `INSERT INTO stores (id, user_id, name, color, logo_initials, payment_days, rule_type, rule_json, created_at, updated_at)
     VALUES (?, ?, ?, '#3FDA9A', ?, 30, 'fixed', ?, ?, ?)`,
    [id, userId, name, initials || 'GE', JSON.stringify(DEFAULT_RULES.fixed), now, now]
  );
  return db.get('SELECT * FROM stores WHERE id=?', [id]);
}

async function monthStats(db, ws, typeId, saleDate, sellerId) {
  const month = saleDate.slice(0, 7);
  const row = await db.get(
    `SELECT COUNT(*) as c, COALESCE(SUM(gross_value),0) as revenue
     FROM sales WHERE user_id=? AND commission_type_id=? AND substr(sale_date,1,7)=? AND status!='cancelada'
       AND COALESCE(seller_id, user_id)=?`,
    [ws, typeId, month, sellerId]
  );
  return { monthCount: Number(row?.c) || 0, monthRevenue: Number(row?.revenue) || 0 };
}

function recStatus(dueDate, rand) {
  if (dueDate > TODAY) return { status: 'previsto', paidDate: null, saleStatus: 'pendente' };
  if (dueDate === TODAY) {
    return rand() < 0.45
      ? { status: 'previsto', paidDate: null, saleStatus: 'pendente' }
      : { status: 'quitado', paidDate: TODAY, saleStatus: 'quitada' };
  }
  const recent = dueDate >= addDaysYmd(TODAY, -20);
  const lateChance = recent ? 0.32 : 0.05;
  if (rand() < lateChance) return { status: 'atrasado', paidDate: null, saleStatus: 'pendente' };
  const paid = addDaysYmd(dueDate, Math.floor(rand() * 5));
  return { status: 'quitado', paidDate: paid > TODAY ? TODAY : paid, saleStatus: 'quitada' };
}

async function insertSale(db, { ws, storeId, sellerId, type, saleDate, gross, qty, prize, flexPercent, cancelled, rand }) {
  const stats = await monthStats(db, ws, type.id, saleDate, sellerId);
  const calc = cancelled
    ? { amount: 0, note: 'Cancelada', bandLabel: '—' }
    : calculateEntry(type, {
        grossValue: gross,
        quantity: qty,
        commissionAmount: prize,
        flexPercent,
        ...stats,
      });
  const now = `${saleDate}T${String(10 + Math.floor(rand() * 8)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00.000Z`;
  const id = uuid();
  const vehicle = pick(rand, VEHICLES);
  const client = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
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
  const saleStatus = cancelled ? 'cancelada' : 'pendente';
  const notes = rand() < 0.12 ? pick(rand, ['Financiado', 'À vista', 'Troca + volta', 'PCD', 'Frotista', 'Consórcio']) : null;
  await db.run(
    `INSERT INTO sales (
      id, user_id, store_id, lead_id, title, client_name, status, sale_date,
      gross_value, accessories_value, extras_value, niche_fields, split_enabled,
      split_partner, split_percent, rule_version_id, commission_type_id, snapshot_json,
      commission_official, commission_extra, commission_total, notes, created_at, updated_at, seller_id
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, 0, NULL, 0, NULL, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      id,
      ws,
      storeId,
      vehicle,
      client,
      saleStatus,
      saleDate,
      gross,
      JSON.stringify({
        quantity: qty,
        cost: 0,
        vehicle,
        flexPercent: flexPercent || 0,
        commissionAmount: prize || 0,
      }),
      type.id,
      JSON.stringify(snapshot),
      calc.amount,
      calc.amount,
      notes,
      now,
      now,
      sellerId,
    ]
  );
  if (cancelled) return { month: saleDate.slice(0, 7) };
  const due = resolveDueDate(type, saleDate);
  await db.run(
    `INSERT INTO receivables (id, sale_id, user_id, label, amount, kind, due_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'oficial', ?, 'previsto', ?, ?)`,
    [uuid(), id, ws, type.name, calc.amount, due, now, now]
  );
  return { month: saleDate.slice(0, 7) };
}

async function settleWorkspace(db, ws, rand) {
  const recs = await db.all(
    `SELECT r.id, r.due_date, r.sale_id FROM receivables r
     JOIN sales s ON s.id = r.sale_id
     WHERE r.user_id=? AND s.status!='cancelada' AND r.status='previsto'`,
    [ws]
  );
  const now = new Date().toISOString();
  for (const rec of recs) {
    const st = recStatus(rec.due_date, rand);
    await db.run(`UPDATE receivables SET status=?, paid_date=?, updated_at=? WHERE id=?`, [
      st.status,
      st.paidDate,
      now,
      rec.id,
    ]);
    if (st.saleStatus === 'quitada') {
      await db.run(`UPDATE sales SET status='quitada', updated_at=? WHERE id=?`, [now, rec.sale_id]);
    }
  }
}

function byName(types, name) {
  return types.find((t) => t.name === name) || types[0];
}

async function generateFor(db, { ownerEmail, storeName, actors, extraLeads }) {
  const owner = await db.get('SELECT * FROM users WHERE email=?', [ownerEmail]);
  if (!owner) throw new Error(`Usuário ausente: ${ownerEmail}`);
  const ws = owner.workspace_id || owner.id;
  const store = await ensureStore(db, ws, storeName);
  const typeRows = await db.all('SELECT * FROM commission_types WHERE user_id=? AND active=1', [ws]);
  const types = typeRows.map((r) => mapRow(r));
  if (!types.length) throw new Error(`Sem comissões em ${ownerEmail}`);

  const rand = rng(
    ownerEmail.split('').reduce((s, c) => s + c.charCodeAt(0), 2026)
  );
  const sellerByEmail = {};
  for (const actor of actors) {
    sellerByEmail[actor.email] = await db.get('SELECT * FROM users WHERE email=?', [actor.email]);
  }

  for (const day of eachDay(FROM, TODAY)) {
    const dow = new Date(`${day}T12:00:00`).getDay();
    if (dow === 0) continue;
    const factor = season(day) * (dow === 6 ? 0.35 : 1);
    for (const actor of actors) {
      const seller = sellerByEmail[actor.email];
      if (!seller) continue;
      const expected = actor.perDay * factor;
      let n = Math.floor(expected);
      if (rand() < expected - n) n += 1;
      if (dow === 1 && rand() < 0.25) n += 1;
      for (let i = 0; i < n; i++) {
        const roll = rand();
        let type = types[0];
        let acc = 0;
        for (const [name, w] of actor.mix) {
          acc += w;
          if (roll <= acc) {
            type = byName(types, name);
            break;
          }
        }
        const ticket = round2(lerp(rand, actor.ticket[0], actor.ticket[1]));
        const cancelled = rand() < 0.03;
        await insertSale(db, {
          ws,
          storeId: store.id,
          sellerId: seller.id,
          type,
          saleDate: day,
          gross: ticket,
          qty: 1,
          prize: type.calcType === 'prize' ? round2(lerp(rand, 180, 900)) : 0,
          flexPercent: type.calcType === 'flex' ? round2(lerp(rand, 0.5, 6)) : 0,
          cancelled,
          rand,
        });
      }
    }
  }

  const months = new Set(eachDay(FROM, TODAY).map((d) => d.slice(0, 7)));
  for (const month of months) {
    await healUserMonth(ws, `${month}-15`);
  }
  await settleWorkspace(db, ws, rand);
  await db.run("UPDATE leads SET store_id=? WHERE user_id=? AND (store_id IS NULL OR store_id='')", [
    store.id,
    ws,
  ]);

  for (const lead of extraLeads || []) {
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO leads (id, user_id, store_id, title, client_name, value, probability, stage, niche_fields, expected_close, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
      [
        uuid(),
        ws,
        store.id,
        lead.title,
        lead.client,
        lead.value,
        lead.probability,
        lead.stage,
        lead.close,
        lead.notes,
        now,
        now,
      ]
    );
  }

  const stats = await db.get(
    `SELECT COUNT(*) as c, COALESCE(SUM(commission_total),0) as comm, COALESCE(SUM(gross_value),0) as rev
     FROM sales WHERE user_id=? AND status!='cancelada'`,
    [ws]
  );
  return { email: ownerEmail, sales: Number(stats.c) || 0, commission: round2(stats.comm), revenue: round2(stats.rev) };
}

async function addGoal(db, ws, sellerId, name, month, target) {
  const start = `${month}-01`;
  const endDate = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
  const end = ymd(endDate);
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO goals (id, workspace_id, seller_id, commission_type_id, period_type, period_start, period_end, metric, target, name, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'month', ?, ?, 'commission', ?, ?, ?, ?)`,
    [uuid(), ws, sellerId || null, start, end, target, name, now, now]
  );
}

async function generateScenarioData(db) {
  const solo = await generateFor(db, {
    ownerEmail: 'solo.teste@exemplo.com',
    storeName: 'Ana Solo',
    actors: [
      {
        email: 'solo.teste@exemplo.com',
        perDay: 0.45,
        ticket: [72000, 230000],
        mix: [
          ['Comissão principal', 0.72],
          ['Premiação mensal', 1],
        ],
      },
    ],
    extraLeads: [
      { title: 'Territory Titanium', client: 'R. Campos', value: 198000, probability: 65, stage: 'proposta', close: '2026-08-25', notes: 'Aguardando simulação' },
      { title: 'Troca Onix 2023', client: 'L. Duarte', value: 89000, probability: 45, stage: 'lead', close: '2026-09-04', notes: 'Primeiro contato' },
    ],
  });

  const pro = await generateFor(db, {
    ownerEmail: 'pro.teste@exemplo.com',
    storeName: 'Pro Motors',
    actors: [
      {
        email: 'pro.teste@exemplo.com',
        perDay: 0.55,
        ticket: [80000, 245000],
        mix: [
          ['Comissão principal', 0.68],
          ['Documentação', 1],
        ],
      },
      {
        email: 'pro.parceiro@exemplo.com',
        perDay: 0.28,
        ticket: [70000, 190000],
        mix: [
          ['Comissão principal', 0.8],
          ['Documentação', 1],
        ],
      },
    ],
    extraLeads: [
      { title: 'Frota prefeitura', client: 'Prefeitura Norte', value: 890000, probability: 40, stage: 'negociacao', close: '2026-09-10', notes: 'Licita em setembro' },
      { title: 'Troca Ranger 2022', client: 'H. Castro', value: 175000, probability: 70, stage: 'proposta', close: '2026-08-22', notes: 'Aguardando avaliação' },
      { title: 'Onix Plus PCD', client: 'M. Ribeiro', value: 92000, probability: 55, stage: 'lead', close: '2026-08-28', notes: 'Enviar tabela PCD' },
    ],
  });

  const time = await generateFor(db, {
    ownerEmail: 'time.teste@exemplo.com',
    storeName: 'Time Auto',
    actors: [
      {
        email: 'time.teste@exemplo.com',
        perDay: 0.22,
        ticket: [90000, 260000],
        mix: [
          ['Comissão principal', 0.55],
          ['Meta do mês', 0.8],
          ['Flexibilização', 1],
        ],
      },
      {
        email: 'time.editor@exemplo.com',
        perDay: 0.62,
        ticket: [75000, 220000],
        mix: [
          ['Comissão principal', 0.45],
          ['Meta do mês', 0.78],
          ['Flexibilização', 1],
        ],
      },
    ],
    extraLeads: [
      { title: 'Locadora Sul', client: 'Locadora Sul', value: 1350000, probability: 35, stage: 'negociacao', close: '2026-10-01', notes: 'Contrato anual' },
      { title: 'Compass Limited', client: 'V. Prado', value: 198000, probability: 80, stage: 'fechado', close: '2026-08-12', notes: 'Aguardando emplacamento' },
    ],
  });

  const carla = await db.get('SELECT * FROM users WHERE email=?', ['time.teste@exemplo.com']);
  const diego = await db.get('SELECT * FROM users WHERE email=?', ['time.editor@exemplo.com']);
  const bruno = await db.get('SELECT * FROM users WHERE email=?', ['pro.teste@exemplo.com']);
  const ana = await db.get('SELECT * FROM users WHERE email=?', ['solo.teste@exemplo.com']);
  for (const month of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
    if (ana) await addGoal(db, ana.id, null, `Meta ${month.slice(5)}/26`, month, 4500);
    if (bruno) await addGoal(db, bruno.id, null, `Meta da casa ${month.slice(5)}/26`, month, 8000);
    if (carla) {
      await addGoal(db, carla.id, null, `Meta do time ${month.slice(5)}/26`, month, 14000);
      if (diego) await addGoal(db, carla.id, diego.id, `Meta Diego ${month.slice(5)}/26`, month, 9000);
    }
  }

  return [solo, pro, time];
}

module.exports = { generateScenarioData, FROM, TODAY };
