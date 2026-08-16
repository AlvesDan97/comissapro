const API = '/api/admin';
const TOKEN_KEY = 'cp_admin_token';

const $ = (id) => document.getElementById(id);
const state = { token: localStorage.getItem(TOKEN_KEY), admin: null, accountId: null };

function fmt(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function tag(status) {
  const map = { trialing: 'trial', active: 'active', overdue: 'overdue', expired: 'expired', canceled: 'canceled' };
  return `<span class="tag ${map[status] || ''}">${esc(status || '—')}</span>`;
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      state.token = null;
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
    }
    throw new Error(data.error || 'Erro no admin');
  }
  return data;
}

function showLogin() {
  $('login').classList.remove('hidden');
  $('shell').classList.add('hidden');
}
function showShell() {
  $('login').classList.add('hidden');
  $('shell').classList.remove('hidden');
  $('who').textContent = state.admin ? `${state.admin.name} · ${state.admin.email}` : '';
}

const TITLES = {
  dashboard: 'Painel',
  revenue: 'Receita',
  inbox: 'Inbox',
  ticket: 'Conversa',
  accounts: 'Contas',
  account: 'Conta',
  subscriptions: 'Assinaturas',
  plans: 'Planos',
  coupons: 'Cupons',
  leads: 'Leads',
  audit: 'Auditoria',
  ops: 'Operação',
};

function setInboxBadge(n) {
  const el = $('inboxNavBadge');
  if (!el) return;
  const c = Number(n) || 0;
  el.textContent = c > 99 ? '99+' : String(c);
  el.classList.toggle('hidden', c === 0);
}

function barsHtml(items, valueKey) {
  const max = Math.max(1, ...items.map((i) => Number(i[valueKey]) || 0));
  return `<div class="bars">${items
    .map((i) => {
      const v = Number(i[valueKey]) || 0;
      const h = Math.max(v ? 6 : 2, Math.round((v / max) * 100));
      return `<div class="bar-col" title="${esc(i.label)}: ${v}"><div class="bar" style="height:${h}%"></div><span>${esc(i.label)}</span></div>`;
    })
    .join('')}</div>`;
}

async function go(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  $(`screen-${name}`).classList.add('on');
  document.querySelectorAll('.nav').forEach((b) =>
    b.classList.toggle(
      'on',
      b.dataset.screen === name ||
        (name === 'account' && b.dataset.screen === 'accounts') ||
        (name === 'ticket' && b.dataset.screen === 'inbox')
    )
  );
  $('pageTitle').textContent = TITLES[name] || name;
  if (name === 'dashboard') await loadDash();
  if (name === 'revenue') await loadRevenue();
  if (name === 'inbox') await loadInbox();
  if (name === 'accounts') await loadAccounts();
  if (name === 'subscriptions') await loadSubs();
  if (name === 'plans') await loadPlans();
  if (name === 'coupons') await loadCoupons();
  if (name === 'leads') await loadLeads();
  if (name === 'audit') await loadAudit();
  if (name === 'ops') await loadOps();
}

