(() => {
  'use strict';

  const ownerState = { billing: { profiles: [], batches: [], insurerSummaries: [], driverPayrolls: [] }, groups: [], period: 'month' };
  const acceptedStatuses = new Set(['autorizado', 'a_caminho', 'em_atendimento', 'aguardando_fechamento', 'concluido']);
  const activeStatuses = new Set(['autorizado', 'a_caminho', 'em_atendimento', 'aguardando_fechamento']);
  const ownerFinalized = (call) => Boolean(call?.ownerClosedAt) || (call?.status === 'concluido' && call?.ownerCloseRequired !== true);

  const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const pct = (value) => `${Math.round(Number(value || 0))}%`;
  const fmtKm = (value) => `${n(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
  const sortRecent = (items) => [...items].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const statusText = {
    novo: 'Novo', cotacao: 'Cotação aberta', aguardando_dados: 'Aguardando dados', aguardando_aprovacao: 'Aguardando aprovação',
    autorizado: 'Aceita', agendado: 'Agendada', a_caminho: 'A caminho', em_atendimento: 'Em atendimento', aguardando_fechamento: 'Aguardando fechamento', concluido: 'Concluída', cancelado: 'Cancelada'
  };
  const sourceText = (call) => call.source === 'whatsapp' ? 'WhatsApp' : 'Manual';

  function setNavText(page, text) {
    document.querySelectorAll(`[data-page="${page}"]`).forEach((button) => {
      [...button.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).forEach((node) => { node.textContent = text; });
    });
  }

  function periodStart() {
    const now = new Date();
    if (ownerState.period === 'all') return null;
    if (ownerState.period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (ownerState.period === '7d') return new Date(now.getTime() - 7 * 86400000);
    if (ownerState.period === '30d') return new Date(now.getTime() - 30 * 86400000);
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function inPeriod(item) {
    const start = periodStart();
    if (!start) return true;
    const raw = item.authorizedAt || item.completedAt || item.cancelledAt || item.createdAt || item.updatedAt;
    if (!raw) return true;
    const value = new Date(raw);
    return !Number.isNaN(value.getTime()) && value >= start;
  }

  function timelineHas(call, type) {
    return Array.isArray(call.operationalTimeline) && call.operationalTimeline.some((event) => event?.type === type);
  }

  function isQuote(call) {
    const quoteTimelineTypes = ['consulta_registrada','consulta_disponibilidade','cotacao','solicitacao_recebida','dados_incompletos','dados_do_atendimento','aguardando_autorizacao'];
    return call.manualQuote === true
      || call.quoteTracked === true
      || call.quoteOutcome === 'open' || call.quoteOutcome === 'won' || call.quoteOutcome === 'lost'
      || ['cotacao', 'aguardando_dados', 'aguardando_aprovacao', 'agendado'].includes(call.status)
      || quoteTimelineTypes.some((type) => timelineHas(call, type));
  }

  function quoteOutcome(call) {
    if (call.quoteOutcome === 'won') return 'won';
    if (acceptedStatuses.has(call.status) || call.authorizedAt) return 'won';
    if (call.quoteOutcome === 'lost') return 'lost';
    if (isQuote(call) && call.status === 'cancelado' && !call.authorizedAt && call.cancellationChargeRequired !== true) return 'lost';
    return 'open';
  }

  function isAccepted(call) {
    return acceptedStatuses.has(call.status) || Boolean(call.authorizedAt) || (call.status === 'cancelado' && call.cancellationChargeRequired === true);
  }

  function driverPayForCall(call) {
    if (!isAccepted(call)) return 0;
    const km = Math.max(0, n(call.serviceOutcome === 'deslocamento_sem_reboque'
      ? (call.displacementBillableKm ?? call.billableKm)
      : call.cancellationChargeRequired
        ? (call.cancellationBillableKm ?? call.billableKm ?? call.totalKm)
        : (call.billableKm ?? call.totalKm)));
    const route = 40 + Math.max(0, km - 50) * 0.70;
    const worked = call.workedTimeChargeRequired ? n(call.workedTimeAmount) : 0;
    return Math.round((route + worked) * 100) / 100;
  }

  function ownerTag(label, tone = '') {
    return `<span class="owner-tag ${tone}">${esc(label)}</span>`;
  }

  function outcomeTag(call) {
    const outcome = quoteOutcome(call);
    if (outcome === 'won') return ownerTag('Ganha', 'won');
    if (outcome === 'lost') return ownerTag('Perdida', 'lost');
    return ownerTag('Em aberto', 'open');
  }

  function callStatusTag(call) {
    const label = statusText[call.status] || String(call.status || 'Novo').replaceAll('_', ' ');
    const tone = call.status === 'concluido' ? 'won' : call.status === 'cancelado' ? 'lost' : activeStatuses.has(call.status) ? 'open' : '';
    return ownerTag(label, tone);
  }

  function currentPayroll() {
    const payrolls = ownerState.billing.driverPayrolls || [];
    return payrolls.find((p) => p.status !== 'paid') || payrolls[0] || null;
  }

  function driverName() {
    const fleetDriver = (mgmt.fleet || []).find((item) => item.driver)?.driver;
    return fleetDriver || currentPayroll()?.driverName || 'Mauro';
  }

  function metrics() {
    const calls = (mgmt.calls || []).filter(inPeriod);
    const quotes = calls.filter(isQuote);
    const won = quotes.filter((call) => quoteOutcome(call) === 'won');
    const lost = quotes.filter((call) => quoteOutcome(call) === 'lost');
    const open = quotes.filter((call) => quoteOutcome(call) === 'open');
    const accepted = calls.filter(isAccepted);
    const finalized = accepted.filter(ownerFinalized);
    const projected = accepted.filter((call) => !ownerFinalized(call));
    const billed = finalized.reduce((sum, call) => sum + n(call.value), 0);
    const projectedValue = projected.reduce((sum, call) => sum + n(call.value || call.calculatedValue || call.quoteCalculatedValue), 0);
    const finance = (mgmt.finance || []).filter((entry) => entry.type === 'receita' && entry.isFinal === true && inPeriod(entry));
    const received = finance.filter((entry) => entry.status === 'pago').reduce((sum, entry) => sum + n(entry.amount), 0);
    const receivable = finance.filter((entry) => entry.status !== 'pago').reduce((sum, entry) => sum + n(entry.amount), 0);
    const conversion = quotes.length ? (won.length / quotes.length) * 100 : 0;
    const payroll = currentPayroll();
    return { calls, quotes, won, lost, open, accepted, finalized, projected, billed, projectedValue, received, receivable, conversion, payroll };
  }

  function dashboardHtml() {
    return `
      <div class="owner-toolbar">
        <div>
          <div class="eyebrow">GESTÃO DA OPERAÇÃO</div>
          <h2>O que está acontecendo na empresa</h2>
          <p>Dados puxados dos atendimentos do WhatsApp e dos lançamentos manuais.</p>
        </div>
        <div class="owner-actions">
          <select id="ownerPeriod" class="owner-period" aria-label="Período">
            <option value="today">Hoje</option><option value="7d">Últimos 7 dias</option><option value="30d">Últimos 30 dias</option><option value="month">Este mês</option><option value="all">Todo o histórico</option>
          </select>
          <button class="btn secondary" onclick="ownerEditCall(null,'quote')">+ Cotação / corrida</button>
          <button class="btn secondary" onclick="ownerDownloadPeriodReport()">Baixar planilha</button>
          <button class="btn" onclick="newItem('finance')">+ Lançamento financeiro</button>
        </div>
      </div>
      <div class="owner-kpis">
        <div class="owner-kpi"><span>Cotações</span><strong id="ownerQuotesTotal">0</strong><small id="ownerQuotesOpen">0 em aberto</small></div>
        <div class="owner-kpi won"><span>Ganhas</span><strong id="ownerQuotesWon">0</strong><small id="ownerConversion">0% conversão</small></div>
        <div class="owner-kpi lost"><span>Perdidas</span><strong id="ownerQuotesLost">0</strong><small>Não viraram corrida</small></div>
        <div class="owner-kpi"><span>Corridas aceitas</span><strong id="ownerAccepted">0</strong><small>Autorizadas pelo WhatsApp ou manual</small></div>
        <div class="owner-kpi money-card"><span>Faturado definitivo</span><strong id="ownerBilled">R$ 0</strong><small>Somente corridas fechadas no app</small></div><div class="owner-kpi"><span>Previsto em abertas</span><strong id="ownerProjected">R$ 0</strong><small>Ainda pode ser corrigido no fechamento</small></div>
        <div class="owner-kpi"><span>A receber</span><strong id="ownerReceivable">R$ 0</strong><small>Receitas ainda pendentes</small></div>
        <div class="owner-kpi"><span>Recebido</span><strong id="ownerReceived">R$ 0</strong><small>Entradas marcadas como pagas</small></div>
        <div class="owner-kpi driver"><span>A pagar ao motorista</span><strong id="ownerDriverDue">R$ 0</strong><small id="ownerDriverDueLabel">Fechamento atual</small></div>
      </div>
      <div class="owner-grid section">
        <div class="card owner-panel owner-span-2">
          <div class="head"><div><h3>Cotações recentes</h3><p>O sistema acompanha se cada cotação virou corrida ou foi perdida.</p></div><button class="btn ghost small" data-page="calls">Ver todas</button></div>
          <div id="ownerQuoteList" class="owner-list section"></div>
        </div>
        <div class="card owner-panel">
          <div class="head"><div><h3>Pagamento do motorista</h3><p id="ownerDriverName">Motorista</p></div><button class="btn ghost small" data-page="fleet">Abrir</button></div>
          <div id="ownerDriverCard" class="section"></div>
        </div>
      </div>
      <div class="owner-grid section">
        <div class="card owner-panel owner-span-2">
          <div class="head"><div><h3>Corridas aceitas</h3><p>Valor cobrado e custo do motorista por atendimento.</p></div><button class="btn ghost small" data-page="calls">Ver histórico</button></div>
          <div id="ownerAcceptedList" class="table-wrap section"></div>
        </div>
        <div class="card owner-panel">
          <div class="head"><div><h3>Pendências</h3><p>O que precisa de atenção.</p></div></div>
          <div id="ownerPendingList" class="owner-list section"></div>
        </div>
      </div>
      <div class="owner-grid section"><div class="card owner-panel"><div class="head"><div><h3>Conversão por seguradora</h3><p>Cotações solicitadas x ganhas.</p></div></div><div id="ownerInsurerFunnel" class="table-wrap section"></div></div><div class="card owner-panel"><div class="head"><div><h3>Conversão por grupo</h3><p>Performance individual de cada WhatsApp.</p></div></div><div id="ownerGroupFunnel" class="table-wrap section"></div></div></div><div hidden><span id="callsKpi"></span><span id="revenueKpi"></span><span id="balanceKpi"></span><span id="pendingKpi"></span></div>`;
  }

  function renderQuoteList(quotes) {
    const target = document.getElementById('ownerQuoteList');
    if (!target) return;
    const items = sortRecent(quotes).slice(0, 7);
    target.innerHTML = items.length ? items.map((call) => `
      <div class="owner-row">
        <div class="owner-row-main"><div class="owner-row-title"><b>${esc(call.insurer || call.client || 'Seguradora')}</b>${outcomeTag(call)}${ownerTag(sourceText(call), call.source === 'whatsapp' ? 'source' : '')}</div>
        <div class="owner-route">${esc(call.origin || 'Origem não informada')} <span>→</span> ${esc(call.destination || 'Destino não informado')}</div>
        ${call.lastOperationalText ? `<div class="owner-message">“${esc(call.lastOperationalText).slice(0, 150)}”</div>` : ''}</div>
        <div class="owner-row-side"><b>${n(call.value) > 0 ? money(call.value) : '—'}</b><button class="btn ghost small" onclick="ownerEditCall('${esc(call.id)}')">Editar</button></div>
      </div>`).join('') : '<div class="empty">Nenhuma cotação registrada neste período.</div>';
  }

  function renderAcceptedList(calls) {
    const target = document.getElementById('ownerAcceptedList');
    if (!target) return;
    const items = sortRecent(calls).slice(0, 8);
    target.innerHTML = items.length ? `<table class="table owner-table"><thead><tr><th>Corrida</th><th>Status</th><th>KM</th><th>Faturado</th><th>Motorista</th><th></th></tr></thead><tbody>${items.map((call) => `
      <tr><td><b>${esc(call.insurer || call.client || 'Seguradora')}</b><br><span class="muted">${esc(call.vehicle || call.plate || 'Veículo')}</span><br><span class="owner-source-line">${sourceText(call)}</span></td>
      <td>${callStatusTag(call)}</td><td>${fmtKm(call.billableKm ?? call.totalKm)}</td><td><b>${n(call.value || call.calculatedValue) > 0 ? money(call.value || call.calculatedValue) : 'A calcular'}</b><br>${ownerFinalized(call) ? ownerTag('Definitivo','won') : ownerTag('Previsto','open')}${call.financeReviewRequired ? '<br><span class="owner-alert">Revisar</span>' : ''}</td><td>${money(driverPayForCall(call))}</td><td><button class="btn ghost small" onclick="ownerEditCall('${esc(call.id)}')">Editar</button>${!ownerFinalized(call) && isAccepted(call) ? `<button class="btn small" onclick="ownerCloseCall('${esc(call.id)}')">Fechar</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhuma corrida aceita neste período.</div>';
  }

  function renderDriverCard(payroll) {
    const target = document.getElementById('ownerDriverCard');
    const title = document.getElementById('ownerDriverName');
    if (!target) return;
    if (title) title.textContent = driverName();
    if (!payroll) {
      target.innerHTML = `<div class="empty">Ainda não há fechamento calculado. As corridas aceitas entram aqui automaticamente.</div><div class="actions section"><button class="btn secondary small" data-page="fleet">Editar motorista</button></div>`;
      return;
    }
    target.innerHTML = `
      <div class="owner-pay-total"><span>Total definitivo</span><strong>${money(payroll.totalAmount)}</strong></div><div class="kpi-line"><span>Ainda previsto em corridas abertas</span><b>${money(payroll.projectedAmount || 0)}</b></div>
      <div class="kpi-line"><span>Período</span><b>${date(payroll.periodStart)} a ${date(payroll.periodEnd)}</b></div>
      <div class="kpi-line"><span>Corridas</span><b>${payroll.callCount || 0}</b></div>
      <div class="kpi-line"><span>Pagamento pelas corridas</span><b>${money(payroll.routeAmount)}</b></div>
      <div class="kpi-line"><span>Horas trabalhadas</span><b>${money(payroll.workedTimeAmount)}</b></div>
      <div class="kpi-line"><span>Vencimento</span><b>${date(payroll.paymentDue)}</b></div>
      <div class="actions section">${payroll.status === 'paid' ? ownerTag('Pago', 'won') : `<button class="btn small" onclick="driverPayrollPaid('${esc(payroll.id)}')">Marcar como pago</button>`}<button class="btn ghost small" data-page="fleet">Detalhes</button></div>`;
  }

  function renderPending(calls) {
    const target = document.getElementById('ownerPendingList');
    if (!target) return;
    const financeReview = calls.filter((call) => call.financeReviewRequired === true);
    const evidence = calls.filter((call) => Array.isArray(call.evidenceChecklist) && call.evidenceChecklist.some((item) => item?.done !== true));
    const overdue = (mgmt.finance || []).filter((entry) => entry.status === 'atrasado' && entry.type === 'receita');
    const openQuotes = calls.filter((call) => isQuote(call) && quoteOutcome(call) === 'open');
    const rows = [
      [financeReview.length, 'corrida(s) com valor para revisar', 'lost'],
      [evidence.length, 'corrida(s) com evidência pendente', 'open'],
      [overdue.length, 'recebimento(s) atrasado(s)', 'lost'],
      [openQuotes.length, 'cotação(ões) aguardando resposta', 'open']
    ].filter(([count]) => count > 0);
    target.innerHTML = rows.length ? rows.map(([count, text, tone]) => `<div class="owner-pending"><strong>${count}</strong><span>${text}</span>${ownerTag(tone === 'lost' ? 'Atenção' : 'Acompanhar', tone)}</div>`).join('') : '<div class="notice good">Sem pendências críticas agora.</div>';
  }

  function renderDashboard() {
    if (!document.getElementById('dashboard')) return;
    const m = metrics();
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('ownerQuotesTotal', m.quotes.length); set('ownerQuotesOpen', `${m.open.length} em aberto`); set('ownerQuotesWon', m.won.length); set('ownerQuotesLost', m.lost.length);
    set('ownerConversion', `${pct(m.conversion)} conversão`); set('ownerAccepted', m.accepted.length); set('ownerBilled', money(m.billed)); set('ownerProjected', money(m.projectedValue)); set('ownerReceivable', money(m.receivable)); set('ownerReceived', money(m.received));
    set('ownerDriverDue', money(m.payroll?.status === 'paid' ? 0 : m.payroll?.totalAmount || 0));
    set('ownerDriverDueLabel', m.payroll ? `${date(m.payroll.periodStart)} a ${date(m.payroll.periodEnd)}` : 'Sem fechamento ainda');
    const period = document.getElementById('ownerPeriod'); if (period) period.value = ownerState.period;
    renderQuoteList(m.quotes); renderAcceptedList(m.accepted); renderDriverCard(m.payroll); renderPending(m.calls); renderFunnelTables(m.quotes);
  }

  function ensureCallsOverview() {
    const page = document.getElementById('calls');
    if (!page || document.getElementById('ownerCallsOverview')) return;
    const head = page.querySelector(':scope > .head');
    head?.insertAdjacentHTML('afterend', `<div id="ownerCallsOverview" class="owner-calls-overview section"><div class="owner-mini-kpis"><div><span>Cotações abertas</span><b id="callsQuoteOpen">0</b></div><div><span>Ganhas</span><b id="callsQuoteWon">0</b></div><div><span>Perdidas</span><b id="callsQuoteLost">0</b></div><div><span>Conversão</span><b id="callsConversion">0%</b></div></div><div class="owner-filterbar section"><button class="btn secondary small" onclick="ownerEditCall(null,'quote')">+ Lançar cotação</button><span class="muted">As linhas abaixo podem vir do WhatsApp ou ser lançadas manualmente.</span></div><div id="ownerQuoteFullList" class="table-wrap section"></div></div>`);
    const h2 = head?.querySelector('h2'); const p = head?.querySelector('p');
    if (h2) h2.textContent = 'Cotações e corridas'; if (p) p.textContent = 'Tudo que entrou pelo WhatsApp e tudo que foi lançado manualmente.';
    const button = head?.querySelector('.btn'); if (button) { button.textContent = '+ Nova cotação / corrida'; button.setAttribute('onclick', "ownerEditCall(null,'quote')"); }
  }

  function renderCallsOverview() {
    ensureCallsOverview();
    const calls = (mgmt.calls || []).filter(inPeriod);
    const quotes = calls.filter(isQuote);
    const won = quotes.filter((call) => quoteOutcome(call) === 'won'); const lost = quotes.filter((call) => quoteOutcome(call) === 'lost'); const open = quotes.filter((call) => quoteOutcome(call) === 'open');
    const conv = won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : 0;
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('callsQuoteOpen', open.length); set('callsQuoteWon', won.length); set('callsQuoteLost', lost.length); set('callsConversion', pct(conv));
    const target = document.getElementById('ownerQuoteFullList'); if (!target) return;
    const items = sortRecent(quotes);
    target.innerHTML = items.length ? `<table class="table owner-table"><thead><tr><th>Seguradora</th><th>Rota / última mensagem</th><th>Resultado</th><th>Valor</th><th>Origem</th><th></th></tr></thead><tbody>${items.map((call) => `<tr><td><b>${esc(call.insurer || call.client || 'Seguradora')}</b><br><span class="muted">${esc(call.vehicle || call.plate || 'Veículo')}</span></td><td><span>${esc(call.origin || '—')} → ${esc(call.destination || '—')}</span>${call.lastOperationalText ? `<br><span class="owner-message-inline">“${esc(call.lastOperationalText).slice(0, 130)}”</span>` : ''}</td><td>${outcomeTag(call)}</td><td>${n(call.value) > 0 ? money(call.value) : '—'}</td><td>${ownerTag(sourceText(call), call.source === 'whatsapp' ? 'source' : '')}</td><td><button class="btn ghost small" onclick="ownerEditCall('${esc(call.id)}')">Editar</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhuma cotação encontrada.</div>';
  }

  function ensureFinanceOverview() {
    const page = document.getElementById('finance'); if (!page || document.getElementById('ownerFinanceOverview')) return;
    const metricsBox = page.querySelector(':scope > .metrics');
    metricsBox?.insertAdjacentHTML('beforebegin', `<div id="ownerFinanceOverview" class="owner-finance-overview section"><div class="owner-mini-kpis"><div><span>Faturado em corridas</span><b id="financeOwnerBilled">R$ 0</b></div><div><span>A receber</span><b id="financeOwnerReceivable">R$ 0</b></div><div><span>Recebido</span><b id="financeOwnerReceived">R$ 0</b></div><div><span>A pagar motorista</span><b id="financeOwnerDriver">R$ 0</b></div></div><div class="owner-filterbar section"><button class="btn" onclick="newItem('finance')">+ Lançamento manual</button><span class="muted">Corridas aceitas entram automaticamente; despesas e acertos também podem ser lançados à mão.</span></div></div>`);
    const head = page.querySelector(':scope > .head'); const p = head?.querySelector('p'); if (p) p.textContent = 'Quanto entrou, quanto falta receber e quanto a operação precisa pagar.';
  }

  function renderFinanceOverview() {
    ensureFinanceOverview(); const m = metrics(); const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set('financeOwnerBilled', money(m.billed)); set('financeOwnerReceivable', money(m.receivable)); set('financeOwnerReceived', money(m.received)); set('financeOwnerDriver', money(m.payroll?.status === 'paid' ? 0 : m.payroll?.totalAmount || 0));
  }

  function ensureFleetOverview() {
    const page = document.getElementById('fleet'); if (!page || document.getElementById('ownerFleetOverview')) return;
    const head = page.querySelector(':scope > .head');
    head?.insertAdjacentHTML('afterend', `<div id="ownerFleetOverview" class="card owner-driver-detail section"></div>`);
    const h2 = head?.querySelector('h2'); const p = head?.querySelector('p'); if (h2) h2.textContent = 'Motorista e frota'; if (p) p.textContent = 'Pagamento do motorista, corridas vinculadas e veículo.';
  }

  function renderFleetOverview() {
    ensureFleetOverview(); const box = document.getElementById('ownerFleetOverview'); if (!box) return; const payroll = currentPayroll(); const fleet = (mgmt.fleet || [])[0] || {};
    box.innerHTML = `<div class="head"><div><h3>${esc(driverName())}</h3><p>Fechamento do motorista calculado pelas corridas aceitas.</p></div><button class="btn secondary small" onclick="editItem('fleet','${esc(fleet.id || '')}')">Editar motorista/veículo</button></div>${payroll ? `<div class="owner-driver-grid section"><div><span>Período</span><b>${date(payroll.periodStart)} a ${date(payroll.periodEnd)}</b></div><div><span>Corridas</span><b>${payroll.callCount || 0}</b></div><div><span>KM faturados</span><b>${fmtKm(payroll.totalKm)}</b></div><div><span>Corridas</span><b>${money(payroll.routeAmount)}</b></div><div><span>Horas trabalhadas</span><b>${money(payroll.workedTimeAmount)}</b></div><div class="total"><span>Total a pagar</span><b>${money(payroll.totalAmount)}</b></div></div><div class="notice good section">Regra automática: R$ 40,00 por corrida até 50 km; acima disso, + R$ 0,70 por km excedente. Hora trabalhada vai integralmente para o motorista.</div><div class="actions section">${payroll.status === 'paid' ? ownerTag('Pagamento realizado', 'won') : `<button class="btn" onclick="driverPayrollPaid('${esc(payroll.id)}')">Marcar pagamento realizado</button>`}<button class="btn secondary" onclick="newItem('finance')">+ Ajuste/despesa manual</button></div>` : `<div class="empty section">Nenhuma corrida calculada para o motorista ainda.</div>`}`;
  }

  function renderFriendlyAutomations() {
    const target = document.getElementById('automationList'); if (!target) return;
    const labels = {
      'auto-confirm': ['Responder acionamentos automaticamente', 'Identifica pedidos que chegam pelo WhatsApp e conduz o atendimento conforme as regras.'],
      'auto-finance': ['Levar corridas aceitas para o financeiro', 'Quando uma corrida é aceita, ela entra no faturamento e no cálculo do motorista.'],
      'auto-overdue': ['Destacar recebimentos atrasados', 'Mostra automaticamente quais valores passaram do vencimento.']
    };
    target.innerHTML = (mgmt.automations || []).map((item) => { const copy = labels[item.id] || [item.name, 'Regra automática da operação.']; return `<div class="switch owner-switch"><div><b>${esc(copy[0])}</b><div class="muted">${esc(copy[1])}</div></div><input type="checkbox" ${item.enabled !== false ? 'checked' : ''} onchange="toggleAutomation('${esc(item.id)}',this.checked)"></div>`; }).join('');
    const page = document.getElementById('automations'); const h2 = page?.querySelector(':scope > .head h2'); const p = page?.querySelector(':scope > .head p'); if (h2) h2.textContent = 'Configurações da operação'; if (p) p.textContent = 'Escolha o que deve acontecer automaticamente. As opções técnicas ficam nas configurações avançadas.';
  }


  function funnelRows(quotes, dimension) {
    const map = new Map();
    for (const call of quotes) {
      const key = dimension === 'insurer' ? (call.insurerId || call.insurer || call.client || 'Seguradora') : (call.sourceGroupId || call.groupName || call.insurer || 'Grupo');
      const name = dimension === 'insurer' ? (call.insurerName || call.insurer || call.client || 'Seguradora') : (call.groupName || call.insurer || call.client || 'Grupo');
      if (!map.has(key)) map.set(key, { name, requested: 0, won: 0, lost: 0, open: 0 });
      const row = map.get(key); row.requested += 1; row[quoteOutcome(call)] += 1;
    }
    return [...map.values()].map((row) => ({ ...row, conversion: row.requested ? row.won / row.requested * 100 : 0 })).sort((a,b)=>b.requested-a.requested);
  }

  function funnelTable(rows) {
    return rows.length ? `<table class="table owner-table"><thead><tr><th>Nome</th><th>Solicitadas</th><th>Ganhas</th><th>Perdidas</th><th>Abertas</th><th>Conversão</th></tr></thead><tbody>${rows.map((row)=>`<tr><td><b>${esc(row.name)}</b></td><td>${row.requested}</td><td>${row.won}</td><td>${row.lost}</td><td>${row.open}</td><td>${pct(row.conversion)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Sem cotações no período.</div>';
  }

  function renderFunnelTables(quotes) {
    const insurer = document.getElementById('ownerInsurerFunnel'); if (insurer) insurer.innerHTML = funnelTable(funnelRows(quotes, 'insurer'));
    const group = document.getElementById('ownerGroupFunnel'); if (group) group.innerHTML = funnelTable(funnelRows(quotes, 'group'));
  }

  function ensureInsurerOverview() {
    const page = document.getElementById('clients'); if (!page) return;
    const head = page.querySelector(':scope > .head');
    const h2 = head?.querySelector('h2'), p = head?.querySelector('p'), button = head?.querySelector('.btn');
    if (h2) h2.textContent = 'Seguradoras e grupos';
    if (p) p.textContent = 'Conecte cada seguradora aos grupos do WhatsApp, calendário de fechamento e tabela comercial.';
    if (button) { button.textContent = '+ Nova seguradora'; button.setAttribute('onclick', 'ownerEditInsurer()'); }
    const oldTable = page.querySelector(':scope > .table-wrap'); if (oldTable) oldTable.style.display = 'none';
    if (!document.getElementById('ownerInsurers')) head?.insertAdjacentHTML('afterend', '<div id="ownerInsurers" class="table-wrap section"></div>');
  }

  function insurerStats(insurer) {
    const groups = new Set(insurer.groupIds || []);
    const quotes = (mgmt.calls || []).filter((call) => inPeriod(call) && isQuote(call) && (call.insurerId === insurer.id || groups.has(call.sourceGroupId)));
    const won = quotes.filter((call) => quoteOutcome(call) === 'won').length;
    const lost = quotes.filter((call) => quoteOutcome(call) === 'lost').length;
    return { requested: quotes.length, won, conversion: quotes.length ? won / quotes.length * 100 : 0 };
  }

  function renderInsurers() {
    ensureInsurerOverview(); const target = document.getElementById('ownerInsurers'); if (!target) return;
    const items = mgmt.insurers || [];
    target.innerHTML = items.length ? `<table class="table owner-table"><thead><tr><th>Seguradora</th><th>Grupos WhatsApp</th><th>Cotações</th><th>Conversão</th><th>Envio planilha</th><th>Pagamento</th><th></th></tr></thead><tbody>${items.map((item)=>{const st=insurerStats(item);const names=(item.groupNames||[]).length?(item.groupNames||[]): (item.groupIds||[]);return `<tr><td><b>${esc(item.name)}</b><br>${ownerTag(item.status==='inactive'?'Inativa':'Ativa',item.status==='inactive'?'lost':'won')}</td><td>${names.length?names.map((name)=>`<div class="small">${esc(name)}</div>`).join(''):'Nenhum grupo'}</td><td>${st.requested} solicitadas · ${st.won} ganhas</td><td>${pct(st.conversion)}</td><td>${item.statementDay?`Dia ${item.statementDay}`:item.submitWindowStartDay?`Dias ${item.submitWindowStartDay}–${item.submitWindowEndDay||item.submitWindowStartDay}`:'Configurar'}</td><td>${item.paymentDay?`Dia ${item.paymentDay}`:'Configurar'}</td><td><button class="btn ghost small" onclick="ownerEditInsurer('${esc(item.id)}')">Editar</button>${item.groupIds?.[0]?`<button class="btn secondary small" onclick="ownerOpenTable('${esc(item.groupIds[0])}')">Tabela</button>`:''}</td></tr>`}).join('')}</tbody></table>` : '<div class="empty">Nenhuma seguradora cadastrada. Os grupos conhecidos também são cadastrados automaticamente quando entra uma cotação.</div>';
  }

  window.ownerOpenTable = (groupId) => { showPage('groups'); setTimeout(() => { if (typeof configurarTabela === 'function') configurarTabela(groupId); }, 350); };

  window.ownerEditInsurer = (id = null) => {
    const item = (mgmt.insurers || []).find((x) => x.id === id) || {};
    const groups = (ownerState.groups || []).filter((g) => g.selected || (item.groupIds || []).includes(g.id));
    const groupHtml = groups.length ? groups.map((g) => `<label class="group"><input type="checkbox" name="insurerGroup" value="${esc(g.id)}" ${(item.groupIds||[]).includes(g.id)?"checked":""}><div><b>${esc(g.name||'Grupo')}</b><div class="small">${esc(g.id)}</div></div></label>`).join('') : '<div class="empty">Sincronize e autorize os grupos do WhatsApp primeiro.</div>';
    openModal(id ? 'Editar seguradora' : 'Nova seguradora', `<div class="form-grid"><div class="field"><label>Nome</label><input name="name" value="${esc(item.name||'')}" required></div><div class="field"><label>Status</label><select name="status"><option value="active">Ativa</option><option value="inactive" ${item.status==='inactive'?'selected':''}>Inativa</option></select></div><div class="field"><label>Modelo de pagamento</label><select name="paymentMode"><option value="manual">Manual</option><option value="monthly" ${item.paymentMode==='monthly'?'selected':''}>Mensal</option><option value="semimonthly" ${item.paymentMode==='semimonthly'?'selected':''}>Quinzenal</option><option value="per_call" ${item.paymentMode==='per_call'?'selected':''}>Por corrida</option></select></div><div class="field"><label>Dia de envio da planilha</label><input name="statementDay" type="number" min="1" max="31" value="${item.statementDay||''}"></div><div class="field"><label>Início janela de envio</label><input name="submitWindowStartDay" type="number" min="1" max="31" value="${item.submitWindowStartDay||''}"></div><div class="field"><label>Fim janela de envio</label><input name="submitWindowEndDay" type="number" min="1" max="31" value="${item.submitWindowEndDay||''}"></div><div class="field"><label>Prazo da NF</label><input name="invoiceDeadlineDay" type="number" min="1" max="31" value="${item.invoiceDeadlineDay||''}"></div><div class="field"><label>Dia de pagamento</label><input name="paymentDay" type="number" min="1" max="31" value="${item.paymentDay||''}"></div><div class="field"><label>Base usada no cálculo</label><input name="baseAddress" value="${esc(item.baseAddress||'')}"></div><div class="field"><label>Contato financeiro</label><input name="contactName" value="${esc(item.contactName||'')}"></div><div class="field"><label>E-mail financeiro</label><input name="contactEmail" type="email" value="${esc(item.contactEmail||'')}"></div></div><div class="section"><label><b>Grupos do WhatsApp ligados a esta seguradora</b></label><div class="groups section">${groupHtml}</div></div><div class="field section"><label>Observações</label><textarea name="notes">${esc(item.notes||'')}</textarea></div><div class="notice good section">A tabela de preço continua versionada por grupo. Use o botão “Tabela” depois de salvar para configurar/confirmar os valores que o robô pode usar.</div>`, async () => {
      const form = document.getElementById('modalForm'); const data = Object.fromEntries(new FormData(form).entries());
      const selectedGroups = [...form.querySelectorAll('input[name="insurerGroup"]:checked')].map((input) => input.value);
      const groupNames = selectedGroups.map((groupId) => (ownerState.groups || []).find((g) => g.id === groupId)?.name || groupId);
      for (const key of ['statementDay','submitWindowStartDay','submitWindowEndDay','invoiceDeadlineDay','paymentDay']) data[key] = data[key] ? Number(data[key]) : null;
      data.id = item.id || undefined; data.groupIds = selectedGroups; data.groupNames = groupNames;
      await api('/api/worker/management', { method: 'POST', body: JSON.stringify({ action: 'upsert_insurer', insurer: data }) });
      await refreshOwner();
    });
  };

  window.ownerCloseCall = (id) => {
    const call = (mgmt.calls || []).find((x) => x.id === id); if (!call) return;
    const testClosure = call?.testMode === true || /^tests?\s+guincho$/i.test(String(call.insurer || call.client || call.groupName || '').trim());
    openModal('Conferir e fechar corrida', `<div class="notice warn">Confira os dados antes de fechar. Depois deste botão o valor vira definitivo no Financeiro, entra no repasse do motorista e o resumo é enviado ao grupo do WhatsApp.</div><div class="form-grid section"><div class="field"><label>Protocolo</label><input value="${esc(call.protocol||'Aguardando')}" disabled></div><div class="field"><label>Motorista</label><input value="${esc(call.driverName||driverName())}" disabled></div><div class="field"><label>KM cobrados</label><input name="billableKm" type="number" step="0.1" value="${n(call.billableKm??call.totalKm??call.estimatedTotalKm)||''}"></div><div class="field"><label>Valor final</label><input name="value" type="number" step="0.01" value="${n(call.value||call.calculatedValue)||''}"></div><div class="field"><label>Horas trabalhadas</label><input name="workedTimeChargedHours" type="number" step="1" min="0" value="${n(call.workedTimeChargedHours)||0}"></div><div class="field"><label>Valor hora trabalhada</label><input name="workedTimeAmount" type="number" step="0.01" min="0" value="${n(call.workedTimeAmount)||0}"></div><div class="field"><label>KM estrada de terra</label><input name="dirtRoadBillableKm" type="number" step="0.1" min="0" value="${n(call.dirtRoadBillableKm)||0}"></div><div class="field"><label>Pedágio</label><input name="toll" type="number" step="0.01" min="0" value="${n(call.finalTollAmount)||0}"></div><div class="field"><label>Outros adicionais</label><input name="otherExtras" type="number" step="0.01" min="0" value="${n(call.finalOtherExtras)||0}"></div><div class="field"><label>Fechado por</label><input name="ownerName" value="Thiago"></div></div><div class="field section"><label>Observações do fechamento</label><textarea name="notes">${esc(call.ownerClosingNotes||'')}</textarea></div>`, async () => {
      const data = Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());
      for (const key of ['billableKm','value','workedTimeChargedHours','workedTimeAmount','dirtRoadBillableKm','toll','otherExtras']) data[key] = data[key] === '' ? null : Number(data[key]);
      const saveButton = document.getElementById('modalSave');
      if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Concluindo...'; }
      try {
        const d = await api('/api/worker/management', { method: 'POST', body: JSON.stringify({ action: 'close_call', callId: id, ownerName: data.ownerName || 'Thiago', final: data }) });
        const sent = d.data?.closeResult?.noticeSent;
        await refreshOwner();
        closeModal();
        alert(testClosure ? 'Corrida de teste concluída ✅ Os dados foram processados e ela saiu dos atendimentos em aberto.' : (sent ? 'Corrida concluída ✅ Resumo enviado ao grupo.' : 'Corrida concluída ✅ O fechamento foi salvo. O WhatsApp não confirmou o resumo; confira o grupo.'));
      } catch (error) {
        if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Concluir corrida'; }
        throw error;
      }
    });
  };

  window.ownerDownloadPeriodReport = () => {
    const now = new Date(); const start = periodStart();
    const fromDefault = start ? start.toISOString().slice(0,10) : ''; const toDefault = now.toISOString().slice(0,10);
    const insurers = (mgmt.insurers || []).map((item)=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    const groups = (ownerState.groups || []).filter((g)=>g.selected).map((g)=>`<option value="${esc(g.id)}">${esc(g.name||g.id)}</option>`).join('');
    openModal('Gerar planilha do período', `<div class="form-grid"><div class="field"><label>De</label><input name="from" type="date" value="${fromDefault}"></div><div class="field"><label>Até</label><input name="to" type="date" value="${toDefault}"></div><div class="field"><label>Seguradora</label><select name="insurerId"><option value="">Todas</option>${insurers}</select></div><div class="field"><label>Grupo</label><select name="groupId"><option value="">Todos</option>${groups}</select></div></div><div class="notice good section">A planilha XLSX sai com Resumo, Corridas, Cotações, Por seguradora, Por grupo, Financeiro e Motoristas.</div>`, async () => {
      const data = Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());
      const url = new URL('/api/worker/billing/export', location.origin); url.searchParams.set('companyId', activeCompanyId);
      for (const key of ['from','to','insurerId','groupId']) if (data[key]) url.searchParams.set(key, data[key]);
      const response = await fetch(url, { cache: 'no-store', headers: { 'x-botguincho-company-id': activeCompanyId, ...(tenantAccessToken ? { authorization: `Bearer ${tenantAccessToken}` } : {}) } });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bot-guincho-${data.from||'inicio'}-${data.to||'hoje'}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    });
  };

  function renderOwnerViews() {
    renderDashboard(); renderCallsOverview(); renderFinanceOverview(); renderFleetOverview(); renderFriendlyAutomations(); renderInsurers();
  }

  async function refreshBillingOnly() {
    try { ownerState.billing = await api('/api/worker/billing'); billingCache = ownerState.billing; } catch (error) { console.error('owner billing', error); }
  }

  async function refreshOwner() {
    try { const [, , groups] = await Promise.all([loadManagement(), refreshBillingOnly(), api('/api/worker/groups').catch(()=>({groups:[]}))]); ownerState.groups = groups?.groups || []; renderOwnerViews(); } catch (error) { console.error('owner dashboard', error); }
  }

  window.ownerEditCall = (id = null, preset = '') => {
    const item = (mgmt.calls || []).find((call) => call.id === id) || {};
    const inferred = item.quoteOutcome === 'lost' || (isQuote(item) && item.status === 'cancelado' && !item.authorizedAt) ? 'perdida' : item.status || (preset === 'quote' ? 'cotacao' : 'novo');
    const options = [
      ['cotacao', 'Cotação aberta'], ['aguardando_aprovacao', 'Aguardando aprovação'], ['autorizado', 'Cotação ganha / corrida aceita'], ['agendado', 'Agendada'], ['a_caminho', 'A caminho'], ['em_atendimento', 'Em atendimento'], ['concluido', 'Concluída'], ['perdida', 'Cotação perdida'], ['cancelado', 'Corrida cancelada']
    ].map(([value, label]) => `<option value="${value}" ${inferred === value ? 'selected' : ''}>${label}</option>`).join('');
    const occurred = item.createdAt ? new Date(item.createdAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    openModal(id ? 'Editar cotação / corrida' : 'Nova cotação / corrida', `<div class="form-grid">
      <div class="field"><label>Data</label><input name="occurredAt" type="date" value="${occurred}"></div>
      <div class="field"><label>Seguradora / grupo</label><input name="client" value="${esc(item.client || item.insurer || '')}" placeholder="Ex.: Solução Assistência"></div>
      <div class="field"><label>Veículo</label><input name="vehicle" value="${esc(item.vehicle || '')}" placeholder="Ex.: Onix"></div>
      <div class="field"><label>Placa</label><input name="plate" value="${esc(item.plate || '')}"></div>
      <div class="field"><label>Origem</label><input name="origin" value="${esc(item.origin || '')}"></div>
      <div class="field"><label>Destino</label><input name="destination" value="${esc(item.destination || '')}"></div>
      <div class="field"><label>Situação</label><select name="friendlyStatus">${options}</select></div>
      <div class="field"><label>Valor da corrida</label><input name="value" type="number" step="0.01" value="${n(item.value) || ''}"></div>
      <div class="field"><label>KM cobrados</label><input name="billableKm" type="number" step="0.1" value="${n(item.billableKm ?? item.totalKm) || ''}"></div>
      <div class="field"><label>Motorista</label><input name="driverName" value="${esc(item.driverName || driverName())}"></div>
      <div class="field"><label>Protocolo</label><input name="protocol" value="${esc(item.protocol || '')}"></div>
      <div class="field"><label>Motivo se perdeu</label><input name="lossReason" value="${esc(item.lossReason || '')}" placeholder="Ex.: fechou com outro prestador"></div>
    </div><div class="notice good section">Se veio do WhatsApp, os dados continuam vinculados ao histórico da conversa. Alterações manuais ficam salvas no mesmo chamado.</div>`, async () => {
      const form = document.getElementById('modalBody'); const data = Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());
      const friendly = data.friendlyStatus; delete data.friendlyStatus;
      const occurredAt = data.occurredAt; delete data.occurredAt;
      data.status = friendly === 'perdida' ? 'cancelado' : friendly;
      data.value = n(data.value); data.billableKm = n(data.billableKm); data.totalKm = data.billableKm;
      data.client = data.client || item.client || item.insurer || ''; data.insurer = data.client;
      data.source = item.source || 'manual'; data.manualQuote = item.manualQuote === true || preset === 'quote' || isQuote(item) || ['cotacao', 'aguardando_aprovacao', 'perdida'].includes(friendly);
      if (friendly === 'perdida') { data.quoteOutcome = 'lost'; data.cancellationChargeRequired = false; }
      else if (acceptedStatuses.has(data.status)) { data.quoteOutcome = data.manualQuote ? 'won' : (item.quoteOutcome || ''); if (!item.authorizedAt && data.status === 'autorizado') data.authorizedAt = new Date().toISOString(); }
      else if (data.manualQuote) data.quoteOutcome = 'open';
      if (occurredAt) data.createdAt = new Date(`${occurredAt}T12:00:00`).toISOString();
      if (id) data.id = id;
      await saveMgmt({ action: 'upsert', collection: 'calls', item: data }); await refreshBillingOnly(); renderOwnerViews();
    });
  };

  document.getElementById('dashboard').innerHTML = dashboardHtml();
  pageMeta.dashboard = ['Gestão da operação', 'Cotações, corridas, faturamento e motorista em uma única tela.'];
  pageMeta.calls = ['Cotações e corridas', 'Veja o que entrou pelo WhatsApp, o que foi ganho, perdido e executado.'];
  pageMeta.clients = ['Seguradoras e grupos', 'Cadastros, grupos do WhatsApp, tabelas e calendário financeiro.'];
  pageMeta.fleet = ['Motorista e frota', 'Pagamento do motorista e dados do guincho.'];
  pageMeta.automations = ['Configurações da operação', 'Regras automáticas em linguagem simples.'];
  setNavText('calls', 'Cotações e corridas'); setNavText('fleet', 'Motorista e frota'); setNavText('automations', 'Configurações');

  const originalRenderManagement = renderManagement;
  renderManagement = function ownerRenderManagement() { originalRenderManagement(); renderOwnerViews(); };

  document.addEventListener('change', (event) => {
    if (event.target?.id === 'ownerPeriod') { ownerState.period = event.target.value; renderOwnerViews(); }
  });
  document.addEventListener('click', (event) => {
    const pageButton = event.target.closest?.('[data-page]');
    if (pageButton && ['dashboard', 'calls', 'finance', 'fleet'].includes(pageButton.dataset.page)) setTimeout(() => { void refreshBillingOnly().then(renderOwnerViews); }, 30);
  });

  setTimeout(() => { void refreshOwner(); }, 0);
  setInterval(() => { if (!document.hidden) void refreshOwner(); }, 60000);
})();
