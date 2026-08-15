const FALLBACK_PLANS = [
  {
    id: 'solo',
    name: 'Solo',
    priceMonthly: 49,
    priceYearly: 490,
    tagline: 'Para quem vende em poucas empresas',
    features: [
      'Até 3 lojas / fornecedores',
      'Vendas com snapshot histórico',
      'Dashboard e metas em faixas',
      'Simulador What-If',
      'Exportação CSV',
      'Suporte por e-mail',
    ],
    highlighted: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 89,
    priceYearly: 890,
    tagline: 'Para multilojas e conferência de extrato',
    features: [
      'Tudo do Solo',
      'Até 25 lojas',
      'Conciliação Smart (PDF/Excel)',
      'Pipeline + recebíveis',
      'Alisamento de renda',
      '2FA e trilha de auditoria',
      '1 convite de parceiro (split)',
    ],
    highlighted: true,
  },
  {
    id: 'time',
    name: 'Time',
    priceMonthly: 149,
    priceYearly: 1490,
    tagline: 'Para equipes e splits com papéis',
    features: [
      'Tudo do Pro',
      'Até 3 usuários inclusos',
      'Usuário extra R$ 59/mês',
      'Papéis: ver / lançar / admin',
      'Split com acordo rastreado',
      'Prioridade no suporte',
    ],
    highlighted: false,
  },
];

let plans = FALLBACK_PLANS;
let cycle = 'monthly';

function money(n) {
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function renderPlans() {
  const grid = document.getElementById('plansGrid');
  grid.innerHTML = plans
    .map((p) => {
      const price = cycle === 'yearly' ? Math.round(p.priceYearly / 12) : p.priceMonthly;
      const yearNote =
        cycle === 'yearly'
          ? `${money(p.priceYearly)}/ano · 2 meses grátis`
          : 'Cobrança mensal';
      const cta = p.highlighted ? 'Começar no Pro' : `Escolher ${p.name}`;
      return `
      <article class="plan ${p.highlighted ? 'featured' : ''}">
        <h3 class="plan-name">${p.name}</h3>
        <p class="plan-tag">${p.tagline}</p>
        <div class="plan-price">${money(price)}<small>/mês</small></div>
        <div class="plan-year">${yearNote}</div>
        <ul>${(p.features || []).map((f) => `<li>${f}</li>`).join('')}</ul>
        <a class="btn ${p.highlighted ? 'btn-mint' : 'btn-ghost'}"
           href="/app?mode=register&plan=${p.id}&cycle=${cycle}">${cta}</a>
      </article>`;
    })
    .join('');
}

document.querySelectorAll('.billing-toggle button').forEach((btn) => {
  btn.addEventListener('click', () => {
    cycle = btn.dataset.cycle;
    document.querySelectorAll('.billing-toggle button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    renderPlans();
  });
});

async function loadPlans() {
  try {
    const res = await fetch('/api/billing/plans');
    if (!res.ok) throw new Error('fail');
    const data = await res.json();
    if (Array.isArray(data.plans) && data.plans.length) plans = data.plans;
  } catch (_) {
    /* usa fallback */
  }
  renderPlans();
}

loadPlans();