async function loadDash() {
  const d = await api('/dashboard');
  const k = d.kpis;
  setInboxBadge(k.inboxUnread);
  $('kpis').innerHTML = [
    ['Contas', k.accounts],
    ['Membros', k.members],
    ['Trials', k.trials],
    ['MRR', fmt(k.mrr)],
    ['Inbox', k.inboxUnread],
    ['Aguardando vocês', k.inboxWaiting],
    ['Hoje', k.newToday],
    ['7 dias', k.newWeek],
    ['Vendas no mês', k.salesMonth],
    ['Bloqueadas', k.blocked],
  ]
    .map(([lbl, val]) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`)
    .join('');
  $('byStatus').innerHTML = `<h3>Status</h3>` + Object.entries(d.byStatus || {}).map(([k, v]) => `<p>${esc(k)} · <b>${v}</b></p>`).join('') || '<p class="hint">Nenhuma conta ainda.</p>';
  $('byPlan').innerHTML = `<h3>Planos</h3>` + Object.entries(d.byPlan || {}).map(([k, v]) => `<p>${esc(k)} · <b>${v}</b></p>`).join('') || '<p class="hint">—</p>';
}

async function loadRevenue() {
  const d = await api('/revenue');
  const k = d.kpis;
  $('revNote').textContent = d.note || '';
  $('revKpis').innerHTML = [
    ['MRR', fmt(k.mrr)],
    ['ARR', fmt(k.arr)],
    ['Pagantes', k.paying],
    ['Trials', k.trials],
    ['Inadimplentes', k.overdue],
    ['Cancelados', k.canceled],
    ['Assentos extra', k.extraSeats],
    ['MRR extra', fmt(k.extraMrr)],
  ]
    .map(([lbl, val]) => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`)
    .join('');
  $('revSignups').innerHTML = barsHtml(d.signups || [], 'accounts');
  const maxMix = Math.max(1, ...(d.mix || []).map((m) => m.mrr));
  $('revMix').innerHTML = (d.mix || [])
    .map(
      (m) => `<div class="mix-row"><span style="width:64px">${esc(m.name)}</span>
        <div class="mix-track"><div class="mix-fill" style="width:${Math.round((m.mrr / maxMix) * 100)}%"></div></div>
        <span class="mono">${fmt(m.mrr)} · ${m.paying} pagantes</span></div>`
    )
    .join('') || '<p class="hint">Sem MRR ainda.</p>';
  const c = d.cycle || {};
  $('revCycle').innerHTML = `<h3>Ciclo</h3>
    <p>Mensal · ${c.monthly?.accounts || 0} contas · <b>${fmt(c.monthly?.mrr)}</b></p>
    <p>Anual · ${c.yearly?.accounts || 0} contas · <b>${fmt(c.yearly?.mrr)}</b></p>`;
  const w = d.waterfall || {};
  $('revWater').innerHTML = `<h3>Neste mês</h3>
    <p>MRR de contas novas ativas · <b>${fmt(w.newMrr)}</b></p>
    <p>Mês passado (novas ainda ativas) · <b>${fmt(w.lastMonthNewMrr)}</b></p>
    <p>Assentos extra · <b>${fmt(w.extraMrr)}</b></p>
    <p>Inadimplência em risco · <b>${fmt(w.overdueAtRisk)}</b></p>`;
}

const KIND_LABEL = { support: 'Suporte', suggestion: 'Sugestão', rating: 'Avaliação' };

async function loadInbox() {
  const kind = $('inKind').value;
  const status = $('inStatus').value;
  const q = encodeURIComponent($('inQ').value || '');
  const data = await api(`/inbox?kind=${kind}&status=${status}&q=${q}`);
  setInboxBadge(data.stats?.unread);
  if (!data.tickets.length) {
    $('inboxList').innerHTML = '<p class="hint">Nada nesta fila.</p>';
    return;
  }
  $('inboxList').innerHTML = `<table class="table"><thead><tr><th>Cliente</th><th>Tipo</th><th>Assunto</th><th>Status</th><th></th></tr></thead><tbody>
    ${data.tickets
      .map(
        (t) => `<tr>
      <td>${esc(t.userName || '—')}<div class="hint">${esc(t.userEmail || '')}</div></td>
      <td>${esc(KIND_LABEL[t.kind] || t.kind)}${t.rating ? ` · ${t.rating}/5` : ''}</td>
      <td>${t.unreadForAdmin ? '<b>' : ''}${esc(t.subject)}${t.unreadForAdmin ? '</b>' : ''}</td>
      <td>${tag(t.status)}</td>
      <td><button class="link" data-tid="${t.id}">abrir</button></td>
    </tr>`
      )
      .join('')}
  </tbody></table>`;
  $('inboxList').querySelectorAll('[data-tid]').forEach((b) => {
    b.onclick = () => openTicket(b.dataset.tid);
  });
}

