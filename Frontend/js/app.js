/* Comiss — app completo */
const urlParams = new URLSearchParams(location.search);

const state = {
  mode: urlParams.get('mode') === 'register' ? 'register' : 'login',
  selectedPlanId: urlParams.get('plan') || null,
  billingCycle: urlParams.get('cycle') === 'yearly' ? 'yearly' : 'monthly',
  catalogPlans: [],
  user: null,
  nicheFields: {},
  stores: [],
  selectedStoreId: '',
  saleStatus: 'todas',
  chartMode: 'commission',
  series: [],
  currentSaleId: null,
  selectedNiche: null,
  multiStore: 0,
  editingStoreId: null,
  catalog: null,
  commissions: [],
  commissionDraft: null,
  commissionFormReturn: 'comissoes',
  launchCommission: null,
  dashScope: null,
  metricCatalog: [],
};

const NICHES = [
  { id: 'automotivo', ico: '🚗', t: 'Automotivo', s: 'Veículos e concessionárias' },
  { id: 'imobiliario', ico: '🏢', t: 'Imobiliário', s: 'Corretagem e marcos' },
  { id: 'representacao', ico: '📦', t: 'Representação', s: 'Multimarcas B2B' },
  { id: 'seguros', ico: '💼', t: 'Seguros', s: 'Apólices e recorrência' },
  { id: 'personalizado', ico: '⚙️', t: 'Personalizado', s: 'Você monta os campos' },
];

const RULE_LABELS = {
  bands: 'Faixas progressivas',
  fixed: 'Percentual fixo',
  margin: 'Margem de lucro',
  product_table: 'Tabela por produto',
  cash_on_receipt: 'No recebimento',
  milestones: 'Marcos',
};

const TITLES = {
  comissoes: 'Minhas Comissões',
  'comissao-form': 'Comissão',
  perfil: 'Perfil',
  dashboard: 'Painel',
  vendas: 'Extrato de Vendas',
  pipeline: 'Pipeline',
  simulador: 'Simulador',
  metas: 'Metas',
  comparar: 'Comparar',
  equipe: 'Equipe',
  pendencias: 'Pendências',
      planos: 'Planos e cobrança',
  ajuda: 'Ajuda',
  config: 'Configurações',
};

function fmt(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
function initials(name) {
  return (name || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
function nicheLabel(id) {
  return NICHES.find((n) => n.id === id)?.t || id || '—';
}
function $(id) { return document.getElementById(id); }
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function show(el) { el.classList.add('show'); el.classList.remove('hidden'); }
function hide(el) { el.classList.remove('show'); }

function toast(msg, isError) {
  const box = $('authError');
  if (!box) return alert(msg);
  // only on auth screen — elsewhere use alert lightly
  if ($('login').classList.contains('show')) {
    box.textContent = msg;
    box.className = isError ? 'error-box' : 'ok-box';
    box.classList.remove('hidden');
  } else {
    alert(msg);
  }
}

function passwordChecks(pw) {
  const p = String(pw || '');
  return {
    len: p.length >= 8,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    num: /\d/.test(p),
  };
}
function passwordStrong(pw) {
  const c = passwordChecks(pw);
  return c.len && c.upper && c.lower && c.num;
}
function updatePwHints(input, box) {
  if (!input || !box) return;
  const c = passwordChecks(input.value);
  const score = ['len', 'upper', 'lower', 'num'].filter((k) => c[k]).length;
  const meter = box.querySelector('.pw-meter');
  const label = box.querySelector('.pw-meter-label');
  if (meter) meter.className = `pw-meter s${score}`;
  if (label) {
    label.textContent = ['Crie uma senha forte', 'Fraca', 'Razoável', 'Boa', 'Forte'][score];
  }
  box.querySelectorAll('[data-rule]').forEach((li) => li.classList.toggle('ok', !!c[li.dataset.rule]));
}
function wirePasswordEyes() {
  const eyeOpen =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOff =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>';
  document.querySelectorAll('.pw-eye').forEach((btn) => {
    if (!btn.innerHTML.trim()) btn.innerHTML = eyeOpen;
    btn.onclick = () => {
      const input = $(btn.dataset.eye);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('on', show);
      btn.innerHTML = show ? eyeOff : eyeOpen;
      btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    };
  });
  document.querySelectorAll('.pw-rules[data-pw]').forEach((box) => {
    const input = $(box.dataset.pw);
    if (!input) return;
    const run = () => updatePwHints(input, box);
    input.addEventListener('input', run);
    run();
  });
  if ($('authPassword') && $('pwRules')) {
    $('authPassword').addEventListener('input', () => {
      if (!$('pwRules').classList.contains('hidden')) updatePwHints($('authPassword'), $('pwRules'));
    });
  }
}

/* ---------- Auth / Onboarding ---------- */
function renderNiches() {
  $('nicheGrid').innerHTML = NICHES.map(
    (n) => `<button type="button" class="niche-card ${state.selectedNiche === n.id ? 'on' : ''}" data-niche="${n.id}">
      <div class="ico">${n.ico}</div><div class="t">${n.t}</div><div class="s">${n.s}</div></button>`
  ).join('');
  $('nicheGrid').querySelectorAll('.niche-card').forEach((btn) => {
    btn.onclick = () => {
      state.selectedNiche = btn.dataset.niche;
      $('btnNicheNext').disabled = false;
      renderNiches();
    };
  });
}

function setAuthMode(mode) {
  state.mode = mode;
  const reg = mode === 'register';
  $('authTitle').textContent = reg ? 'Criar conta' : 'Bem-vindo de volta';
  $('authSub').textContent = reg ? 'Comece sua central de comissões.' : 'Acesse sua central de comissões.';
  $('btnAuth').textContent = reg ? 'Criar conta' : 'Entrar';
  $('nameField').style.display = reg ? 'block' : 'none';
  const planWrap = $('planPickWrap');
  if (planWrap) planWrap.classList.toggle('hidden', !reg);
  if (reg) syncPlanPickUi();
  const termsRow = $('termsAcceptRow');
  if (termsRow) termsRow.style.display = reg ? 'flex' : 'none';
  const pwRules = $('pwRules');
  if (pwRules) pwRules.classList.toggle('hidden', !reg);
  const pwInput = $('authPassword');
  if (pwInput) {
    pwInput.autocomplete = reg ? 'new-password' : 'current-password';
    pwInput.placeholder = reg ? 'Crie uma senha' : 'Sua senha';
    if (reg) updatePwHints(pwInput, pwRules);
  }
  $('authToggleWrap').innerHTML = reg
    ? 'Já tem conta? <a id="authToggle">Entrar</a>'
    : 'Novo por aqui? <a id="authToggle">Criar conta</a>';
  $('authToggle').onclick = () => setAuthMode(reg ? 'login' : 'register');
  $('otpField').classList.add('hidden');
  $('authError').classList.add('hidden');
  if ($('confirmBox') && !urlParams.get('confirm')) $('confirmBox').classList.add('hidden');
}

function syncPlanPickUi() {
  document.querySelectorAll('#planPick [data-plan]').forEach((b) => {
    b.classList.toggle('on', b.dataset.plan === state.selectedPlanId);
  });
  const cycle = $('regCycle');
  if (cycle) {
    cycle.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.cycle === (state.billingCycle || 'monthly'));
    });
  }
}

