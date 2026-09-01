(() => {
  'use strict';
  const statusLabel = { cotacao:'Cotação aberta', aguardando_dados:'Aguardando dados', aguardando_aprovacao:'Aguardando aprovação', autorizado:'Aceita', agendado:'Agendada', a_caminho:'A caminho', em_atendimento:'Em atendimento', aguardando_fechamento:'Aguardando fechamento', concluido:'Concluída', cancelado:'Cancelada' };
  const accepted = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido']);
  const quoteTimelineTypes = new Set(['consulta_registrada','consulta_disponibilidade','cotacao','solicitacao_recebida','dados_incompletos','dados_do_atendimento','aguardando_autorizacao']);
  const isQuote = (c) => c?.quoteTracked === true || ['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(c?.status) || ['open','won','lost'].includes(c?.quoteOutcome) || (Array.isArray(c?.operationalTimeline) && c.operationalTimeline.some((event) => quoteTimelineTypes.has(event?.type)));
  const outcome = (c) => c?.quoteOutcome === 'won' || accepted.has(c?.status) || c?.authorizedAt ? 'Ganha' : c?.quoteOutcome === 'lost' || (c?.status === 'cancelado' && !c?.authorizedAt) ? 'Perdida' : 'Em aberto';
  const stamp = (value) => { try { return new Date(value).toLocaleString('pt-BR'); } catch { return '—'; } };
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const isAccepted = (c) => accepted.has(c?.status) || Boolean(c?.authorizedAt) || (c?.status === 'cancelado' && c?.cancellationChargeRequired === true);
  const simulatedRevenueForCall = (c) => isAccepted(c) ? num(c?.value || c?.calculatedValue || c?.quoteCalculatedValue) : 0;
  const simulatedDriverForCall = (c) => {
    if (!isAccepted(c)) return 0;
    const km = Math.max(0, num(c?.serviceOutcome === 'deslocamento_sem_reboque'
      ? (c?.displacementBillableKm ?? c?.billableKm)
      : c?.cancellationChargeRequired
        ? (c?.cancellationBillableKm ?? c?.billableKm ?? c?.totalKm)
        : (c?.billableKm ?? c?.totalKm)));
    const route = 40 + Math.max(0, km - 50) * 0.70;
    const worked = c?.workedTimeChargeRequired ? num(c?.workedTimeAmount) : 0;
    return Math.round((route + worked) * 100) / 100;
  };

  function styles() {
    if (document.getElementById('testModeStyles')) return;
    const style = document.createElement('style');
    style.id = 'testModeStyles';
    style.textContent = `
      .test-mode-card{border:1px solid #93c5fd;background:linear-gradient(135deg,#eff6ff,#f8fbff);box-shadow:0 10px 30px rgba(37,99,235,.08)}
      .test-mode-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
      .test-mode-head-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
      .test-mode-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:800;letter-spacing:.04em}
      .test-mode-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:10px;margin-top:14px}
      .test-mode-metric{background:#fff;border:1px solid #dbeafe;border-radius:14px;padding:12px}.test-mode-metric span{display:block;color:#64748b;font-size:12px}.test-mode-metric b{display:block;color:#0f172a;font-size:24px;margin-top:4px}
      .test-mode-list{display:grid;gap:8px;margin-top:14px}.test-mode-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;background:#fff;border:1px solid #dbeafe;border-radius:14px;padding:12px}.test-mode-row small{display:block;color:#64748b;margin-top:5px}.test-mode-status{align-self:start;padding:5px 8px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:800}.test-mode-route{margin-top:5px;font-size:13px;color:#334155}
      .test-mode-actions{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;justify-content:flex-end}.test-mode-actions .btn{min-height:30px}.test-mode-delete{color:#b91c1c!important;border-color:#fecaca!important;background:#fff!important}.test-mode-delete:hover{background:#fef2f2!important;border-color:#fca5a5!important}.test-mode-delete-all{color:#fff!important;border-color:#b91c1c!important;background:#b91c1c!important}.test-mode-delete-all:hover{background:#991b1b!important;border-color:#991b1b!important}.test-mode-delete-all:disabled{opacity:.65;cursor:wait}
      @media(max-width:720px){.test-mode-metrics{grid-template-columns:1fr 1fr}.test-mode-head{display:block}.test-mode-head-actions{justify-content:flex-start;margin-top:10px}.test-mode-badge{margin-top:0}.test-mode-row{grid-template-columns:1fr}.test-mode-status{justify-self:start}.test-mode-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function renderTestMode() {
    styles();
    const calls = Array.isArray(mgmt?.testCalls) ? mgmt.testCalls : [];
    const quotes = calls.filter(isQuote);
    const won = quotes.filter((c) => outcome(c) === 'Ganha');
    const lost = quotes.filter((c) => outcome(c) === 'Perdida');
    const open = quotes.filter((c) => outcome(c) === 'Em aberto');
    const acceptedCalls = calls.filter(isAccepted);
    const simulatedRevenue = acceptedCalls.reduce((sum, c) => sum + simulatedRevenueForCall(c), 0);
    const simulatedDriver = acceptedCalls.reduce((sum, c) => sum + simulatedDriverForCall(c), 0);
    const dashboard = document.getElementById('dashboard');
    if (dashboard) {
      let card = document.getElementById('testModeDashboard');
      if (!card) {
        card = document.createElement('div'); card.id = 'testModeDashboard'; card.className = 'card section test-mode-card';
        const anchor = dashboard.querySelector('.owner-kpis') || dashboard.firstElementChild;
        if (anchor?.parentNode) anchor.parentNode.insertBefore(card, anchor); else dashboard.prepend(card);
      }
      card.innerHTML = `<div class="test-mode-head"><div><div class="eyebrow">AMBIENTE DE TESTE</div><h3>Testes do WhatsApp</h3><p>Estes dados servem só para validação. Não entram em faturamento, recebíveis ou pagamento real do motorista.</p></div><span class="test-mode-badge">TESTE · ${calls.length} registro(s)</span></div><div class="test-mode-metrics"><div class="test-mode-metric"><span>Cotações</span><b>${quotes.length}</b></div><div class="test-mode-metric"><span>Em aberto</span><b>${open.length}</b></div><div class="test-mode-metric"><span>Ganhas</span><b>${won.length}</b></div><div class="test-mode-metric"><span>Perdidas</span><b>${lost.length}</b></div><div class="test-mode-metric"><span>Corridas aceitas</span><b>${acceptedCalls.length}</b></div><div class="test-mode-metric"><span>Faturamento simulado</span><b>${money(simulatedRevenue)}</b></div><div class="test-mode-metric"><span>Mauro simulado</span><b>${money(simulatedDriver)}</b></div></div><div class="test-mode-list">${calls.length ? [...calls].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).slice(0,5).map(c=>`<div class="test-mode-row"><div><b>${esc(c.vehicle||'Cotação de teste')}</b><small>${esc(c.groupName||c.insurer||'Tests guincho')} · ${stamp(c.updatedAt||c.createdAt)}</small><div class="test-mode-route">${esc(c.origin||'Origem não informada')} → ${esc(c.destination||'Destino não informado')}</div></div><span class="test-mode-status">${esc(statusLabel[c.status]||c.status||'Teste')}</span></div>`).join('') : '<div class="empty">Nenhum teste registrado ainda.</div>'}</div>`;
    }
    const financePage = document.getElementById('finance');
    if (financePage) {
      let financeCard = document.getElementById('testModeFinancePanel');
      if (!financeCard) { financeCard = document.createElement('div'); financeCard.id = 'testModeFinancePanel'; financeCard.className = 'card section test-mode-card'; financePage.prepend(financeCard); }
      financeCard.innerHTML = `<div class="test-mode-head"><div><div class="eyebrow">FINANCEIRO DE TESTE</div><h3>Simulação das corridas do Tests guincho</h3><p>Calculado com as mesmas regras da operação, mas isolado do financeiro oficial.</p></div><span class="test-mode-badge">NÃO É COBRANÇA REAL</span></div><div class="test-mode-metrics"><div class="test-mode-metric"><span>Corridas aceitas</span><b>${acceptedCalls.length}</b></div><div class="test-mode-metric"><span>Faturamento simulado</span><b>${money(simulatedRevenue)}</b></div><div class="test-mode-metric"><span>Pagamento Mauro</span><b>${money(simulatedDriver)}</b></div></div>`;
      const persistedTestFinance = Array.isArray(mgmt?.testFinance) ? mgmt.testFinance : [];
      const financeByCall = new Map();
      for (const c of calls.filter((item) => item?.ownerClosedAt || item?.status === 'concluido')) financeByCall.set(c.id, { sourceCallId:c.id, description:`[TESTE] ${c.vehicle || 'Corrida'} · ${c.groupName || c.insurer || 'Tests guincho'}`, amount:simulatedRevenueForCall(c), billableKm:num(c.billableKm ?? c.totalKm), updatedAt:c.ownerClosedAt || c.completedAt || c.updatedAt, testMode:true });
      for (const entry of persistedTestFinance) financeByCall.set(entry.sourceCallId || entry.id, entry);
      const testFinanceRows = [...financeByCall.values()].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
      if (testFinanceRows.length) financeCard.insertAdjacentHTML('beforeend', `<div class="test-mode-list test-finance-detail-list">${testFinanceRows.slice(0,20).map(f=>`<div class="test-mode-row"><div><b>${esc(f.description || '[TESTE] Corrida concluída')}</b><small>Fechado em ${stamp(f.updatedAt)}</small><div class="test-mode-route">${num(f.billableKm).toLocaleString('pt-BR',{maximumFractionDigits:1})} km · ${money(f.amount)}</div></div><span class="test-mode-status">TESTE · FECHADO</span></div>`).join('')}</div>`);
    }
    const callsPage = document.getElementById('calls');
    if (callsPage) {
      let panel = document.getElementById('testModeCallsPanel');
      if (!panel) { panel = document.createElement('div'); panel.id = 'testModeCallsPanel'; panel.className = 'card section test-mode-card'; callsPage.prepend(panel); }
      panel.innerHTML = `<div class="test-mode-head"><div><div class="eyebrow">MODO DE TESTE</div><h3>Cotações e corridas do Tests guincho</h3><p>Visíveis para conferência, isoladas dos números oficiais.</p></div><div class="test-mode-head-actions"><span class="test-mode-badge">${calls.length} registro(s)</span>${calls.length ? '<button type="button" class="btn small test-mode-delete-all" onclick="deleteAllTestCalls(this)">Apagar todos</button>' : ''}</div></div><div class="test-mode-list">${calls.length ? [...calls].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0)).map(c=>`<div class="test-mode-row"><div><b>${esc(c.vehicle||'Atendimento de teste')}</b><small>${esc(outcome(c))} · ${stamp(c.updatedAt||c.createdAt)}</small><div class="test-mode-route">${esc(c.origin||'Origem não informada')} → ${esc(c.destination||'Destino não informado')}</div>${c.lastOperationalText?`<small>“${esc(c.lastOperationalText).slice(0,150)}”</small>`:''}</div><div class="test-mode-actions"><span class="test-mode-status">${esc(statusLabel[c.status]||c.status||'Teste')}</span><button type="button" class="btn small ghost test-mode-delete" onclick="deleteTestCall('${esc(c.id)}')">Excluir</button></div></div>`).join('') : '<div class="empty">Nenhum atendimento de teste registrado.</div>'}</div>`;
    }
  }

  window.deleteTestCall = async (id) => {
    const call = (Array.isArray(mgmt?.testCalls) ? mgmt.testCalls : []).find((item) => item?.id === id);
    if (!call) return alert('Corrida de teste não encontrada. Atualize a tela.');
    if (!confirm('Excluir definitivamente esta corrida de TESTE? Ela também será removida do Financeiro de teste.')) return;
    try {
      await api('/api/worker/management', { method:'POST', body:JSON.stringify({ action:'delete_call', callId:id, ownerName:'Thiago' }) });
      await loadManagement();
      if (typeof refreshBillingOnly === 'function') await refreshBillingOnly();
      alert('Corrida de teste excluída.');
    } catch (error) {
      alert('Não foi possível excluir: ' + (error?.message || error));
    }
  };

  window.deleteAllTestCalls = async (button) => {
    const calls = Array.isArray(mgmt?.testCalls) ? [...mgmt.testCalls] : [];
    if (!calls.length) return alert('Não há corridas de teste para excluir.');
    if (!confirm(`APAGAR TODOS OS ${calls.length} REGISTROS DE TESTE?\n\nIsso remove definitivamente todas as cotações/corridas do Tests guincho e o Financeiro de teste vinculado.\n\nAs corridas e o financeiro REAIS não serão alterados. Essa ação não pode ser desfeita.`)) return;
    const originalText = button?.textContent || 'Apagar todos';
    if (button) button.disabled = true;
    let deleted = 0;
    const failures = [];
    for (const call of calls) {
      if (button) button.textContent = `Apagando ${deleted + 1}/${calls.length}...`;
      try {
        await api('/api/worker/management', { method:'POST', body:JSON.stringify({ action:'delete_call', callId:call.id, ownerName:'Thiago' }) });
        deleted += 1;
      } catch (error) {
        failures.push({ id:call.id, error:error?.message || String(error) });
      }
    }
    try {
      await loadManagement();
      if (typeof refreshBillingOnly === 'function') await refreshBillingOnly();
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText; }
    }
    if (failures.length) alert(`${deleted} registro(s) apagado(s). ${failures.length} não puderam ser excluídos; atualize a tela e tente novamente.`);
    else alert(`Pronto. ${deleted} registro(s) de teste foram apagados.`);
  };

  const previousRenderManagement = renderManagement;
  renderManagement = function(){ previousRenderManagement(); renderTestMode(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderTestMode); else renderTestMode();
})();