async function openTicket(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  $('screen-ticket').classList.add('on');
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('on', b.dataset.screen === 'inbox'));
  $('pageTitle').textContent = 'Conversa';
  const d = await api(`/inbox/${id}`);
  const t = d.ticket;
  const sug = t.kind === 'suggestion';
  const statuses = sug
    ? [['received', 'Recebida'], ['planned', 'Planejada'], ['shipped', 'Lançada'], ['declined', 'Recusada']]
    : [['open', 'Aberto'], ['in_progress', 'Em atendimento'], ['waiting_user', 'Aguardando cliente'], ['waiting_staff', 'Aguardando Comiss'], ['resolved', 'Resolvido']];
  $('ticketDetail').innerHTML = `
    <div class="card">
      <h3>${esc(KIND_LABEL[t.kind] || t.kind)} · ${esc(t.subject)} ${tag(t.status)}</h3>
      <p class="hint">${esc(t.userName || '')} · ${esc(t.userEmail || '')} · ${esc(t.plan || '')} · ${esc(t.planStatus || '')}</p>
      ${t.rating ? `<p>Nota ${t.rating}/5</p>` : ''}
      <div class="thread">
        ${(d.messages || [])
          .map(
            (m) => `<div class="bubble ${m.authorType === 'admin' ? 'admin' : ''}">
              <div class="who">${esc(m.authorName)} · ${new Date(m.createdAt).toLocaleString('pt-BR')}</div>
              <div>${esc(m.body)}</div>
            </div>`
          )
          .join('')}
      </div>
      ${
        t.kind !== 'rating'
          ? `<div class="row"><textarea id="replyBody" placeholder="Responder ao cliente"></textarea></div>
             <div class="actions"><button class="btn small" type="button" id="btnReply">Enviar resposta</button></div>`
          : ''
      }
      <div class="actions" style="margin-top:10px">
        <select id="ticketStatus">${statuses.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <button class="btn small ghost" type="button" id="btnTicketStatus">Atualizar status</button>
      </div>
    </div>`;
  $('ticketStatus').value = t.status;
  const reply = $('btnReply');
  if (reply) {
    reply.onclick = async () => {
      await api(`/inbox/${id}/reply`, { method: 'POST', body: { body: $('replyBody').value } });
      openTicket(id);
    };
  }
  $('btnTicketStatus').onclick = async () => {
    await api(`/inbox/${id}/status`, { method: 'POST', body: { status: $('ticketStatus').value } });
    openTicket(id);
  };
}

async function loadAccounts() {
  const q = encodeURIComponent($('accQ').value || '');
  const plan = $('accPlan').value;
  const status = $('accStatus').value;
  const data = await api(`/accounts?q=${q}&plan=${plan}&status=${status}`);
  if (!data.accounts.length) {
    $('accList').innerHTML = '<p class="hint">Nenhuma conta com esse filtro.</p>';
    return;
  }
  $('accList').innerHTML = `<table class="table"><thead><tr><th>Conta</th><th>Plano</th><th>Status</th><th>MRR</th><th></th></tr></thead><tbody>
    ${data.accounts
      .map(
        (a) => `<tr>
      <td><button class="link" data-id="${a.id}">${esc(a.name)}</button><div class="hint">${esc(a.email)}</div></td>
      <td>${esc(a.planName)}</td>
      <td>${tag(a.status)}${a.blocked ? ' · bloqueada' : ''}</td>
      <td class="mono">${fmt(a.mrr)}</td>
      <td><button class="link" data-id="${a.id}">abrir</button></td>
    </tr>`
      )
      .join('')}
  </tbody></table>`;
  $('accList').querySelectorAll('[data-id]').forEach((b) => {
    b.onclick = () => openAccount(b.dataset.id);
  });
}