async function doAuth() {
  $('authError').classList.add('hidden');
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const otp = $('authOtp').value.trim();
  try {
    let data;
    if (state.mode === 'register') {
      if (!$('termsAccept')?.checked) {
        toast('Aceite os Termos de Uso e a Política de Privacidade para criar a conta.', true);
        return;
      }
      const name = $('authName').value.trim();
      if (!state.selectedPlanId) {
        toast('Escolha um plano para criar a conta.', true);
        return;
      }
      if (!passwordStrong(password)) {
        toast('Senha fraca. Use 8+ caracteres, com maiúscula, minúscula e número.', true);
        return;
      }
      data = await Api.post('/auth/register', {
        email,
        password,
        name,
        planId: state.selectedPlanId,
        billingCycle: state.billingCycle || 'monthly',
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      if (data.needsConfirm) {
        $('confirmHint').textContent = data.message || `Enviamos um link para ${data.email}. Abra o e-mail para entrar.`;
        $('confirmBox').classList.remove('hidden');
        toast(data.message || 'Confirme seu e-mail para entrar.');
        return;
      }
    } else {
      data = await Api.post('/auth/login', { email, password, otp: otp || undefined });
    }
    Api.setToken(data.token);
    state.user = data.user;
    state.nicheFields = data.nicheFields || {};
    localStorage.setItem('cp_biometry', $('bioSwitch').classList.contains('on') ? '1' : '0');
    hide($('login'));
    if (!data.user.onboardingDone) startOnboarding();
    else await enterApp();
  } catch (err) {
    if (err.data?.needsConfirm) {
      $('confirmBox').classList.remove('hidden');
      $('confirmHint').textContent = err.message;
      toast(err.message, true);
      return;
    }
    if (err.data?.requireOtp) {
      $('otpField').classList.remove('hidden');
      toast(err.data.hint || 'Informe o OTP', true);
      return;
    }
    toast(err.message || 'Falha na autenticação', true);
  }
}

function startOnboarding() {
  show($('onboarding'));
  showWizard('wizardProfile');
  $('obName').value = state.user?.name || '';
  $('obProfession').value = state.user?.profession || '';
  $('obCompany').value = state.user?.company || '';
  $('obCurrency').value = state.user?.currency || 'BRL';
}

function showWizard(id) {
  ['wizardProfile', 'wizardCommissions', 'wizardCommissionForm', 'wizardReady'].forEach((w) => {
    $(w).classList.toggle('hidden', w !== id);
  });
}

async function enterApp(startScreen) {
  hide($('onboarding'));
  hide($('login'));
  $('splash').classList.add('hide');
  show($('app'));
  applyUserChrome();
  await Promise.all([refreshStores(), loadCommissionCatalog()]);
  const fromUrl = urlParams.get('screen');
  await goTo(startScreen || fromUrl || 'dashboard');
  flushOfflineQueue();
  startInboxPoll();
}

function applyUserChrome() {
  const u = state.user;
  if (!u) return;
  const ini = initials(u.name);
  $('sideAvatar').textContent = ini;
  $('topAvatar').textContent = ini;
  $('sideName').textContent = u.name;
  $('topName').textContent = u.name.split(' ')[0];
  $('sideRole').textContent = u.profession || u.company || 'Vendedor';
  document.body.classList.toggle('theme-light', u.theme === 'light');
  document.querySelectorAll('.theme-toggle button').forEach((b) => {
    b.classList.toggle('on', b.dataset.theme === (u.theme || 'dark'));
  });
  $('cfg2fa').classList.toggle('on', !!u.twofaEnabled);
  $('cfgBio').classList.toggle('on', !!u.biometryEnabled);
  if ($('cfgNiche')) $('cfgNiche').textContent = nicheLabel(u.niche);
  if ($('cfgMulti')) $('cfgMulti').textContent = u.multiStore ? 'Sim' : 'Não';
  if ($('cfgPlan')) {
    const status = u.planStatus === 'trialing' ? 'trial' : u.planStatus || '—';
    $('cfgPlan').textContent = `${u.planName || u.plan || '—'} · ${status}`;
  }
  applyNavAccess();
}

function roleLabel(u) {
  if (!u) return '—';
  if (u.isOwner) return u.planName || 'Dono';
  const map = { admin: 'Admin', editor: 'Lançar', viewer: 'Ver', owner: 'Dono' };
  return map[u.workspaceRole] || u.profession || 'Vendedor';
}

function applyNavAccess() {
  const u = state.user;
  if (!u) return;
  $('sideRole').textContent = roleLabel(u);
  const showPipeline = ['pro', 'time'].includes(u.plan);
  const showTeam = u.canSeeTeam && ['pro', 'time'].includes(u.plan);
  const showPlanos = !!u.isOwner;
  document.querySelectorAll('[data-nav="pipeline"]').forEach((el) => el.classList.toggle('hidden', !showPipeline));
  document.querySelectorAll('[data-nav="equipe"]').forEach((el) => el.classList.toggle('hidden', !showTeam));
  document.querySelectorAll('[data-nav="planos"]').forEach((el) => el.classList.toggle('hidden', !showPlanos));
  document.body.classList.toggle('role-viewer', !u.canLaunch);
}

/* ---------- Navigation ---------- */
async function goTo(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const screen = $(`screen-${name}`);
  if (screen) screen.classList.add('active');
  document.querySelectorAll('.nav-item, .bn-item').forEach((b) => {
    const on =
      b.dataset.screen === name ||
      (name === 'comissao-form' && b.dataset.screen === 'comissoes');
    b.classList.toggle('active', on);
  });
  $('pageTitle').textContent = TITLES[name] || name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const hideFab =
    name === 'comissao-form' ||
    name === 'perfil' ||
    name === 'comissoes' ||
    name === 'dashboard' ||
    name === 'ajuda' ||
    name === 'config' ||
    name === 'planos';
  if ($('fabNewSale')) $('fabNewSale').classList.toggle('hidden', hideFab);

  if (name === 'dashboard') await loadDashboard();
  if (name === 'comissoes') await loadCommissionsScreen();
  if (name === 'perfil') loadProfileScreen();
  if (name === 'vendas') await loadSales();
  if (name === 'pipeline') await loadLeads();
  if (name === 'simulador') await loadSimulator();
  if (name === 'equipe') await loadTeam();
  if (name === 'metas') await loadGoals();
  if (name === 'comparar') await loadCompare();
  if (name === 'planos') await loadPlansScreen();
  if (name === 'pendencias') await loadPendencias();
  if (name === 'ajuda') await loadAjuda();
  if (name === 'config') {
    applyUserChrome();
    await loadNotifyPrefs();
  }
}

let inboxTimer = null;
async function refreshInboxBadge() {
  if (!Api.token) return;
  try {
    const data = await Api.get('/inbox/unread');
    const n = Number(data.unread) || 0;
    const badge = $('inboxBadge');
    if (!badge) return;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n === 0);
  } catch (_) { /* sessão expirada */ }
  try {
    const s = await Api.get('/support/unread');
    const h = Number(s.unread) || 0;
    const help = $('helpBadge');
    if (help) {
      help.textContent = h > 99 ? '99+' : String(h);
      help.classList.toggle('hidden', h === 0);
    }
  } catch (_) { /* ignore */ }
}
function startInboxPoll() {
  refreshInboxBadge();
  if (inboxTimer) clearInterval(inboxTimer);
  inboxTimer = setInterval(refreshInboxBadge, 45000);
}
async function openInbox() {
  show($('inboxOverlay'));
  const data = await Api.get('/inbox/notifications');
  const list = $('inboxList');
  if (!data.notifications?.length) {
    list.innerHTML = '<p class="empty">Nenhuma notificação ainda.</p>';
  } else {
    list.innerHTML = data.notifications
      .map(
        (n) => `<button class="notify-row ${n.read ? '' : 'unread'}" type="button" data-nid="${n.id}">
          <span class="notify-dot"></span>
          <div><div class="notify-title">${escHtml(n.title)}</div>
          <div class="notify-body">${escHtml(n.body || '')}</div></div>
        </button>`
      )
      .join('');
    list.querySelectorAll('[data-nid]').forEach((btn) => {
      btn.onclick = async () => {
        const item = data.notifications.find((x) => x.id === btn.dataset.nid);
        await Api.post(`/inbox/notifications/${btn.dataset.nid}/read`, {});
        hide($('inboxOverlay'));
        if ((item?.link || '').includes('ajuda') || item?.type === 'support') await goTo('ajuda');
        else await goTo('pendencias');
        refreshInboxBadge();
      };
    });
  }
  refreshInboxBadge();
}
async function loadPendencias() {
  const { followups } = await Api.get('/inbox/followups');
  const typeLabel = {
    receivable_due: 'Recebimento',
    lead_stale: 'Lead',
    invite_pending: 'Convite',
    trial_ending: 'Trial',
  };
  $('pendenciasList').innerHTML = followups.length
    ? followups
        .map(
          (f) => `<div class="pend-card">
            <h4>${escHtml(f.title)}</h4>
            <p>${escHtml(typeLabel[f.type] || f.type)} · ${escHtml(f.body || '')}</p>
            <button class="btn-secondary" type="button" data-done="${f.id}">Marcar como feito</button>
          </div>`
        )
        .join('')
    : '<p class="empty">Nada pendente agora. Quando um recebimento vencer, um lead parar ou o trial acabar, aparece aqui.</p>';
  $('pendenciasList').querySelectorAll('[data-done]').forEach((btn) => {
    btn.onclick = async () => {
      await Api.post(`/inbox/followups/${btn.dataset.done}/done`, {});
      await loadPendencias();
      refreshInboxBadge();
    };
  });
  refreshInboxBadge();
}

async function loadNotifyPrefs() {
  try {
    const { prefs } = await Api.get('/inbox/prefs');
    document.querySelectorAll('[data-pref]').forEach((btn) => {
      btn.classList.toggle('on', prefs[btn.dataset.pref] !== false);
    });
  } catch (_) { /* ignore */ }
}

/* ---------- Perfil & comissões do vendedor ---------- */
async function loadCommissionCatalog() {
  if (state.catalog) return state.catalog;
  try {
    state.catalog = await Api.get('/commissions/catalog');
  } catch {
    state.catalog = window.CommissionUI.FALLBACK_CATALOG;
  }
  return state.catalog;
}

async function refreshCommissions() {
  const { commissions } = await Api.get('/commissions');
  state.commissions = commissions || [];
  return state.commissions;
}

function firstName() {
  return (state.user?.name || '').split(/\s+/)[0] || 'olá';
}

async function loadCommissionsScreen() {
  await refreshCommissions();
  $('commLead').textContent = `Olá, ${firstName()}! Configure como você recebe suas comissões.`;
  $('commissionsList').innerHTML = CommissionUI.listHtml(state.commissions);
  const canManage = !!state.user?.canManage;
  if ($('btnAddCommission')) $('btnAddCommission').classList.toggle('hidden', !canManage);
  $('commissionsList').querySelectorAll('[data-edit-commission]').forEach((btn) => {
    if (!canManage) {
      btn.classList.add('hidden');
      return;
    }
    btn.onclick = () => openCommissionForm(btn.dataset.editCommission, 'comissoes');
  });
}

function loadProfileScreen() {
  const u = state.user || {};
  $('perfilHello').textContent = `Olá, ${firstName()}! Seus dados profissionais.`;
  $('pfName').value = u.name || '';
  $('pfProfession').value = u.profession || '';
  $('pfCompany').value = u.company || '';
  $('pfCurrency').value = u.currency || 'BRL';
}

async function saveProfileFrom(nameId, professionId, companyId, currencyId) {
  const name = $(nameId).value.trim();
  if (!name) throw new Error('Informe seu nome.');
  const data = await Api.patch('/auth/me', {
    name,
    profession: $(professionId).value.trim(),
    company: $(companyId).value.trim(),
    currency: $(currencyId).value,
  });
  state.user = data.user;
  applyUserChrome();
}

function renderCommissionForm(mountId) {
  const catalog = state.catalog || CommissionUI.FALLBACK_CATALOG;
  const root = $(mountId);
  root.innerHTML = CommissionUI.formHtml(state.commissionDraft, catalog);
  CommissionUI.bindForm(root, state.commissionDraft, catalog, () => renderCommissionForm(mountId));
}

async function openCommissionForm(id, from) {
  await loadCommissionCatalog();
  state.commissionFormReturn = from || 'comissoes';
  if (id) {
    const { commission } = await Api.get(`/commissions/${id}`);
    state.commissionDraft = CommissionUI.draftFrom(commission);
  } else {
    state.commissionDraft = CommissionUI.emptyDraft();
  }
  const editing = !!state.commissionDraft.id;
  if (from === 'onboarding') {
    $('obFormTitle').textContent = editing ? 'Editar comissão' : 'Nova comissão';
    renderCommissionForm('obCfMount');
    showWizard('wizardCommissionForm');
    return;
  }
  $('cfPageTitle').textContent = editing ? 'Editar comissão' : 'Nova comissão';
  $('btnDeleteCommission').classList.toggle('hidden', !editing);
  if ($('cfError')) {
    $('cfError').classList.add('hidden');
    $('cfError').textContent = '';
  }
  $('btnSaveCommission').disabled = false;
  $('btnSaveCommission').textContent = 'Salvar comissão';
  renderCommissionForm('cfMount');
  await goTo('comissao-form');
}

async function saveCommissionFrom(mountId) {
  if (!state.commissionDraft) {
    throw new Error('Abra o formulário novamente para salvar.');
  }
  const root = $(mountId);
  if (!root) throw new Error('Formulário não encontrado.');
  CommissionUI.syncDraftFromDom(root, state.commissionDraft);
  const payload = CommissionUI.payloadFromDraft(state.commissionDraft);
  if (!payload.name) throw new Error('Informe o nome da comissão.');
  if (state.commissionDraft.id) {
    await Api.patch(`/commissions/${state.commissionDraft.id}`, payload);
  } else {
    await Api.post('/commissions', payload);
  }
}

function showFormError(boxId, msg) {
  const box = $(boxId);
  if (!box) {
    alert(msg);
    return;
  }
  box.textContent = msg;
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function handleSaveCommission(btn, mountId, errorBoxId, afterSave) {
  const box = $(errorBoxId);
  if (box) {
    box.classList.add('hidden');
    box.textContent = '';
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    await saveCommissionFrom(mountId);
    btn.textContent = 'Salva';
    await afterSave();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original;
    showFormError(errorBoxId, err.message || 'Não foi possível salvar a comissão.');
  }
}

async function renderOnboardingCommissionList() {
  await refreshCommissions();
  $('obCommissionList').innerHTML = CommissionUI.listHtml(state.commissions);
  $('btnObCommissionsNext').disabled = state.commissions.length === 0;
  $('obCommissionList').querySelectorAll('[data-edit-commission]').forEach((btn) => {
    btn.onclick = () => openCommissionForm(btn.dataset.editCommission, 'onboarding');
  });
}

/* ---------- Stores ---------- */
async function refreshStores() {
  try {
    const { stores } = await Api.get('/stores');
    state.stores = stores || [];
  } catch {
    state.stores = [];
  }
  const sel = $('storeFilter');
  if (sel) {
    const cur = state.selectedStoreId;
    sel.innerHTML =
      `<option value="">Todas</option>` +
      state.stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    sel.value = cur;
  }
}

async function loadStoresScreen() {
  await refreshStores();
  const list = $('storesList');
  if (!list) return;
  if (!state.stores.length) {
    list.innerHTML = '<p class="empty">Nenhuma loja cadastrada.</p>';
    return;
  }
  list.innerHTML = state.stores.map((s) => `
    <button class="store-card" data-id="${s.id}" type="button">
      <div class="store-logo" style="background:${s.color}">${s.logoInitials || initials(s.name)}</div>
      <div class="store-info">
        <div class="name">${s.name}</div>
        <div class="meta">Fat. mês: ${fmt(s.monthlyRevenue)} · ${RULE_LABELS[s.ruleType] || s.ruleType}</div>
      </div>
      <div class="store-figure">
        <div class="amt">${fmt(s.monthlyCommission)}</div>
        <span class="stat ${s.payoutStatus}">${s.payoutStatus === 'quitado' ? 'Em dia' : 'Repasse pendente'}</span>
      </div>
    </button>`).join('') +
    `<button class="add-card" id="btnAddStoreCard" type="button">+ Adicionar nova loja</button>`;

  list.querySelectorAll('.store-card').forEach((btn) => {
    btn.onclick = () => openRuleEditor(btn.dataset.id);
  });
  const add = $('btnAddStoreCard');
  if (add) add.onclick = openStoreModal;
}

function openRuleEditor(storeId) {
  state.editingStoreId = storeId;
  const s = state.stores.find((x) => x.id === storeId);
  if (!s) return;
  const bands = (s.rule.bands || [])
    .map((b, i) => `<div class="kv"><span>Faixa ${i + 1}: ${b.min}${b.max ? '–' + b.max : '+'} un.</span><span>${(b.percent * 100).toFixed(2).replace('.', ',')}%</span></div>`)
    .join('');
  $('ruleEditor').innerHTML = `
    <div class="form-field" style="margin-bottom:12px"><label>Loja</label><input value="${s.name}" disabled></div>
    <div class="form-field" style="margin-bottom:12px"><label>Modelo de cálculo</label>
      <select id="editRuleType">${Object.entries(RULE_LABELS).map(([k, v]) => `<option value="${k}" ${k === s.ruleType ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    <div class="form-field" style="margin-bottom:12px"><label>Prazo de pagamento (dias)</label>
      <input type="number" id="editPaymentDays" value="${s.paymentDays}">
    </div>
    <div id="editRuleBody">${s.ruleType === 'bands' ? bands : `<div class="kv"><span>Parâmetros</span><span>${JSON.stringify(s.rule)}</span></div>`}</div>
    <div class="form-field" style="margin-top:12px"><label>% fixo / margem (quando aplicável)</label>
      <input type="number" step="0.001" id="editPercent" value="${s.rule.percent || s.rule.percentOnMargin || 0.03}">
    </div>
    <button class="btn-primary" style="margin-top:14px" id="btnSaveRules">Salvar regras (nova versão / snapshot futuro)</button>
    <p style="font-size:11px;color:var(--text-faint);margin-top:10px">RN-01: vendas passadas mantêm a regra da época. Esta alteração vale da data de hoje em diante.</p>
  `;
  $('btnSaveRules').onclick = async () => {
    const ruleType = $('editRuleType').value;
    let rule = { ...s.rule };
    if (ruleType === 'fixed' || ruleType === 'cash_on_receipt') rule = { percent: Number($('editPercent').value), extraBonus: 0 };
    if (ruleType === 'margin') rule = { percentOnMargin: Number($('editPercent').value), defaultCost: 0, extraBonus: 0 };
    if (ruleType === 'bands' && !rule.bands) {
      rule = {
        volumeBasis: 'units',
        bands: [
          { min: 1, max: 4, percent: 0.003 },
          { min: 5, max: 7, percent: 0.004 },
          { min: 8, max: 10, percent: 0.0055 },
          { min: 11, max: null, percent: 0.007 },
        ],
      };
    }
    await Api.patch(`/stores/${storeId}`, {
      ruleType,
      rule,
      paymentDays: Number($('editPaymentDays').value),
    });
    alert('Regras atualizadas. Nova versão registrada na auditoria.');
    await loadStoresScreen();
    openRuleEditor(storeId);
  };
}

function openStoreModal() {
  $('storeForm').innerHTML = `
    <div class="form-field full"><label>Nome</label><input id="nsName"></div>
    <div class="form-field"><label>CNPJ</label><input id="nsCnpj"></div>
    <div class="form-field"><label>Cor</label><input id="nsColor" type="color" value="#3FDA9A"></div>
    <div class="form-field full"><label>Modelo</label>
      <select id="nsRule">${Object.entries(RULE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    </div>
    <div class="form-field full"><label>Prazo (dias)</label><input id="nsDays" type="number" value="30"></div>`;
  show($('storeOverlay'));
}

/* ---------- Dashboard ---------- */
async function loadDashboard() {
  const scope = state.user?.canSeeTeam ? state.dashScope || 'workspace' : 'me';
  const data = await Api.get(`/dashboard?scope=${scope}`);
  const k = data.kpis;
  const monthLabel = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  $('dashHello').textContent = `Olá, ${firstName()}! ${data.scope === 'workspace' ? 'Visão do espaço.' : 'Toque numa comissão para lançar.'}`;
  $('dashMonthLabel').textContent = `Comissão · ${monthLabel}`;
  $('kpiCommission').textContent = fmt(k.commissionMonth);
  $('kpiReceived').textContent = fmt(k.commissionReceived);
  $('kpiPipeline').textContent = fmt(k.pipeline);
  $('kpiSalesCount').textContent = `${k.salesCount} lançamento${k.salesCount === 1 ? '' : 's'} neste mês`;
  const today = (data.byCommission || []).reduce((s, c) => s + (Number(c.todayCommission) || 0), 0);
  if ($('kpiToday')) $('kpiToday').textContent = fmt(today);
  renderReceiveConfirm(data.dueToConfirm || [], data.dueTotal || 0);

  const tabs = $('dashScopeTabs');
  if (tabs) {
    tabs.classList.toggle('hidden', !data.canSeeTeam);
    tabs.querySelectorAll('[data-scope]').forEach((b) => {
      b.classList.toggle('on', b.dataset.scope === scope);
      b.classList.toggle('active', b.dataset.scope === scope);
      b.onclick = () => {
        state.dashScope = b.dataset.scope;
        loadDashboard();
      };
    });
  }

  const goalBox = $('dashGoalBox');
  if (goalBox) {
    if (data.goal) {
      goalBox.classList.remove('hidden');
      const pct = Math.min(100, data.goal.percent || 0);
      const unit = data.goal.metric === 'quantity' ? `${Math.round(data.goal.current)} / ${Math.round(data.goal.target)}` : `${fmt(data.goal.current)} / ${fmt(data.goal.target)}`;
      goalBox.innerHTML = `<div class="goal-meta"><span>Meta do ${data.goal.metric === 'quantity' ? 'mês (qtd)' : 'mês'}</span><strong>${Math.round(data.goal.percent)}%</strong></div>
        <div class="goal-track"><span style="width:${pct}%"></span></div>
        <div class="goal-sub">${unit} · faltam ${data.goal.metric === 'quantity' ? data.goal.remaining : fmt(data.goal.remaining)}</div>`;
    } else {
      goalBox.classList.add('hidden');
      goalBox.innerHTML = '';
    }
  }

  const rankWrap = $('dashRankingWrap');
  if (rankWrap) {
    const show = data.scope === 'workspace' && (data.ranking || []).length;
    rankWrap.classList.toggle('hidden', !show);
    if (show) {
      $('dashRanking').innerHTML = data.ranking
        .map(
          (r, i) => `<button class="sale-row" type="button" data-seller="${r.sellerId}">
            <span class="sale-dot pendente"></span>
            <div class="sale-main"><div class="title">${i + 1}. ${r.name}</div>
            <div class="sub">${r.launches} lançamento${r.launches === 1 ? '' : 's'}</div></div>
            <div class="sale-amt"><div class="v mono">${fmt(r.commission)}</div></div>
          </button>`
        )
        .join('');
      $('dashRanking').querySelectorAll('[data-seller]').forEach((btn) => {
        btn.onclick = () => {
          state.dashScope = 'me';
          state.previewSellerId = btn.dataset.seller;
          loadDashboard();
        };
      });
    }
  }
  const alerts = $('dashAlerts');
  if (alerts) {
    alerts.innerHTML = (data.alerts || [])
      .map((a) => `<p class="screen-lead">${a.name} ainda não lançou neste mês.</p>`)
      .join('');
    try {
      const pend = await Api.get('/inbox/followups');
      const extra = (pend.followups || []).filter((f) => f.type !== 'receivable_due').length;
      if (extra) {
        alerts.insertAdjacentHTML(
          'afterbegin',
          `<p class="screen-lead"><button class="link" type="button" data-go-pend>Você tem ${extra} pendência${extra === 1 ? '' : 's'} além dos recebimentos.</button></p>`
        );
        alerts.querySelector('[data-go-pend]')?.addEventListener('click', () => goTo('pendencias'));
      }
    } catch (_) { /* ignore */ }
  }

  const list = $('dashCommissionList');
  const types = data.byCommission || [];
  const canLaunch = data.canLaunch !== false && state.user?.canLaunch !== false;
  if (!types.length) {
    list.innerHTML = `<p class="empty">Cadastre uma comissão para começar a lançar.<br><button class="link" type="button" id="dashGoCommissions">Ir para minhas comissões</button></p>`;
    const go = $('dashGoCommissions');
    if (go) go.onclick = () => goTo('comissoes');
  } else {
    list.innerHTML = types
      .map(
        (c) => `
      <div class="launch-card">
        <button class="comm-card-body" type="button" data-history="${c.id}">
          <h3>${c.name}</h3>
          <p class="comm-detail">${c.detail || ''} · ${c.highlight || ''}</p>
          <div class="comm-highlight">${fmt(c.monthCommission)} este mês</div>
          <p class="comm-receive">${c.monthCount || 0} lançamento${c.monthCount === 1 ? '' : 's'} · recebe ${(c.receiveLabel || '').toLowerCase()}</p>
        </button>
        ${canLaunch ? `<button class="launch-cta" type="button" data-launch="${c.id}">Lançar</button>` : ''}
      </div>`
      )
      .join('');
    list.querySelectorAll('[data-history]').forEach((btn) => {
      btn.onclick = () => openCommissionHistory(btn.dataset.history, types);
    });
    list.querySelectorAll('[data-launch]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openLaunch(btn.dataset.launch, types);
      };
    });
  }

  $('recentSales').innerHTML = (data.recent || []).length
    ? data.recent
        .map(
          (s) => `
      <div class="tx-row">
        <div class="tx-main"><div class="t">${s.title}</div>
        <div class="s">${s.sellerName ? s.sellerName + ' · ' : ''}${s.commissionName || s.storeName || '—'} · ${s.saleDate}</div></div>
        <div class="tx-amt ${s.status === 'cancelada' ? 'neg' : 'pos'}">${s.status === 'cancelada' ? '—' : '+' + fmt(s.commissionTotal)}</div>
      </div>`
        )
        .join('')
    : '<p class="empty">Nenhum lançamento ainda</p>';
}

function fmtDay(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function renderReceiveConfirm(items, total) {
  const box = $('receiveConfirmBanner');
  if (!box) return;
  if (!items.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const extra = items.length > 4 ? `<li>e mais ${items.length - 4}…</li>` : '';
  const rows = items
    .slice(0, 4)
    .map(
      (r) =>
        `<li>${r.saleTitle || r.label} · ${fmtDay(r.dueDate)} · ${fmt(r.amount)}</li>`
    )
    .join('');
  box.classList.remove('hidden');
  box.innerHTML = `
    <h4>Confirme o que deveria ter entrado</h4>
    <p>${items.length} recebimento${items.length === 1 ? '' : 's'} no total de <strong>${fmt(total)}</strong> com vencimento até hoje. Confira se caiu na conta.</p>
    <ul>${rows}${extra}</ul>
    <div class="row-actions">
      <button type="button" class="btn-confirm" id="btnConfirmAllDue">Confirmar todos</button>
    </div>`;
  const all = $('btnConfirmAllDue');
  if (all) {
    all.onclick = async () => {
      all.disabled = true;
      all.textContent = 'Confirmando…';
      try {
        await Api.post('/dashboard/receivables/confirm-due', { ids: items.map((r) => r.id) });
        await loadDashboard();
      } catch (e) {
        all.disabled = false;
        all.textContent = 'Confirmar todos';
        alert(e.message || 'Não foi possível confirmar.');
      }
    };
  }
}

async function openCommissionHistory(commissionId, types) {
  const list = types || state.commissions || [];
  const type = list.find((c) => c.id === commissionId);
  if (!type) return;
  state.launchCommission = type;
  $('historyTitle').textContent = type.name;
  $('historySub').textContent = `${type.detail || ''} · ${type.monthCount || 0} lançamento${type.monthCount === 1 ? '' : 's'} neste mês`;
  $('historyList').innerHTML = '<p class="empty">Carregando…</p>';
  show($('historyOverlay'));
  try {
    const { sales } = await Api.get(`/sales?commissionTypeId=${encodeURIComponent(type.id)}`);
    $('historyList').innerHTML = sales.length
      ? sales
          .map(
            (s) => `
      <button class="sale-row" type="button" data-id="${s.id}">
        <span class="sale-dot ${s.status}"></span>
        <div class="sale-main"><div class="title">${s.title}</div>
        <div class="sub">${s.saleDate} · ${s.status}</div></div>
        <div class="sale-amt"><div class="v mono">${fmt(s.grossValue)}</div>
        <div class="c mono">${s.status === 'cancelada' ? '—' : '+' + fmt(s.commissionTotal)}</div></div>
      </button>`
          )
          .join('')
      : '<p class="empty">Nenhum lançamento nesta comissão ainda.</p>';
    $('historyList').querySelectorAll('.sale-row').forEach((btn) => {
      btn.onclick = () => {
        hide($('historyOverlay'));
        openSaleDetail(btn.dataset.id);
      };
    });
  } catch (e) {
    $('historyList').innerHTML = `<p class="empty">${e.message || 'Não foi possível carregar.'}</p>`;
  }
  const launchBtn = $('btnHistoryLaunch');
  if (launchBtn) {
    launchBtn.onclick = () => {
      hide($('historyOverlay'));
      openLaunch(type.id, list);
    };
  }
}

function launchInputs() {
  const type = state.launchCommission;
  if (!type) return {};
  return {
    grossValue: Number($('launchValue')?.value) || 0,
    quantity: Number($('launchQty')?.value) || 1,
    costValue: Number($('launchCost')?.value) || 0,
    receiveDate: $('launchReceive')?.value || '',
    clientName: $('launchClient')?.value?.trim() || '',
    phone: $('launchPhone')?.value?.trim() || '',
    email: $('launchEmail')?.value?.trim() || '',
    notes: $('launchNotes')?.value?.trim() || '',
    monthCount: type.monthCount || 0,
    monthRevenue: type.monthRevenue || 0,
    commissionAmount: $('launchCommission') ? Number($('launchCommission').value) : undefined,
    flexPercent: $('launchFlex') ? Number($('launchFlex').value) || 0 : 0,
  };
}

function renderLaunchPreview() {
  const type = state.launchCommission;
  const box = $('launchPreview');
  if (!type || !box) return;
  const p = CommissionUI.preview(type, launchInputs());
  const receive = type.receiveLabel ? ` · recebe ${type.receiveLabel.toLowerCase()}` : '';
  const extra =
    p.monthRecalc && p.previousCount && p.monthRate != null
      ? `<div class="note extra">Os ${p.previousCount} lançamento${p.previousCount === 1 ? '' : 's'} anterior${p.previousCount === 1 ? '' : 'es'} deste mês também passam para ${String(p.monthRate).replace('.', ',')}%.</div>`
      : '';
  box.innerHTML = `<div class="lbl">Sua comissão</div>
    <div class="num">${fmt(p.amount)}</div>
    <div class="note">${p.note || ''}${receive}</div>${extra}`;
}

function openLaunch(commissionId, types) {
  const list = types || state.commissions || [];
  const type = list.find((c) => c.id === commissionId);
  if (!type) {
    alert('Comissão não encontrada. Cadastre suas regras em Minhas Comissões.');
    return goTo('comissoes');
  }
  state.launchCommission = type;
  $('launchTitle').textContent = `Lançar · ${type.name}`;
  $('launchRule').textContent = `${type.detail} · ${type.highlight}`;
  if ($('launchError')) {
    $('launchError').classList.add('hidden');
    $('launchError').textContent = '';
  }
  const needsQty = type.calcType === 'quantity' || type.config?.per === 'unit';
  const needsCost = type.config?.appliedOn === 'margin' || type.config?.appliedOn === 'net_value';
  const needsReceive = type.receiveWhen === 'per_entry';
  const isPrize = type.calcType === 'prize';
  const isFlex = type.calcType === 'flex';
  const itemLabel = isPrize ? type.config?.itemLabel || 'Valor do item' : 'Valor';
  $('saleForm').innerHTML = `
    <div class="field"><label>${itemLabel} <span class="req">obrigatório</span></label>
      <input id="launchValue" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required></div>
    ${isPrize ? `<div class="field"><label>Valor da premiação <span class="req">obrigatório</span></label>
      <input id="launchCommission" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required></div>` : ''}
    ${isFlex ? `<div class="field"><label>Flexibilização</label>
      <div class="suffix-input"><input id="launchFlex" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" value="0"><span>%</span></div>
      <p class="field-hint">% desta venda que você flexibilizou. 0 = sem flex. Até 3% = comissão de 0,5%.</p></div>` : ''}
    <div class="field"><label>Nome do cliente <span class="opt">(opcional)</span></label>
      <input id="launchClient" type="text" placeholder="Nome" autocomplete="name"></div>
    <div class="field"><label>Número <span class="opt">(opcional)</span></label>
      <input id="launchPhone" type="tel" placeholder="WhatsApp ou telefone" inputmode="tel" autocomplete="tel"></div>
    <div class="field"><label>E-mail <span class="opt">(opcional)</span></label>
      <input id="launchEmail" type="email" placeholder="email@exemplo.com" autocomplete="email"></div>
    <div class="field"><label>Observações <span class="opt">(opcional)</span></label>
      <textarea id="launchNotes" rows="3" placeholder="Detalhes da venda, veículo, pedido…"></textarea></div>
    ${needsQty ? `<div class="field"><label>Quantidade</label>
      <input id="launchQty" type="number" min="1" step="1" value="1"></div>` : ''}
    ${needsCost ? `<div class="field"><label>Custo</label>
      <input id="launchCost" type="number" min="0" step="0.01" value="0"></div>` : ''}
    ${needsReceive ? `<div class="field"><label>Quando você recebe?</label>
      <input id="launchReceive" type="date"></div>` : ''}
  `;
  ['launchValue', 'launchQty', 'launchCost', 'launchCommission', 'launchFlex'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', renderLaunchPreview);
  });
  renderLaunchPreview();
  const val = $('launchValue');
  show($('saleOverlay'));
  if (val) setTimeout(() => val.focus(), 80);
}

async function saveSale() {
  const type = state.launchCommission;
  if (!type) return;
  const err = $('launchError');
  if (err) {
    err.classList.add('hidden');
    err.textContent = '';
  }
  const input = launchInputs();
  if (type.calcType === 'prize') {
    if ($('launchValue')?.value === '') {
      if (err) {
        err.textContent = 'Informe o valor do item.';
        err.classList.remove('hidden');
      }
      return;
    }
    if ($('launchCommission')?.value === '') {
      if (err) {
        err.textContent = 'Informe o valor da premiação.';
        err.classList.remove('hidden');
      }
      return;
    }
  } else if (type.calcType !== 'fixed' && type.calcType !== 'quantity' && !input.grossValue) {
    if (err) {
      err.textContent = 'Informe o valor do lançamento.';
      err.classList.remove('hidden');
    }
    return;
  }
  const btn = $('btnSaveSale');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Lançando…';
  try {
    await Api.post('/sales', {
      commissionTypeId: type.id,
      grossValue: input.grossValue,
      quantity: input.quantity,
      costValue: input.costValue,
      commissionAmount: type.calcType === 'prize' ? input.commissionAmount : undefined,
      flexPercent: type.calcType === 'flex' ? input.flexPercent : undefined,
      clientName: input.clientName,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      receiveDate: input.receiveDate || undefined,
    });
    hide($('saleOverlay'));
    await goTo('dashboard');
  } catch (e) {
    if (err) {
      err.textContent = e.message || 'Não foi possível lançar.';
      err.classList.remove('hidden');
    } else alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function drawSeriesChart(svgId, axisId, series, mode) {
  const svg = $(svgId);
  const pts = series.map((s) => (mode === 'revenue' ? s.revenue || s.total || 0 : s.commission || s.total || 0));
  if (!pts.length) {
    svg.innerHTML = '';
    $(axisId).innerHTML = '';
    return;
  }
  const w = 600, h = 160, pad = 8;
  const max = Math.max(...pts, 1), min = Math.min(...pts, 0);
  const stepX = (w - pad * 2) / Math.max(pts.length - 1, 1);
  const coords = pts.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
    return [x, y];
  });
  const line = coords.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0]},${h} L${coords[0][0]},${h} Z`;
  svg.innerHTML = `<defs><linearGradient id="g${svgId}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3FDA9A" stop-opacity=".28"/><stop offset="100%" stop-color="#3FDA9A" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#g${svgId})"/><path d="${line}" fill="none" stroke="#3FDA9A" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="${coords[coords.length - 1][0]}" cy="${coords[coords.length - 1][1]}" r="4" fill="#3FDA9A"/>`;
  $(axisId).innerHTML = series.map((s) => `<span>${s.label || s.month?.slice(5) || ''}</span>`).join('');
}

function renderLadder(stepsId, labelsId, bands, units) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  $(stepsId).innerHTML = sorted.map((t, i) => {
    let cls = '';
    const thr = t.max ?? 9999;
    if (units >= thr) cls = 'filled';
    else if (units >= t.min) cls = 'current';
    return `<div class="ladder-step ${cls}" style="height:${26 + i * 13}px"><span class="pct">${(t.percent * 100).toFixed(2).replace('.', ',')}%</span></div>`;
  }).join('');
  if (labelsId) {
    $(labelsId).innerHTML = sorted.map((t) => `<span>${t.min}${t.max ? '–' + t.max : '+'}</span>`).join('');
  }
}

/* ---------- Sales ---------- */
async function loadSales() {
  const params = new URLSearchParams();
  if (state.saleStatus && state.saleStatus !== 'todas') params.set('status', state.saleStatus);
  if (state.selectedStoreId) params.set('storeId', state.selectedStoreId);
  if ($('saleFrom').value) params.set('from', $('saleFrom').value);
  if ($('saleTo').value) params.set('to', $('saleTo').value);
  if ($('saleQuery').value.trim()) params.set('q', $('saleQuery').value.trim());
  if ($('globalSearch').value.trim()) params.set('q', $('globalSearch').value.trim());
  const { sales } = await Api.get(`/sales?${params}`);
  $('salesList').innerHTML = sales.length
    ? sales.map((s) => `
      <button class="sale-row" type="button" data-id="${s.id}">
        <span class="sale-dot ${s.status}"></span>
        <div class="sale-main"><div class="title">${s.title}</div>
        <div class="sub">${s.commissionName || s.storeName || '—'} · ${s.saleDate}</div></div>
        <div class="sale-amt"><div class="v mono">${fmt(s.grossValue)}</div>
        <div class="c mono">${s.status === 'cancelada' ? '—' : '+' + fmt(s.commissionTotal)}</div></div>
      </button>`).join('')
    : '<p class="empty">Nenhuma venda encontrada</p>';
  $('salesList').querySelectorAll('.sale-row').forEach((btn) => {
    btn.onclick = () => openSaleDetail(btn.dataset.id);
  });
}

async function openSaleDetail(id) {
  const { sale, receivables } = await Api.get(`/sales/${id}`);
  state.currentSaleId = id;
  $('detailTitle').textContent = sale.title;
  const snap = sale.snapshot || {};
  const snapNote = snap.monthRecalc
    ? `Faixa do mês: <strong>${snap.bandLabel || '—'}</strong> — ${snap.engineNote || 'o % atual vale para todos os lançamentos do período'}.`
    : `Snapshot histórico: regra vigente em <strong>${sale.saleDate}</strong> — ${snap.bandLabel || '—'} (${snap.engineNote || ''}).`;
  $('detailSnap').innerHTML = snapNote;
  $('detailBody').innerHTML = `
    <div class="kv"><span>Comissão</span><span>${sale.commissionName || sale.snapshot?.commissionName || '—'}</span></div>
    <div class="kv"><span>Cliente</span><span>${sale.clientName || '—'}</span></div>
    <div class="kv"><span>Valor</span><span>${fmt(sale.grossValue)}</span></div>
    <div class="kv"><span>Faixa / regra</span><span>${sale.snapshot?.bandLabel || '—'}</span></div>
    <div class="kv"><span>Comissão oficial</span><span>${fmt(sale.commissionOfficial)}</span></div>
    <div class="kv"><span>Por fora</span><span>${fmt(sale.commissionExtra)}</span></div>
    <div class="kv" style="border:none"><span>Total</span><span>${fmt(sale.commissionTotal)}</span></div>
    <div class="section-title">Recebíveis</div>
    ${(receivables || []).map((r) => `<div class="kv"><span>${r.label} (${r.kind}) · ${r.dueDate}</span><span>${fmt(r.amount)} · ${r.status}</span></div>`).join('') || '<p class="empty">—</p>'}`;
  $('detailStatus').value = sale.status;
  show($('detailOverlay'));
}

/* ---------- Leads / Receivables ---------- */
async function loadLeads() {
  const { leads } = await Api.get('/leads');
  $('leadsList').innerHTML = leads.length
    ? leads.map((l) => `
      <div class="lead-card">
        <div class="lead-main">
          <div class="title">${l.title}</div>
          <div class="sub">${l.clientName || '—'} · ${fmt(l.value)} · prob. ${l.probability}%</div>
        </div>
        <span class="stage-pill">${l.stage}</span>
        <div class="sale-amt"><div class="v">${fmt(l.expectedCommission)}</div><div class="c">esperada</div></div>
      </div>`).join('')
    : '<p class="empty">Nenhum lead. Clique em + Lead.</p>';
}

function openLeadModal() {
  $('leadForm').innerHTML = `
    <div class="form-field full"><label>Título</label><input id="leadTitle"></div>
    <div class="form-field full"><label>Cliente</label><input id="leadClient"></div>
    <div class="form-field"><label>Valor</label><input id="leadValue" type="number"></div>
    <div class="form-field"><label>Probabilidade %</label><input id="leadProb" type="number" value="50"></div>
    <div class="form-field full"><label>Estágio</label>
      <select id="leadStage"><option>lead</option><option>proposta</option><option>negociacao</option><option>fechado</option><option>perdido</option></select></div>`;
  show($('leadOverlay'));
}

async function loadReceivables() {
  const { receivables } = await Api.get('/dashboard/receivables');
  const today = new Date().toISOString().slice(0, 10);
  const due = receivables.filter((r) => r.status !== 'quitado' && r.status !== 'cancelado' && r.dueDate <= today);
  const rest = receivables.filter((r) => !due.includes(r));
  const ordered = [...due, ...rest];
  const head = due.length
    ? `<div class="receive-banner" style="margin-bottom:14px"><h4>Confirme o que deveria ter entrado</h4>
        <p>${due.length} item${due.length === 1 ? '' : 's'} com vencimento até hoje. Toque em confirmar em cada um, ou todos de uma vez.</p>
        <div class="row-actions"><button type="button" class="btn-confirm" id="btnConfirmDueList">Confirmar vencidos (${due.length})</button></div></div>`
    : '';
  $('receivablesList').innerHTML =
    head +
    (ordered.length
      ? ordered
          .map((r) => {
            const overdue = r.status !== 'quitado' && r.status !== 'cancelado' && r.dueDate <= today;
            return `
      <div class="sale-row" style="cursor:default${overdue ? ';border-color:rgba(232,163,61,.45)' : ''}">
        <span class="sale-dot ${r.status === 'quitado' ? 'quitada' : 'pendente'}"></span>
        <div class="sale-main"><div class="title">${r.saleTitle} — ${r.label}</div>
        <div class="sub">${r.storeName} · venc. ${fmtDay(r.dueDate)} · ${r.kind}${overdue ? ' · confirmar' : ''}</div></div>
        <div class="sale-amt"><div class="v">${fmt(r.amount)}</div>
        <button class="chip ${r.status === 'quitado' ? 'active' : ''}" data-rid="${r.id}" style="margin-top:6px">${r.status === 'quitado' ? 'quitado' : 'Confirmar'}</button></div>
      </div>`;
          })
          .join('')
      : '<p class="empty">Sem recebíveis</p>');
  const bulk = $('btnConfirmDueList');
  if (bulk) {
    bulk.onclick = async () => {
      bulk.disabled = true;
      try {
        await Api.post('/dashboard/receivables/confirm-due', { ids: due.map((r) => r.id) });
        await loadReceivables();
      } catch (e) {
        bulk.disabled = false;
        alert(e.message || 'Não foi possível confirmar.');
      }
    };
  }
  $('receivablesList').querySelectorAll('[data-rid]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.textContent === 'quitado') return;
      await Api.patch(`/dashboard/receivables/${btn.dataset.rid}`, { status: 'quitado' });
      await loadReceivables();
    };
  });
}

/* ---------- Tools ---------- */
async function loadSimulator() {
  const { commissions } = await Api.get('/commissions');
  state.commissions = commissions || [];
  let dash = { byCommission: [] };
  try {
    dash = await Api.get('/dashboard');
  } catch {
    /* preview still works without month counts */
  }
  const counts = {};
  (dash.byCommission || []).forEach((c) => {
    counts[c.id] = { monthCount: c.monthCount || 0, monthRevenue: c.monthRevenue || 0 };
  });
  state.simCounts = counts;
  const sel = $('simCommission');
  if (!sel) return;
  if (!state.commissions.length) {
    sel.innerHTML = '<option value="">Cadastre uma comissão</option>';
    $('simResult').textContent = fmt(0);
    if ($('simNote')) $('simNote').textContent = 'Cadastre uma comissão em Minhas Comissões.';
    return;
  }
  sel.innerHTML = state.commissions.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  sel.onchange = () => {
    syncSimFields();
    runSim();
  };
  ['simValue', 'simFlex', 'simQty', 'simPrize', 'simCost'].forEach((id) => {
    const n = $(id);
    if (n) n.oninput = runSim;
  });
  syncSimFields();
  runSim();
}

function currentSimType() {
  const id = $('simCommission')?.value;
  const type = (state.commissions || []).find((c) => c.id === id);
  if (!type) return null;
  const extra = (state.simCounts || {})[type.id] || {};
  return { ...type, monthCount: extra.monthCount || 0, monthRevenue: extra.monthRevenue || 0 };
}

function syncSimFields() {
  const type = currentSimType();
  if (!type) return;
  const flex = type.calcType === 'flex';
  const qty = type.calcType === 'quantity' || type.config?.per === 'unit';
  const prize = type.calcType === 'prize';
  const cost = type.config?.appliedOn === 'margin' || type.config?.appliedOn === 'net_value';
  $('simFlexWrap')?.classList.toggle('hidden', !flex);
  $('simQtyWrap')?.classList.toggle('hidden', !qty);
  $('simPrizeWrap')?.classList.toggle('hidden', !prize);
  $('simCostWrap')?.classList.toggle('hidden', !cost);
  $('simValueWrap')?.classList.toggle('hidden', prize && false);
}

function runSim() {
  const type = currentSimType();
  if (!type || !window.CommissionUI) {
    if ($('simResult')) $('simResult').textContent = fmt(0);
    return;
  }
  const p = CommissionUI.preview(type, {
    grossValue: Number($('simValue')?.value) || 0,
    quantity: Number($('simQty')?.value) || 1,
    costValue: Number($('simCost')?.value) || 0,
    flexPercent: Number($('simFlex')?.value) || 0,
    commissionAmount: Number($('simPrize')?.value) || 0,
    monthCount: type.monthCount || 0,
    monthRevenue: type.monthRevenue || 0,
  });
  $('simResult').textContent = fmt(p.amount);
  if ($('simNote')) {
    const month = type.monthCount ? ` · ${type.monthCount} no mês` : '';
    $('simNote').textContent = `${p.note || type.highlight || ''}${month}`;
  }
}

async function runRecon() {
  const fd = new FormData();
  const file = $('reconFile').files[0];
  if (file) fd.append('file', file);
  else fd.append('filename', 'extrato-demo.pdf');
  if (state.selectedStoreId) fd.append('storeId', state.selectedStoreId);
  const { reconciliation } = await Api.upload('/tools/reconcile', fd);
  $('reconResults').innerHTML = `
    <div class="ok-box">Arquivo: ${reconciliation.filename} · ${reconciliation.ok} ok · ${reconciliation.warn} divergências · saldo ${fmt(reconciliation.netDiff)}</div>
    ${reconciliation.items.map((i) => `
      <div class="recon-row">
        <div class="recon-icon ${i.match_status}">${i.match_status === 'ok' ? '✓' : '!'} </div>
        <div class="recon-text"><div class="t1">${i.label}</div><div class="t2">${i.note}</div></div>
        <div class="recon-diff ${i.match_status}">${i.diff === 0 ? 'R$ 0' : (i.diff > 0 ? '+' : '') + fmt(i.diff)}</div>
      </div>`).join('')}`;
}

async function loadSmoothing() {
  const { series, analysis } = await Api.get('/tools/smoothing');
  $('smoothKpis').innerHTML = `
    <div class="kpi-card"><div class="lbl">Média mensal</div><div class="val">${fmt(analysis.average)}</div></div>
    <div class="kpi-card"><div class="lbl">Retirada segura</div><div class="val">${fmt(analysis.safeWithdrawal)}</div></div>
    <div class="kpi-card"><div class="lbl">Reserva imposto</div><div class="val">${fmt(analysis.reserveTax)}</div></div>
    <div class="kpi-card"><div class="lbl">Reserva emergência</div><div class="val">${fmt(analysis.reserveEmergency)}</div></div>
    <div class="kpi-card"><div class="lbl">Volatilidade</div><div class="val">${fmt(analysis.volatility)}</div></div>`;
  $('smoothSuggestion').textContent = analysis.suggestion;
  drawSeriesChart(
    'smoothChart',
    'smoothAxis',
    series.map((s) => ({ ...s, commission: s.total, label: s.month.slice(5) })),
    'commission'
  );
}

async function loadTeam() {
  const { members, limits } = await Api.get('/team/members');
  if ($('teamLimits')) {
    $('teamLimits').textContent = limits
      ? `${limits.used} de ${limits.cap} pessoas (incluso ${limits.included}${limits.extraSeats ? ` + ${limits.extraSeats} extra` : ''})`
      : '';
  }
  $('teamList').innerHTML = members.length
    ? members.map((m) => `
      <div class="store-card" style="cursor:default">
        <div class="avatar">${initials(m.name || m.email)}</div>
        <div class="store-info"><div class="name">${m.name || m.email}</div>
        <div class="meta">${m.email}${m.inviteLink ? ' · convite pendente' : ''}</div></div>
        <div class="store-figure"><div class="amt">${m.roleLabel || m.role}</div>
        <span class="stat ${m.status === 'accepted' ? 'quitado' : 'pendente'}">${m.status}</span>
        ${state.user?.canManage && m.status === 'pending' ? `<button class="link" data-resend-member="${m.id}" type="button">reenviar</button>` : ''}
        ${state.user?.canManage ? `<button class="link" data-del-member="${m.id}" type="button">remover</button>` : ''}</div>
      </div>`).join('')
    : '<p class="empty">Nenhum convite ainda</p>';
  $('teamList').querySelectorAll('[data-del-member]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Remover esta pessoa do espaço?')) return;
      await Api.del(`/team/members/${btn.dataset.delMember}`);
      await loadTeam();
    };
  });
  $('teamList').querySelectorAll('[data-resend-member]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await Api.post(`/team/members/${btn.dataset.resendMember}/resend`, {});
        toast('Convite reenviado.');
      } catch (err) {
        toast(err.message || 'Não foi possível reenviar', true);
      }
    };
  });
  const extra = $('extraSeatBox');
  if (extra) {
    extra.classList.toggle('hidden', state.user?.plan !== 'time' || !state.user?.isOwner);
    if ($('extraSeatsInput')) $('extraSeatsInput').value = state.user?.extraSeats || 0;
  }
}

