(() => {
  'use strict';

  const ACCEPTED = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido']);
  const STATUS = {
    novo:'Novo', cotacao:'Cotação aberta', aguardando_dados:'Aguardando dados', aguardando_aprovacao:'Aguardando aprovação',
    autorizado:'Corrida aceita', agendado:'Agendada', a_caminho:'A caminho', em_atendimento:'Em atendimento',
    aguardando_fechamento:'Aguardando fechamento', concluido:'Concluída', cancelado:'Cancelada'
  };

  const html = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const brl = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const fmtDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
  };
  const calls = () => Array.isArray(mgmt?.calls) ? mgmt.calls : [];
  const findCall = (id) => calls().find((call) => String(call?.id) === String(id)) || null;
  const isAccepted = (call) => ACCEPTED.has(call?.status) || Boolean(call?.authorizedAt) || (call?.status === 'cancelado' && call?.cancellationChargeRequired === true);
  const isFinalized = (call) => Boolean(call?.ownerClosedAt) || (call?.status === 'concluido' && call?.ownerCloseRequired !== true);
  const outcome = (call) => {
    if (call?.quoteOutcome === 'lost' || (call?.status === 'cancelado' && !call?.authorizedAt && call?.cancellationChargeRequired !== true)) return 'lost';
    if (call?.quoteOutcome === 'won' || isAccepted(call)) return 'won';
    return 'open';
  };
  const outcomeLabel = (call) => outcome(call) === 'won' ? 'Ganha' : outcome(call) === 'lost' ? 'Perdida' : 'Em aberto';
  const outcomeTone = (call) => outcome(call) === 'won' ? 'won' : outcome(call) === 'lost' ? 'lost' : 'open';

  function ensureQuoteActionStyles() {
    if (document.getElementById('quoteActionsV1Styles')) return;
    const style = document.createElement('style');
    style.id = 'quoteActionsV1Styles';
    style.textContent = `
      #ownerQuoteFullList .owner-table tbody tr.owner-quote-clickable{cursor:pointer;position:relative}
      #ownerQuoteFullList .owner-table tbody tr.owner-quote-clickable:focus-visible{outline:3px solid rgba(20,100,232,.22);outline-offset:2px}
      #ownerQuoteFullList .owner-table tbody tr.owner-quote-clickable:hover{border-color:#b8cce7!important;box-shadow:0 10px 28px rgba(31,57,95,.09)!important}
      .quote-detail-hero{padding:16px;border:1px solid #dce6f2;border-radius:16px;background:linear-gradient(135deg,#f7fbff,#fff)}
      .quote-detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
      .quote-detail-head h3{margin:0;color:#10213b;font-size:20px;line-height:1.25}.quote-detail-head p{margin:5px 0 0;color:#718096;font-size:13px}
      .quote-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
      .quote-detail-field{min-width:0;padding:11px 12px;border:1px solid #e4eaf2;border-radius:12px;background:#fff}
      .quote-detail-field span{display:block;color:#8390a3;font-size:10px;font-weight:800;letter-spacing:.055em;text-transform:uppercase;margin-bottom:4px}
      .quote-detail-field b{display:block;color:#1b2d47;font-size:13px;line-height:1.35;overflow-wrap:anywhere}
      .quote-detail-route{margin-top:12px;padding:13px 14px;border-radius:13px;background:#f6f9fd;border:1px solid #e5ebf3;color:#31445f;font-size:13px;line-height:1.5}
      .quote-detail-message{margin-top:12px;padding:13px 14px;border-left:3px solid #a9c9f5;border-radius:10px;background:#f8fbff;color:#63758d;font-size:12px;line-height:1.5;overflow-wrap:anywhere}
      .quote-detail-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:16px}
      .quote-detail-actions .btn{width:100%;min-height:44px}.quote-action-win{background:#159c62!important}.quote-action-lost{background:#fff1f2!important;color:#bf3540!important;border:1px solid #efc8cc!important;box-shadow:none!important}.quote-action-close{background:#1464e8!important}
      .quote-detail-note{margin-top:12px;color:#7d899a;font-size:11px;line-height:1.45}
      @media(max-width:760px){.quote-detail-head{display:block}.quote-detail-head .owner-tag{margin-top:9px}.quote-detail-grid{grid-template-columns:1fr 1fr}.quote-detail-actions{grid-template-columns:1fr}.quote-detail-actions .btn{min-height:46px}.quote-detail-route,.quote-detail-message{font-size:12px}}
      @media(max-width:420px){.quote-detail-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function modalActions(call) {
    const state = outcome(call);
    const final = isFinalized(call);
    const buttons = [];
    if (state === 'open') {
      buttons.push(`<button type="button" class="btn quote-action-win" onclick="closeModal();ownerConvertQuote('${html(call.id)}')">✓ Marcar como ganha</button>`);
      buttons.push(`<button type="button" class="btn quote-action-lost" onclick="ownerMarkQuoteLost('${html(call.id)}')">✕ Marcar como perdida</button>`);
    }
    if (state === 'won' && !final) {
      buttons.push(`<button type="button" class="btn quote-action-close" onclick="closeModal();ownerCloseCall('${html(call.id)}')">Fechar corrida</button>`);
    }
    if (state === 'lost') {
      buttons.push(`<button type="button" class="btn secondary" onclick="ownerReopenQuote('${html(call.id)}')">Reabrir cotação</button>`);
    }
    buttons.push(`<button type="button" class="btn secondary" onclick="closeModal();ownerEditCall('${html(call.id)}')">Editar dados</button>`);
    return buttons.join('');
  }

  window.ownerOpenQuoteActions = (id) => {
    const call = findCall(id);
    if (!call) return alert('Cotação/corrida não encontrada. Atualize a página e tente novamente.');
    ensureQuoteActionStyles();
    const value = Number(call.value || call.calculatedValue || call.quoteCalculatedValue || 0);
    const km = Number(call.billableKm ?? call.totalKm ?? call.estimatedTotalKm ?? 0);
    const final = isFinalized(call);
    const body = `
      <div class="quote-detail-hero">
        <div class="quote-detail-head">
          <div><h3>${html(call.insurerName || call.insurer || call.client || 'Seguradora')}</h3><p>${html(call.vehicle || 'Veículo não informado')}${call.plate ? ` · placa ${html(call.plate)}` : ''}</p></div>
          <span class="owner-tag ${outcomeTone(call)}">${outcomeLabel(call)}</span>
        </div>
        <div class="quote-detail-grid">
          <div class="quote-detail-field"><span>Situação</span><b>${html(STATUS[call.status] || String(call.status || 'Novo').replaceAll('_',' '))}${final ? ' · fechada' : ''}</b></div>
          <div class="quote-detail-field"><span>Valor</span><b>${value > 0 ? brl(value) : 'Ainda não informado'}</b></div>
          <div class="quote-detail-field"><span>KM</span><b>${km > 0 ? `${km.toLocaleString('pt-BR',{maximumFractionDigits:1})} km` : 'Ainda não informado'}</b></div>
          <div class="quote-detail-field"><span>Protocolo</span><b>${html(call.protocol || 'Não informado')}</b></div>
          <div class="quote-detail-field"><span>Origem do registro</span><b>${call.source === 'whatsapp' ? 'WhatsApp' : 'Manual'}</b></div>
          <div class="quote-detail-field"><span>Data</span><b>${html(fmtDate(call.authorizedAt || call.createdAt || call.updatedAt))}</b></div>
        </div>
        <div class="quote-detail-route"><b>Origem:</b> ${html(call.origin || 'Não informada')}<br><b>Destino:</b> ${html(call.destination || 'Não informado')}</div>
        ${call.lastOperationalText ? `<div class="quote-detail-message"><b>Última mensagem</b><br>${html(call.lastOperationalText)}</div>` : ''}
        ${call.lossReason ? `<div class="quote-detail-message"><b>Motivo da perda</b><br>${html(call.lossReason)}</div>` : ''}
        <div class="quote-detail-actions">${modalActions(call)}</div>
        <div class="quote-detail-note">Ao marcar como ganha, a cotação vira corrida aceita e entra na Operação. Ao fechar a corrida, o fechamento definitivo continua usando a conferência de KM, valor, hora trabalhada, estrada de terra, pedágio e adicionais.</div>
      </div>`;
    openModal('Detalhes da cotação / corrida', body, async () => {});
    const save = document.getElementById('modalSave');
    if (save) save.style.display = 'none';
  };

  window.ownerMarkQuoteLost = (id) => {
    const call = findCall(id);
    if (!call) return alert('Cotação não encontrada.');
    openModal('Marcar cotação como perdida', `
      <div class="notice warn">Esta cotação será contabilizada como perdida e não entrará como corrida aceita.</div>
      <div class="field section"><label>Motivo da perda</label><textarea name="lossReason" placeholder="Ex.: seguradora fechou com outro prestador, preço, sem retorno...">${html(call.lossReason || '')}</textarea></div>`, async () => {
      const data = Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());
      await api('/api/worker/management', { method:'POST', body:JSON.stringify({
        action:'upsert', collection:'calls', item:{
          id:call.id, status:'cancelado', quoteOutcome:'lost', cancellationChargeRequired:false,
          manualQuote:call.manualQuote === true || true, quoteTracked:true, lossReason:String(data.lossReason || '').trim()
        }
      }) });
      if (typeof window.refreshOwner === 'function') await window.refreshOwner();
    });
    const save = document.getElementById('modalSave');
    if (save) { save.textContent = 'Marcar como perdida'; save.classList.add('danger'); }
  };

  window.ownerReopenQuote = async (id) => {
    const call = findCall(id);
    if (!call) return alert('Cotação não encontrada.');
    if (!confirm('Reabrir esta cotação? Ela voltará para “Em aberto”.')) return;
    await api('/api/worker/management', { method:'POST', body:JSON.stringify({
      action:'upsert', collection:'calls', item:{ id:call.id, status:'cotacao', quoteOutcome:'open', cancellationChargeRequired:false, lossReason:'' }
    }) });
    if (typeof window.refreshOwner === 'function') await window.refreshOwner();
    closeModal();
  };

  function extractCallId(row) {
    const button = row.querySelector('button[onclick*="ownerEditCall"]');
    const action = button?.getAttribute('onclick') || '';
    const match = action.match(/ownerEditCall\('([^']+)'\)/);
    return match?.[1] || '';
  }

  function enhanceRow(row) {
    if (!row || row.dataset.quoteActionsReady === '1') return;
    const id = extractCallId(row);
    if (!id) return;
    row.dataset.quoteActionsReady = '1';
    row.dataset.callId = id;
    row.classList.add('owner-quote-clickable');
    row.setAttribute('role','button');
    row.setAttribute('tabindex','0');
    row.setAttribute('aria-label','Abrir detalhes da cotação ou corrida');
    const button = row.querySelector('button[onclick*="ownerEditCall"]');
    if (button) {
      button.textContent = 'Abrir';
      button.setAttribute('onclick', `event.stopPropagation();ownerOpenQuoteActions('${id}')`);
    }
    row.addEventListener('click', (event) => {
      if (event.target.closest('button,a,input,select,textarea,label')) return;
      window.ownerOpenQuoteActions(id);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.ownerOpenQuoteActions(id); }
    });
  }

  function enhanceQuoteRows() {
    ensureQuoteActionStyles();
    document.querySelectorAll('#ownerQuoteFullList .owner-table tbody tr').forEach(enhanceRow);
  }

  const observer = new MutationObserver(() => requestAnimationFrame(enhanceQuoteRows));
  const start = () => {
    ensureQuoteActionStyles();
    observer.observe(document.documentElement, { childList:true, subtree:true });
    enhanceQuoteRows();
    setTimeout(enhanceQuoteRows, 300);
    setTimeout(enhanceQuoteRows, 1200);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
})();