async function openAccount(id) {
  state.accountId = id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  $('screen-account').classList.add('on');
  $('pageTitle').textContent = 'Conta';
  const d = await api(`/accounts/${id}`);
  const a = d.account;
  const u = d.usage;
  $('accDetail').innerHTML = `
    <div class="card">
      <h3>${esc(a.name)} ${tag(a.status)}</h3>
      <p class="hint">${esc(a.email)} · ${esc(a.company || a.profession || '—')} · criada ${new Date(a.createdAt).toLocaleString('pt-BR')}</p>
      <p>Plano <b>${esc(a.planName)}</b> · ${esc(a.billingCycle)} · trial até ${a.trialEndsAt ? new Date(a.trialEndsAt).toLocaleDateString('pt-BR') : '—'}
      ${a.blocked ? `<br>Bloqueada: ${esc(a.blockedReason || '')}` : ''}</p>
      <p class="hint">Asaas customer ${esc(a.asaasCustomerId || '—')} · sub ${esc(a.asaasSubscriptionId || '—')}</p>
      <p>Uso: ${u.sales} vendas · ${fmt(u.commission)} comissão · ${u.commissionTypes} tipos · ${u.seats} convites</p>
      <div class="actions">
        <select id="newPlan"><option value="solo">Solo</option><option value="pro">Pro</option><option value="time">Time</option></select>
        <button class="btn small" type="button" id="btnPlan">Trocar plano</button>
        <select id="newStatus">
          <option value="trialing">trial</option><option value="active">ativo</option>
          <option value="overdue">inadimplente</option><option value="canceled">cancelado</option>
        </select>
        <button class="btn small" type="button" id="btnStatus">Status</button>
        <button class="btn small ghost" type="button" id="btnTrial">+7 dias trial</button>
        ${a.blocked
          ? '<button class="btn small" type="button" id="btnUnblock">Desbloquear</button>'
          : '<button class="btn small danger" type="button" id="btnBlock">Bloquear</button>'}
        <button class="btn small ghost" type="button" id="btnImp">Abrir como cliente</button>
      </div>
    </div>
    <div class="card">
      <h3>Equipe</h3>
      ${d.team.length ? d.team.map((m) => `<p>${esc(m.name || m.email)} · ${esc(m.role)} · ${esc(m.status)}</p>`).join('') : '<p class="hint">Sem convites.</p>'}
    </div>
    <div class="card">
      <h3>Notas internas</h3>
      <div class="row"><input id="noteBody" placeholder="Só você vê isso"><button class="btn small" type="button" id="btnNote">Salvar nota</button></div>
      ${d.notes.map((n) => `<p class="hint">${esc(n.createdAt)} · ${esc(n.adminEmail || '')}<br>${esc(n.body)}</p>`).join('')}
    </div>`;
  $('newPlan').value = a.plan;
  $('newStatus').value = a.status === 'expired' ? 'canceled' : a.status;
  $('btnPlan').onclick = async () => {
    await api(`/accounts/${id}/plan`, { method: 'POST', body: { planId: $('newPlan').value } });
    openAccount(id);
  };
  $('btnStatus').onclick = async () => {
    await api(`/accounts/${id}/status`, { method: 'POST', body: { status: $('newStatus').value } });
    openAccount(id);
  };
  $('btnTrial').onclick = async () => {
    await api(`/accounts/${id}/extend-trial`, { method: 'POST', body: { days: 7 } });
    openAccount(id);
  };
  const block = $('btnBlock');
  if (block) {
    block.onclick = async () => {
      const reason = prompt('Motivo do bloqueio') || 'bloqueado no teste';
      await api(`/accounts/${id}/block`, { method: 'POST', body: { reason } });
      openAccount(id);
    };
  }
  const un = $('btnUnblock');
  if (un) un.onclick = async () => {
    await api(`/accounts/${id}/unblock`, { method: 'POST' });
    openAccount(id);
  };
  $('btnImp').onclick = async () => {
    const r = await api(`/accounts/${id}/impersonate`, { method: 'POST' });
    localStorage.setItem('cp_token', r.token);
    window.open('/app', '_blank');
  };
  $('btnNote').onclick = async () => {
    await api(`/accounts/${id}/note`, { method: 'POST', body: { body: $('noteBody').value } });
    openAccount(id);
  };
}

async function loadSubs() {
  const { subscriptions } = await api('/subscriptions');
  $('subList').innerHTML = `<table class="table"><thead><tr><th>Conta</th><th>Plano</th><th>Status</th><th>Asaas</th><th>MRR</th></tr></thead><tbody>
    ${subscriptions
      .map(
        (s) => `<tr>
      <td>${esc(s.name)}<div class="hint">${esc(s.email)}</div></td>
      <td>${esc(s.planName)} · ${esc(s.billingCycle)}</td>
      <td>${tag(s.status)}</td>
      <td class="hint">${s.asaasSubscriptionId ? 'ligado' : '—'}</td>
      <td>${fmt(s.mrr)}</td>
    </tr>`
      )
      .join('')}</tbody></table>`;
}

async function loadPlans() {
  const { plans, note } = await api('/plans');
  $('planList').innerHTML =
    `<p class="hint">${esc(note || '')}</p>` +
    plans
      .map(
        (p) => `<form class="card" data-plan="${esc(p.id)}">
      <h3>${esc(p.name)} <span class="hint">(${esc(p.id)})</span></h3>
      <label>Nome<input name="name" value="${esc(p.name)}"></label>
      <label>Tagline<input name="tagline" value="${esc(p.tagline || '')}"></label>
      <div class="row">
        <label>Mensal (R$)<input name="priceMonthly" type="number" min="1" step="0.01" value="${p.priceMonthly}"></label>
        <label>Anual (R$)<input name="priceYearly" type="number" min="1" step="0.01" value="${p.priceYearly}"></label>
        <label>Assento extra<input name="extraSeatPrice" type="number" min="0" step="0.01" value="${p.extraSeatPrice || ''}" placeholder="—"></label>
      </div>
      <div class="row">
        <label>Limite lojas<input name="maxStores" type="number" min="0" value="${p.maxStores}"></label>
        <label>Usuários inclusos<input name="maxTeamMembers" type="number" min="0" value="${p.maxTeamMembers}"></label>
      </div>
      <label>Features (uma por linha)<textarea name="features">${esc((p.features || []).join('\n'))}</textarea></label>
      <button class="btn small" type="submit">Salvar ${esc(p.name)}</button>
    </form>`
      )
      .join('');
  $('planList').querySelectorAll('form[data-plan]').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await api(`/plans/${form.dataset.plan}`, {
        method: 'PATCH',
        body: {
          name: fd.get('name'),
          tagline: fd.get('tagline'),
          priceMonthly: Number(fd.get('priceMonthly')),
          priceYearly: Number(fd.get('priceYearly')),
          extraSeatPrice: fd.get('extraSeatPrice') === '' ? null : Number(fd.get('extraSeatPrice')),
          maxStores: Number(fd.get('maxStores')),
          maxTeamMembers: Number(fd.get('maxTeamMembers')),
          features: String(fd.get('features') || ''),
        },
      });
      await loadPlans();
    };
  });
}

