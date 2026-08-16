const { v4: uuid } = require('uuid');
const db = require('../db');
const { notify } = require('./notify');
const { sendMail, appBaseUrl } = require('./mail');

const KINDS = ['support', 'suggestion', 'rating'];
const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting_user', 'waiting_staff', 'resolved'];
const SUGGESTION_STATUSES = ['received', 'planned', 'shipped', 'declined'];
const CATEGORIES = {
  support: ['problema', 'duvida', 'cobranca', 'acesso'],
  suggestion: ['ideia'],
  rating: ['avaliacao'],
};

function defaultStatus(kind) {
  if (kind === 'suggestion') return 'received';
  if (kind === 'rating') return 'open';
  return 'open';
}

function publicTicket(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    kind: row.kind,
    category: row.category,
    subject: row.subject,
    body: row.body,
    status: row.status,
    rating: row.rating == null ? null : Number(row.rating),
    lastAuthorType: row.last_author_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    userName: row.user_name || null,
    userEmail: row.user_email || null,
    assignedAdminId: row.assigned_admin_id || null,
    unreadForAdmin: !row.admin_read_at,
    unreadForUser: !row.user_read_at,
    ...extra,
  };
}

function publicMessage(row) {
  return {
    id: row.id,
    authorType: row.author_type,
    authorName: row.author_name || (row.author_type === 'admin' ? 'Comiss' : 'Você'),
    body: row.body,
    createdAt: row.created_at,
  };
}

async function listForUser(userId) {
  const rows = await db.all(
    `SELECT * FROM support_tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 80`,
    [userId]
  );
  return rows.map((r) => publicTicket(r));
}

async function listForAdmin({ kind, status, q } = {}) {
  let rows = await db.all(
    `SELECT t.*, u.name as user_name, u.email as user_email, u.plan, u.plan_status
     FROM support_tickets t
     LEFT JOIN users u ON u.id=t.user_id
     ORDER BY t.updated_at DESC LIMIT 200`
  );
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (status) rows = rows.filter((r) => r.status === status);
  if (q) {
    const s = String(q).toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.subject || '').toLowerCase().includes(s) ||
        (r.body || '').toLowerCase().includes(s) ||
        (r.user_email || '').toLowerCase().includes(s) ||
        (r.user_name || '').toLowerCase().includes(s)
    );
  }
  return rows.map((r) =>
    publicTicket(r, {
      plan: r.plan,
      planStatus: r.plan_status,
    })
  );
}

async function stats() {
  const rows = await db.all(`SELECT kind, status, admin_read_at FROM support_tickets`);
  const openKinds = { support: 0, suggestion: 0, rating: 0 };
  let unread = 0;
  let waitingStaff = 0;
  let lowRatings = 0;
  for (const r of rows) {
    if (!r.admin_read_at) unread += 1;
    if (r.kind === 'support' && r.status !== 'resolved') openKinds.support += 1;
    if (r.kind === 'suggestion' && !['shipped', 'declined'].includes(r.status)) openKinds.suggestion += 1;
    if (r.kind === 'rating' && r.status !== 'resolved') openKinds.rating += 1;
    if (r.kind === 'support' && (r.status === 'open' || r.status === 'waiting_staff')) waitingStaff += 1;
    if (r.kind === 'rating' && Number(r.rating) > 0 && Number(r.rating) <= 2) lowRatings += 1;
  }
  return { unread, waitingStaff, lowRatings, openKinds, total: rows.length };
}

async function getTicket(id) {
  return db.get(
    `SELECT t.*, u.name as user_name, u.email as user_email, u.plan, u.plan_status, u.company
     FROM support_tickets t
     LEFT JOIN users u ON u.id=t.user_id
     WHERE t.id=?`,
    [id]
  );
}

async function messages(ticketId) {
  const rows = await db.all(
    `SELECT * FROM support_messages WHERE ticket_id=? ORDER BY created_at ASC`,
    [ticketId]
  );
  return rows.map(publicMessage);
}

async function addMessage(ticketId, { authorType, authorId, authorName, body }) {
  const text = String(body || '').trim();
  if (!text) {
    const err = new Error('Escreva uma mensagem.');
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO support_messages (id, ticket_id, author_type, author_id, author_name, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), ticketId, authorType, authorId || null, authorName || null, text.slice(0, 4000), now]
  );
  const patch =
    authorType === 'admin'
      ? `last_author_type='admin', user_read_at=NULL, admin_read_at=?, status=CASE WHEN status='resolved' THEN status ELSE 'waiting_user' END`
      : `last_author_type='user', admin_read_at=NULL, user_read_at=?, status=CASE WHEN kind='support' AND status IN ('waiting_user','resolved') THEN 'waiting_staff' ELSE status END`;
  await db.run(`UPDATE support_tickets SET ${patch}, updated_at=? WHERE id=?`, [now, now, ticketId]);
  return text;
}

