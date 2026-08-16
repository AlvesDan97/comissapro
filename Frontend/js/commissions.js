/**
 * UI de tipos de comissão do vendedor — formulário dinâmico + lista.
 */
(function () {
  const FALLBACK_CATALOG = {
    calcTypes: [
      { id: 'percent', name: 'Percentual', short: 'Percentual sobre venda', hint: 'Um % fixo sobre o valor escolhido.' },
      { id: 'fixed', name: 'Valor fixo', short: 'Valor fixo por lançamento', hint: 'Um valor em dinheiro a cada venda ou unidade.' },
      { id: 'bands', name: 'Faixas', short: 'Faixas por valor ou quantidade', hint: 'Ao subir de faixa no mês, o % novo vale para todos os lançamentos do período.' },
      { id: 'quantity', name: 'Quantidade', short: 'Por quantidade', hint: 'Um valor para cada unidade vendida.' },
      { id: 'goal', name: 'Meta', short: 'Por meta/faixa', hint: 'O percentual sobe com o volume do mês e vale para todos os lançamentos.' },
      { id: 'prize', name: 'Premiação', short: 'Valor informado no lançamento', hint: 'Você digita o valor do item e o valor da premiação em cada lançamento. Os dois são variáveis.' },
      { id: 'flex', name: 'Flexibilização', short: 'Comissão conforme o desconto dado', hint: 'O % cai se você flexibilizar acima do limite. Cada venda tem o próprio cálculo — os lançamentos anteriores não mudam.' },
    ],
    appliedOn: [
      { id: 'entry_value', name: 'Valor do lançamento' },
      { id: 'net_value', name: 'Valor líquido' },
      { id: 'margin', name: 'Margem' },
      { id: 'accessories', name: 'Acessórios' },
    ],
    generatedWhen: [
      { id: 'on_entry', name: 'Ao registrar o lançamento' },
      { id: 'on_receipt', name: 'Quando o cliente pagar' },
      { id: 'on_invoice', name: 'Na emissão da nota' },
      { id: 'manual', name: 'Manualmente' },
    ],
    receiveWhen: [
      { id: 'same_month', name: 'Mesmo mês' },
      { id: 'next_month', name: '1º dia do próximo mês' },
      { id: 'next_month_5th_bd', name: '5º dia útil do próximo mês' },
      { id: 'days_after', name: 'X dias depois' },
      { id: 'specific_date', name: 'Data específica' },
      { id: 'per_entry', name: 'Definir em cada lançamento' },
    ],
    currencies: [
      { id: 'BRL', name: 'R$ — Real Brasileiro' },
      { id: 'USD', name: 'US$ — Dólar' },
      { id: 'EUR', name: '€ — Euro' },
    ],
  };

  function inferBandBasisClient(cfg) {
    if (cfg.bandBasis === 'units' || cfg.bandBasis === 'revenue' || cfg.bandBasis === 'sale_value') return cfg.bandBasis;
    const caps = (cfg.bands || [])
      .map((b) => b.max)
      .filter((m) => m !== '' && m != null && Number.isFinite(Number(m)))
      .map(Number);
    if (caps.length && Math.max(...caps) <= 100) return 'units';
    return 'sale_value';
  }

  function emptyDraft() {
    return {
      id: null,
      name: '',
      calcType: 'percent',
      percent: 0.5,
      appliedOn: 'entry_value',
      amount: 0,
      per: 'entry',
      amountPerUnit: 0,
      unitLabel: 'unidade',
      bandMode: 'percent',
      bandBasis: 'units',
      recalcMonth: true,
      bands: [{ min: 0, max: '', value: 0.5 }],
      goalBasis: 'units',
      goalBands: [
        { min: 1, max: 4, percent: 0.3 },
        { min: 5, max: 7, percent: 0.4 },
        { min: 8, max: 10, percent: 0.55 },
        { min: 11, max: null, percent: 0.7 },
      ],
      generatedWhen: 'on_entry',
      receiveWhen: 'next_month',
      receiveDays: 30,
      receiveDate: '',
      itemLabel: 'Valor do item',
      flexBands: [
        { min: 0, max: 3, percent: 0.5 },
        { min: 3, max: '', percent: 0.4 },
      ],
    };
  }

  function draftFrom(c) {
    const d = emptyDraft();
    if (!c) return d;
    d.id = c.id;
    d.name = c.name || '';
    d.calcType = c.calcType || 'percent';
    d.generatedWhen = c.generatedWhen || 'on_entry';
    d.receiveWhen = c.receiveWhen || 'next_month';
    d.receiveDays = c.receiveDays ?? 30;
    d.receiveDate = c.receiveDate || '';
    const cfg = c.config || {};
    if (d.calcType === 'percent') {
      d.percent = cfg.percent ?? 0.5;
      d.appliedOn = cfg.appliedOn || 'entry_value';
    } else if (d.calcType === 'fixed') {
      d.amount = cfg.amount ?? 0;
      d.per = cfg.per || 'entry';
    } else if (d.calcType === 'bands') {
      d.appliedOn = cfg.appliedOn || 'entry_value';
      d.bandMode = cfg.mode || 'percent';
      d.bandBasis = cfg.bandBasis || inferBandBasisClient(cfg);
      d.recalcMonth = d.bandBasis === 'sale_value' ? false : cfg.recalcMonth !== false;
      d.bands = (cfg.bands || []).map((b) => ({
        min: b.min ?? 0,
        max: b.max == null ? '' : b.max,
        value: b.value ?? 0,
      }));
      if (!d.bands.length) d.bands = [{ min: 0, max: '', value: 0.5 }];
    } else if (d.calcType === 'quantity') {
      d.amountPerUnit = cfg.amountPerUnit ?? 0;
      d.unitLabel = cfg.unitLabel || 'unidade';
    } else if (d.calcType === 'goal') {
      d.goalBasis = cfg.basis || 'units';
      d.goalBands = (cfg.bands || []).map((b) => ({
        min: b.min ?? 1,
        max: b.max == null ? '' : b.max,
        percent: b.percent ?? 0,
      }));
      if (!d.goalBands.length) d.goalBands = [{ min: 1, max: '', percent: 0.3 }];
    } else if (d.calcType === 'prize') {
      d.itemLabel = cfg.itemLabel || 'Valor do item';
    } else if (d.calcType === 'flex') {
      d.flexBands = (cfg.bands || []).map((b) => ({
        min: b.min ?? 0,
        max: b.max == null ? '' : b.max,
        percent: b.percent ?? 0,
      }));
      if (!d.flexBands.length) {
        d.flexBands = [
          { min: 0, max: 3, percent: 0.5 },
          { min: 3, max: '', percent: 0.4 },
        ];
      }
    }
    return d;
  }

  function optionsHtml(list, selected) {
    return list.map((x) => `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${x.name}</option>`).join('');
  }

  function bandRowsHtml(rows, valueKey, valueLabel) {
    return rows
      .map(
        (b, i) => `
      <div class="band-row" data-idx="${i}">
        <input class="cf-band-min" type="number" min="0" step="1" value="${b.min ?? 0}" aria-label="Mínimo">
        <input class="cf-band-max" type="number" min="0" step="1" value="${b.max ?? ''}" placeholder="∞" aria-label="Máximo">
        <input class="cf-band-val" type="number" min="0" step="0.01" value="${b[valueKey] ?? 0}" aria-label="${valueLabel}">
        <button type="button" class="band-remove" data-remove-band="${i}" aria-label="Remover faixa">✕</button>
      </div>`
      )
      .join('');
  }

  function typeFieldsHtml(draft, catalog) {
    const t = draft.calcType;
    if (t === 'percent') {
      return `
        <div class="field"><label>Percentual da comissão</label>
          <div class="suffix-input"><input class="cf-percent" type="number" min="0" step="0.01" value="${draft.percent}"><span>%</span></div>
        </div>
        <div class="field"><label>Percentual aplicado sobre</label>
          <select class="cf-applied">${optionsHtml(catalog.appliedOn, draft.appliedOn)}</select>
        </div>`;
    }
    if (t === 'fixed') {
      return `
        <div class="field"><label>Valor da comissão</label>
          <input class="cf-amount" type="number" min="0" step="0.01" value="${draft.amount}">
        </div>
        <div class="field"><label>Aplicado por</label>
          <select class="cf-per">
            <option value="entry" ${draft.per === 'entry' ? 'selected' : ''}>Lançamento</option>
            <option value="unit" ${draft.per === 'unit' ? 'selected' : ''}>Unidade</option>
          </select>
        </div>`;
    }
    if (t === 'bands') {
      const basisLabel =
        draft.bandBasis === 'units' ? 'lançamentos' : draft.bandBasis === 'revenue' ? 'R$ no mês' : 'R$ da venda';
      return `
        <div class="field"><label>O De / Até conta o quê?</label>
          <select class="cf-band-basis">
            <option value="units" ${draft.bandBasis === 'units' ? 'selected' : ''}>Quantidade de lançamentos no mês</option>
            <option value="sale_value" ${draft.bandBasis === 'sale_value' ? 'selected' : ''}>Valor desta venda (R$)</option>
            <option value="revenue" ${draft.bandBasis === 'revenue' ? 'selected' : ''}>Faturamento do mês (R$)</option>
          </select>
          <p class="field-hint">Ex.: 1–4 vendas = 0,3%. Se De/Até for 0 e 80.000, use valor desta venda.</p>
        </div>
        <div class="field"><label>% calculado sobre</label>
          <select class="cf-applied">${optionsHtml(catalog.appliedOn, draft.appliedOn)}</select>
        </div>
        <div class="field"><label>Cada faixa paga em</label>
          <select class="cf-band-mode">
            <option value="percent" ${draft.bandMode === 'percent' ? 'selected' : ''}>Percentual (%)</option>
            <option value="fixed" ${draft.bandMode === 'fixed' ? 'selected' : ''}>Valor fixo</option>
          </select>
        </div>
        <div class="field">
          <label>Faixas (${basisLabel})</label>
          <div class="band-head"><span>De</span><span>Até</span><span>${draft.bandMode === 'fixed' ? 'R$' : '%'}</span><span></span></div>
          <div class="cf-bands">${bandRowsHtml(draft.bands, 'value', 'Valor')}</div>
          <button type="button" class="link-btn cf-add-band">＋ Adicionar faixa</button>
        </div>
        ${
          draft.bandBasis === 'sale_value'
            ? ''
            : `<label class="check-row">
                <input type="checkbox" class="cf-recalc-month" ${draft.recalcMonth !== false ? 'checked' : ''}>
                <span>Ao atingir a próxima faixa, recalcular todos os lançamentos do mês com o % novo</span>
              </label>`
        }`;
    }
    if (t === 'quantity') {
      return `
        <div class="field"><label>Valor por quantidade</label>
          <input class="cf-amount-unit" type="number" min="0" step="0.01" value="${draft.amountPerUnit}">
        </div>
        <div class="field"><label>Unidade</label>
          <input class="cf-unit-label" type="text" value="${draft.unitLabel}" placeholder="unidade, apólice, veículo…">
        </div>`;
    }
    if (t === 'goal') {
      return `
        <div class="field"><label>Meta medida em</label>
          <select class="cf-goal-basis">
            <option value="units" ${draft.goalBasis === 'units' ? 'selected' : ''}>Quantidade de vendas</option>
            <option value="revenue" ${draft.goalBasis === 'revenue' ? 'selected' : ''}>Faturamento</option>
          </select>
        </div>
        <div class="field">
          <label>Faixas da meta</label>
          <div class="band-head"><span>De</span><span>Até</span><span>%</span><span></span></div>
          <div class="cf-goal-bands">${bandRowsHtml(draft.goalBands, 'percent', 'Percentual')}</div>
          <button type="button" class="link-btn cf-add-goal-band">＋ Adicionar faixa</button>
        </div>
        <p class="field-hint">Ao subir de faixa, todos os lançamentos do mês passam para o percentual atual.</p>`;
    }
    if (t === 'prize') {
      return `
        <div class="field"><label>Como chamar o valor do item</label>
          <input class="cf-item-label" type="text" maxlength="40" value="${escapeAttr(draft.itemLabel || 'Valor do item')}" placeholder="Valor do item">
          <p class="field-hint">No lançamento você informa esse valor e, à parte, o valor da premiação. Nada é calculado automaticamente.</p>
        </div>`;
    }
    if (t === 'flex') {
      return `
        <div class="field">
          <label>Faixas de flexibilização (% da venda)</label>
          <p class="field-hint">Até 3% da venda = 0,5%. Acima de 3% = 0,4%. Cada lançamento usa o próprio flex: os anteriores não são recalculados.</p>
          <div class="band-head"><span>De %</span><span>Até %</span><span>Comissão %</span><span></span></div>
          <div class="cf-flex-bands">${bandRowsHtml(draft.flexBands, 'percent', 'Percentual')}</div>
          <button type="button" class="link-btn cf-add-flex-band">＋ Adicionar faixa</button>
        </div>`;
    }
    return '';
  }

  function formHtml(draft, catalog) {
    const hint = catalog.calcTypes.find((t) => t.id === draft.calcType)?.hint || '';
    return `
      <div class="field"><label>Nome da comissão</label>
        <input class="cf-name" type="text" maxlength="80" placeholder="Ex.: Comissão principal" value="${escapeAttr(draft.name)}">
      </div>
      <div class="field">
        <label>Como ela é calculada?</label>
        <div class="type-pick" role="radiogroup">
          ${catalog.calcTypes
            .map(
              (t) => `<button type="button" class="type-opt ${draft.calcType === t.id ? 'on' : ''}" data-type="${t.id}">
                <span class="radio"></span>${t.name}
              </button>`
            )
            .join('')}
        </div>
        <p class="field-hint">${hint}</p>
      </div>
      <div class="cf-type-fields">${typeFieldsHtml(draft, catalog)}</div>
      <div class="field"><label>Quando essa comissão é gerada?</label>
        <select class="cf-generated">${optionsHtml(catalog.generatedWhen, draft.generatedWhen)}</select>
      </div>
      <div class="field"><label>Quando você normalmente recebe?</label>
        <select class="cf-receive">${optionsHtml(catalog.receiveWhen, draft.receiveWhen)}</select>
        <p class="field-hint cf-receive-hint"></p>
      </div>
      <div class="field cf-days-wrap ${draft.receiveWhen === 'days_after' ? '' : 'hidden'}">
        <label>Quantos dias depois?</label>
        <input class="cf-days" type="number" min="0" step="1" value="${draft.receiveDays ?? 30}">
      </div>
      <div class="field cf-date-wrap ${draft.receiveWhen === 'specific_date' ? '' : 'hidden'}">
        <label>Data específica</label>
        <input class="cf-date" type="date" value="${draft.receiveDate || ''}">
      </div>
    `;
  }

  function escapeAttr(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function readBands(root, selector, valueKey) {
    return [...root.querySelectorAll(selector + ' .band-row')].map((row) => {
      const min = Number(row.querySelector('.cf-band-min').value);
      const maxRaw = row.querySelector('.cf-band-max').value;
      const val = Number(row.querySelector('.cf-band-val').value);
      return {
        min: Number.isFinite(min) ? min : 0,
        max: maxRaw === '' ? null : Number(maxRaw),
        [valueKey]: Number.isFinite(val) ? val : 0,
      };
    });
  }

  function syncDraftFromDom(root, draft) {
    if (!root || !draft) return draft;
    const name = root.querySelector('.cf-name');
    if (name) draft.name = name.value;
    const percent = root.querySelector('.cf-percent');
    if (percent) draft.percent = Number(percent.value);
    const applied = root.querySelector('.cf-applied');
    if (applied) draft.appliedOn = applied.value;
    const amount = root.querySelector('.cf-amount');
    if (amount) draft.amount = Number(amount.value);
    const per = root.querySelector('.cf-per');
    if (per) draft.per = per.value;
    const bandMode = root.querySelector('.cf-band-mode');
    if (bandMode) draft.bandMode = bandMode.value;
    const bandBasis = root.querySelector('.cf-band-basis');
    if (bandBasis) draft.bandBasis = bandBasis.value;
    const recalcMonth = root.querySelector('.cf-recalc-month');
    if (recalcMonth) draft.recalcMonth = recalcMonth.checked;
    const amountUnit = root.querySelector('.cf-amount-unit');
    if (amountUnit) draft.amountPerUnit = Number(amountUnit.value);
    const unitLabel = root.querySelector('.cf-unit-label');
    if (unitLabel) draft.unitLabel = unitLabel.value;
    const itemLabel = root.querySelector('.cf-item-label');
    if (itemLabel) draft.itemLabel = itemLabel.value;
    const goalBasis = root.querySelector('.cf-goal-basis');
    if (goalBasis) draft.goalBasis = goalBasis.value;
    const generated = root.querySelector('.cf-generated');
    if (generated) draft.generatedWhen = generated.value;
    const receive = root.querySelector('.cf-receive');
    if (receive) draft.receiveWhen = receive.value;
    const days = root.querySelector('.cf-days');
    if (days) draft.receiveDays = Number(days.value);
    const date = root.querySelector('.cf-date');
    if (date) draft.receiveDate = date.value;
    if (root.querySelector('.cf-bands')) draft.bands = readBands(root, '.cf-bands', 'value');
    if (root.querySelector('.cf-goal-bands')) draft.goalBands = readBands(root, '.cf-goal-bands', 'percent');
    if (root.querySelector('.cf-flex-bands')) draft.flexBands = readBands(root, '.cf-flex-bands', 'percent');
    return draft;
  }

  function payloadFromDraft(draft) {
    if (!draft) throw new Error('Formulário incompleto.');
    let config = {};
    if (draft.calcType === 'percent') config = { percent: Number(draft.percent) || 0, appliedOn: draft.appliedOn };
    if (draft.calcType === 'fixed') config = { amount: Number(draft.amount) || 0, per: draft.per };
    if (draft.calcType === 'bands') {
      config = {
        appliedOn: draft.appliedOn,
        bandBasis: draft.bandBasis || 'units',
        recalcMonth: draft.bandBasis === 'sale_value' ? false : draft.recalcMonth !== false,
        mode: draft.bandMode,
        bands: draft.bands,
      };
    }
    if (draft.calcType === 'quantity') {
      config = { amountPerUnit: Number(draft.amountPerUnit) || 0, unitLabel: draft.unitLabel || 'unidade' };
    }
    if (draft.calcType === 'goal') {
      config = { basis: draft.goalBasis, bands: draft.goalBands };
    }
    if (draft.calcType === 'prize') {
      config = { itemLabel: draft.itemLabel || 'Valor do item' };
    }
    if (draft.calcType === 'flex') {
      config = { recalcMonth: false, bands: draft.flexBands };
    }
    return {
      name: String(draft.name || '').trim(),
      calcType: draft.calcType,
      config,
      generatedWhen: draft.generatedWhen,
      receiveWhen: draft.receiveWhen,
      receiveDays: draft.receiveWhen === 'days_after' ? draft.receiveDays : null,
      receiveDate: draft.receiveWhen === 'specific_date' ? draft.receiveDate : null,
    };
  }

  function bindForm(root, draft, catalog, rerender) {
    root.querySelectorAll('.type-opt').forEach((btn) => {
      btn.onclick = () => {
        syncDraftFromDom(root, draft);
        draft.calcType = btn.dataset.type;
        rerender();
      };
    });
    const receive = root.querySelector('.cf-receive');
    const receiveHint = root.querySelector('.cf-receive-hint');
    const syncReceiveHint = () => {
      if (!receiveHint || !receive) return;
      receiveHint.textContent =
        receive.value === 'next_month_5th_bd'
          ? 'A data é calculada sozinha: 5º dia útil do mês seguinte (sem sábado, domingo e feriados nacionais).'
          : '';
    };
    if (receive) {
      receive.onchange = () => {
        draft.receiveWhen = receive.value;
        root.querySelector('.cf-days-wrap')?.classList.toggle('hidden', receive.value !== 'days_after');
        root.querySelector('.cf-date-wrap')?.classList.toggle('hidden', receive.value !== 'specific_date');
        syncReceiveHint();
      };
      syncReceiveHint();
    }
    const addBand = root.querySelector('.cf-add-band');
    if (addBand) {
      addBand.onclick = () => {
        syncDraftFromDom(root, draft);
        const last = draft.bands[draft.bands.length - 1];
        draft.bands.push({ min: last?.max || 0, max: '', value: last?.value || 0 });
        rerender();
      };
    }
    const addGoal = root.querySelector('.cf-add-goal-band');
    if (addGoal) {
      addGoal.onclick = () => {
        syncDraftFromDom(root, draft);
        const last = draft.goalBands[draft.goalBands.length - 1];
        draft.goalBands.push({ min: last?.max || 0, max: '', percent: last?.percent || 0 });
        rerender();
      };
    }
    const addFlex = root.querySelector('.cf-add-flex-band');
    if (addFlex) {
      addFlex.onclick = () => {
        syncDraftFromDom(root, draft);
        const last = draft.flexBands[draft.flexBands.length - 1];
        draft.flexBands.push({ min: last?.max || 0, max: '', percent: last?.percent || 0 });
        rerender();
      };
    }
    root.querySelectorAll('[data-remove-band]').forEach((btn) => {
      btn.onclick = () => {
        syncDraftFromDom(root, draft);
        const idx = Number(btn.dataset.removeBand);
        if (draft.calcType === 'goal') {
          if (draft.goalBands.length < 2) return;
          draft.goalBands.splice(idx, 1);
        } else if (draft.calcType === 'flex') {
          if (draft.flexBands.length < 2) return;
          draft.flexBands.splice(idx, 1);
        } else {
          if (draft.bands.length < 2) return;
          draft.bands.splice(idx, 1);
        }
        rerender();
      };
    });
    const bandMode = root.querySelector('.cf-band-mode');
    if (bandMode) {
      bandMode.onchange = () => {
        syncDraftFromDom(root, draft);
        rerender();
      };
    }
    const bandBasisEl = root.querySelector('.cf-band-basis');
    if (bandBasisEl) {
      bandBasisEl.onchange = () => {
        syncDraftFromDom(root, draft);
        rerender();
      };
    }
  }

  function listHtml(commissions) {
    if (!commissions.length) {
      return `<p class="empty">Nenhuma comissão ainda. Toque em adicionar para cadastrar a primeira regra.</p>`;
    }
    return commissions
      .map(
        (c) => `
      <article class="comm-card">
        <div class="comm-card-body">
          <h3>${escapeAttr(c.name)}</h3>
          <p class="comm-detail">${escapeAttr(c.detail)}</p>
          <div class="comm-highlight">${escapeAttr(c.highlight)}</div>
          <p class="comm-receive">Recebimento: ${escapeAttr((c.receiveLabel || '').toLowerCase())}</p>
        </div>
        <button type="button" class="comm-edit" data-edit-commission="${c.id}">Editar</button>
      </article>`
      )
      .join('');
  }

  function preview(commission, input) {
    const cfg = commission.config || {};
    const gross = Number(input.grossValue) || 0;
    const qty = Math.max(1, Number(input.quantity) || 1);
    const cost = Number(input.costValue) || 0;
    const monthCount = Number(input.monthCount) || 0;
    const monthRevenue = Number(input.monthRevenue) || 0;
    const t = commission.calcType;
    const pct = (n) => (Number(n) || 0) / 100;
    const base =
      cfg.appliedOn === 'margin' || cfg.appliedOn === 'net_value' ? Math.max(0, gross - cost) : gross;
    const pick = (bands, vol, key) => {
      const sorted = [...(bands || [])].sort((a, b) => (a.min || 0) - (b.min || 0));
      let cur = sorted[0] || { [key]: 0 };
      for (const b of sorted) if (vol >= (b.min || 0)) cur = b;
      return cur;
    };
    if (t === 'percent') return { amount: base * pct(cfg.percent), note: `${commission.highlight} sobre o valor` };
    if (t === 'fixed') {
      const amount = (Number(cfg.amount) || 0) * (cfg.per === 'unit' ? qty : 1);
      return { amount, note: 'Valor fixo' };
    }
    if (t === 'bands') {
      const basis = inferBandBasisClient(cfg);
      const vol =
        basis === 'units' ? monthCount + 1 : basis === 'revenue' ? monthRevenue + gross : base;
      const band = pick(cfg.bands, vol, 'value');
      const monthRecalc = basis !== 'sale_value' && cfg.recalcMonth !== false;
      const note = monthRecalc
        ? `${vol} lançamento${vol === 1 ? '' : 's'} no mês · vale para todos`
        : basis === 'units'
          ? `${vol}º lançamento no mês`
          : basis === 'revenue'
            ? 'faturamento do mês'
            : 'valor desta venda';
      if (cfg.mode === 'fixed') {
        return { amount: Number(band.value) || 0, note, monthRecalc, previousCount: monthCount };
      }
      return {
        amount: base * pct(band.value),
        note,
        monthRecalc,
        previousCount: monthCount,
        monthRate: band.value,
      };
    }
    if (t === 'quantity') {
      return { amount: (Number(cfg.amountPerUnit) || 0) * qty, note: `${qty} ${cfg.unitLabel || 'un.'}` };
    }
    if (t === 'goal') {
      const vol = cfg.basis === 'revenue' ? monthRevenue + gross : monthCount + 1;
      const band = pick(cfg.bands, vol, 'percent');
      return {
        amount: gross * pct(band.percent),
        note: `${vol} no mês · vale para todos`,
        monthRecalc: true,
        previousCount: monthCount,
        monthRate: band.percent,
      };
    }
    if (t === 'prize') {
      const amount = Number(input.commissionAmount) || 0;
      return { amount, note: 'Premiação lançada manualmente' };
    }
    if (t === 'flex') {
      const flexAmount = Number(input.flexAmount) || 0;
      const pctFlex =
        input.flexPercent != null && input.flexPercent !== ''
          ? Math.max(0, Number(input.flexPercent) || 0)
          : gross > 0
            ? (flexAmount / gross) * 100
            : 0;
      const sorted = [...(cfg.bands || [])].sort((a, b) => (a.min || 0) - (b.min || 0));
      const matches = sorted.filter((b) => {
        const min = Number(b.min) || 0;
        const max = b.max === '' || b.max == null ? null : Number(b.max);
        if (pctFlex < min) return false;
        if (max != null && Number.isFinite(max) && pctFlex > max) return false;
        return true;
      });
      let band = matches[0] || sorted[sorted.length - 1] || { percent: 0 };
      if (matches.length > 1) {
        matches.sort((a, b) => {
          const am = a.max == null || a.max === '' ? Infinity : Number(a.max);
          const bm = b.max == null || b.max === '' ? Infinity : Number(b.max);
          return am - bm;
        });
        band = matches[0];
      }
      const flexLabel = String(Math.round(pctFlex * 100) / 100).replace('.', ',');
      return {
        amount: gross * pct(band.percent),
        note: `Flex ${flexLabel}% da venda · comissão ${String(band.percent).replace('.', ',')}%`,
      };
    }
    return { amount: 0, note: '' };
  }

  window.CommissionUI = {
    FALLBACK_CATALOG,
    emptyDraft,
    draftFrom,
    formHtml,
    listHtml,
    syncDraftFromDom,
    payloadFromDraft,
    bindForm,
    preview,
  };
})();
