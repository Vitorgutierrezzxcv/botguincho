(() => {
  'use strict';
  const activeStatuses = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento']);
  const getMgmt = () => {
    try {
      if (typeof mgmt !== 'undefined' && mgmt && typeof mgmt === 'object') return mgmt;
    } catch {}
    return { company:{}, calls:[], finance:[], fleet:[], driverPayrolls:[] };
  };
  const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const money = (v) => n(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const esc2 = (v) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const km = (call) => n(call?.billableKm ?? call?.totalKm ?? call?.estimatedTotalKm);
  const value = (call) => n(call?.value || call?.calculatedValue || call?.quoteCalculatedValue);
  const finalized = (call) => Boolean(call?.ownerClosedAt) || (call?.status === 'concluido' && call?.ownerCloseRequired !== true);
  const accepted = (call) => activeStatuses.has(call?.status) || Boolean(call?.authorizedAt) || call?.status === 'concluido';
  const driverPay = (call) => {
    if (!accepted(call)) return 0;
    const usedKm = Math.max(0,km(call));
    return Math.round((40 + Math.max(0,usedKm - 50) * .70 + n(call?.workedTimeAmount)) * 100) / 100;
  };

  function go(page){
    const btn = document.querySelector(`.sidebar [data-page="${page}"]`) || document.querySelector(`[data-page="${page}"]`);
    if (btn) btn.click();
    document.getElementById('axMenuDrawer')?.classList.remove('open');
  }
  window.axGo = go;

  function greetingName(){
    const state=getMgmt();
    const raw=window.__acionadorUserName || state?.user?.name || state?.company?.ownerName || state?.company?.contactName || '';
    const clean=String(raw||'').trim();
    if(!clean || /^(usuário|usuario|acionador\.ai|central operacional)$/i.test(clean)) return '';
    return clean.split(/\s+/)[0];
  }

  function updateGreeting(){
    const title=document.getElementById('title');
    if(!title) return;
    const hour=new Date().getHours();
    const greeting=hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite';
    const name=greetingName();
    title.textContent=name?`${greeting}, ${name}`:greeting;
    const subtitle=document.getElementById('subtitle');
    if(subtitle){subtitle.textContent='';subtitle.style.display='none'}
  }

  function buildMenu(){
    if (document.getElementById('axMenuFab')) return;
    const fab = document.createElement('button'); fab.id='axMenuFab'; fab.className='ax-menu-fab'; fab.type='button'; fab.setAttribute('aria-label','Abrir menu'); fab.innerHTML='☰';
    const drawer = document.createElement('div'); drawer.id='axMenuDrawer'; drawer.className='ax-menu-drawer';
    const items = [
      ['dashboard','⌂','Início'],['operations','◉','Operação'],['calls','▣','Corridas'],['finance','$','Financeiro'],['clients','◌','Clientes'],['fleet','▰','Motoristas e frota'],
      ['pricing','≡','Tabelas de valores'],['groups','◎','Grupos'],['whatsapp','◍','WhatsApp'],['tracker','⌖','Rastreador'],['automations','⚡','Configurações'],['help','?','Ajuda']
    ];
    drawer.innerHTML = `<div class="ax-menu-head"><div class="ax-menu-logo"><img src="/icon.svg" alt=""></div><div><b>Acionador.ai</b><small>${esc2(document.getElementById('companyNameDisplay')?.textContent || 'Central operacional')}</small></div></div><div class="ax-menu-section">NAVEGAÇÃO</div>${items.map(([p,i,t])=>`<button class="ax-menu-item" data-ax-page="${p}"><span class="ax-menu-icon">${i}</span><span>${t}</span></button>`).join('')}`;
    drawer.querySelectorAll('[data-ax-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.axPage)));
    fab.addEventListener('click',()=>drawer.classList.toggle('open'));
    document.addEventListener('click',(e)=>{if(!drawer.contains(e.target)&&e.target!==fab)drawer.classList.remove('open')});
    document.body.append(drawer,fab);
  }

  function currentPayroll(){
    const list = Array.isArray(window.ownerState?.billing?.driverPayrolls) ? window.ownerState.billing.driverPayrolls : (Array.isArray(getMgmt().driverPayrolls)?getMgmt().driverPayrolls:[]);
    return list.find(p=>p.status!=='paid') || list[0] || null;
  }

  function activeCalls(){
    return (Array.isArray(getMgmt().calls)?getMgmt().calls:[]).filter(c=>!c.deletedAt && c.testRunId == null && activeStatuses.has(c.status));
  }

  function renderHome(){
    const page=document.getElementById('dashboard'); if(!page) return;
    let root=document.getElementById('axHomeV2'); if(!root){root=document.createElement('div');root.id='axHomeV2';root.className='ax-home';page.prepend(root)}
    const calls=activeCalls().sort((a,b)=>new Date(b.authorizedAt||b.updatedAt||0)-new Date(a.authorizedAt||a.updatedAt||0));
    const awaiting=calls.filter(c=>c.status==='aguardando_fechamento');
    const state=getMgmt();
    const finance=Array.isArray(state.finance)?state.finance:[];
    const finalCalls=(state.calls||[]).filter(c=>!c.deletedAt&&finalized(c));
    const billed=finalCalls.reduce((s,c)=>s+n(c.value),0);
    const receivable=finance.filter(f=>f.type==='receita'&&f.isFinal===true&&f.status!=='pago'&&!f.deletedAt).reduce((s,f)=>s+n(f.amount),0);
    const received=finance.filter(f=>f.type==='receita'&&f.isFinal===true&&f.status==='pago'&&!f.deletedAt).reduce((s,f)=>s+n(f.amount),0);
    const payroll=currentPayroll();
    const driverDue = n(payroll?.totalAmount || payroll?.projectedAmount) || (state.calls||[]).filter(c=>!c.deletedAt&&accepted(c)&&!finalized(c)).reduce((s,c)=>s+driverPay(c),0);
    const driver=(state.fleet||[]).find(x=>x.driver)?.driver || payroll?.driverName || 'Mauro';
    const expenseRows=finance.filter(f=>f.type==='despesa'&&!f.deletedAt);
    const driverExpenseRows=expenseRows.filter(f=>/repasse|motorista|mauro|driver/i.test(String(f.description||f.name||f.category||'')));
    const driverExpenseBooked=driverExpenseRows.reduce((sum,f)=>sum+n(f.amount),0);
    const driverCost=driverExpenseBooked || driverDue;
    const otherExpenses=Math.max(0,expenseRows.reduce((sum,f)=>sum+n(f.amount),0)-driverExpenseBooked);
    const totalCosts=otherExpenses+driverCost;
    const estimatedProfit=billed-totalCosts;
    const runHtml = calls.length ? calls.slice(0,6).map(c=>`<article class="ax-run-card ${c.status==='aguardando_fechamento'?'await':''}"><div class="ax-run-card-head"><div><div class="ax-run-title">${esc2(c.vehicle||c.plate||'Veículo não informado')}</div><div class="ax-run-sub">${esc2(c.groupName||c.insurer||c.client||'Atendimento')} · ${c.authorizedAt?new Date(c.authorizedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'agora'}</div></div><span class="ax-pill ${c.status==='aguardando_fechamento'?'await':''}">${c.status==='aguardando_fechamento'?'Aguardando fechamento':'Em andamento'}</span></div><div class="ax-route"><b>Origem</b>: ${esc2(c.origin||'Não informada')}<br><b>Destino</b>: ${esc2(c.destination||'Não informado')}</div><div class="ax-run-meta"><div><span>KM</span><b>${km(c).toLocaleString('pt-BR',{maximumFractionDigits:1})} km</b></div><div><span>Valor previsto</span><b>${money(value(c))}</b></div><div><span>Motorista</span><b>${esc2(c.driverName||driver)}</b></div></div><div class="ax-run-actions"><button onclick="operationEditCall('${esc2(c.id)}')">Editar comanda</button><button class="primary" onclick="operationCloseCall('${esc2(c.id)}')">Concluir corrida</button></div></article>`).join('') : `<div class="ax-empty-home"><b>Nenhuma corrida em andamento</b>As corridas aceitas pelo WhatsApp aparecem aqui automaticamente.</div>`;
    root.innerHTML=`<div class="ax-home-hero ax-home-hero-single"><section class="ax-welcome"><div><small>ACOMPANHAMENTO EM TEMPO REAL</small><h2>${calls.length?`${calls.length} corrida${calls.length>1?'s':''} acontecendo agora`:'Operação pronta para receber chamadas'}</h2><p>${awaiting.length?`${awaiting.length} corrida${awaiting.length>1?'s':''} aguardando fechamento.`:'Acompanhe, edite e conclua os atendimentos sem sair da tela inicial.'}</p></div><div class="ax-welcome-actions"><button class="ax-btn light" onclick="axGo('operations')">Abrir operação</button><button class="ax-btn glass" onclick="ownerEditCall(null,'quote')">+ Corrida manual</button></div></section></div><section class="ax-active-section"><div class="ax-section-head"><div><h3>Corridas em andamento</h3><p>Prioridade da operação: acompanhar e concluir atendimentos.</p></div><button class="ax-link-btn" onclick="axGo('operations')">Ver operação</button></div><div class="ax-run-list">${runHtml}</div></section><aside class="ax-driver-summary ax-driver-after-runs"><div><span class="label">REPASSE DO MOTORISTA</span><div class="ax-driver-name">${esc2(driver)}</div><p class="ax-driver-copy">Provisão do período atual com base nas corridas aceitas e concluídas.</p></div><div><div class="ax-driver-total">${money(driverCost)}</div><div class="ax-driver-foot"><span>${payroll?.periodStart&&payroll?.periodEnd?`${payroll.periodStart} → ${payroll.periodEnd}`:'Período atual'}</span><button class="ax-link-btn" style="color:#fff" onclick="axGo('fleet')">Ver repasse</button></div></div></aside><section class="ax-company-summary"><div class="ax-company-summary-head"><div><span class="ax-summary-kicker">RESUMO DA EMPRESA</span><h3>Visão financeira do período</h3><p>Faturamento, custos, repasse e resultado da operação em um único lugar.</p></div><button class="ax-summary-action" onclick="axGo('finance')">Abrir financeiro</button></div><div class="ax-finance-overview"><div class="ax-finance-card revenue"><span>Faturado</span><b>${money(billed)}</b><small>Corridas concluídas</small></div><div class="ax-finance-card received"><span>Recebido</span><b>${money(received)}</b><small>Entradas confirmadas</small></div><div class="ax-finance-card pending"><span>A receber</span><b>${money(receivable)}</b><small>Receitas pendentes</small></div><div class="ax-finance-card expense"><span>Gastos operacionais</span><b>${money(otherExpenses)}</b><small>Despesas sem o repasse</small></div><div class="ax-finance-card driver"><span>Repasse motorista</span><b>${money(driverCost)}</b><small>${esc2(driver)} · período atual</small></div><div class="ax-finance-card profit ${estimatedProfit<0?'negative':'positive'}"><span>Lucro estimado</span><b>${money(estimatedProfit)}</b><small>Faturado − gastos − repasse</small></div></div></section>`;
  }

  function highlightMenu(){
    const active=document.querySelector('.page.active')?.id;
    document.querySelectorAll('.ax-menu-item').forEach(b=>b.classList.toggle('active',b.dataset.axPage===active));
  }

  function init(){
    document.body.classList.add('tratto-ui');
    buildMenu();
    renderHome();
    highlightMenu();
    updateGreeting();
    document.querySelectorAll('[data-page]').forEach((button)=>button.addEventListener('click',()=>setTimeout(()=>{renderHome();highlightMenu();updateGreeting()},80)));
    setInterval(()=>{renderHome();highlightMenu();updateGreeting()},5000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,350));else setTimeout(init,350);
})();