async function loadCoupons() {
  const { coupons } = await api('/coupons');
  $('couponList').innerHTML = coupons.length
    ? `<table class="table"><thead><tr><th>Código</th><th>Tipo</th><th>Valor</th><th>Usos</th></tr></thead><tbody>
      ${coupons.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.kind)}</td><td>${c.value}</td><td>${c.redeemed}/${c.maxRedemptions || '∞'}</td></tr>`).join('')}
    </tbody></table>`
    : '<p class="hint">Nenhum cupom ainda.</p>';
}

async function loadLeads() {
  const { leads } = await api('/leads');
  $('leadList').innerHTML = leads.length
    ? leads.map((l) => `<div class="card"><b>${esc(l.title)}</b> ${tag(l.stage)}<p class="hint">${esc(l.ownerEmail || '')} · ${fmt(l.value)}</p></div>`).join('')
    : '<p class="hint">Nenhum lead no app ainda.</p>';
}

async function loadAudit() {
  const { events } = await api('/audit');
  $('auditList').innerHTML = events.length
    ? `<table class="table"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th></tr></thead><tbody>
      ${events.map((e) => `<tr><td>${new Date(e.createdAt).toLocaleString('pt-BR')}</td><td>${esc(e.adminEmail || '')}</td><td>${esc(e.action)}</td><td>${esc(e.entity)} ${esc(e.entityId || '')}</td></tr>`).join('')}
    </tbody></table>`
    : '<p class="hint">Sem ações ainda.</p>';
}

async function loadOps() {
  const o = await api('/ops');
  $('opsBox').innerHTML = `<div class="card">
    <p>API: <b>${esc(o.api)}</b> · banco <b>${esc(o.db)}</b> · env <b>${esc(o.env)}</b></p>
    <p>Asaas: <b>${o.asaas ? 'ligado' : 'sem chave'}</b> · ${esc(o.asaasUrl)}</p>
    <p>Resend: <b>${o.resend ? 'ligado' : 'sem chave'}</b></p>
    <p>APP_URL: ${esc(o.appUrl || '—')}</p>
    <p class="hint">${esc(o.time)}</p>
  </div>`;
}

async function boot() {
  document.querySelectorAll('.nav, [data-screen]').forEach((b) => {
    if (b.id === 'btnLogout') return;
    b.addEventListener('click', () => go(b.dataset.screen));
  });
  $('btnLogout').onclick = () => {
    localStorage.removeItem(TOKEN_KEY);
    state.token = null;
    showLogin();
  };
  $('btnLogin').onclick = async () => {
    $('loginError').classList.add('hidden');
    try {
      const data = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('email').value, password: $('password').value }),
      }).then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Falha no login');
        return j;
      });
      state.token = data.token;
      state.admin = data.admin;
      localStorage.setItem(TOKEN_KEY, data.token);
      showShell();
      await go('dashboard');
    } catch (err) {
      $('loginError').textContent = err.message;
      $('loginError').classList.remove('hidden');
    }
  };
  $('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btnLogin').click();
  });
  $('btnAccSearch').onclick = loadAccounts;
  if ($('btnInboxSearch')) $('btnInboxSearch').onclick = loadInbox;
  $('btnCoupon').onclick = async () => {
    await api('/coupons', {
      method: 'POST',
      body: { code: $('cpCode').value, kind: $('cpKind').value, value: Number($('cpValue').value) || 0 },
    });
    $('cpCode').value = '';
    await loadCoupons();
  };

  if (!state.token) {
    showLogin();
    return;
  }
  try {
    const me = await api('/me');
    state.admin = me.admin;
    showShell();
    await go('dashboard');
  } catch {
    showLogin();
  }
}

boot();