async function loadGoals() {
  const { goals } = await Api.get('/goals');
  const can = state.user?.canManage;
  if ($('btnAddGoal')) $('btnAddGoal').classList.toggle('hidden', !can);
  if ($('goalForm')) $('goalForm').classList.toggle('hidden', !can);
  $('goalsList').innerHTML = goals.length
    ? goals.map((g) => {
        const pct = Math.min(100, g.progress?.percent || 0);
        return `<div class="op-card" style="margin-bottom:10px">
          <strong>${g.name || g.periodType}</strong>
          <div class="goal-track" style="margin:8px 0"><span style="width:${pct}%"></span></div>
          <p class="screen-lead" style="margin:0">${g.metric === 'quantity' ? g.progress.current + ' / ' + g.target : fmt(g.progress.current) + ' / ' + fmt(g.target)} · ${Math.round(pct)}%</p>
          ${can ? `<button class="link" data-del-goal="${g.id}" type="button">Excluir</button>` : ''}
        </div>`;
      }).join('')
    : '<p class="empty">Nenhuma meta ainda.</p>';
  $('goalsList').querySelectorAll('[data-del-goal]').forEach((b) => {
    b.onclick = async () => {
      await Api.del(`/goals/${b.dataset.delGoal}`);
      await loadGoals();
    };
  });
  if (can) {
    const comm = state.commissions?.length ? state.commissions : (await Api.get('/commissions')).commissions || [];
    state.commissions = comm;
    $('goalCommission').innerHTML = '<option value="">Carteira toda</option>' + comm.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    $('goalSeller').innerHTML = '<option value="">Espaço todo</option>' + (state.user.isOwner ? `<option value="${state.user.id}">Eu</option>` : '');
    try {
      const { members } = await Api.get('/team/members');
      members.filter((m) => m.memberUserId).forEach((m) => {
        $('goalSeller').innerHTML += `<option value="${m.memberUserId}">${m.name || m.email}</option>`;
      });
    } catch (_) { /* solo */ }
  }
}

