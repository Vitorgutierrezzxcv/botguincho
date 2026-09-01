(() => {
  'use strict';

  const OPEN_STATUSES = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento']);
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const fmtDate = (value) => { try { return value ? new Date(value).toLocaleString('pt-BR') : '—'; } catch { return '—'; } };
  const allCalls = () => [...(Array.isArray(mgmt?.calls) ? mgmt.calls : []), ...(Array.isArray(mgmt?.testCalls) ? mgmt.testCalls : [])];
  const findCall = (id) => allCalls().find((call) => call?.id === id) || null;
  const isOpenCall = (call) => OPEN_STATUSES.has(call?.status) || (Boolean(call?.authorizedAt) && !['concluido','cancelado'].includes(call?.status));
  const currentValue = (call) => num(call?.value || call?.calculatedValue || call?.quoteCalculatedValue);
  const currentKm = (call) => num(call?.billableKm ?? call?.totalKm ?? call?.estimatedTotalKm);
  const isTestCall = (call) => call?.testMode === true || String(call?.groupName || '').toLowerCase().includes('tests guincho');

  function ensureStyles() {
    if (document.getElementById('operationCommandStyles')) return;
    const style = document.createElement('style');
    style.id = 'operationCommandStyles';
    style.textContent = `
      #operations > .grid2{display:none!important}
      .op-center{display:grid;gap:16px}
      .op-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .op-summary-card{background:#fff;border:1px solid #dbeafe;border-radius:18px;padding:16px;box-shadow:0 10px 28px rgba(15,23,42,.05)}
      .op-summary-card span{display:block;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}.op-summary-card b{display:block;color:#0f172a;font-size:26px;margin-top:5px}
      .op-list{display:grid;gap:12px}.op-card{background:#fff;border:1px solid #dbeafe;border-radius:18px;padding:16px;box-shadow:0 10px 30px rgba(15,23,42,.05);cursor:pointer;transition:.15s ease}.op-card:hover{transform:translateY(-1px);border-color:#60a5fa}.op-card.awaiting{border-color:#f59e0b;background:#fffbeb}
      .op-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.op-title{font-size:17px;font-weight:850;color:#0f172a}.op-sub{color:#64748b;font-size:13px;margin-top:4px}.op-route{margin-top:12px;padding:11px 12px;border-radius:12px;background:#f8fafc;color:#334155;font-size:13px;line-height:1.45}.op-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}.op-meta div{background:#f8fafc;border-radius:12px;padding:10px}.op-meta span{display:block;color:#64748b;font-size:11px}.op-meta b{display:block;color:#0f172a;margin-top:3px;font-size:14px}.op-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.op-actions .btn{min-height:40px}.op-badge{display:inline-flex;padding:6px 9px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:800}.op-badge.test{background:#ede9fe;color:#6d28d9}.op-badge.close{background:#fef3c7;color:#92400e}
      .op-empty{padding:28px;text-align:center;background:#fff;border:1px dashed #bfdbfe;border-radius:18px;color:#64748b}.op-empty b{display:block;color:#0f172a;font-size:17px;margin-bottom:5px}
      .op-form-note{background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;padding:12px;color:#1e3a8a;font-size:13px}.op-close-note{background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:12px;color:#92400e;font-size:13px}
      @media(max-width:760px){.op-summary{grid-template-columns:1fr 1fr}.op-summary-card:last-child{grid-column:1/-1}.op-meta{grid-template-columns:1fr 1fr}.op-card-head{display:block}.op-card-head .op-badge{margin-top:8px}.op-actions{display:grid;grid-template-columns:1fr 1fr}.op-actions .btn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function statusBadge(call) {
    const labels = { autorizado:'Aceita', a_caminho:'A caminho', em_atendimento:'Em atendimento', aguardando_fechamento:'Aguardando fechamento' };
    const label = labels[call?.status] || 'Em andamento';
    const cls = call?.status === 'aguardando_fechamento' ? ' close' : '';
    return `<span class="op-badge${cls}">${esc(label)}</span>`;
  }

  function cardHtml(call) {
    const test = isTestCall(call);
    return `<div class="op-card ${call.status === 'aguardando_fechamento' ? 'awaiting' : ''}" onclick="operationEditCall('${esc(call.id)}')">
      <div class="op-card-head"><div><div class="op-title">${esc(call.vehicle || call.plate || 'Veículo não informado')}</div><div class="op-sub">${esc(call.insurerName || call.insurer || call.client || call.groupName || 'Seguradora')} · ${fmtDate(call.authorizedAt || call.createdAt)}</div></div><div>${test ? '<span class="op-badge test">TESTE</span> ' : ''}${statusBadge(call)}</div></div>
      <div class="op-route"><b>Origem:</b> ${esc(call.origin || 'Não informada')}<br><b>Destino:</b> ${esc(call.destination || 'Não informado')}</div>
      <div class="op-meta"><div><span>Protocolo</span><b>${esc(call.protocol || 'Aguardando')}</b></div><div><span>KM atual</span><b>${currentKm(call).toLocaleString('pt-BR',{maximumFractionDigits:1})} km</b></div><div><span>Valor atual</span><b>${money(currentValue(call))}</b></div><div><span>Motorista</span><b>${esc(call.driverName || 'Mauro')}</b></div></div>
      <div class="op-actions"><button class="btn secondary" type="button" onclick="event.stopPropagation();operationEditCall('${esc(call.id)}')">Editar comanda</button><button class="btn" type="button" onclick="event.stopPropagation();operationCloseCall('${esc(call.id)}')">Concluir corrida</button><button class="btn ghost" type="button" onclick="event.stopPropagation();operationDeleteCall('${esc(call.id)}')">Excluir</button></div>
    </div>`;
  }

  function renderOperationCenter() {
    ensureStyles();
    const page = document.getElementById('operations');
    if (!page) return;
    const head = page.querySelector(':scope > .head');
    const h2 = head?.querySelector('h2'); const p = head?.querySelector('p'); const topButton = head?.querySelector('.btn');
    if (h2) h2.textContent = 'Corridas em andamento';
    if (p) p.textContent = 'Abra uma corrida aceita, corrija os dados, lance adicionais e conclua quando terminar.';
    if (topButton) { topButton.textContent = '+ Corrida manual'; topButton.setAttribute('onclick', "ownerEditCall(null,'quote')"); }

    let root = document.getElementById('operationCommandCenter');
    if (!root) { root = document.createElement('div'); root.id = 'operationCommandCenter'; root.className = 'op-center section'; head?.insertAdjacentElement('afterend', root); }
    const calls = allCalls().filter(isOpenCall).sort((a,b) => new Date(b.authorizedAt || b.updatedAt || 0) - new Date(a.authorizedAt || a.updatedAt || 0));
    const awaiting = calls.filter((call) => call.status === 'aguardando_fechamento').length;
    const projected = calls.reduce((sum, call) => sum + currentValue(call), 0);
    root.innerHTML = `<div class="op-summary"><div class="op-summary-card"><span>Em andamento</span><b>${calls.length}</b></div><div class="op-summary-card"><span>Aguardando fechamento</span><b>${awaiting}</b></div><div class="op-summary-card"><span>Valor previsto</span><b>${money(projected)}</b></div></div><div class="op-list">${calls.length ? calls.map(cardHtml).join('') : '<div class="op-empty"><b>Nenhuma corrida em andamento</b>Quando uma cotação for aceita com “pode seguir”, ela aparecerá aqui automaticamente.</div>'}</div>`;
  }

  function commandForm(call, closing = false) {
    const hours = num(call.workedTimeChargedHours);
    return `${closing ? '<div class="op-close-note"><b>Conferência final.</b> Ao concluir, o valor passa a ser definitivo no Financeiro e no pagamento do motorista. O resumo também é enviado ao grupo do WhatsApp.</div>' : '<div class="op-form-note"><b>Comanda aberta.</b> Você pode corrigir os dados e salvar sem concluir. Nada vira definitivo até clicar em “Concluir corrida”.</div>'}
      <div class="form-grid section">
        <div class="field"><label>Veículo</label><input name="vehicle" value="${esc(call.vehicle || '')}"></div>
        <div class="field"><label>Placa</label><input name="plate" value="${esc(call.plate || '')}"></div>
        <div class="field"><label>Protocolo</label><input name="protocol" value="${esc(call.protocol || '')}"></div>
        <div class="field"><label>Motorista</label><input name="driverName" value="${esc(call.driverName || 'Mauro')}"></div>
        <div class="field"><label>Origem</label><input name="origin" value="${esc(call.origin || '')}"></div>
        <div class="field"><label>Destino</label><input name="destination" value="${esc(call.destination || '')}"></div>
        <div class="field"><label>KM cobrados</label><input name="billableKm" type="number" step="0.1" min="0" value="${currentKm(call) || ''}"></div>
        <div class="field"><label>Valor da corrida</label><input name="value" type="number" step="0.01" min="0" value="${currentValue(call) || ''}"></div>
        <div class="field"><label>Horas trabalhadas cobradas</label><input name="workedTimeChargedHours" type="number" step="1" min="0" value="${hours}"><small>R$ 80,00 por hora iniciada após os 15 min de tolerância.</small></div>
        <div class="field"><label>KM de estrada de terra</label><input name="dirtRoadBillableKm" type="number" step="0.1" min="0" value="${num(call.dirtRoadBillableKm)}"><small>Regra atual: R$ 3,80/km de terra.</small></div>
        <div class="field"><label>Pedágio adicional</label><input name="toll" type="number" step="0.01" min="0" value="${num(call.finalTollAmount)}"></div>
        <div class="field"><label>Outros adicionais</label><input name="otherExtras" type="number" step="0.01" min="0" value="${num(call.finalOtherExtras)}" placeholder="Ex.: 30,00"></div>
      </div>
      <div class="field section"><label>Observações / correções</label><textarea name="notes" placeholder="Ex.: 4 km adicionais, cliente demorou, acesso difícil...">${esc(call.ownerClosingNotes || '')}</textarea></div>`;
  }

  function readCommandForm(call) {
    const data = Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());
    const hours = Math.max(0, num(data.workedTimeChargedHours));
    const km = Math.max(0, num(data.billableKm));
    return {
      data,
      item: {
        id: call.id,
        testMode: call.testMode === true,
        vehicle: data.vehicle || call.vehicle || '', plate: data.plate || call.plate || '', protocol: data.protocol || call.protocol || '', driverName: data.driverName || call.driverName || 'Mauro',
        origin: data.origin || call.origin || '', destination: data.destination || call.destination || '',
        billableKm: km, totalKm: km,
        value: Math.max(0, num(data.value)),
        workedTimeChargedHours: hours, workedTimeAmount: hours * 80, workedTimeChargeRequired: hours > 0,
        dirtRoadBillableKm: Math.max(0, num(data.dirtRoadBillableKm)),
        finalTollAmount: Math.max(0, num(data.toll)), finalOtherExtras: Math.max(0, num(data.otherExtras)),
        ownerClosingNotes: String(data.notes || '').trim()
      }
    };
  }

  window.operationEditCall = (id) => {
    const call = findCall(id); if (!call) return alert('Corrida não encontrada. Atualize a tela e tente novamente.');
    openModal('Editar corrida em andamento', commandForm(call, false), async () => {
      const { item } = readCommandForm(call);
      await api('/api/worker/management', { method:'POST', body: JSON.stringify({ action:'upsert', collection:'calls', item }) });
      await loadManagement(); renderManagement();
      alert('Alterações salvas. A corrida continua em andamento.');
    });
    const save = document.getElementById('modalSave'); if (save) save.textContent = 'Salvar alterações';
  };

  window.operationDeleteCall = async (id) => {
    const call = findCall(id); if (!call) return alert('Corrida não encontrada. Atualize a tela e tente novamente.');
    const test = isTestCall(call);
    const confirmed = confirm(test
      ? 'Excluir esta corrida de TESTE? Ela será removida definitivamente, junto com o financeiro de teste vinculado.'
      : 'Excluir esta corrida? Ela sairá do painel e dos totais, mas continuará preservada internamente para auditoria.');
    if (!confirmed) return;
    await api('/api/worker/management', { method:'POST', body: JSON.stringify({ action:'delete_call', callId:id, ownerName:'Thiago' }) });
    await loadManagement();
    if (typeof refreshBillingOnly === 'function') await refreshBillingOnly();
    renderManagement();
    alert(test ? 'Corrida de teste excluída.' : 'Corrida removida do painel. O histórico interno foi preservado.');
  };

  window.operationCloseCall = (id) => {
    const call = findCall(id); if (!call) return alert('Corrida não encontrada. Atualize a tela e tente novamente.');
    openModal('Conferir e concluir corrida', commandForm(call, true), async () => {
      const { data, item } = readCommandForm(call);
      const saveButton = document.getElementById('modalSave');
      if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Concluindo...'; }
      try {
        const response = await api('/api/worker/management', { method:'POST', body: JSON.stringify({
        action:'close_call', callId:id, ownerName:'Thiago', final:{
          billableKm:item.billableKm, value:item.value,
          workedTimeChargedHours:item.workedTimeChargedHours, workedTimeAmount:item.workedTimeAmount,
          dirtRoadBillableKm:item.dirtRoadBillableKm, toll:item.finalTollAmount, otherExtras:item.finalOtherExtras,
          notes:item.ownerClosingNotes, vehicle:item.vehicle, plate:item.plate, protocol:item.protocol, origin:item.origin, destination:item.destination, driverName:item.driverName
        }
      }) });
      await loadManagement();
      if (typeof refreshBillingOnly === 'function') await refreshBillingOnly();
      renderManagement();
        const sent = response?.data?.closeResult?.noticeSent;
        closeModal();
        alert(isTestCall(call)
          ? (sent ? 'Corrida de teste concluída ✅ Financeiro de teste atualizado e resumo enviado ao grupo.' : 'Corrida de teste concluída, mas o WhatsApp não confirmou o envio do resumo. Confira o grupo.')
          : (sent ? 'Corrida concluída ✅ Financeiro atualizado e resumo enviado ao grupo.' : 'Corrida concluída e financeiro atualizado. O WhatsApp não confirmou o resumo; confira o grupo.'));
      } catch (error) {
        if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Concluir corrida'; }
        throw error;
      }
    });
    const save = document.getElementById('modalSave'); if (save) save.textContent = 'Concluir corrida';
  };

  const previousRenderManagement = renderManagement;
  renderManagement = function operationCommandRender(){ previousRenderManagement(); renderOperationCenter(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderOperationCenter); else renderOperationCenter();
})();
