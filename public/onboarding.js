const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const selfMode=params.get('self')==='1'&&!params.get('companyId');

if(selfMode){
  runSelfOnboarding();
}else{
  runMasterOnboarding();
}

async function runSelfOnboarding(){
  const token=localStorage.getItem('bg-access-token')||'';
  if(!token){location.replace('/login.html');return}
  document.title='Acionador.ai · Configure sua empresa';
  document.body.innerHTML=`<main style="min-height:100dvh;background:#f5f7fb;padding:24px;display:grid;place-items:center;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033">
    <section style="width:min(680px,100%);background:white;border:1px solid #e3e8f0;border-radius:24px;padding:28px;box-shadow:0 18px 60px rgba(23,32,51,.08)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px"><img src="/icons/icon-192.png" style="width:50px;height:50px;border-radius:14px" alt=""><div><b style="font-size:19px">Acionador.ai</b><div style="font-size:12px;color:#7b879a">Configuração inicial</div></div></div>
      <div style="font-size:12px;font-weight:800;color:#0877F9;letter-spacing:.06em">PASSO 1 DE 2 · SUA EMPRESA</div>
      <h1 style="font-size:30px;letter-spacing:-.03em;margin:8px 0">Vamos criar sua operação</h1>
      <p style="color:#758198;line-height:1.55;margin:0 0 22px">Cada empresa recebe seu próprio ambiente, WhatsApp, grupos, horários, tabelas, frota e dados. Nada é compartilhado com outras operações.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" id="selfGrid">
        <label style="display:block;font-size:12px;font-weight:750;color:#445169">Seu nome<input id="selfName" autocomplete="name" style="display:block;width:100%;margin-top:6px;border:1px solid #e3e8f0;border-radius:12px;padding:13px;font:inherit" placeholder="Ex.: Thiago"></label>
        <label style="display:block;font-size:12px;font-weight:750;color:#445169">Celular<input id="selfPhone" autocomplete="tel" inputmode="tel" style="display:block;width:100%;margin-top:6px;border:1px solid #e3e8f0;border-radius:12px;padding:13px;font:inherit" placeholder="(31) 99999-9999"></label>
        <label style="display:block;font-size:12px;font-weight:750;color:#445169;grid-column:1/-1">Nome da empresa<input id="selfCompany" style="display:block;width:100%;margin-top:6px;border:1px solid #e3e8f0;border-radius:12px;padding:13px;font:inherit" placeholder="Ex.: América Guinchos"></label>
        <label style="display:block;font-size:12px;font-weight:750;color:#445169">Estado principal<select id="selfState" style="display:block;width:100%;margin-top:6px;border:1px solid #e3e8f0;border-radius:12px;padding:13px;font:inherit;background:white"><option>MG</option><option>SP</option><option>RJ</option><option>ES</option><option>PR</option><option>SC</option><option>RS</option><option>GO</option><option>DF</option><option>BA</option><option>PE</option><option>CE</option><option>PA</option><option>AM</option><option>MT</option><option>MS</option><option>TO</option><option>MA</option><option>PI</option><option>RN</option><option>PB</option><option>AL</option><option>SE</option><option>RO</option><option>AC</option><option>AP</option><option>RR</option></select></label>
        <label style="display:block;font-size:12px;font-weight:750;color:#445169">Cidades principais<input id="selfCities" style="display:block;width:100%;margin-top:6px;border:1px solid #e3e8f0;border-radius:12px;padding:13px;font:inherit" placeholder="Betim, Contagem"></label>
      </div>
      <div id="selfNotice" style="display:none;margin-top:14px;border-radius:12px;padding:11px 13px;font-size:13px"></div>
      <button id="createSelfCompany" style="width:100%;margin-top:18px;border:0;border-radius:12px;background:#0877F9;color:white;padding:14px;font:inherit;font-weight:800;cursor:pointer">Criar minha empresa</button>
      <button id="selfLogout" style="width:100%;margin-top:10px;border:1px solid #e3e8f0;border-radius:12px;background:white;color:#445169;padding:12px;font:inherit;font-weight:700;cursor:pointer">Sair desta conta</button>
      <p style="font-size:11px;color:#8a94a5;line-height:1.5;text-align:center;margin:16px 0 0">No próximo passo você conecta o WhatsApp e escolhe os grupos da sua própria operação.</p>
    </section>
  </main>`;
  const style=document.createElement('style');style.textContent='@media(max-width:620px){#selfGrid{grid-template-columns:1fr!important}#selfGrid label{grid-column:auto!important}}';document.head.appendChild(style);

  const notice=(msg,type='bad')=>{const el=$('selfNotice');el.style.display='block';el.textContent=msg;el.style.background=type==='good'?'#edfbf3':'#fff0f0';el.style.color=type==='good'?'#17633b':'#8b2d2d';el.style.border=`1px solid ${type==='good'?'#bde8cf':'#f0c4c4'}`};
  const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
  const slugify=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,38);
  try{
    const r=await fetch('/api/control/me',{headers:{authorization:`Bearer ${token}`},cache:'no-store'});const me=await r.json();if(!r.ok)throw new Error(me.error||'Sessão inválida');
    if(me.user?.name)$('selfName').value=me.user.name;if(me.user?.phone)$('selfPhone').value=me.user.phone;
    const memberships=(me.memberships||[]).filter(x=>x?.companies?.slug);
    if(memberships.length){const chosen=memberships[0].companies.slug;localStorage.setItem('bg-company-id',chosen);location.replace(`/?companyId=${encodeURIComponent(chosen)}`);return}
  }catch(e){localStorage.removeItem('bg-access-token');location.replace('/login.html');return}

  $('createSelfCompany').onclick=async()=>{
    const btn=$('createSelfCompany'),name=$('selfName').value.trim(),companyName=$('selfCompany').value.trim(),phone=$('selfPhone').value.trim(),state=$('selfState').value,cities=$('selfCities').value.split(',').map(x=>x.trim()).filter(Boolean);
    if(!name)return notice('Informe seu nome.');if(companyName.length<2)return notice('Informe o nome da empresa.');
    const base=slugify(companyName)||'empresa';const slug=`${base}-${Math.random().toString(36).slice(2,6)}`.slice(0,42);
    btn.disabled=true;btn.textContent='Criando ambiente...';
    try{
      const r=await fetch('/api/control/companies',{method:'POST',headers,body:JSON.stringify({action:'self_create',company:{name:companyName,slug,contact_name:name,phone,service_state:state,priority_cities:cities}})});let d={};try{d=await r.json()}catch{};if(!r.ok)throw new Error(d.error||'Não foi possível criar a empresa');
      const c=d.company;if(!c?.slug)throw new Error('Empresa criada sem identificador');localStorage.setItem('bg-company-id',c.slug);notice('Empresa criada. Abrindo seu ambiente exclusivo...','good');setTimeout(()=>location.replace(`/?companyId=${encodeURIComponent(c.slug)}&first=1`),700);
    }catch(e){notice(String(e.message).includes('duplicate')?'Já existe uma empresa com este identificador. Tente novamente.':e.message);btn.disabled=false;btn.textContent='Criar minha empresa'}
  };
  $('selfLogout').onclick=()=>{['bg-access-token','bg-refresh-token','bg-access-expires-at','bg-company-id'].forEach(k=>localStorage.removeItem(k));location.replace('/login.html')};
}

