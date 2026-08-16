const { v4: uuid } = require('uuid');
const db = require('../db');
const { notify } = require('./notify');
const { appBaseUrl } = require('./mail');
const { getPlan } = require('./plans');

const LEAD_STALE_DAYS = 3;
const INVITE_STALE_DAYS = 3;
const SNOOZE_DAYS = 3;
const EMAIL_COOLDOWN_MS = 48 * 60 * 60 * 1000;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function money(n) {
  return Number(n || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

async function upsertOpen({ workspaceId, sellerId, type, refType, refId, title, body, dueAt }) {
  const existing = await db.get(
    `SELECT * FROM followups WHERE workspace_id=? AND type=? AND ref_id=? AND status='open'`,
    [workspaceId, type, refId]
  );
  const now = new Date().toISOString();
  if (existing) {
    await db.run(
      `UPDATE followups SET title=?, body=?, due_at=?, seller_id=?, updated_at=? WHERE id=?`,
      [title, body || existing.body, dueAt || existing.due_at, sellerId || existing.seller_id, now, existing.id]
    );
    return db.get('SELECT * FROM followups WHERE id=?', [existing.id]);
  }
  const snoozed = await db.get(
    `SELECT id FROM followups WHERE workspace_id=? AND type=? AND ref_id=? AND status='done' AND done_at>=?`,
    [workspaceId, type, refId, daysAgo(SNOOZE_DAYS)]
  );
  if (snoozed) return null;
  const id = uuid();
  await db.run(
    `INSERT INTO followups (id, workspace_id, seller_id, type, ref_type, ref_id, title, body, due_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [id, workspaceId, sellerId || null, type, refType, refId, title, body || '', dueAt || now, now, now]
  );
  return db.get('SELECT * FROM followups WHERE id=?', [id]);
}

async function fanout(followup, payloads) {
  if (!followup || !payloads?.length) return;
  const last = followup.last_notified_at ? new Date(followup.last_notified_at).getTime() : 0;
  if (followup.notified_once && last && Date.now() - last < EMAIL_COOLDOWN_MS) return;
  for (const p of payloads) await notify(p);
  await db.run(`UPDATE followups SET last_notified_at=?, notified_once=1, updated_at=? WHERE id=?`, [
    new Date().toISOString(),
    new Date().toISOString(),
    followup.id,
  ]);
}

async function closeFollowup(id) {
  const now = new Date().toISOString();
  await db.run(`UPDATE followups SET status='done', done_at=?, updated_at=? WHERE id=? AND status='open'`, [
    now,
    now,
    id,
  ]);
}

async function closeResolved(workspaceId, owner) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const open = await db.all(
    `SELECT * FROM followups WHERE workspace_id=? AND status='open'`,
    [workspaceId]
  );
  for (const fu of open) {
    let done = false;
    if (fu.type === 'receivable_due') {
      const sellerFilter = fu.ref_id?.startsWith('ws:')
        ? ''
        : ' AND COALESCE(s.seller_id, s.user_id)=?';
      const params = fu.ref_id?.startsWith('ws:')
        ? [workspaceId, today]
        : [workspaceId, today, fu.seller_id || owner.id];
      const left = await db.get(
        `SELECT COUNT(*) as c FROM receivables r
         JOIN sales s ON s.id=r.sale_id
         WHERE r.user_id=? AND r.status IN ('previsto','parcial','atrasado') AND r.due_date<=?${sellerFilter}`,
        params
      );
      done = !(Number(left?.c) || 0);
    } else if (fu.type === 'lead_stale') {
      const lead = await db.get('SELECT * FROM leads WHERE id=?', [fu.ref_id]);
      done =
        !lead ||
        ['fechado', 'perdido'].includes(lead.stage) ||
        new Date(lead.updated_at).getTime() > Date.now() - LEAD_STALE_DAYS * 86400000;
    } else if (fu.type === 'invite_pending') {
      const m = await db.get('SELECT * FROM team_members WHERE id=?', [fu.ref_id]);
      done = !m || m.status !== 'pending';
    } else if (fu.type === 'trial_ending') {
      done = !owner || owner.plan_status !== 'trialing';
    }
    if (done) await closeFollowup(fu.id);
  }
}

async function syncReceivables(workspaceId, ownerId) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.all(
    `SELECT r.*, s.title as sale_title, COALESCE(s.seller_id, s.user_id) as seller_id
     FROM receivables r
     JOIN sales s ON s.id=r.sale_id
     WHERE r.user_id=? AND r.status IN ('previsto','parcial','atrasado') AND r.due_date<=?`,
    [workspaceId, today]
  );
  if (!rows.length) return;
  const link = `${appBaseUrl()}/app`;
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const ownerFu = await upsertOpen({
    workspaceId,
    sellerId: ownerId,
    type: 'receivable_due',
    refType: 'receivable_batch',
    refId: `ws:${today}`,
    title: 'Recebimentos para confirmar',
    body: `${rows.length} item(ns) · ${money(total)} com vencimento até hoje`,
    dueAt: today,
  });
  await fanout(ownerFu, [
    {
      userId: ownerId,
      workspaceId,
      type: 'receivable',
      title: 'Confirme se caiu na conta',
      body: ownerFu?.body,
      link,
      emailTemplate: 'receivable',
      emailVars: { amountLabel: money(total), detail: rows[0]?.sale_title, link },
      prefKey: 'emailReceivable',
    },
  ]);

  const bySeller = new Map();
  for (const r of rows) {
    const sid = r.seller_id || ownerId;
    if (sid === ownerId) continue;
    if (!bySeller.has(sid)) bySeller.set(sid, []);
    bySeller.get(sid).push(r);
  }
  for (const [sellerId, list] of bySeller) {
    const seller = await db.get('SELECT id FROM users WHERE id=?', [sellerId]);
    if (!seller) continue;
    const sub = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const fu = await upsertOpen({
      workspaceId,
      sellerId,
      type: 'receivable_due',
      refType: 'receivable_batch',
      refId: `${sellerId}:${today}`,
      title: 'Seus recebimentos para confirmar',
      body: `${list.length} item(ns) · ${money(sub)}`,
      dueAt: today,
    });
    await fanout(fu, [
      {
        userId: sellerId,
        workspaceId,
        type: 'receivable',
        title: 'Confirme se caiu na conta',
        body: fu?.body,
        link,
        emailTemplate: 'receivable',
        emailVars: { amountLabel: money(sub), detail: list[0]?.sale_title, link },
        prefKey: 'emailReceivable',
      },
    ]);
  }
}

async function syncLeads(workspaceId, ownerId) {
  const cutoff = daysAgo(LEAD_STALE_DAYS);
  const rows = await db.all(
    `SELECT * FROM leads WHERE user_id=? AND stage NOT IN ('fechado','perdido') AND updated_at<=?`,
    [workspaceId, cutoff]
  );
  const link = `${appBaseUrl()}/app`;
  for (const lead of rows) {
    const days = Math.max(
      LEAD_STALE_DAYS,
      Math.floor((Date.now() - new Date(lead.updated_at).getTime()) / 86400000)
    );
    const fu = await upsertOpen({
      workspaceId,
      sellerId: ownerId,
      type: 'lead_stale',
      refType: 'lead',
      refId: lead.id,
      title: `Lead parado: ${lead.title}`,
      body: `${lead.client_name || 'sem cliente'} · ${days} dias sem movimento`,
      dueAt: new Date().toISOString().slice(0, 10),
    });
    await fanout(fu, [
      {
        userId: ownerId,
        workspaceId,
        type: 'lead',
        title: fu?.title,
        body: fu?.body,
        link,
        emailTemplate: 'lead',
        emailVars: { title: lead.title, client: lead.client_name, days, link },
        prefKey: 'emailLead',
      },
    ]);
  }
}

async function syncInvites(workspaceId, ownerId) {
  const cutoff = daysAgo(INVITE_STALE_DAYS);
  const rows = await db.all(
    `SELECT * FROM team_members WHERE owner_user_id=? AND status='pending' AND created_at<=?`,
    [workspaceId, cutoff]
  );
  const link = `${appBaseUrl()}/app`;
  for (const m of rows) {
    const fu = await upsertOpen({
      workspaceId,
      sellerId: ownerId,
      type: 'invite_pending',
      refType: 'team_member',
      refId: m.id,
      title: `Convite pendente: ${m.email}`,
      body: `${m.name || m.email} ainda não aceitou`,
      dueAt: new Date().toISOString().slice(0, 10),
    });
    await fanout(fu, [
      {
        userId: ownerId,
        workspaceId,
        type: 'invite',
        title: fu?.title,
        body: fu?.body,
        link,
        emailTemplate: 'inviteRemind',
        emailVars: { email: m.email, link },
        prefKey: 'emailInviteRemind',
      },
    ]);
  }
}

async function syncTrial(workspaceId, owner) {
  if (!owner || owner.plan_status !== 'trialing' || !owner.trial_ends_at) return;
  const ends = new Date(owner.trial_ends_at).getTime();
  const days = Math.ceil((ends - Date.now()) / 86400000);
  if (days > 7 || days < 0) return;
  const bucket = days <= 1 ? '1' : '7';
  const plan = getPlan(owner.plan || 'pro');
  const fu = await upsertOpen({
    workspaceId,
    sellerId: owner.id,
    type: 'trial_ending',
    refType: 'user',
    refId: `${owner.id}:${bucket}`,
    title: `Mês grátis acaba em ${days} dia${days === 1 ? '' : 's'}`,
    body: `Plano ${plan?.name || owner.plan} · depois o Asaas cobra`,
    dueAt: owner.trial_ends_at.slice(0, 10),
  });
  const link = `${appBaseUrl()}/app`;
  await fanout(fu, [
    {
      userId: owner.id,
      workspaceId,
      type: 'trial',
      title: fu?.title,
      body: fu?.body,
      link,
      emailTemplate: 'trial',
      emailVars: { days, planName: plan?.name || 'Pro', link },
      prefKey: 'emailTrial',
    },
  ]);
}

async function syncWorkspace(workspaceId) {
  const owner = await db.get('SELECT * FROM users WHERE id=?', [workspaceId]);
  if (!owner) return { ok: false };
  await closeResolved(workspaceId, owner);
  await syncReceivables(workspaceId, owner.id);
  if (['pro', 'time'].includes(owner.plan)) await syncLeads(workspaceId, owner.id);
  if (['pro', 'time'].includes(owner.plan)) await syncInvites(workspaceId, owner.id);
  await syncTrial(workspaceId, owner);
  return { ok: true };
}

async function runSweep() {
  const owners = await db.all(`SELECT id FROM users WHERE id = workspace_id`);
  let n = 0;
  for (const o of owners) {
    try {
      await syncWorkspace(o.id);
      n += 1;
    } catch (err) {
      console.error('[followups] workspace', o.id, err.message);
    }
  }
  return n;
}

function startFollowupJob() {
  const ms = Number(process.env.FOLLOWUP_INTERVAL_MS || 15 * 60 * 1000);
  setTimeout(() => {
    runSweep()
      .then((n) => console.log(`[followups] varredura inicial: ${n} espaços`))
      .catch((e) => console.error(e));
  }, 8000);
  setInterval(() => {
    runSweep().catch((e) => console.error('[followups]', e));
  }, ms);
}

module.exports = {
  upsertOpen,
  syncWorkspace,
  runSweep,
  startFollowupJob,
  closeFollowup,
};