async function loadCompare() {
  if (!state.metricCatalog.length) {
    const { catalog } = await Api.get('/metrics/catalog');
    state.metricCatalog = catalog || [];
  }
  const keys = state.metricCatalog.filter((c) => c.unit !== 'share');
  $('cmpMetric').innerHTML = keys.map((c) => `<option value="${c.key}">${c.label}</option>`).join('');
  $('smKey').innerHTML = state.metricCatalog.map((c) => `<option value="${c.key}">${c.label}</option>`).join('');
  const now = new Date();
  if (!$('cmpFrom').value) $('cmpFrom').value = `${now.toISOString().slice(0, 7)}-01`;
  if (!$('cmpTo').value) $('cmpTo').value = now.toISOString().slice(0, 10);
  $('cmpSellerWrap').classList.toggle('hidden', !state.user?.canSeeTeam);
  if (state.user?.canSeeTeam) {
    try {
      const { members } = await Api.get('/team/members');
      $('cmpSeller').innerHTML = '<option value="">Todos</option><option value="' + state.user.id + '">Eu</option>' +
        members.filter((m) => m.memberUserId).map((m) => `<option value="${m.memberUserId}">${m.name || m.email}</option>`).join('');
    } catch (_) {}
  }
  const comm = state.commissions?.length ? state.commissions : (await Api.get('/commissions')).commissions || [];
  $('cmpCommission').innerHTML = '<option value="">Todas</option>' + comm.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  await runCompare();
  const { saved } = await Api.get('/metrics/saved');
  $('savedMetricsList').innerHTML = (saved || []).length
    ? saved.map((s) => `<div class="kv"><span>${s.name} · ${s.catalogKey}</span>${state.user?.canManage ? `<button class="link" data-del-sm="${s.id}" type="button">excluir</button>` : ''}</div>`).join('')
    : '<p class="empty">Nenhuma métrica salva.</p>';
  $('savedMetricsList').querySelectorAll('[data-del-sm]').forEach((b) => {
    b.onclick = async () => {
      await Api.del(`/metrics/saved/${b.dataset.delSm}`);
      await loadCompare();
    };
  });
}

