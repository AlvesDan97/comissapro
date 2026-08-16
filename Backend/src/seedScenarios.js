/**
 * Contas de teste: Solo, Pro e Time (não apaga o resto do banco).
 * Senha de todos: ComissTest1
 */
require('./loadEnv');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('./db');

const PASSWORD = 'ComissTest1';
const TEST_EMAILS = [
  'solo.teste@exemplo.com',
  'pro.teste@exemplo.com',
  'pro.parceiro@exemplo.com',
  'time.teste@exemplo.com',
  'time.editor@exemplo.com',
  'time.viewer@exemplo.com',
];

function addDays(iso, days) {
  const d = new Date(iso || Date.now());
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function wipeByEmails(emails) {
  const rows = await db.all(
    `SELECT id FROM users WHERE email IN (${emails.map(() => '?').join(',')})`,
    emails
  );
  for (const row of rows) {
    const id = row.id;
    await db.run('DELETE FROM receivables WHERE user_id=?', [id]);
    await db.run('DELETE FROM sales WHERE user_id=?', [id]);
    await db.run('DELETE FROM leads WHERE user_id=?', [id]);
    await db.run('DELETE FROM commission_rule_versions WHERE user_id=?', [id]);
    await db.run('DELETE FROM commission_types WHERE user_id=?', [id]);
    await db.run('DELETE FROM stores WHERE user_id=?', [id]);
    await db.run('DELETE FROM team_members WHERE owner_user_id=? OR member_user_id=?', [id, id]);
    await db.run('DELETE FROM notifications WHERE user_id=?', [id]);
    await db.run('DELETE FROM followups WHERE workspace_id=? OR seller_id=?', [id, id]);
    await db.run('DELETE FROM goals WHERE workspace_id=? OR seller_id=?', [id, id]);
    await db.run('DELETE FROM audit_logs WHERE user_id=?', [id]);
    await db.run('DELETE FROM users WHERE id=?', [id]);
  }
}

async function insertOwner({ email, name, plan, profession, company, extraSeats = 0 }) {
  const started = '2026-01-01T12:00:00.000Z';
  const now = new Date().toISOString();
  const id = uuid();
  const hash = bcrypt.hashSync(PASSWORD, 12);
  await db.run(
    `INSERT INTO users (
      id, email, password_hash, name, niche, multi_store, onboarding_done,
      twofa_enabled, biometry_enabled, theme, plan, billing_cycle, plan_status,
      plan_started_at, trial_ends_at, workspace_id, workspace_role, extra_seats,
      accepted_terms_at, accepted_privacy_at, email_verified_at, email_confirm_token,
      profession, company, currency, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'automotivo', ?, 1, 0, 0, 'dark', ?, 'monthly', 'active', ?, ?, ?, 'owner', ?, ?, ?, ?, NULL, ?, ?, 'BRL', ?, ?)`,
    [
      id,
      email,
      hash,
      name,
      plan === 'solo' ? 0 : 1,
      plan,
      started,
      addDays(started, 30),
      id,
      extraSeats,
      started,
      started,
      started,
      profession,
      company,
      started,
      now,
    ]
  );
  return id;
}

async function insertMember({ email, name, ownerId, role, plan, planStatus, planStarted, trialEnds }) {
  const now = new Date().toISOString();
  const id = uuid();
  await db.run(
    `INSERT INTO users (
      id, email, password_hash, name, plan, billing_cycle, plan_status, plan_started_at,
      trial_ends_at, workspace_id, workspace_role, onboarding_done, accepted_terms_at,
      accepted_privacy_at, email_verified_at, email_confirm_token, profession, currency, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'monthly', ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, 'BRL', ?, ?)`,
    [
      id,
      email,
      bcrypt.hashSync(PASSWORD, 12),
      name,
      plan,
      planStatus,
      planStarted,
      trialEnds,
      ownerId,
      role,
      now,
      now,
      now,
      role === 'editor' ? 'Vendedor' : 'Consultor',
      now,
      now,
    ]
  );
  await db.run(
    `INSERT INTO team_members (id, owner_user_id, email, name, role, status, member_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?)`,
    [uuid(), ownerId, email, name, role, id, now]
  );
  return id;
}

async function addCommission(userId, spec, sort) {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO commission_types (
      id, user_id, name, calc_type, config_json, generated_when,
      receive_when, receive_days, receive_date, sort_order, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'on_entry', 'next_month', NULL, NULL, ?, 1, ?, ?)`,
    [uuid(), userId, spec.name, spec.calcType, JSON.stringify(spec.config), sort, now, now]
  );
}

async function addLead(userId, title, client, value) {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO leads (id, user_id, store_id, title, client_name, value, probability, stage, niche_fields, expected_close, notes, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, 60, 'proposta', '{}', NULL, 'Lead de teste', ?, ?)`,
    [uuid(), userId, title, client, value, now, now]
  );
}

