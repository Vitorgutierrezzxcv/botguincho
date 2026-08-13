import express from 'express';
import { z } from 'zod';
import { parseServiceRequest } from './domain/parser.js';
import { decideRequest } from './domain/decision.js';
import { GConnectBrowserProvider } from './integrations/gconnectBrowser.js';
import { GoogleRoutesClient, roundEtaToOperationalMinutes } from './integrations/googleRoutes.js';
import { WhatsAppCloudClient } from './integrations/whatsapp.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const googleRoutes = new GoogleRoutesClient();
const whatsapp = new WhatsAppCloudClient();
const gconnect = new GConnectBrowserProvider();

const platformHtml = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bot Guincho</title>
<style>
:root{--bg:#07111f;--panel:#0d1b2d;--panel2:#11243b;--line:#203651;--text:#f6fbff;--muted:#8fa6bf;--brand:#2ee59d;--danger:#ff6b6b;--warning:#ffd166}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#15314a 0,transparent 30%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.layout{min-height:100vh;display:grid;grid-template-columns:260px 1fr}.sidebar{border-right:1px solid var(--line);padding:28px 20px;background:#071525;position:sticky;top:0;height:100vh}.logo{display:flex;gap:12px;align-items:center;margin-bottom:30px}.logo-mark{width:42px;height:42px;border-radius:13px;background:var(--brand);display:grid;place-items:center;color:#042719;font-weight:950}.logo strong{display:block}.logo small,.muted{color:var(--muted)}nav{display:grid;gap:8px}.nav{border:0;text-align:left;color:var(--muted);background:transparent;padding:13px 14px;border-radius:12px;font-weight:800;cursor:pointer}.nav.active,.nav:hover{background:#122b47;color:#fff}.main{padding:38px;max-width:1320px;width:100%;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:28px}.top h1{margin:0;font-size:30px}.top p{margin:7px 0 0;color:var(--muted)}.status{display:flex;align-items:center;gap:9px;padding:10px 14px;border:1px solid var(--line);border-radius:999px;background:#0b1c2f}.dot{width:10px;height:10px;border-radius:50%;background:var(--warning)}.dot.ok{background:var(--brand)}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:20px;padding:24px}.metric{font-size:30px;font-weight:900;margin:14px 0 6px}.section{margin-top:18px}.notice{padding:14px 16px;border-radius:13px;background:#172b40;color:var(--warning);margin-top:14px;line-height:1.5}.oknotice{color:#9ff5d0}.errornotice{color:#ffaaaa}.btn{border:0;border-radius:12px;padding:12px 16px;font-weight:850;cursor:pointer;transition:.15s}.btn:hover{transform:translateY(-1px)}.btn:disabled{opacity:.55;cursor:wait;transform:none}.primary{background:var(--brand);color:#052719}.secondary{background:#17304c;color:white;border:1px solid var(--line)}.danger{background:#3a2028;color:#ffb1b1;border:1px solid #65313c}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.page{display:none}.page.active{display:block}.field{display:grid;gap:8px;margin:14px 0}.field input,.field textarea{width:100%;background:#081524;color:white;border:1px solid var(--line);border-radius:12px;padding:12px 13px;outline:none}.field textarea{min-height:180px;resize:vertical}.setup{display:grid;grid-template-columns:1fr 1fr;gap:12px}.qr{width:min(360px,80vw);background:white;border-radius:18px;padding:14px;margin:16px 0}.qr img{display:block;width:100%}.empty{padding:28px;border:1px dashed #31516f;border-radius:15px;color:var(--muted);text-align:center}.groups{display:grid;gap:10px;margin-top:16px}.group{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--line);border-radius:13px;background:#091929}.group input{width:18px;height:18px;accent-color:var(--brand)}.group strong{display:block}.group small{display:block;color:var(--muted);margin-top:3px}.switch{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 0;border-bottom:1px solid var(--line)}.switch input{width:20px;height:20px;accent-color:var(--brand)}.activity{display:grid;gap:10px}.event{padding:12px 14px;border:1px solid var(--line);border-radius:13px;background:#091929}.event small{color:var(--muted)}.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(5,39,25,.3);border-top-color:#052719;border-radius:50%;animation:spin .7s linear infinite;vertical-align:-2px;margin-right:7px}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:900px){.layout{grid-template-columns:1fr}.sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}nav{grid-template-columns:repeat(4,1fr)}.main{padding:22px 16px}.grid4,.grid2,.setup{grid-template-columns:1fr 1fr}}@media(max-width:600px){.grid4,.grid2,.setup{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}nav{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="layout">
<aside class="sidebar">
  <div class="logo"><div class="logo-mark">BG</div><div><strong>Bot Guincho</strong><small>Central operacional</small></div></div>
  <nav>
    <button class="nav active" data-page="overview">Visão geral</button>
    <button class="nav" data-page="whatsapp">WhatsApp</button>
    <button class="nav" data-page="groups">Grupos</button>
    <button class="nav" data-page="ai">Inteligência</button>
  </nav>
</aside>
<main class="main">
<div class="top"><div><h1 id="title">Central operacional</h1><p id="subtitle">Configure e acompanhe a automação do atendimento.</p></div><div class="status"><span id="statusDot" class="dot"></span><span id="statusText">Plataforma online</span></div></div>

<section id="overview" class="page active">
  <div class="grid4">
    <div class="card"><b>Plataforma</b><div class="metric">Online</div><div class="muted">Vercel + API</div></div>
    <div class="card"><b>WhatsApp</b><div class="metric" id="mWa">—</div><div class="muted">Sessão persistente</div></div>
    <div class="card"><b>Grupos</b><div class="metric" id="mGroups">—</div><div class="muted">Selecionados</div></div>
    <div class="card"><b>IA</b><div class="metric" id="mAi">—</div><div class="muted">Resposta automática</div></div>
  </div>
  <div class="grid2 section">
    <div class="card">
      <h2>Conexão do worker</h2>
      <p class="muted">O WhatsApp roda em um servidor persistente. Cole a URL e o token gerados no servidor.</p>
      <div class="setup">
        <div class="field"><label>Worker URL</label><input id="workerUrl" placeholder="https://...trycloudflare.com" autocomplete="off"></div>
        <div class="field"><label>Token</label><input id="workerToken" type="password" placeholder="Token do worker" autocomplete="off"></div>
      </div>
      <div class="actions">
        <button class="btn primary" id="saveWorker" type="button" onclick="connectWorker()"><span id="connectLabel">Conectar worker</span></button>
        <button class="btn secondary" id="testWorker" type="button" onclick="testWorkerConnection()">Testar conexão</button>
        <button class="btn danger" id="clearWorker" type="button" onclick="disconnectWorker()">Desconectar</button>
      </div>
      <div id="workerNotice" class="notice">Aguardando configuração do worker.</div>
    </div>
    <div class="card"><h2>Atividade recente</h2><p class="muted">Mensagens, respostas e eventos da sessão.</p><div id="activity" class="activity section"></div></div>
  </div>
</section>

<section id="whatsapp" class="page">
  <div class="card">
    <h2>WhatsApp Web</h2>
    <p class="muted">Escaneie o QR pelo WhatsApp em Configurações → Aparelhos conectados → Conectar um aparelho.</p>
    <div id="qrBox" class="empty section">Conecte o worker para carregar o QR Code.</div>
    <div id="waNotice" class="notice">Aguardando worker.</div>
    <div class="actions"><button class="btn secondary" type="button" onclick="refreshWhatsapp()">Atualizar status</button></div>
  </div>
</section>

<section id="groups" class="page">
  <div class="card">
    <h2>Grupos monitorados</h2>
    <p class="muted">O bot só responde nos grupos marcados abaixo.</p>
    <div id="groupList" class="groups"><div class="empty">Conecte o WhatsApp para listar os grupos.</div></div>
    <div class="actions"><button class="btn primary" type="button" onclick="saveGroups()">Salvar grupos</button><button class="btn secondary" type="button" onclick="loadGroups()">Sincronizar grupos</button></div>
  </div>
</section>

<section id="ai" class="page">
  <div class="grid2">
    <div class="card">
      <h2>Inteligência artificial</h2>
      <p class="muted">Configure como o bot interpreta e responde às mensagens dos grupos autorizados.</p>
      <div class="field"><label>Modelo</label><input id="aiModel" placeholder="gpt-5-mini"></div>
      <div class="field"><label>Instruções do atendente</label><textarea id="aiInstructions"></textarea></div>
      <div class="actions"><button class="btn primary" type="button" onclick="saveAi()">Salvar configuração</button></div>
      <div id="aiNotice" class="notice">Aguardando worker.</div>
    </div>
    <div class="card">
      <h2>Automação</h2>
      <div class="switch"><div><strong>IA ativa</strong><div class="muted">Responder automaticamente nos grupos selecionados.</div></div><input id="aiEnabled" type="checkbox"></div>
      <div class="switch"><div><strong>Responder toda mensagem</strong><div class="muted">Processar cada nova mensagem recebida.</div></div><input id="replyEvery" type="checkbox"></div>
      <div class="switch"><div><strong>Modo humano</strong><div class="muted">Pausa a resposta automática sem desconectar.</div></div><input id="humanTakeover" type="checkbox"></div>
    </div>
  </div>
</section>
</main>
</div>

<script>
(function(){
  var titles={
    overview:['Central operacional','Configure e acompanhe a automação do atendimento.'],
    whatsapp:['WhatsApp','Conecte e acompanhe a sessão do cliente.'],
    groups:['Grupos','Escolha exatamente onde o bot pode atuar.'],
    ai:['Inteligência','Configure o comportamento do atendente automático.']
  };

  function el(id){ return document.getElementById(id); }
  function escapeHtml(value){ var d=document.createElement('div'); d.textContent=value||''; return d.innerHTML; }
  function setNotice(id,text,kind){ var node=el(id); if(!node)return; node.textContent=text; node.className='notice '+(kind||''); }
  function normalizeUrl(value){ return String(value||'').trim().replace(/\/+$/,''); }
  function savedWorker(){ return {url:normalizeUrl(localStorage.getItem('botguincho_worker_url')||''),token:localStorage.getItem('botguincho_worker_token')||''}; }

  document.querySelectorAll('.nav').forEach(function(btn){
    btn.addEventListener('click',function(){
      document.querySelectorAll('.nav').forEach(function(x){x.classList.remove('active')});
      document.querySelectorAll('.page').forEach(function(x){x.classList.remove('active')});
      btn.classList.add('active');
      el(btn.dataset.page).classList.add('active');
      el('title').textContent=titles[btn.dataset.page][0];
      el('subtitle').textContent=titles[btn.dataset.page][1];
    });
  });

  var initial=savedWorker();
  el('workerUrl').value=initial.url;
  el('workerToken').value=initial.token;

  async function fetchWithTimeout(url,options,timeoutMs){
    var controller=new AbortController();
    var timer=setTimeout(function(){controller.abort()},timeoutMs||8000);
    try{
      return await fetch(url,Object.assign({},options||{},{signal:controller.signal,cache:'no-store'}));
    } finally {
      clearTimeout(timer);
    }
  }

  async function workerApi(path,options){
    var w=savedWorker();
    if(!w.url) throw new Error('Worker não configurado');
    var opts=options||{};
    var headers=Object.assign({},opts.headers||{}, {'x-botguincho-token':w.token});
    if(opts.body && !headers['content-type']) headers['content-type']='application/json';
    var response;
    try{
      response=await fetchWithTimeout(w.url+path,Object.assign({},opts,{headers:headers}),9000);
    }catch(error){
      if(error && error.name==='AbortError') throw new Error('Tempo esgotado ao acessar o worker');
      throw new Error('Não foi possível acessar o worker. Confirme se o túnel está online.');
    }
    var data={};
    try{ data=await response.json(); }catch(_){}
    if(!response.ok){
      if(response.status===401) throw new Error('Token inválido');
      throw new Error(data.message||data.error||('HTTP '+response.status));
    }
    return data;
  }

  async function workerHealth(url){
    var response;
    try{
      response=await fetchWithTimeout(url+'/health',{method:'GET'},7000);
    }catch(error){
      if(error && error.name==='AbortError') throw new Error('O worker não respondeu em 7 segundos');
      throw new Error('URL do worker inacessível. O túnel pode ter expirado.');
    }
    if(!response.ok) throw new Error('Worker respondeu HTTP '+response.status);
    return true;
  }

  async function loadStatus(){
    var s=await workerApi('/api/status');
    var ready=s.whatsapp && s.whatsapp.status==='pronto';
    el('statusDot').className='dot '+(ready?'ok':'');
    el('statusText').textContent=ready?'WhatsApp conectado':'Worker conectado';
    el('mWa').textContent=ready?'Online':((s.whatsapp&&s.whatsapp.status)||'Offline');
    el('mGroups').textContent=s.groupsSelected==null?'0':String(s.groupsSelected);
    el('mAi').textContent=s.ai&&s.ai.enabled?'Ativa':'Pausada';
    if(s.whatsapp&&s.whatsapp.qrDataUrl){
      el('qrBox').className='section';
      el('qrBox').innerHTML='<div class="qr"><img src="'+s.whatsapp.qrDataUrl+'" alt="QR Code do WhatsApp"></div>';
    }else{
      el('qrBox').className='empty section';
      el('qrBox').textContent=ready?'WhatsApp conectado com sucesso.':'Aguardando geração do QR Code...';
    }
    setNotice('workerNotice','Worker conectado com sucesso.','oknotice');
    setNotice('waNotice',ready?'WhatsApp conectado e pronto.':'Estado da sessão: '+((s.whatsapp&&s.whatsapp.status)||'desconhecido'),'oknotice');
    return s;
  }

  async function loadGroups(){
    try{
      var d=await workerApi('/api/groups');
      var groups=(d&&d.groups)||[];
      el('groupList').innerHTML=groups.length?groups.map(function(g){
        return '<label class="group"><input type="checkbox" value="'+escapeHtml(g.id)+'" '+(g.selected?'checked':'')+'><div><strong>'+escapeHtml(g.name)+'</strong><small>'+escapeHtml(g.id)+'</small></div></label>';
      }).join(''):'<div class="empty">Nenhum grupo identificado. Envie uma mensagem em um grupo e clique em Sincronizar grupos.</div>';
    }catch(error){
      el('groupList').innerHTML='<div class="empty">'+escapeHtml(error.message)+'</div>';
    }
  }

  async function loadSettings(){
    try{
      var s=await workerApi('/api/settings');
      el('aiEnabled').checked=!!s.aiEnabled;
      el('replyEvery').checked=!!s.replyEveryMessage;
      el('humanTakeover').checked=!!s.humanTakeover;
      el('aiModel').value=s.aiModel||'';
      el('aiInstructions').value=s.aiInstructions||'';
      setNotice('aiNotice',s.apiKeyConfigured?'OpenAI configurada no worker.':'A IA ainda precisa da OPENAI_API_KEY no worker.',s.apiKeyConfigured?'oknotice':'');
    }catch(error){
      setNotice('aiNotice','Não foi possível carregar a IA: '+error.message,'errornotice');
    }
  }

  async function loadActivity(){
    try{
      var d=await workerApi('/api/activity');
      var items=(d&&d.activity)||[];
      el('activity').innerHTML=items.length?items.slice(0,10).map(function(e){
        return '<div class="event"><strong>'+escapeHtml(e.message)+'</strong><br><small>'+new Date(e.at).toLocaleString('pt-BR')+' · '+escapeHtml(e.type)+'</small></div>';
      }).join(''):'<div class="empty">Ainda não há atividade.</div>';
    }catch(_){
      el('activity').innerHTML='<div class="empty">Worker ainda não conectado.</div>';
    }
  }

  async function refreshAll(){
    await loadStatus();
    await Promise.all([loadGroups(),loadSettings(),loadActivity()]);
  }

  window.connectWorker=async function(){
    var button=el('saveWorker');
    var label=el('connectLabel');
    var url=normalizeUrl(el('workerUrl').value);
    var token=String(el('workerToken').value||'').trim();

    if(!url){
      setNotice('workerNotice','Informe a Worker URL.','errornotice');
      return;
    }
    if(!/^https:\/\//i.test(url)){
      setNotice('workerNotice','A Worker URL precisa começar com https://','errornotice');
      return;
    }
    if(!token){
      setNotice('workerNotice','Informe o token do worker.','errornotice');
      return;
    }

    button.disabled=true;
    label.innerHTML='<span class="spinner"></span>Conectando...';
    setNotice('workerNotice','Testando acesso ao worker...','');

    localStorage.setItem('botguincho_worker_url',url);
    localStorage.setItem('botguincho_worker_token',token);

    try{
      await workerHealth(url);
      setNotice('workerNotice','Worker encontrado. Validando token...','');
      await refreshAll();
      setNotice('workerNotice','Worker conectado. WhatsApp, grupos e IA estão liberados.','oknotice');
    }catch(error){
      setNotice('workerNotice','Falha na conexão: '+error.message,'errornotice');
    }finally{
      button.disabled=false;
      label.textContent='Conectar worker';
    }
  };

  window.testWorkerConnection=async function(){
    var url=normalizeUrl(el('workerUrl').value);
    var token=String(el('workerToken').value||'').trim();
    if(url) localStorage.setItem('botguincho_worker_url',url);
    if(token) localStorage.setItem('botguincho_worker_token',token);
    setNotice('workerNotice','Testando conexão...','');
    try{
      await workerHealth(url);
      await loadStatus();
      setNotice('workerNotice','Conexão testada com sucesso.','oknotice');
    }catch(error){
      setNotice('workerNotice','Teste falhou: '+error.message,'errornotice');
    }
  };

  window.disconnectWorker=function(){
    localStorage.removeItem('botguincho_worker_url');
    localStorage.removeItem('botguincho_worker_token');
    location.reload();
  };

  window.refreshWhatsapp=function(){
    loadStatus().catch(function(error){setNotice('waNotice',error.message,'errornotice')});
  };

  window.saveGroups=async function(){
    try{
      var groupIds=Array.from(document.querySelectorAll('#groupList input:checked')).map(function(x){return x.value});
      await workerApi('/api/groups',{method:'POST',body:JSON.stringify({groupIds:groupIds})});
      await Promise.all([loadGroups(),loadStatus()]);
      alert('Grupos salvos.');
    }catch(error){ alert(error.message); }
  };

  async function persistAi(){
    await workerApi('/api/settings',{method:'POST',body:JSON.stringify({
      aiEnabled:el('aiEnabled').checked,
      replyEveryMessage:el('replyEvery').checked,
      humanTakeover:el('humanTakeover').checked,
      aiModel:el('aiModel').value,
      aiInstructions:el('aiInstructions').value
    })});
  }

  window.saveAi=async function(){
    try{
      await persistAi();
      await Promise.all([loadSettings(),loadStatus()]);
      alert('Configuração salva.');
    }catch(error){ alert(error.message); }
  };

  ['aiEnabled','replyEvery','humanTakeover'].forEach(function(id){
    el(id).addEventListener('change',function(){
      persistAi().then(loadStatus).catch(function(error){alert(error.message)});
    });
  });

  async function checkPlatform(){
    try{
      var response=await fetch('/health',{cache:'no-store'});
      var data=await response.json();
      el('statusDot').className='dot '+(data.ok?'ok':'');
      el('statusText').textContent=data.ok?'Plataforma online':'Falha na plataforma';
    }catch(_){
      el('statusText').textContent='API indisponível';
    }
  }

  checkPlatform();
  if(initial.url){
    setNotice('workerNotice','Worker salvo. Tentando reconectar...','');
    refreshAll().catch(function(error){setNotice('workerNotice','Worker salvo, mas está offline: '+error.message,'errornotice')});
  }else{
    loadActivity();
  }

  setInterval(function(){
    if(savedWorker().url){
      loadStatus().catch(function(){});
      loadActivity().catch(function(){});
    }
  },7000);
})();
</script>
</body>
</html>`;

app.get('/', (_req, res) => res.type('html').send(platformHtml));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'botguincho',
    integrations: {
      googleRoutes: googleRoutes.isConfigured(),
      whatsapp: whatsapp.isConfigured(),
      whatsappSendEnabled: whatsapp.isSendEnabled(),
      gconnect: gconnect.isConfigured(),
    },
  });
});

const parseBodySchema = z.object({
  text: z.string().min(1),
  insurer: z.string().optional(),
});

app.post('/api/requests/parse', (req, res) => {
  const parsedBody = parseBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsedBody.error.flatten() });
  }
  const request = parseServiceRequest(parsedBody.data.text, parsedBody.data.insurer);
  return res.json({ request, decision: decideRequest(request) });
});

const etaTestSchema = z.object({
  origin: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  destinationAddress: z.string().min(3),
  roundToMinutes: z.number().int().positive().max(60).default(10),
});

app.post('/api/eta/test', async (req, res) => {
  const parsed = etaTestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
  }
  try {
    const route = await googleRoutes.computeEta({
      origin: parsed.data.origin,
      destinationAddress: parsed.data.destinationAddress,
    });
    const suggestedMinutes = roundEtaToOperationalMinutes(route.durationSeconds, parsed.data.roundToMinutes);
    return res.json({
      route,
      distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
      rawEtaMinutes: Number((route.durationSeconds / 60).toFixed(1)),
      suggestedEtaMinutes: suggestedMinutes,
      suggestedReply: `${suggestedMinutes} minutos ou menos`,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'route_error',
      message: error instanceof Error ? error.message : 'Erro desconhecido ao consultar Google Routes.',
    });
  }
});

const gconnectTestSchema = z.object({
  vehicleId: z.string().min(1).optional(),
});

app.post('/api/gconnect/position', async (req, res) => {
  const parsed = gconnectTestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
  }
  const vehicleId = parsed.data.vehicleId ?? process.env.GCONNECT_DEFAULT_VEHICLE ?? 'GSWOH17';
  try {
    return res.json({ vehicleId, position: await gconnect.getCurrentPosition(vehicleId) });
  } catch (error) {
    return res.status(502).json({
      error: 'gconnect_error',
      message: error instanceof Error ? error.message : 'Erro desconhecido ao consultar GConnect.',
    });
  }
});

const liveEtaSchema = z.object({
  vehicleId: z.string().min(1).optional(),
  destinationAddress: z.string().min(3),
  roundToMinutes: z.number().int().positive().max(60).default(10),
});

app.post('/api/eta/live', async (req, res) => {
  const parsed = liveEtaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', details: parsed.error.flatten() });
  }
  const vehicleId = parsed.data.vehicleId ?? process.env.GCONNECT_DEFAULT_VEHICLE ?? 'GSWOH17';
  try {
    const position = await gconnect.getCurrentPosition(vehicleId);
    const route = await googleRoutes.computeEta({
      origin: position,
      destinationAddress: parsed.data.destinationAddress,
    });
    const suggestedMinutes = roundEtaToOperationalMinutes(route.durationSeconds, parsed.data.roundToMinutes);
    return res.json({
      vehicleId,
      position,
      route,
      distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
      rawEtaMinutes: Number((route.durationSeconds / 60).toFixed(1)),
      suggestedEtaMinutes: suggestedMinutes,
      suggestedReply: `${suggestedMinutes} minutos ou menos`,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'live_eta_error',
      message: error instanceof Error ? error.message : 'Erro ao consultar posição e ETA.',
    });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`botguincho listening on port ${port}`);
});
