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
  accounts: 'Contas',
  account: 'Conta',
  subscriptions: 'Assinaturas',
  plans: 'Planos',
  coupons: 'Cupons',
  leads: 'Leads',
  audit: 'Auditoria',
  ops: 'Operação',
};

async function go(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  $(`screen-${name}`).classList.add('on');
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('on', b.dataset.screen === name || (name === 'account' && b.dataset.screen === 'accounts')));
  $('pageTitle').textContent = TITLES[name] || name;
  if (name === 'dashboard') await loadDash();
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
  $('kpis').innerHTML = [
    ['Contas', k.accounts],
    ['Membros', k.members],
    ['Trials', k.trials],
    ['MRR', fmt(k.mrr)],
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
  const { plans } = await api('/plans');
  $('planList').innerHTML = plans
    .map(
      (p) => `<div class="card"><h3>${esc(p.name)} · ${fmt(p.priceMonthly)}/mês</h3>
      <p class="hint">${esc(p.tagline)}</p>
      <p>${(p.features || []).map((f) => esc(f)).join(' · ')}</p></div>`
    )
    .join('');
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