function runMasterOnboarding(){
  const companyId=(new URLSearchParams(location.search).get('companyId')||'').toLowerCase().replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,42);
  const token=localStorage.getItem('bg-master-token')||localStorage.getItem('bg-access-token')||'';
  let company=null,lastStatus=null,lastTracker=null,lastGroups=[];
  if(!companyId){location.replace('/master.html');return}
  function h(){return {'content-type':'application/json',authorization:`Bearer ${token}`,'x-botguincho-company-id':companyId}}
  async function api(url,opt={}){const u=new URL(url,location.origin);if(url.startsWith('/api/worker/'))u.searchParams.set('companyId',companyId);const r=await fetch(u.pathname+u.search,{cache:'no-store',headers:{...h(),...(opt.headers||{})},...opt});let d={};try{d=await r.json()}catch{}if(!r.ok){const e=new Error(d.error||d.message||`HTTP ${r.status}`);e.status=r.status;throw e}return d}
  function note(id,msg,type='warn'){const el=$(id);el.style.display='block';el.className='notice section '+type;el.textContent=msg}
  function mark(){const done={s1:!!company,s2:!!company?.tenant_provisioned,s3:lastStatus?.whatsapp?.status==='pronto',s4:lastGroups.some(x=>x.selected),s5:!!lastTracker?.connected};Object.entries(done).forEach(([id,v])=>$(id).classList.toggle('done',!!v));const ready=done.s2&&done.s3&&done.s4&&done.s5;note('readyStatus',ready?'Tudo certo. A empresa pode ser ativada.':'Ainda falta concluir uma ou mais etapas.',ready?'good':'warn');return ready}
  function renderTrackerEndpoint(){if($('trackerEndpoint'))$('trackerEndpoint').textContent=`${location.origin}/api/worker/tracker-bridge?companyId=${encodeURIComponent(companyId)}`}
  async function loadCompany(){try{renderTrackerEndpoint();const d=await api('/api/control/companies');company=(d.companies||[]).find(x=>x.slug===companyId);if(!company)throw new Error('Empresa não encontrada');$('companyTitle').textContent=company.name;$('companySlug').textContent=company.slug;$('name').value=company.name||'';$('state').value=company.service_state||'MG';$('cities').value=(company.priority_cities||[]).join(', ');mark()}catch(e){note('globalNotice',e.message,'bad')}}
  async function patchCompany(patch){if(!company)return;const d=await api('/api/control/companies',{method:'PATCH',body:JSON.stringify({id:company.id,patch})});company=d.company;mark();return company}
  async function syncTenantConfig(){if(!company)throw new Error('Empresa não carregada');const priorityCities=Array.isArray(company.priority_cities)?company.priority_cities:[];await api('/api/worker/settings',{method:'POST',body:JSON.stringify({companyName:company.name,serviceState:company.service_state||'MG',priorityCities})});await api('/api/worker/management',{method:'POST',body:JSON.stringify({action:'replace_company',item:{name:company.name,document:company.document||'',phone:company.phone||'',email:company.email||''}})});return true}
  async function saveCompany(){try{const next=await patchCompany({name:$('name').value.trim(),service_state:$('state').value.toUpperCase().trim(),priority_cities:$('cities').value.split(',').map(x=>x.trim()).filter(Boolean),onboarding_step:'environment'});company=next;note('globalNotice','Dados salvos. Preparando o ambiente da empresa...','warn');await syncTenantConfig();await status();note('globalNotice','Empresa e ambiente sincronizados.','good')}catch(e){note('globalNotice',e.message,'bad')}}
  async function status(){try{lastStatus=await api('/api/worker/status');const ready=lastStatus?.whatsapp?.status==='pronto';const infra=lastStatus?.infrastructure?.status||'ativo';const returnedTenant=lastStatus?.infrastructure?.companyId||lastStatus?.clientId||companyId;if(returnedTenant!==companyId)throw new Error('O ambiente retornou um tenant diferente do esperado.');note('tenantStatus',`Ambiente ${infra} · ${returnedTenant}`,'good');note('waStatus',ready?'WhatsApp conectado e pronto.':`WhatsApp: ${lastStatus?.whatsapp?.status||'iniciando'}`,ready?'good':'warn');$('qr').innerHTML=lastStatus?.whatsapp?.qrDataUrl?`<img src="${lastStatus.whatsapp.qrDataUrl}" alt="QR Code">`:'';if(company&&!company.tenant_provisioned)await patchCompany({tenant_provisioned:true,onboarding_step:ready?'groups':'whatsapp'});mark();return lastStatus}catch(e){note('tenantStatus',`Não foi possível abrir o ambiente: ${e.message}`,'bad');throw e}}
  async function provision(){try{note('tenantStatus','Criando ambiente isolado da empresa...','warn');await syncTenantConfig();await status();if(company&&!company.tenant_provisioned)await patchCompany({tenant_provisioned:true,onboarding_step:lastStatus?.whatsapp?.status==='pronto'?'groups':'whatsapp'});note('globalNotice','Tenant provisionado. Agora conecte o WhatsApp desta empresa.','good')}catch(e){note('tenantStatus',`Falha ao provisionar: ${e.message}`,'bad')}}
  async function loadGroups(){try{const d=await api('/api/worker/groups');lastGroups=d.groups||[];$('groups').innerHTML=lastGroups.length?lastGroups.map(g=>`<label class="group-row"><input type="checkbox" value="${g.id}" ${g.selected?'checked':''}><span>${g.name||'Grupo'}</span></label>`).join(''):'<div class="empty">Nenhum grupo encontrado. Conecte o WhatsApp primeiro.</div>';mark()}catch(e){$('groups').innerHTML=`<div class="empty">${e.message}</div>`}}
  async function saveGroups(){try{const ids=[...document.querySelectorAll('#groups input:checked')].map(x=>x.value);if(!ids.length)return note('globalNotice','Selecione pelo menos um grupo em que o bot poderá atuar.','warn');await api('/api/worker/groups',{method:'POST',body:JSON.stringify({groupIds:ids})});await loadGroups();await patchCompany({onboarding_step:'tracker'});note('globalNotice','Grupos autorizados salvos.','good')}catch(e){note('globalNotice',e.message,'bad')}}
  async function tracker(){try{renderTrackerEndpoint();lastTracker=await api('/api/worker/tracker');$('pairCode').textContent=lastTracker.pairCode||'--------';note('trackerStatus',lastTracker.connected?`Rastreador online · leitura há ${lastTracker.ageSeconds||0}s`:`Rastreador ainda não conectado. Código desta empresa: ${lastTracker.pairCode||'—'}`,lastTracker.connected?'good':'warn');if(lastTracker.connected)await patchCompany({onboarding_step:'activation'});mark()}catch(e){note('trackerStatus',e.message,'bad')}}
  async function activate(){try{if(!mark())return note('globalNotice','Conclua todas as etapas antes de ativar.','warn');const fresh=await api('/api/worker/health');if(fresh.status!=='operational')return note('globalNotice','O ambiente ainda não está operacional. Confira WhatsApp, rastreador e rotas.','warn');await patchCompany({status:'active',onboarding_step:'completed',tenant_provisioned:true});note('globalNotice','Empresa ativada e pronta para operar.','good')}catch(e){note('globalNotice',e.message,'bad')}}
  $('saveCompany').onclick=saveCompany;$('provision').onclick=provision;$('refreshWa').onclick=status;$('loadGroups').onclick=loadGroups;$('saveGroups').onclick=saveGroups;$('refreshTracker').onclick=tracker;$('activate').onclick=activate;$('openCompany').onclick=()=>window.open(`/?companyId=${encodeURIComponent(companyId)}`,'_blank');renderTrackerEndpoint();loadCompany();
}