async function runCompare() {
  const qs = new URLSearchParams({
    from: $('cmpFrom').value,
    to: $('cmpTo').value,
    groupBy: $('cmpGroup').value,
    metric: $('cmpMetric').value || 'commission_launched',
  });
  if ($('cmpSeller')?.value) qs.set('sellerId', $('cmpSeller').value);
  if ($('cmpCommission')?.value) qs.set('commissionTypeId', $('cmpCommission').value);
  const data = await Api.get(`/metrics/compare?${qs}`);
  const t = data.totals || {};
  const delta = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(0) + '%');
  $('cmpTotals').innerHTML = `
    <div class="kpi-card"><div class="lbl">Atual</div><div class="val mono">${fmt(t.current)}</div></div>
    <div class="kpi-card"><div class="lbl">Vs anterior</div><div class="val">${delta(t.previousDelta)}</div></div>
    <div class="kpi-card"><div class="lbl">Vs ano passado</div><div class="val">${delta(t.yearAgoDelta)}</div></div>`;
  $('cmpTable').innerHTML = (data.series || [])
    .map((r) => `<div class="kv"><span>${r.bucket}</span><span>${fmt(r.value)} · ${r.launches} lanç.</span></div>`)
    .join('') || '<p class="empty">Sem dados no período.</p>';
  if (data.sellers?.length) {
    $('cmpTable').innerHTML += '<div class="section-title">Por vendedor</div>' +
      data.sellers.map((s) => `<div class="kv"><span>${s.name}</span><span>${fmt(s.commission)}</span></div>`).join('');
  }
}

