/* Comiss — app completo */
const urlParams = new URLSearchParams(location.search);

const state = {
  mode: urlParams.get('mode') === 'register' ? 'register' : 'login',
  selectedPlanId: urlParams.get('plan') || 'pro',
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
  dashboard: 'Painel',
  lojas: 'Lojas & Fornecedores',
  vendas: 'Extrato de Vendas',
  pipeline: 'Pipeline',
  recebiveis: 'Recebíveis',
  simulador: 'Simulador de Metas',
  reconciliacao: 'Conciliação',
  alisamento: 'Alisamento de Renda',
  equipe: 'Equipe & Split',
  auditoria: 'Auditoria',
  planos: 'Planos',
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
  const termsRow = $('termsAcceptRow');
  if (termsRow) termsRow.style.display = reg ? 'flex' : 'none';
  $('authToggleWrap').innerHTML = reg
    ? 'Já tem conta? <a id="authToggle">Entrar</a>'
    : 'Novo por aqui? <a id="authToggle">Criar conta</a>';
  $('authToggle').onclick = () => setAuthMode(reg ? 'login' : 'register');
  $('otpField').classList.add('hidden');
  $('authError').classList.add('hidden');
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
      data = await Api.post('/auth/register', {
        email,
        password,
        name,
        planId: state.selectedPlanId || 'pro',
        billingCycle: state.billingCycle || 'monthly',
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
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
  $('wizardNiche').classList.remove('hidden');
  $('wizardMulti').classList.add('hidden');
  $('wizardStore').classList.add('hidden');
  renderNiches();
}

async function enterApp() {
  hide($('onboarding'));
  hide($('login'));
  $('splash').classList.add('hide');
  show($('app'));
  applyUserChrome();
  await refreshStores();
  await goTo('dashboard');
  flushOfflineQueue();
}

function applyUserChrome() {
  const u = state.user;
  if (!u) return;
  const ini = initials(u.name);
  $('sideAvatar').textContent = ini;
  $('topAvatar').textContent = ini;
  $('sideName').textContent = u.name;
  $('topName').textContent = u.name.split(' ')[0];
  $('sideRole').textContent = `${nicheLabel(u.niche)} · ${u.multiStore ? 'Multilojas' : '1 empresa'}`;
  document.body.classList.toggle('theme-light', u.theme === 'light');
  document.querySelectorAll('.theme-toggle button').forEach((b) => {
    b.classList.toggle('on', b.dataset.theme === (u.theme || 'dark'));
  });
  $('cfg2fa').classList.toggle('on', !!u.twofaEnabled);
  $('cfgBio').classList.toggle('on', !!u.biometryEnabled);
  $('cfgNiche').textContent = nicheLabel(u.niche);
  $('cfgMulti').textContent = u.multiStore ? 'Sim' : 'Não';
  if ($('cfgPlan')) {
    const status = u.planStatus === 'trialing' ? 'trial' : u.planStatus || '—';
    $('cfgPlan').textContent = `${u.planName || u.plan || '—'} · ${status}`;
  }
}

/* ---------- Navigation ---------- */
async function goTo(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const screen = $(`screen-${name}`);
  if (screen) screen.classList.add('active');
  document.querySelectorAll('.nav-item, .bn-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.screen === name);
  });
  $('pageTitle').textContent = TITLES[name] || name;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (name === 'dashboard') await loadDashboard();
  if (name === 'lojas') await loadStoresScreen();
  if (name === 'vendas') await loadSales();
  if (name === 'pipeline') await loadLeads();
  if (name === 'recebiveis') await loadReceivables();
  if (name === 'simulador') await loadSimulator();
  if (name === 'alisamento') await loadSmoothing();
  if (name === 'equipe') await loadTeam();
  if (name === 'auditoria') await loadAudit();
  if (name === 'planos') await loadPlansScreen();
  if (name === 'config') applyUserChrome();
}

/* ---------- Stores ---------- */
async function refreshStores() {
  const { stores } = await Api.get('/stores');
  state.stores = stores;
  const sel = $('storeFilter');
  const cur = state.selectedStoreId;
  sel.innerHTML = `<option value="">Todas as lojas</option>` +
    stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  sel.value = cur;
  const sim = $('simStore');
  if (sim) {
    sim.innerHTML = stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  }
}

async function loadStoresScreen() {
  await refreshStores();
  const list = $('storesList');
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
  const q = state.selectedStoreId ? `?storeId=${state.selectedStoreId}` : '';
  const data = await Api.get(`/dashboard${q}`);
  const k = data.kpis;
  $('kpiCommission').textContent = fmt(k.commissionMonth);
  $('kpiReceived').textContent = fmt(k.commissionReceived);
  $('kpiPipeline').textContent = fmt(k.pipeline);
  $('kpiRevenue').textContent = fmt(k.revenueMonth);
  $('kpiSalesCount').textContent = `${k.salesCount} vendas neste ciclo`;

  $('byStoreCards').innerHTML = (data.byStore || []).map((s) => `
    <div class="mini-card">
      <div class="mini-top"><div class="mini-val"><div class="n">${fmt(s.commission)}</div><div class="s">${s.name}</div></div></div>
      <div class="mini-bottom"><span style="font-size:12px;color:var(--text-dim)">${s.salesCount} vendas</span>
      <span class="mini-delta up">${s.color ? '' : ''}${fmt(s.commission)}</span></div>
    </div>`).join('') || '<p class="empty">Sem dados</p>';

  state.series = data.series || [];
  drawSeriesChart('mainChart', 'chartAxis', state.series, state.chartMode);

  if (data.ladder) {
    $('ladderStore').textContent = data.ladder.storeName;
    $('ladderUnits').textContent = `${data.ladder.units} no mês`;
    $('ladderBadge').textContent = data.ladder.progress
      ? `Faixa ${((data.ladder.progress.currentPercent || 0) * 100).toFixed(2).replace('.', ',')}%`
      : '—';
    $('ladderNote').textContent = data.ladder.progress?.message || '';
    renderLadder('ladderSteps', 'ladderLabels', data.ladder.bands || [], data.ladder.units);
  } else {
    $('ladderStore').textContent = 'Sem faixas nesta loja';
    $('ladderUnits').textContent = 'Use modelo de faixas para ver a escada';
    $('ladderSteps').innerHTML = '';
    $('ladderNote').textContent = '';
  }

  $('recentSales').innerHTML = (data.recent || []).map((s) => `
    <div class="tx-row">
      <div class="tx-main"><div class="t">${s.title}</div><div class="s">${s.storeName} · ${s.saleDate}</div></div>
      <div class="tx-amt ${s.status === 'cancelada' ? 'neg' : 'pos'}">${s.status === 'cancelada' ? '—' : '+' + fmt(s.commissionTotal)}</div>
    </div>`).join('') || '<p class="empty">Nenhuma venda</p>';
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
        <div class="sub">${s.storeName} · ${s.clientName || '—'} · ${s.saleDate}</div></div>
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
  $('detailSnap').innerHTML = `Snapshot histórico: regra vigente em <strong>${sale.saleDate}</strong> — ${sale.snapshot?.bandLabel || '—'} (${sale.snapshot?.engineNote || ''}). Alterações futuras não recalculam esta venda.`;
  $('detailBody').innerHTML = `
    <div class="kv"><span>Loja</span><span>${sale.storeName || '—'}</span></div>
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

function openSaleModal() {
  if (!state.stores.length) {
    alert('Cadastre uma loja primeiro.');
    return goTo('lojas');
  }
  const niche = state.user?.niche || 'personalizado';
  const fields = state.nicheFields[niche] || state.nicheFields.personalizado || [];
  const dynamic = fields.map((f) => {
    if (f.type === 'select') {
      return `<div class="form-field full"><label>${f.label}</label><select data-niche="${f.key}">${(f.options || []).map((o) => `<option>${o}</option>`).join('')}</select></div>`;
    }
    if (f.type === 'toggle') {
      return `<div class="form-field full toggle-field" style="margin:0"><span>${f.label}</span><button class="switch" type="button" data-niche-toggle="${f.key}"></button></div>`;
    }
    return `<div class="form-field full"><label>${f.label}</label><input data-niche="${f.key}" type="${f.type === 'money' ? 'number' : 'text'}" placeholder="${f.type === 'money' ? '0' : ''}"></div>`;
  }).join('');

  $('saleForm').innerHTML = `
    <div class="form-field full"><label>Loja</label>
      <select id="saleStore">${state.stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
    <div class="form-field full"><label>Cliente</label><input id="saleClient"></div>
    <div class="form-field"><label>Data</label><input id="saleDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="form-field"><label>Valor</label><input id="saleValue" type="number" placeholder="0"></div>
    <div class="form-field"><label>Acessórios</label><input id="saleAcc" type="number" value="0"></div>
    <div class="form-field"><label>Por fora (R$)</label><input id="saleExtra" type="number" value="0"></div>
    ${dynamic}
    <div class="form-field full"><label>Marcos / parcelas (JSON opcional)</label>
      <textarea id="saleMilestones" placeholder='[{"label":"Sinal","percent":0.5,"kind":"oficial"},{"label":"Restante","percent":0.5}]'></textarea></div>
    <div class="toggle-field" style="margin:0;grid-column:1/-1"><span>Dividir com parceiro (split)</span><button class="switch" id="saleSplit" type="button"></button></div>
    <div class="form-field"><label>Parceiro</label><input id="salePartner"></div>
    <div class="form-field"><label>% parceiro</label><input id="saleSplitPct" type="number" value="50"></div>`;
  $('saleForm').querySelectorAll('.switch').forEach((sw) => {
    sw.onclick = () => sw.classList.toggle('on');
  });
  show($('saleOverlay'));
}

async function saveSale() {
  const nicheFields = {};
  $('saleForm').querySelectorAll('[data-niche]').forEach((el) => {
    nicheFields[el.dataset.niche] = el.type === 'number' ? Number(el.value) : el.value;
  });
  $('saleForm').querySelectorAll('[data-niche-toggle]').forEach((el) => {
    nicheFields[el.dataset.nicheToggle] = el.classList.contains('on');
  });
  let milestones;
  try {
    const raw = $('saleMilestones').value.trim();
    if (raw) milestones = JSON.parse(raw);
  } catch {
    return alert('JSON de marcos inválido');
  }
  const body = {
    storeId: $('saleStore').value,
    clientName: $('saleClient').value,
    saleDate: $('saleDate').value,
    grossValue: Number($('saleValue').value) || 0,
    accessoriesValue: Number($('saleAcc').value) || 0,
    commissionExtra: Number($('saleExtra').value) || 0,
    nicheFields,
    splitEnabled: $('saleSplit').classList.contains('on'),
    splitPartner: $('salePartner').value,
    splitPercent: Number($('saleSplitPct').value) || 0,
    milestones,
  };
  try {
    await Api.post('/sales', body);
    hide($('saleOverlay'));
    await goTo('vendas');
  } catch (err) {
    alert(err.message);
  }
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
    <div class="form-field full"><label>Loja</label>
      <select id="leadStore"><option value="">—</option>${state.stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
    <div class="form-field full"><label>Estágio</label>
      <select id="leadStage"><option>lead</option><option>proposta</option><option>negociacao</option><option>fechado</option><option>perdido</option></select></div>`;
  show($('leadOverlay'));
}

async function loadReceivables() {
  const { receivables } = await Api.get('/dashboard/receivables');
  $('receivablesList').innerHTML = receivables.length
    ? receivables.map((r) => `
      <div class="sale-row" style="cursor:default">
        <span class="sale-dot ${r.status === 'quitado' ? 'quitada' : 'pendente'}"></span>
        <div class="sale-main"><div class="title">${r.saleTitle} — ${r.label}</div>
        <div class="sub">${r.storeName} · venc. ${r.dueDate} · ${r.kind}</div></div>
        <div class="sale-amt"><div class="v">${fmt(r.amount)}</div>
        <button class="chip ${r.status === 'quitado' ? 'active' : ''}" data-rid="${r.id}" style="margin-top:6px">${r.status}</button></div>
      </div>`).join('')
    : '<p class="empty">Sem recebíveis</p>';
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
  await refreshStores();
  await runSim();
}

async function runSim() {
  const storeId = $('simStore').value || state.stores[0]?.id;
  const extraUnits = Number($('simUnits').value);
  const ticket = Number($('simTicket').value);
  $('simUnitsVal').textContent = `${extraUnits} un.`;
  $('simTicketVal').textContent = fmt(ticket);
  if (!storeId) return;
  const { result, currentUnits, rule } = await Api.post('/tools/simulate', { storeId, extraUnits, ticket });
  $('simResult').textContent = fmt(result.projectedCommission);
  $('simDiff').textContent = `↑ ${fmt(result.diff)} vs. cenário atual`;
  $('simProjLabel').textContent = `${result.projectedUnits} unidades projetadas (hoje: ${currentUnits})`;
  $('simBadge').textContent = result.bandLabel;
  renderLadder('ladderStepsSim', 'ladderLabelsSim', rule.bands || [], result.projectedUnits);
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
  const { members } = await Api.get('/team/members');
  $('teamList').innerHTML = members.length
    ? members.map((m) => `
      <div class="store-card" style="cursor:default">
        <div class="avatar">${initials(m.name || m.email)}</div>
        <div class="store-info"><div class="name">${m.name || m.email}</div><div class="meta">${m.email}</div></div>
        <div class="store-figure"><div class="amt">${m.role}</div><span class="stat ${m.status === 'accepted' ? 'quitado' : 'pendente'}">${m.status}</span></div>
      </div>`).join('')
    : '<p class="empty">Nenhum convite ainda</p>';
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
  const priceLabel =
    s.billingCycle === 'yearly'
      ? `${fmt(s.price)}/ano`
      : `${fmt(s.price)}/mês`;
  $('currentPlanCard').innerHTML = `
    <div class="kv"><span>Plano</span><span>${s.planName}</span></div>
    <div class="kv"><span>Status</span><span>${s.status}</span></div>
    <div class="kv"><span>Ciclo</span><span>${s.billingCycle === 'yearly' ? 'Anual' : 'Mensal'}</span></div>
    <div class="kv"><span>Valor</span><span>${priceLabel}</span></div>
    <div class="kv" style="border:none"><span>Limite de lojas</span><span>${s.limits.maxStores}</span></div>
    <p style="font-size:12px;color:var(--text-dim);margin:12px 0 0">Trial de 14 dias no site. Aqui a troca de plano é imediata (pagamento real entra na produção).</p>`;

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
        alert(res.message);
        await loadPlansScreen();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

/* ---------- Boot / Events ---------- */
function wireEvents() {
  $('btnStart').onclick = () => {
    $('splash').classList.add('hide');
    show($('login'));
    setAuthMode(state.mode === 'register' ? 'register' : 'login');
  };
  $('btnAuth').onclick = doAuth;
  $('authToggle').onclick = () => setAuthMode(state.mode === 'login' ? 'register' : 'login');
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
  $('btnGoogle').onclick = () => toast('Login social Google: conecte OAuth em produção. Use e-mail/senha na demo.', true);
  $('btnApple').onclick = () => toast('Login social Apple: conecte OAuth em produção. Use e-mail/senha na demo.', true);

  $('btnNicheNext').onclick = () => {
    $('wizardNiche').classList.add('hidden');
    $('wizardMulti').classList.remove('hidden');
  };
  $('wizardMulti').querySelectorAll('[data-multi]').forEach((btn) => {
    btn.onclick = () => {
      state.multiStore = Number(btn.dataset.multi);
      $('wizardMulti').querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      btn.classList.add('on');
    };
  });
  $('btnMultiNext').onclick = () => {
    $('wizardMulti').classList.add('hidden');
    $('wizardStore').classList.remove('hidden');
  };
  $('btnFinishOnboarding').onclick = async () => {
    const name = $('firstStoreName').value.trim();
    if (!name) return alert('Informe o nome da loja');
    await Api.patch('/auth/me', {
      niche: state.selectedNiche,
      multiStore: !!state.multiStore,
      onboardingDone: true,
      biometryEnabled: localStorage.getItem('cp_biometry') === '1',
    });
    await Api.post('/stores', {
      name,
      cnpj: $('firstStoreCnpj').value,
      color: $('firstStoreColor').value,
      ruleType: $('firstStoreRule').value,
      paymentDays: Number($('firstStoreDays').value) || 30,
    });
    const me = await Api.get('/auth/me');
    state.user = me.user;
    state.nicheFields = me.nicheFields;
    await enterApp();
  };

  document.querySelectorAll('.nav-item, .bn-item').forEach((btn) => {
    btn.addEventListener('click', () => goTo(btn.dataset.screen));
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

  $('storeFilter').onchange = async () => {
    state.selectedStoreId = $('storeFilter').value;
    const active = document.querySelector('.screen.active')?.id?.replace('screen-', '');
    if (active) await goTo(active);
  };
  $('btnNewSaleHero').onclick = openSaleModal;
  $('btnNewSaleSide').onclick = openSaleModal;
  $('fabNewSale').onclick = openSaleModal;
  $('btnSaveSale').onclick = saveSale;
  $('btnAddStore').onclick = openStoreModal;
  $('btnSaveStore').onclick = async () => {
    await Api.post('/stores', {
      name: $('nsName').value,
      cnpj: $('nsCnpj').value,
      color: $('nsColor').value,
      ruleType: $('nsRule').value,
      paymentDays: Number($('nsDays').value) || 30,
    });
    hide($('storeOverlay'));
    await loadStoresScreen();
  };
  $('btnAddLead').onclick = openLeadModal;
  $('btnSaveLead').onclick = async () => {
    await Api.post('/leads', {
      title: $('leadTitle').value,
      clientName: $('leadClient').value,
      value: Number($('leadValue').value) || 0,
      probability: Number($('leadProb').value) || 50,
      storeId: $('leadStore').value || null,
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
  $('simUnits').oninput = runSim;
  $('simTicket').oninput = runSim;
  $('simStore').onchange = runSim;
  $('btnRecon').onclick = () => $('reconFile').click();
  $('reconFile').onchange = () => { if ($('reconFile').files[0]) runRecon(); };
  $('tglComissao').onclick = function () {
    this.classList.add('on'); $('tglFaturamento').classList.remove('on');
    state.chartMode = 'commission'; drawSeriesChart('mainChart', 'chartAxis', state.series, state.chartMode);
  };
  $('tglFaturamento').onclick = function () {
    this.classList.add('on'); $('tglComissao').classList.remove('on');
    state.chartMode = 'revenue'; drawSeriesChart('mainChart', 'chartAxis', state.series, state.chartMode);
  };
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

  if (Api.token) {
    try {
      const me = await Api.get('/auth/me');
      state.user = me.user;
      state.nicheFields = me.nicheFields || {};
      $('splash').classList.add('hide');
      if (!me.user.onboardingDone) startOnboarding();
      else await enterApp();
      return;
    } catch {
      Api.setToken(null);
    }
  }

  // Vindo do site com plano escolhido → abre login/registro direto
  if (urlParams.get('mode') === 'register' || urlParams.get('plan')) {
    $('splash').classList.add('hide');
    show($('login'));
    setAuthMode(urlParams.get('mode') === 'register' ? 'register' : 'login');
  }
}

boot();