async function main() {
  await db.init();
  await wipeByEmails(TEST_EMAILS);

  const soloId = await insertOwner({
    email: 'solo.teste@exemplo.com',
    name: 'Ana Solo',
    plan: 'solo',
    profession: 'Vendedora autônoma',
    company: 'Ana Solo',
  });
  await addCommission(
    soloId,
    { name: 'Comissão principal', calcType: 'percent', config: { percent: 0.5, appliedOn: 'entry_value' } },
    0
  );
  await addCommission(
    soloId,
    { name: 'Premiação mensal', calcType: 'prize', config: { itemLabel: 'Valor do veículo' } },
    1
  );

  const proId = await insertOwner({
    email: 'pro.teste@exemplo.com',
    name: 'Bruno Pro',
    plan: 'pro',
    profession: 'Consultor de vendas',
    company: 'Pro Motors',
  });
  const proOwner = await db.get('SELECT * FROM users WHERE id=?', [proId]);
  await addCommission(
    proId,
    { name: 'Comissão principal', calcType: 'percent', config: { percent: 0.5, appliedOn: 'entry_value' } },
    0
  );
  await addCommission(
    proId,
    {
      name: 'Documentação',
      calcType: 'bands',
      config: {
        appliedOn: 'entry_value',
        bandBasis: 'sale_value',
        recalcMonth: false,
        mode: 'percent',
        bands: [
          { min: 0, max: 80000, value: 0.2 },
          { min: 80000, max: 150000, value: 0.35 },
          { min: 150000, max: null, value: 0.5 },
        ],
      },
    },
    1
  );
  await addLead(proId, 'Cliente Territory', 'J. Mendes', 195000);
  await insertMember({
    email: 'pro.parceiro@exemplo.com',
    name: 'Paula Parceira',
    ownerId: proId,
    role: 'editor',
    plan: 'pro',
    planStatus: proOwner.plan_status,
    planStarted: proOwner.plan_started_at,
    trialEnds: proOwner.trial_ends_at,
  });

  const timeId = await insertOwner({
    email: 'time.teste@exemplo.com',
    name: 'Carla Time',
    plan: 'time',
    profession: 'Gerente comercial',
    company: 'Time Auto',
    extraSeats: 0,
  });
  const timeOwner = await db.get('SELECT * FROM users WHERE id=?', [timeId]);
  await addCommission(
    timeId,
    { name: 'Comissão principal', calcType: 'percent', config: { percent: 0.5, appliedOn: 'entry_value' } },
    0
  );
  await addCommission(
    timeId,
    {
      name: 'Meta do mês',
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
    },
    1
  );
  await addCommission(
    timeId,
    {
      name: 'Flexibilização',
      calcType: 'flex',
      config: {
        recalcMonth: false,
        bands: [
          { min: 0, max: 3, percent: 0.5 },
          { min: 3, max: null, percent: 0.4 },
        ],
      },
    },
    2
  );
  await addLead(timeId, 'Frota empresa XYZ', 'Empresa XYZ', 420000);
  await insertMember({
    email: 'time.editor@exemplo.com',
    name: 'Diego Lançador',
    ownerId: timeId,
    role: 'editor',
    plan: 'time',
    planStatus: timeOwner.plan_status,
    planStarted: timeOwner.plan_started_at,
    trialEnds: timeOwner.trial_ends_at,
  });
  await insertMember({
    email: 'time.viewer@exemplo.com',
    name: 'Eva Visualiza',
    ownerId: timeId,
    role: 'viewer',
    plan: 'time',
    planStatus: timeOwner.plan_status,
    planStarted: timeOwner.plan_started_at,
    trialEnds: timeOwner.trial_ends_at,
  });

  const { generateScenarioData } = require('./seedScenarioData');
  const stats = await generateScenarioData(db);
  console.log('Contas de teste prontas. Senha de todas: ComissTest1');
  console.log('Solo  dono     solo.teste@exemplo.com');
  console.log('Pro   dono     pro.teste@exemplo.com');
  console.log('Pro   parceiro pro.parceiro@exemplo.com  (lança no espaço do Bruno)');
  console.log('Time  dono     time.teste@exemplo.com');
  console.log('Time  editor   time.editor@exemplo.com   (lança no espaço da Carla)');
  console.log('Time  viewer   time.viewer@exemplo.com   (só vê)');
  console.log('Massa jan/2026 → hoje:');
  for (const s of stats) {
    console.log(
      `  ${s.email}  ${s.sales} lançamentos  faturamento ${s.revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}  comissão ${s.commission.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
    );
  }
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
