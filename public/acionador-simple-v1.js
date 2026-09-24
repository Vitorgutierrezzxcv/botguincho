(function acionadorSimpleOverlay() {
  'use strict';

  const hiddenPages = new Set(['whatsapp','groups','tracker','ai','automations','tests']);
  const labels = {
    dashboard:['Início','Resumo simples da operação e do dinheiro.'],
    operations:['Corridas','Acompanhe as corridas que ainda precisam de ação.'],
    calls:['Histórico','Consulte todas as corridas registradas.'],
    finance:['Financeiro','Veja o que entrou, o que falta receber e o resultado.'],
    fleet:['Motorista','Confira o valor do repasse e marque quando pagar.'],
    clients:['Clientes','Cadastre clientes, seguradoras e parceiros.'],
    pricing:['Valores','Consulte os valores de referência de cada cliente.'],
    help:['Ajuda','Um guia simples para usar o Acionador.IA.'],
    more:['Mais','Histórico, clientes, valores e ajuda.']
  };
  const num = (v) => Number(v || 0) || 0;
  const safe = (v) => String(v ?? '').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cash = (v) => Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

  function go(page){
    const button=document.querySelector(`.sidebar [data-page="${page}"]`)||document.querySelector(`[data-page="${page}"]`);
    if(button) button.click(); else if(typeof showPage==='function') showPage(page);
  }
  window.simpleGo=go;

  function setCopy(){
    for(const [page,copy] of Object.entries(labels)){
      try{ if(typeof pageMeta!=='undefined'&&pageMeta[page]) pageMeta[page]=copy; }catch{}
    }
    const active=document.querySelector('.page.active')?.id;
    if(active&&labels[active]){
      const t=document.getElementById('title'),s=document.getElementById('subtitle');
      if(t)t.textContent=labels[active][0]; if(s)s.textContent=labels[active][1];
    }
    const names={dashboard:'Início',operations:'Corridas',calls:'Histórico',clients:'Clientes',pricing:'Valores',finance:'Financeiro',fleet:'Motorista',help:'Ajuda'};
    for(const [page,text] of Object.entries(names)){
      document.querySelectorAll(`.sidebar [data-page="${page}"]`).forEach((b)=>{
        const icon=b.querySelector('.ico')?.outerHTML||''; b.innerHTML=`${icon}${text}`;
      });
    }
  }

  function simplifyMenus(){
    document.body.classList.add('ax-simple-mode');
    document.querySelectorAll('[data-page]').forEach((el)=>{if(hiddenPages.has(el.dataset.page))el.classList.add('ax-hidden-tech')});
    const current=localStorage.getItem('bg-page');
    if(hiddenPages.has(current)){localStorage.setItem('bg-page','dashboard');setTimeout(()=>go('dashboard'),0)}
    const drawerNames={dashboard:'Início',operations:'Corridas',calls:'Histórico',finance:'Financeiro',clients:'Clientes',fleet:'Motorista',pricing:'Valores',help:'Ajuda'};
    document.querySelectorAll('.ax-menu-item').forEach((b)=>{
      const p=b.dataset.axPage;if(hiddenPages.has(p))b.classList.add('ax-hidden-tech');
      const span=b.querySelector('span:last-child');if(span&&drawerNames[p])span.textContent=drawerNames[p];
    });
    const mobile=document.querySelector('.mobile-tabs');
    if(mobile&&mobile.dataset.simpleBuilt!=='1'){
      mobile.dataset.simpleBuilt='1';
      mobile.innerHTML=[['dashboard','⌂','Início'],['operations','◉','Corridas'],['finance','$','Financeiro'],['fleet','▰','Motorista'],['more','•••','Mais']]
        .map(([p,i,t])=>`<button data-simple-page="${p}"><span class="mico">${i}</span>${t}</button>`).join('');
      mobile.querySelectorAll('[data-simple-page]').forEach((b)=>b.addEventListener('click',()=>go(b.dataset.simplePage)));
    }
    if(!document.getElementById('simpleNewRunSide')){
      const nav=document.querySelector('.sidebar .nav-group');
      if(nav){const b=document.createElement('button');b.id='simpleNewRunSide';b.className='simple-new-run-side';b.innerHTML='<span>＋</span> Nova corrida';b.onclick=()=>window.simpleNewRun?.();nav.insertAdjacentElement('beforebegin',b)}
    }
    if(!document.getElementById('simpleNewRunFab')){
      const b=document.createElement('button');b.id='simpleNewRunFab';b.className='simple-new-run-fab';b.innerHTML='<span>＋</span> Corrida';b.onclick=()=>window.simpleNewRun?.();document.body.appendChild(b);
    }
  }

  function rebuildMore(){
    const page=document.getElementById('more');if(!page||page.dataset.simpleBuilt==='1')return;
    page.dataset.simpleBuilt='1';
    page.innerHTML=`<div class="head"><div><h2>Mais</h2><p>O que você usa de vez em quando.</p></div></div>
    <div class="simple-mode-card"><div class="simple-mode-icon">✓</div><div><b>Gestão manual</b><p>O robô está desativado. O Acionador.IA agora serve para registrar corridas e controlar o dinheiro.</p></div></div>
    <div class="simple-more-grid section">
      <button data-simple-go="calls"><span>▣</span><b>Histórico</b><small>Ver todas as corridas</small></button>
      <button data-simple-go="clients"><span>◌</span><b>Clientes</b><small>Seguradoras e parceiros</small></button>
      <button data-simple-go="pricing"><span>≡</span><b>Valores</b><small>Tabelas de referência</small></button>
      <button data-simple-go="help"><span>?</span><b>Ajuda</b><small>Como usar o sistema</small></button>
    </div><div class="simple-tip section"><b>Regra simples:</b> registre a corrida → conclua quando terminar → confira Financeiro e Motorista.</div>`;
    page.querySelectorAll('[data-simple-go]').forEach((b)=>b.addEventListener('click',()=>go(b.dataset.simpleGo)));
  }

  function rebuildHelp(){
    const page=document.getElementById('help');if(!page||page.dataset.simpleBuilt==='1')return;
    page.dataset.simpleBuilt='1';
    page.innerHTML=`<div class="head"><div><h2>Ajuda</h2><p>Você só precisa lembrar de três passos.</p></div></div>
    <div class="simple-help-steps">
      <button onclick="simpleNewRun()"><span>1</span><div><b>Registre a corrida</b><p>Toque em “Nova corrida” e preencha somente o básico.</p></div></button>
      <button onclick="simpleGo('operations')"><span>2</span><div><b>Quando terminar, conclua</b><p>Confira KM e valor final. O sistema calcula o repasse do motorista.</p></div></button>
      <button onclick="simpleGo('finance')"><span>3</span><div><b>Controle o pagamento</b><p>Marque o que recebeu, registre gastos e acompanhe o lucro.</p></div></button>
    </div>
    <div class="simple-help-grid section">
      <div class="card"><h3>Onde vejo o lucro?</h3><p>Na tela <b>Início</b> e em <b>Financeiro</b>. O cálculo considera faturamento, gastos e repasse do motorista.</p></div>
      <div class="card"><h3>Onde vejo o motorista?</h3><p>Na tela <b>Motorista</b>. Lá aparece quanto precisa pagar e o botão para marcar o pagamento como realizado.</p></div>
      <div class="card"><h3>Errei uma corrida?</h3><p>Abra <b>Corridas</b> ou <b>Histórico</b> e edite antes de concluir.</p></div>
      <div class="card"><h3>O sistema manda WhatsApp?</h3><p><b>Não.</b> O modo atual é manual. O painel serve somente para registro, acompanhamento e financeiro.</p></div>
    </div>`;
  }

  function addHomeActions(){
    const root=document.getElementById('axHomeV2');if(!root||document.getElementById('simpleHomeActions'))return;
    const bar=document.createElement('section');bar.id='simpleHomeActions';bar.className='simple-home-actions';
    bar.innerHTML=`<div class="simple-actions-copy"><span>O QUE VOCÊ QUER FAZER?</span><b>Escolha uma opção</b></div>
      <div class="simple-actions-grid">
        <button class="primary" onclick="simpleNewRun()"><span>＋</span><div><b>Nova corrida</b><small>Registrar atendimento</small></div></button>
        <button onclick="simpleGo('operations')"><span>◉</span><div><b>Corridas abertas</b><small>Acompanhar e concluir</small></div></button>
        <button onclick="simpleGo('finance')"><span>$</span><div><b>Ver dinheiro</b><small>Receber, gastar e lucrar</small></div></button>
        <button onclick="simpleGo('fleet')"><span>▰</span><div><b>Pagar motorista</b><small>Ver repasse do período</small></div></button>
      </div>`;
    root.prepend(bar);
  }

  function simplifyHome(){
    const root=document.getElementById('axHomeV2');if(!root)return;
    const kicker=root.querySelector('.ax-welcome small');if(kicker)kicker.textContent='CONTROLE DA OPERAÇÃO';
    const empty=root.querySelector('.ax-run-list .ax-empty-home');if(empty)empty.innerHTML='<b>Nenhuma corrida aberta</b><span>Toque em “Nova corrida” para registrar o próximo atendimento.</span>';
    const h=root.querySelector('.ax-company-summary-head h3');if(h)h.textContent='Seu dinheiro';
    const p=root.querySelector('.ax-company-summary-head p');if(p)p.textContent='Veja rapidamente quanto faturou, quanto falta receber e quanto sobrou.';
    const labels=['Faturado','Já recebeu','Falta receber','Outros gastos','Pagar motorista','Lucro estimado'];
    [...root.querySelectorAll('.ax-finance-card')].forEach((c,i)=>{const s=c.querySelector('span');if(s&&labels[i])s.textContent=labels[i]});
  }

  function guidePages(){
    const fin=document.getElementById('finance');
    if(fin&&!document.getElementById('simpleFinanceGuide')){
      fin.querySelector(':scope > .head')?.insertAdjacentHTML('afterend','<div id="simpleFinanceGuide" class="simple-guide"><b>Como usar:</b><span>1. Corrida concluída entra aqui.</span><span>2. Quando o cliente pagar, marque como pago.</span><span>3. Registre outros gastos quando acontecerem.</span></div>');
    }
    const fleet=document.getElementById('fleet'),fh=fleet?.querySelector(':scope > .head');if(fh){const h=fh.querySelector('h2'),p=fh.querySelector('p');if(h)h.textContent='Motorista';if(p)p.textContent='Veja quanto precisa pagar e marque quando o pagamento for feito.'}
    const calls=document.getElementById('calls'),ch=calls?.querySelector(':scope > .head');if(ch){const h=ch.querySelector('h2'),p=ch.querySelector('p'),b=ch.querySelector('.btn');if(h)h.textContent='Histórico de corridas';if(p)p.textContent='Todas as corridas ficam salvas aqui para você consultar depois.';if(b){b.textContent='+ Nova corrida';b.setAttribute('onclick','simpleNewRun()')}}
    const ops=document.getElementById('operations'),oh=ops?.querySelector(':scope > .head');if(oh){const h=oh.querySelector('h2'),p=oh.querySelector('p'),b=oh.querySelector('.btn');if(h)h.textContent='Corridas';if(p)p.textContent='Quando terminar, toque em “Concluir corrida”.';if(b){b.textContent='+ Nova corrida';b.setAttribute('onclick','simpleNewRun()')}}
  }

  function manualBanner(){
    const root=document.getElementById('axHomeV2');if(!root||document.getElementById('simpleManualBanner'))return;
    const b=document.createElement('div');b.id='simpleManualBanner';b.className='simple-manual-banner';
    b.innerHTML='<span>✓</span><div><b>Modo manual</b><small>Sem robô e sem mensagens automáticas. Use o sistema para registrar e controlar as corridas.</small></div>';
    root.prepend(b);
  }

  window.simpleNewRun=()=>{
    if(typeof openModal!=='function'||typeof saveMgmt!=='function')return;
    const today=new Date().toISOString().slice(0,10);
    const driver=(mgmt?.fleet||[]).find((x)=>x.driver)?.driver||'';
    openModal('Nova corrida',`<div class="simple-modal-intro"><b>Preencha só o que souber.</b><span>Você pode completar ou corrigir depois.</span></div>
      <div class="form-grid simple-run-form">
        <div class="field"><label>Data</label><input name="occurredAt" type="date" value="${today}"></div>
        <div class="field"><label>Cliente / seguradora</label><input name="client" placeholder="Ex.: Seguradora X"></div>
        <div class="field"><label>Veículo</label><input name="vehicle" placeholder="Ex.: Onix branco"></div>
        <div class="field"><label>Placa <span class="simple-optional">opcional</span></label><input name="plate"></div>
        <div class="field field-wide"><label>De onde saiu</label><input name="origin" placeholder="Endereço de origem"></div>
        <div class="field field-wide"><label>Para onde foi</label><input name="destination" placeholder="Endereço de destino"></div>
        <div class="field"><label>Valor da corrida</label><input name="value" inputmode="decimal" type="number" step="0.01" placeholder="0,00"></div>
        <div class="field"><label>KM cobrados</label><input name="billableKm" inputmode="decimal" type="number" step="0.1" placeholder="0"></div>
        <div class="field"><label>Motorista</label><input name="driverName" value="${safe(driver)}"></div>
        <div class="field"><label>Situação agora</label><select name="status"><option value="autorizado">Corrida confirmada</option><option value="a_caminho">Motorista a caminho</option><option value="em_atendimento">Em atendimento</option><option value="aguardando_fechamento">Terminou — falta conferir valores</option></select></div>
      </div>
      <details class="simple-details"><summary>Adicionar protocolo ou observação</summary><div class="form-grid section"><div class="field"><label>Protocolo</label><input name="protocol"></div><div class="field"><label>Observação</label><input name="ownerNotes"></div></div></details>`,async()=>{
      const data=Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());
      const day=data.occurredAt;delete data.occurredAt;
      data.value=num(data.value);data.billableKm=num(data.billableKm);data.totalKm=data.billableKm;
      data.client=String(data.client||'').trim();data.insurer=data.client;data.source='manual';data.manualQuote=false;data.quoteTracked=true;data.quoteOutcome='won';data.ownerCloseRequired=true;data.authorizedAt=new Date().toISOString();
      if(day)data.createdAt=new Date(`${day}T12:00:00`).toISOString();
      await saveMgmt({action:'upsert',collection:'calls',item:data});
      if(typeof refreshBillingOnly==='function')await refreshBillingOnly().catch(()=>{});
      if(typeof refreshOwner==='function')await refreshOwner().catch(()=>{});
      setTimeout(()=>go('operations'),50);
    });
    const save=document.getElementById('modalSave');if(save)save.textContent='Salvar corrida';
  };

  window.simpleCloseCall=(id)=>{
    const call=(mgmt?.calls||[]).find((x)=>x.id===id);if(!call||typeof openModal!=='function')return;
    const km=num(call.billableKm??call.totalKm??call.estimatedTotalKm),value=num(call.value||call.calculatedValue||call.quoteCalculatedValue);
    openModal('Concluir corrida',`<div class="simple-close-summary"><b>${safe(call.vehicle||call.plate||'Corrida')}</b><span>${safe(call.origin||'Origem não informada')} → ${safe(call.destination||'Destino não informado')}</span></div>
      <div class="simple-modal-intro"><b>Confira só dois números.</b><span>Ao concluir, Financeiro e pagamento do motorista serão atualizados.</span></div>
      <div class="form-grid"><div class="field"><label>Valor final da corrida</label><input id="simpleCloseValue" name="value" type="number" inputmode="decimal" step="0.01" value="${value||''}"></div><div class="field"><label>KM cobrados</label><input id="simpleCloseKm" name="billableKm" type="number" inputmode="decimal" step="0.1" value="${km||''}"></div></div>
      <div id="simpleClosePreview" class="simple-close-preview"></div>
      <details class="simple-details"><summary>Teve adicional? Preencher detalhes</summary><div class="form-grid section"><div class="field"><label>Hora trabalhada</label><input id="simpleWorked" name="workedTimeAmount" type="number" step="0.01" value="${num(call.workedTimeAmount)||0}"></div><div class="field"><label>Pedágio</label><input name="toll" type="number" step="0.01" value="${num(call.finalTollAmount)||0}"></div><div class="field"><label>Outros adicionais</label><input name="otherExtras" type="number" step="0.01" value="${num(call.finalOtherExtras)||0}"></div><div class="field"><label>Observação</label><input name="notes" value="${safe(call.ownerClosingNotes||'')}"></div></div></details>`,async()=>{
      const data=Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());['value','billableKm','workedTimeAmount','toll','otherExtras'].forEach((k)=>data[k]=num(data[k]));
      const save=document.getElementById('modalSave');if(save){save.disabled=true;save.textContent='Concluindo…'}
      try{
        await api('/api/worker/management',{method:'POST',body:JSON.stringify({action:'close_call',callId:id,ownerName:'Painel',suppressNotice:true,manualCompletion:true,final:{...data,workedTimeChargedHours:num(call.workedTimeChargedHours),dirtRoadBillableKm:num(call.dirtRoadBillableKm)}})});
        if(typeof loadManagement==='function')await loadManagement();if(typeof refreshBillingOnly==='function')await refreshBillingOnly().catch(()=>{});if(typeof refreshOwner==='function')await refreshOwner().catch(()=>{});if(typeof closeModal==='function')closeModal();
        alert('Corrida concluída. Financeiro e pagamento do motorista foram atualizados.');
      }catch(error){if(save){save.disabled=false;save.textContent='Concluir corrida'}alert(error?.message||'Não foi possível concluir a corrida.')}
    });
    const save=document.getElementById('modalSave');if(save)save.textContent='Concluir corrida';
    const preview=()=>{
      const km=num(document.getElementById('simpleCloseKm')?.value),v=num(document.getElementById('simpleCloseValue')?.value),worked=num(document.getElementById('simpleWorked')?.value);
      const pay=Math.round((40+Math.max(0,km-50)*.70+worked)*100)/100,profit=v-pay,box=document.getElementById('simpleClosePreview');
      if(box)box.innerHTML=`<div><span>Pagar motorista</span><b>${cash(pay)}</b></div><div><span>Sobra desta corrida*</span><b>${cash(profit)}</b></div><small>*Antes de outros gastos da empresa.</small>`;
    };
    ['simpleCloseKm','simpleCloseValue','simpleWorked'].forEach((x)=>document.getElementById(x)?.addEventListener('input',preview));preview();
  };

  function enhanceFinanceRows(){
    document.querySelectorAll('#financeTable tr').forEach((row)=>{
      if(row.dataset.simpleEnhanced==='1')return;
      const edit=row.querySelector('button[onclick*="editItem"]'),m=edit?.getAttribute('onclick')?.match(/finance','([^']+)'/);if(!m)return;
      const item=(mgmt?.finance||[]).find((x)=>x.id===m[1]);if(!item||item.status==='pago')return;
      row.dataset.simpleEnhanced='1';const cell=row.lastElementChild;if(!cell)return;
      const b=document.createElement('button');b.className='btn small simple-paid-btn';b.textContent=item.type==='receita'?'Marcar recebido':'Marcar pago';
      b.onclick=async()=>{b.disabled=true;try{await saveMgmt({action:'upsert',collection:'finance',item:{...item,status:'pago',paidAt:new Date().toISOString()}});if(typeof refreshOwner==='function')await refreshOwner().catch(()=>{})}catch(e){b.disabled=false;alert(e?.message||'Não foi possível atualizar.')}};
      cell.prepend(b);
    });
  }

  function syncActive(){
    const active=document.querySelector('.page.active')?.id;
    document.querySelectorAll('.mobile-tabs [data-simple-page]').forEach((b)=>b.classList.toggle('active',b.dataset.simplePage===active));
  }

  function enhance(){
    simplifyMenus();setCopy();rebuildMore();rebuildHelp();addHomeActions();simplifyHome();guidePages();manualBanner();enhanceFinanceRows();syncActive();
    window.ownerCloseCall=window.simpleCloseCall;window.operationCloseCall=window.simpleCloseCall;
  }
  let scheduled=false;const schedule=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhance()})};
  const obs=new MutationObserver(schedule);
  function init(){enhance();obs.observe(document.body,{subtree:true,childList:true});document.addEventListener('click',(e)=>{if(e.target.closest?.('[data-page],[data-simple-page]'))setTimeout(enhance,40)});setInterval(enhance,4000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