async function createTicket({ user, kind, category, subject, body, rating }) {
  if (!KINDS.includes(kind)) {
    const err = new Error('Tipo inválido. Use suporte, sugestão ou avaliação.');
    err.status = 400;
    throw err;
  }
  const text = String(body || '').trim();
  if (!text) {
    const err = new Error('Escreva o que aconteceu.');
    err.status = 400;
    throw err;
  }
  const allowed = CATEGORIES[kind] || [];
  const cat = allowed.includes(category) ? category : allowed[0];
  let rate = rating == null || rating === '' ? null : Number(rating);
  if (kind === 'rating') {
    if (!rate || rate < 1 || rate > 5) {
      const err = new Error('Escolha uma nota de 1 a 5.');
      err.status = 400;
      throw err;
    }
  } else if (rate != null && (rate < 1 || rate > 5)) {
    rate = null;
  }
  const now = new Date().toISOString();
  const id = uuid();
  const subj =
    String(subject || '').trim().slice(0, 120) ||
    (kind === 'rating' ? `Avaliação ${rate}/5` : kind === 'suggestion' ? 'Sugestão' : 'Pedido de ajuda');
  const status = kind === 'rating' && rate >= 4 ? 'resolved' : defaultStatus(kind);
  await db.run(
    `INSERT INTO support_tickets
      (id, workspace_id, user_id, kind, category, subject, body, status, rating,
       last_author_type, user_read_at, admin_read_at, created_at, updated_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, NULL, ?, ?, ?)`,
    [
      id,
      user.workspaceId,
      user.id,
      kind,
      cat,
      subj,
      text.slice(0, 4000),
      status,
      rate,
      now,
      now,
      now,
      status === 'resolved' ? now : null,
    ]
  );
  await db.run(
    `INSERT INTO support_messages (id, ticket_id, author_type, author_id, author_name, body, created_at)
     VALUES (?, ?, 'user', ?, ?, ?, ?)`,
    [uuid(), id, user.id, user.name, text.slice(0, 4000), now]
  );

  const adminTo = process.env.ADMIN_EMAIL;
  if (adminTo) {
    const label = kind === 'support' ? 'Suporte' : kind === 'suggestion' ? 'Sugestão' : 'Avaliação';
    sendMail({
      to: adminTo,
      subject: `${label} · ${subj}`,
      text: `${user.name} (${user.email}) enviou ${label.toLowerCase()}.\n\n${text}\n\n${appBaseUrl()}/admin`,
      html: `<p><strong>${user.name}</strong> (${user.email}) enviou ${label.toLowerCase()}.</p><p>${text.replace(/</g, '&lt;')}</p><p><a href="${appBaseUrl()}/admin">Abrir portal admin</a></p>`,
    }).catch(() => {});
  }
  return id;
}

async function replyAsAdmin(ticket, admin, body) {
  const text = await addMessage(ticket.id, {
    authorType: 'admin',
    authorId: admin.id,
    authorName: admin.name || 'Comiss',
    body,
  });
  await notify({
    userId: ticket.user_id,
    workspaceId: ticket.workspace_id,
    type: 'support',
    title: 'Resposta da Comiss',
    body: text.slice(0, 180),
    link: `${appBaseUrl()}/app?screen=ajuda`,
    emailTemplate: 'supportReply',
    emailVars: {
      name: ticket.user_name,
      subject: ticket.subject,
      body: text.slice(0, 500),
      link: `${appBaseUrl()}/app?screen=ajuda`,
    },
    forceEmail: true,
  });
}

async function replyAsUser(ticket, user, body) {
  if (ticket.status === 'resolved' && ticket.kind === 'support') {
    await db.run(`UPDATE support_tickets SET status='waiting_staff', resolved_at=NULL, updated_at=? WHERE id=?`, [
      new Date().toISOString(),
      ticket.id,
    ]);
  }
  await addMessage(ticket.id, {
    authorType: 'user',
    authorId: user.id,
    authorName: user.name,
    body,
  });
}

async function setStatus(ticketId, status, kind) {
  const allowed = kind === 'suggestion' ? SUGGESTION_STATUSES : SUPPORT_STATUSES;
  if (!allowed.includes(status)) {
    const err = new Error('Status inválido para este tipo.');
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  await db.run(
    `UPDATE support_tickets SET status=?, resolved_at=?, updated_at=?, admin_read_at=? WHERE id=?`,
    [status, status === 'resolved' || status === 'shipped' || status === 'declined' ? now : null, now, now, ticketId]
  );
}

async function setRating(ticket, rating) {
  const n = Number(rating);
  if (!n || n < 1 || n > 5) {
    const err = new Error('Nota de 1 a 5.');
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  await db.run(`UPDATE support_tickets SET rating=?, updated_at=?, user_read_at=? WHERE id=?`, [
    n,
    now,
    now,
    ticket.id,
  ]);
}

async function markRead(ticket, who) {
  const now = new Date().toISOString();
  if (who === 'admin') {
    await db.run(`UPDATE support_tickets SET admin_read_at=? WHERE id=?`, [now, ticket.id]);
  } else {
    await db.run(`UPDATE support_tickets SET user_read_at=? WHERE id=?`, [now, ticket.id]);
  }
}

async function unreadForUser(userId) {
  const row = await db.get(
    `SELECT COUNT(*) as c FROM support_tickets WHERE user_id=? AND user_read_at IS NULL`,
    [userId]
  );
  return Number(row?.c) || 0;
}

module.exports = {
  KINDS,
  SUPPORT_STATUSES,
  SUGGESTION_STATUSES,
  publicTicket,
  listForUser,
  listForAdmin,
  stats,
  getTicket,
  messages,
  createTicket,
  replyAsAdmin,
  replyAsUser,
  setStatus,
  setRating,
  markRead,
  unreadForUser,
};