async function loadAudit() {
  const { logs } = await Api.get('/team/audit');
  $('auditList').innerHTML = logs.length
    ? logs.map((l) => `
      <div class="audit-row">
        <div class="a">${l.action} · ${l.entity}${l.entity_id ? ' #' + l.entity_id.slice(0, 8) : ''}</div>
        <div class="m">${new Date(l.created_at).toLocaleString('pt-BR')}</div>
      </div>`).join('')
    : '<p class="empty">Sem eventos</p>';
}

async function loadPlansScreen() {
  const [{ plans }, sub] = await Promise.all([
    Api.get('/billing/plans'),
    Api.get('/billing/me'),
  ]);
  state.catalogPlans = plans;
  const s = sub.subscription;
  const invoices = sub.invoices || [];
  const priceLabel =
    s.billingCycle === 'yearly'
      ? `${fmt(s.price)}/ano`
      : `${fmt(s.price)}/mês`;
  const next = s.nextDueDate ? new Date(s.nextDueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
  $('currentPlanCard').innerHTML = `
    <div class="kv"><span>Plano</span><span>${s.planName}</span></div>
    <div class="kv"><span>Status</span><span>${s.status}</span></div>
    <div class="kv"><span>Ciclo</span><span>${s.billingCycle === 'yearly' ? 'Anual · recorrente' : 'Mensal · recorrente'}</span></div>
    <div class="kv"><span>Valor</span><span>${priceLabel}</span></div>
    <div class="kv"><span>Próxima cobrança</span><span>${next}</span></div>
    <div class="kv" style="border:none"><span>1 mês grátis</span><span>${s.trialEndsAt ? 'até ' + new Date(s.trialEndsAt).toLocaleDateString('pt-BR') : 'incluso'}</span></div>
    <div class="row-actions" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">
      ${s.payUrl ? `<a class="btn-primary" href="${s.payUrl}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">Pagar / cadastrar Pix ou cartão</a>` : ''}
      ${sub.isOwner ? '<button class="btn-secondary" type="button" id="btnCancelPlan">Cancelar assinatura</button>' : ''}
    </div>
    <p style="font-size:12px;color:var(--text-dim);margin:12px 0 0">Cartão e Pix ficam no Asaas (página segura). Recorrência: cartão cobra sozinho; Pix gera uma fatura a cada ciclo.</p>`;
  const cancel = $('btnCancelPlan');
  if (cancel) {
    cancel.onclick = async () => {
      if (!confirm('Cancelar impede novas cobranças. O acesso segue até o fim do período.')) return;
      const res = await Api.post('/billing/cancel', {});
      alert(res.message);
      await loadPlansScreen();
    };
  }

  const alertBox = $('billingAlert');
  if (alertBox) {
    const bad = invoices.find((p) => p.failed) || invoices.find((p) => p.open);
    if (bad) {
      alertBox.classList.remove('hidden');
      alertBox.innerHTML = `<h4>${bad.failed ? 'Pagamento em atraso ou falhou' : 'Há uma fatura em aberto'}</h4>
        <p>${fmt(bad.value)} · vencimento ${bad.dueDate || '—'} · ${bad.statusLabel}</p>
        ${bad.invoiceUrl ? `<a class="btn-confirm" href="${bad.invoiceUrl}" target="_blank" rel="noopener">Pagar agora ou trocar cartão</a>` : ''}`;
    } else {
      alertBox.classList.add('hidden');
      alertBox.innerHTML = '';
    }
  }

  const inv = $('invoiceList');
  if (inv) {
    if (!s.asaasEnabled) {
      inv.innerHTML = '<p class="empty">Cobrança Asaas ainda não está ligada neste ambiente.</p>';
    } else if (!invoices.length) {
      inv.innerHTML = '<p class="empty">Nenhuma fatura ainda. Ao ativar um plano, a recorrência aparece aqui.</p>';
    } else {
      inv.innerHTML = invoices
        .map(
          (p) => `<div class="sale-row" style="cursor:default">
            <span class="sale-dot ${p.failed ? 'cancelada' : p.open ? 'pendente' : 'quitado'}"></span>
            <div class="sale-main"><div class="title">${p.statusLabel}</div>
            <div class="sub">Vence ${p.dueDate || '—'}${p.paymentDate ? ' · pago ' + p.paymentDate : ''} · ${p.billingType || 'Pix/cartão'}</div></div>
            <div class="sale-amt"><div class="v mono">${fmt(p.value)}</div>
            ${p.invoiceUrl && (p.open || p.failed) ? `<a class="link" href="${p.invoiceUrl}" target="_blank" rel="noopener">Pagar</a>` : ''}</div>
          </div>`
        )
        .join('');
    }
  }

  const cycle = state.billingCycle;
  $('plansAppGrid').innerHTML = plans.map((p) => {
    const price = cycle === 'yearly' ? Math.round(p.priceYearly / 12) : p.priceMonthly;
    const current = state.user?.plan === p.id;
    return `
      <div class="op-card" style="${p.highlighted ? 'border-color:rgba(63,218,154,.4)' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
          <strong style="font-size:16px">${p.name}</strong>
          ${current ? '<span class="stat quitado">Atual</span>' : ''}
        </div>
        <div class="mono" style="font-size:22px;font-weight:700;margin-bottom:4px">${fmt(price)}<span style="font-size:12px;color:var(--text-faint)">/mês</span></div>
        <div style="font-size:12px;color:var(--text-faint);margin-bottom:12px">${p.tagline}</div>
        <ul style="padding-left:18px;margin:0 0 14px;font-size:12.5px;color:var(--text-dim);line-height:1.55">
          ${p.features.map((f) => `<li>${f}</li>`).join('')}
        </ul>
        <button class="btn-primary" data-subscribe="${p.id}" ${current ? 'disabled' : ''}>
          ${current ? 'Plano ativo' : 'Ativar ' + p.name}
        </button>
      </div>`;
  }).join('');

  $('plansAppGrid').querySelectorAll('[data-subscribe]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const res = await Api.post('/billing/subscribe', {
          planId: btn.dataset.subscribe,
          billingCycle: state.billingCycle,
        });
        state.user.plan = res.subscription.planId;
        state.user.planName = res.subscription.planName;
        state.user.planStatus = res.subscription.status;
        state.user.billingCycle = res.subscription.billingCycle;
        state.user.planLimits = res.subscription.limits;
        applyUserChrome();
        if (res.payUrl) window.open(res.payUrl, '_blank', 'noopener');
        alert(res.message);
        await loadPlansScreen();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

const HELP_KIND = { support: 'Suporte', suggestion: 'Sugestão', rating: 'Avaliação' };
const helpState = { tab: 'list', ticketId: null, rating: 5 };

function helpStatusLabel(t) {
  const map = {
    open: 'Aberto',
    in_progress: 'Em atendimento',
    waiting_user: 'Aguardando você',
    waiting_staff: 'Aguardando a Comiss',
    resolved: 'Resolvido',
    received: 'Recebida',
    planned: 'Planejada',
    shipped: 'Lançada',
    declined: 'Não vamos seguir',
  };
  return map[t.status] || t.status;
}

async function loadAjuda() {
  const panel = $('helpPanel');
  if (!panel) return;
  document.querySelectorAll('#helpTabs .chip').forEach((c) => c.classList.toggle('active', c.dataset.help === helpState.tab));
  if (helpState.ticketId) {
    await renderHelpThread(helpState.ticketId);
    return;
  }
  if (helpState.tab === 'list') {
    const data = await Api.get('/support');
    if (!data.tickets?.length) {
      panel.innerHTML = '<p class="empty">Nenhuma conversa ainda. Abra um pedido, uma sugestão ou deixe uma nota.</p>';
      return;
    }
    panel.innerHTML = data.tickets
      .map(
        (t) => `<button class="ticket-row" type="button" data-open-ticket="${t.id}">
          <b>${escHtml(HELP_KIND[t.kind] || t.kind)} · ${escHtml(t.subject)}</b>
          <div class="hint">${escHtml(helpStatusLabel(t))}${t.unreadForUser ? ' · nova resposta' : ''}${t.rating ? ` · ${t.rating}/5` : ''}</div>
        </button>`
      )
      .join('');
    panel.querySelectorAll('[data-open-ticket]').forEach((b) => {
      b.onclick = () => {
        helpState.ticketId = b.dataset.openTicket;
        loadAjuda();
      };
    });
    return;
  }
  if (helpState.tab === 'rating') {
    panel.innerHTML = `
      <div class="settings-card">
        <p class="screen-lead" style="margin-top:0">Como está sendo usar o Comiss?</p>
        <div class="star-pick" id="starPick">${[1, 2, 3, 4, 5]
          .map((n) => `<button type="button" data-star="${n}" class="${n <= helpState.rating ? 'on' : ''}">★</button>`)
          .join('')}</div>
        <div class="field"><label>Comentário (opcional)</label><textarea id="helpBody" placeholder="O que está bom ou o que falta"></textarea></div>
        <button class="btn-primary" type="button" id="btnHelpSend">Enviar avaliação</button>
      </div>`;
    panel.querySelectorAll('[data-star]').forEach((b) => {
      b.onclick = () => {
        helpState.rating = Number(b.dataset.star);
        panel.querySelectorAll('[data-star]').forEach((x) =>
          x.classList.toggle('on', Number(x.dataset.star) <= helpState.rating)
        );
      };
    });
    $('btnHelpSend').onclick = () => sendHelp('rating');
    return;
  }
  const isSug = helpState.tab === 'suggestion';
  panel.innerHTML = `
    <div class="settings-card">
      ${
        isSug
          ? ''
          : `<div class="field"><label>Assunto</label>
        <select id="helpCat">
          <option value="problema">Algo não funciona</option>
          <option value="duvida">Dúvida de uso</option>
          <option value="cobranca">Cobrança / plano</option>
          <option value="acesso">Não consigo entrar</option>
        </select></div>
        <div class="field"><label>Título</label><input id="helpSubject" placeholder="Ex.: não aparece a comissão do mês"></div>`
      }
      <div class="field"><label>${isSug ? 'Sua ideia' : 'Detalhe'}</label>
        <textarea id="helpBody" placeholder="${isSug ? 'O que você gostaria que o Comiss fizesse' : 'O que aconteceu, o que você esperava'}"></textarea></div>
      <button class="btn-primary" type="button" id="btnHelpSend">${isSug ? 'Enviar sugestão' : 'Enviar pedido'}</button>
    </div>`;
  $('btnHelpSend').onclick = () => sendHelp(isSug ? 'suggestion' : 'support');
}

async function sendHelp(kind) {
  try {
    const cat = $('helpCat')?.value;
    await Api.post('/support', {
      kind,
      category: kind === 'suggestion' ? 'ideia' : kind === 'rating' ? 'avaliacao' : cat,
      subject: $('helpSubject')?.value || (kind === 'suggestion' ? 'Sugestão' : ''),
      body: $('helpBody')?.value || (kind === 'rating' ? `Nota ${helpState.rating}/5` : ''),
      rating: kind === 'rating' ? helpState.rating : undefined,
    });
    helpState.tab = 'list';
    helpState.ticketId = null;
    await loadAjuda();
    refreshInboxBadge();
  } catch (err) {
    alert(err.message);
  }
}

async function renderHelpThread(id) {
  const panel = $('helpPanel');
  const data = await Api.get(`/support/${id}`);
  const t = data.ticket;
  panel.innerHTML = `
    <button class="back-link" type="button" id="helpBack">← Conversas</button>
    <div class="settings-card">
      <div class="section-title" style="margin-top:0">${escHtml(HELP_KIND[t.kind] || t.kind)} · ${escHtml(t.subject)}</div>
      <p class="screen-lead">${escHtml(helpStatusLabel(t))}${t.rating ? ` · nota ${t.rating}/5` : ''}</p>
      <div class="help-thread">
        ${(data.messages || [])
          .map(
            (m) => `<div class="help-bubble ${m.authorType === 'admin' ? 'admin' : ''}">
              <div class="who">${escHtml(m.authorName)} · ${new Date(m.createdAt).toLocaleString('pt-BR')}</div>
              <div>${escHtml(m.body)}</div>
            </div>`
          )
          .join('')}
      </div>
      ${
        t.kind !== 'rating'
          ? `<div class="field"><label>Responder</label><textarea id="helpReply" placeholder="Escreva aqui"></textarea></div>
             <button class="btn-primary" type="button" id="btnHelpReply">Enviar</button>`
          : ''
      }
      ${
        t.kind === 'support' && t.status === 'resolved' && !t.rating
          ? `<p class="screen-lead">Como foi o atendimento?</p>
             <div class="star-pick" id="csatPick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-csat="${n}">★</button>`).join('')}</div>`
          : ''
      }
    </div>`;
  $('helpBack').onclick = () => {
    helpState.ticketId = null;
    helpState.tab = 'list';
    loadAjuda();
  };
  const reply = $('btnHelpReply');
  if (reply) {
    reply.onclick = async () => {
      try {
        await Api.post(`/support/${id}/messages`, { body: $('helpReply').value });
        await renderHelpThread(id);
        refreshInboxBadge();
      } catch (err) {
        alert(err.message);
      }
    };
  }
  panel.querySelectorAll('[data-csat]').forEach((b) => {
    b.onclick = async () => {
      await Api.post(`/support/${id}/rate`, { rating: Number(b.dataset.csat) });
      await renderHelpThread(id);
    };
  });
}

async function fillPlanPick() {
  const wrap = $('planPick');
  if (!wrap) return;
  try {
    const data = await fetch('/api/billing/plans').then((r) => r.json());
    if (!data.plans?.length) return;
    wrap.innerHTML = data.plans
      .map(
        (p) =>
          `<button type="button" data-plan="${escHtml(p.id)}"><strong>${escHtml(p.name)}</strong><small>R$ ${p.priceMonthly}/mês</small></button>`
      )
      .join('');
    syncPlanPickUi();
  } catch (_) { /* fallback HTML */ }
}

/* ---------- Boot / Events ---------- */
function wireEvents() {
  wirePasswordEyes();
  $('btnStart').onclick = () => {
    $('splash').classList.add('hide');
    show($('login'));
    setAuthMode(state.mode === 'register' ? 'register' : 'login');
  };
  $('btnAuth').onclick = doAuth;
  $('authToggle').onclick = () => setAuthMode(state.mode === 'login' ? 'register' : 'login');
  if ($('planPick')) {
    $('planPick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-plan]');
      if (!b) return;
      state.selectedPlanId = b.dataset.plan;
      syncPlanPickUi();
    });
  }
  const regCycle = $('regCycle');
  if (regCycle) {
    regCycle.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.billingCycle = b.dataset.cycle;
        syncPlanPickUi();
      };
    });
  }
  const planCycle = $('planCycleToggle');
  if (planCycle) {
    planCycle.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        state.billingCycle = b.dataset.cycle;
        planCycle.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        loadPlansScreen();
      };
    });
  }
  $('bioSwitch').onclick = function () { this.classList.toggle('on'); };

  $('btnProfileNext').onclick = async () => {
    try {
      await saveProfileFrom('obName', 'obProfession', 'obCompany', 'obCurrency');
      await loadCommissionCatalog();
      await renderOnboardingCommissionList();
      showWizard('wizardCommissions');
    } catch (err) {
      alert(err.message);
    }
  };
  $('btnObAddCommission').onclick = () => openCommissionForm(null, 'onboarding');
  $('btnObFormBack').onclick = async () => {
    await renderOnboardingCommissionList();
    showWizard('wizardCommissions');
  };
  $('btnObSaveCommission').onclick = () =>
    handleSaveCommission($('btnObSaveCommission'), 'obCfMount', 'obCfError', async () => {
      await renderOnboardingCommissionList();
      showWizard('wizardCommissions');
      $('btnObSaveCommission').disabled = false;
      $('btnObSaveCommission').textContent = 'Salvar comissão';
    });
  $('btnObCommissionsNext').onclick = () => {
    if (!state.commissions.length) return alert('Cadastre pelo menos uma comissão para continuar.');
    $('readyTitle').textContent = `Pronto, ${firstName()}!`;
    $('readySub').textContent = 'Suas regras estão salvas. Agora você entra em Minhas Comissões — pode editar e adicionar outras quando quiser.';
    showWizard('wizardReady');
  };
  $('btnFinishOnboarding').onclick = async () => {
    await Api.patch('/auth/me', { onboardingDone: true });
    const me = await Api.get('/auth/me');
    state.user = me.user;
    state.nicheFields = me.nicheFields;
    await enterApp('comissoes');
  };

  $('btnAddCommission').onclick = () => openCommissionForm(null, 'comissoes');
  $('btnCfBack').onclick = () => goTo('comissoes');
  $('btnSaveCommission').onclick = () =>
    handleSaveCommission($('btnSaveCommission'), 'cfMount', 'cfError', async () => {
      await goTo('comissoes');
    });
  $('btnDeleteCommission').onclick = async () => {
    if (!state.commissionDraft?.id) return;
    if (!confirm('Excluir esta comissão? Lançamentos antigos não são apagados.')) return;
    try {
      await Api.del(`/commissions/${state.commissionDraft.id}`);
      await goTo('comissoes');
    } catch (err) {
      alert(err.message);
    }
  };
  $('btnSaveProfile').onclick = async () => {
    try {
      await saveProfileFrom('pfName', 'pfProfession', 'pfCompany', 'pfCurrency');
      alert('Perfil salvo.');
    } catch (err) {
      alert(err.message);
    }
  };

  document.querySelectorAll('.nav-item, .bn-item').forEach((btn) => {
    btn.addEventListener('click', () => goTo(btn.dataset.screen));
  });
  document.querySelectorAll('#helpTabs .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      helpState.tab = btn.dataset.help;
      helpState.ticketId = null;
      loadAjuda();
    });
  });
  document.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => goTo(btn.dataset.go));
  });
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => hide($(btn.dataset.close)));
  });
  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => { if (e.target === ov) hide(ov); });
  });

  if ($('storeFilter')) {
    $('storeFilter').onchange = async () => {
      state.selectedStoreId = $('storeFilter').value;
      const active = document.querySelector('.screen.active')?.id?.replace('screen-', '');
      if (active) await goTo(active);
    };
  }
  $('fabNewSale').onclick = () => goTo('dashboard');
  $('btnSaveSale').onclick = saveSale;
  if ($('btnAddStore')) $('btnAddStore').onclick = openStoreModal;
  if ($('btnSaveStore')) {
    $('btnSaveStore').onclick = async () => {
      await Api.post('/stores', {
        name: $('nsName').value,
        cnpj: $('nsCnpj').value,
        color: $('nsColor').value,
        ruleType: $('nsRule').value,
        paymentDays: Number($('nsDays').value) || 30,
      });
      hide($('storeOverlay'));
      if ($('storesList')) await loadStoresScreen();
    };
  }
  $('btnAddLead').onclick = openLeadModal;
  $('btnSaveLead').onclick = async () => {
    await Api.post('/leads', {
      title: $('leadTitle').value,
      clientName: $('leadClient').value,
      value: Number($('leadValue').value) || 0,
      probability: Number($('leadProb').value) || 50,
      storeId: $('leadStore')?.value || null,
      stage: $('leadStage').value,
    });
    hide($('leadOverlay'));
    await loadLeads();
  };
  $('btnInvite').onclick = () => show($('inviteOverlay'));
  $('btnSaveInvite').onclick = async () => {
    await Api.post('/team/members', {
      email: $('inviteEmail').value,
      name: $('inviteName').value,
      role: $('inviteRole').value,
    });
    hide($('inviteOverlay'));
    await loadTeam();
  };
  if ($('btnSaveSeats')) {
    $('btnSaveSeats').onclick = async () => {
      const res = await Api.post('/billing/extra-seats', { extraSeats: Number($('extraSeatsInput').value) || 0 });
      state.user.extraSeats = res.extraSeats;
      alert(`Assentos extras: ${res.extraSeats} (${fmt(res.monthlyExtra)}/mês)`);
      await loadTeam();
    };
  }
  if ($('btnAddGoal')) $('btnAddGoal').onclick = () => $('goalForm')?.classList.remove('hidden');
  if ($('goalPeriod')) {
    $('goalPeriod').onchange = () => $('goalRangeWrap')?.classList.toggle('hidden', $('goalPeriod').value !== 'range');
  }
  if ($('btnSaveGoal')) {
    $('btnSaveGoal').onclick = async () => {
      await Api.post('/goals', {
        name: $('goalName').value,
        periodType: $('goalPeriod').value,
        periodStart: $('goalFrom').value || undefined,
        periodEnd: $('goalTo').value || undefined,
        metric: $('goalMetric').value,
        target: Number($('goalTarget').value) || 0,
        sellerId: $('goalSeller').value || null,
        commissionTypeId: $('goalCommission').value || null,
      });
      $('goalTarget').value = '';
      await loadGoals();
    };
  }
  if ($('btnRunCompare')) $('btnRunCompare').onclick = runCompare;
  if ($('btnSaveMetric')) {
    $('btnSaveMetric').onclick = async () => {
      await Api.post('/metrics/saved', { name: $('smName').value, catalogKey: $('smKey').value, pinDashboard: true });
      $('smName').value = '';
      await loadCompare();
    };
  }
  if ($('authForgotLink')) {
    $('authForgotLink').onclick = () => $('forgotBox').classList.toggle('hidden');
  }
  if ($('btnForgot')) {
    $('btnForgot').onclick = async () => {
      const res = await Api.post('/auth/forgot', { email: $('forgotEmail').value || $('authEmail').value });
      toast(res.message || 'Enviado');
    };
  }
  if ($('btnReset')) {
    $('btnReset').onclick = async () => {
      const password = $('resetPassword').value;
      if (!passwordStrong(password)) {
        toast('Senha fraca. Use 8+ caracteres, com maiúscula, minúscula e número.', true);
        return;
      }
      const data = await Api.post('/auth/reset', { token: urlParams.get('reset'), password });
      Api.setToken(data.token);
      state.user = data.user;
      await enterApp();
    };
  }
  if ($('btnResendConfirm')) {
    $('btnResendConfirm').onclick = async () => {
      const res = await Api.post('/auth/resend-confirm', { email: $('authEmail').value });
      toast(res.message || 'Enviado');
    };
  }
  if ($('btnAcceptInvite')) {
    $('btnAcceptInvite').onclick = async () => {
      if (!$('termsAccept')?.checked) {
        toast('Aceite os Termos para entrar.', true);
        return;
      }
      if (!passwordStrong($('inviteJoinPassword').value)) {
        toast('Senha fraca. Use 8+ caracteres, com maiúscula, minúscula e número.', true);
        return;
      }
      const data = await Api.post('/auth/accept-invite', {
        token: urlParams.get('invite'),
        password: $('inviteJoinPassword').value,
        name: $('inviteJoinName').value,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      Api.setToken(data.token);
      state.user = data.user;
      await enterApp('dashboard');
    };
  }
  $('btnUpdateSale').onclick = async () => {
    await Api.patch(`/sales/${state.currentSaleId}`, { status: $('detailStatus').value });
    hide($('detailOverlay'));
    await loadSales();
  };
  $('saleFilters').querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => {
      $('saleFilters').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      state.saleStatus = c.dataset.status;
      loadSales();
    };
  });
  ['saleFrom', 'saleTo', 'saleQuery'].forEach((id) => {
    $(id).addEventListener('change', loadSales);
    $(id).addEventListener('keyup', (e) => { if (e.key === 'Enter') loadSales(); });
  });
  $('globalSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') goTo('vendas');
  });
  if ($('simUnits')) $('simUnits').oninput = runSim;
  if ($('simTicket')) $('simTicket').oninput = runSim;
  if ($('simStore')) $('simStore').onchange = runSim;
  if ($('btnRecon')) $('btnRecon').onclick = () => $('reconFile')?.click();
  if ($('reconFile')) $('reconFile').onchange = () => { if ($('reconFile').files[0]) runRecon(); };
  document.querySelectorAll('.theme-toggle button').forEach((b) => {
    b.onclick = async () => {
      await Api.patch('/auth/me', { theme: b.dataset.theme });
      state.user.theme = b.dataset.theme;
      applyUserChrome();
    };
  });
  $('cfg2fa').onclick = async function () {
    this.classList.toggle('on');
    await Api.patch('/auth/me', { twofaEnabled: this.classList.contains('on') });
    state.user.twofaEnabled = this.classList.contains('on');
  };
  $('cfgBio').onclick = async function () {
    this.classList.toggle('on');
    await Api.patch('/auth/me', { biometryEnabled: this.classList.contains('on') });
    state.user.biometryEnabled = this.classList.contains('on');
  };
  if ($('btnInbox')) $('btnInbox').onclick = () => openInbox();
  if ($('btnReadAll')) {
    $('btnReadAll').onclick = async () => {
      await Api.post('/inbox/notifications/read-all', {});
      await openInbox();
    };
  }
  document.querySelectorAll('[data-pref]').forEach((btn) => {
    btn.onclick = async () => {
      btn.classList.toggle('on');
      try {
        await Api.patch('/inbox/prefs', { [btn.dataset.pref]: btn.classList.contains('on') });
      } catch (err) {
        btn.classList.toggle('on');
        toast(err.message || 'Não foi possível salvar', true);
      }
    };
  });
  $('btnLogout').onclick = () => {
    Api.setToken(null);
    location.reload();
  };
  $('btnExport').onclick = async () => {
    const blob = await Api.get('/team/export.csv');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'comiss-export.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const syncOfflineUi = () => {
    $('offlinePill').classList.toggle('show', !navigator.onLine);
  };
  window.addEventListener('online', syncOfflineUi);
  window.addEventListener('offline', syncOfflineUi);
  syncOfflineUi();
}

async function boot() {
  wireEvents();
  fillPlanPick();

  if (urlParams.get('confirm')) {
    $('splash').classList.add('hide');
    show($('login'));
    try {
      const data = await Api.post('/auth/confirm', { token: urlParams.get('confirm') });
      Api.setToken(data.token);
      state.user = data.user;
      state.nicheFields = data.nicheFields || {};
      hide($('login'));
      if (!data.user.onboardingDone) startOnboarding();
      else await enterApp();
    } catch (e) {
      $('confirmBox').classList.remove('hidden');
      toast(e.message || 'Link inválido. Peça um novo e-mail.', true);
    }
    return;
  }

  if (Api.token) {
    try {
      const me = await Api.get('/auth/me');
      state.user = me.user;
      state.nicheFields = me.nicheFields || {};
      $('splash').classList.add('hide');
      if (!me.user.onboardingDone) startOnboarding();
      else await enterApp();
      return;
    } catch (e) {
      Api.setToken(null);
      if (e.data?.needsConfirm) {
        $('splash').classList.add('hide');
        show($('login'));
        $('confirmBox').classList.remove('hidden');
        $('confirmHint').textContent =
          e.message || 'Confirme seu e-mail para entrar. Abra o link que enviamos (e o spam).';
      }
    }
  }

  // Vindo do site com plano escolhido → abre login/registro direto
  if (urlParams.get('invite')) {
    $('splash').classList.add('hide');
    show($('login'));
    $('inviteBox').classList.remove('hidden');
    $('termsAcceptRow').style.display = 'flex';
    try {
      const { invite } = await Api.get(`/auth/invite/${urlParams.get('invite')}`);
      $('inviteHint').textContent = `${invite.ownerName} te convidou como ${invite.role}. Crie uma senha para ${invite.email}.`;
      $('authEmail').value = invite.email;
      $('inviteJoinName').value = invite.name || '';
    } catch (e) {
      toast(e.message || 'Convite inválido', true);
    }
    return;
  }
  if (urlParams.get('reset')) {
    $('splash').classList.add('hide');
    show($('login'));
    $('resetBox').classList.remove('hidden');
    return;
  }
  if (urlParams.get('mode') === 'register' || urlParams.get('plan')) {
    $('splash').classList.add('hide');
    show($('login'));
    setAuthMode(urlParams.get('mode') === 'register' ? 'register' : 'login');
  }
}

boot();
