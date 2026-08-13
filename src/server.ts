import express from 'express';
import { z } from 'zod';
import { parseServiceRequest } from './domain/parser.js';
import { decideRequest } from './domain/decision.js';
import { GConnectBrowserProvider } from './integrations/gconnectBrowser.js';
import { GoogleRoutesClient, roundEtaToOperationalMinutes } from './integrations/googleRoutes.js';
import { WhatsAppCloudClient } from './integrations/whatsapp.js';

const app = express();
app.use(express.json());

const googleRoutes = new GoogleRoutesClient();
const whatsapp = new WhatsAppCloudClient();
const gconnect = new GConnectBrowserProvider();

const platformHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bot Guincho</title>
  <style>
    :root{--bg:#07111f;--panel:#0d1b2d;--panel2:#11243b;--line:#203651;--text:#f6fbff;--muted:#8fa6bf;--brand:#2ee59d;--danger:#ff6b6b;--warning:#ffd166}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 0,#15314a 0,transparent 30%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.layout{min-height:100vh;display:grid;grid-template-columns:250px 1fr}.sidebar{border-right:1px solid var(--line);padding:26px 18px;background:rgba(7,17,31,.82);position:sticky;top:0;height:100vh}.logo{display:flex;gap:12px;align-items:center;padding:0 8px 28px}.logo-mark{width:42px;height:42px;border-radius:13px;background:linear-gradient(145deg,var(--brand),#18b981);display:grid;place-items:center;color:#042719;font-weight:950}.logo small,.muted{color:var(--muted)}nav{display:grid;gap:7px}.nav{border:0;text-align:left;color:var(--muted);background:transparent;padding:12px 13px;border-radius:12px;font-weight:700;cursor:pointer}.nav.active,.nav:hover{background:#11243b;color:#fff}.main{padding:34px;max-width:1280px;width:100%;margin:0 auto}.top{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:26px}.top h1{margin:0;font-size:28px}.top p{margin:6px 0 0;color:var(--muted)}.status{display:flex;align-items:center;gap:9px;padding:9px 13px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}.dot{width:9px;height:9px;border-radius:50%;background:var(--warning)}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card,.section{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:18px;padding:20px}.metric{font-size:27px;font-weight:900;margin:12px 0}.section{margin-top:18px;padding:24px}.section h2{margin:0 0 8px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.btn{border:0;border-radius:12px;padding:11px 15px;font-weight:800;cursor:pointer}.btn.primary{background:var(--brand);color:#042719}.btn.secondary{background:#19304a;color:#fff;border:1px solid var(--line)}.notice{padding:14px;border-radius:12px;background:#17283a;color:var(--warning);margin-top:14px}.tabs{display:none}.tab-panel{display:none}.tab-panel.active{display:block}.list{display:grid;gap:10px;margin-top:16px}.row{display:flex;align-items:center;justify-content:space-between;padding:14px;border:1px solid var(--line);border-radius:12px;background:#0a1727}.badge{font-size:12px;padding:5px 9px;border-radius:999px;background:#17344a;color:#9fd8ff}.input,textarea{width:100%;background:#081524;color:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:8px}textarea{min-height:140px;resize:vertical}.qr{width:220px;height:220px;border:1px dashed #35506d;border-radius:18px;display:grid;place-items:center;color:var(--muted);margin-top:18px;background:#fff0}.hidden{display:none}@media(max-width:900px){.layout{grid-template-columns:1fr}.sidebar{height:auto;position:relative;border-right:0;border-bottom:1px solid var(--line)}nav{grid-template-columns:repeat(4,1fr)}.grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.grid{grid-template-columns:1fr}.main{padding:20px}nav{grid-template-columns:1fr 1fr}.top{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="logo"><div class="logo-mark">BG</div><div><strong>Bot Guincho</strong><small>Central operacional</small></div></div>
    <nav>
      <button class="nav active" data-tab="overview">Visão geral</button>
      <button class="nav" data-tab="whatsapp">WhatsApp</button>
      <button class="nav" data-tab="groups">Grupos</button>
      <button class="nav" data-tab="ai">Inteligência</button>
    </nav>
  </aside>
  <main class="main">
    <div class="top"><div><h1>Central operacional</h1><p>Configure e acompanhe a automação do atendimento.</p></div><div class="status"><span class="dot" id="dot"></span><span id="statusText">Verificando...</span></div></div>

    <section class="tab-panel active" id="overview">
      <div class="grid">
        <div class="card"><b>Plataforma</b><div class="metric" id="platformMetric">Online</div><div class="muted">Vercel + API</div></div>
        <div class="card"><b>WhatsApp</b><div class="metric" id="waMetric">Worker</div><div class="muted">Sessão persistente</div></div>
        <div class="card"><b>Grupos</b><div class="metric" id="groupsMetric">—</div><div class="muted">Selecionados</div></div>
        <div class="card"><b>IA</b><div class="metric" id="aiMetric">—</div><div class="muted">Resposta automática</div></div>
      </div>
      <div class="section"><h2>Operação</h2><p class="muted">O painel está publicado. O WhatsApp Web é mantido em um worker persistente para não perder a sessão do cliente.</p><div class="notice" id="workerNotice">Conectando ao worker...</div></div>
    </section>

    <section class="tab-panel" id="whatsapp">
      <div class="section"><h2>WhatsApp Web</h2><p class="muted">Escaneie o QR Code pelo WhatsApp em Aparelhos conectados.</p><div class="qr" id="qrBox">Aguardando worker</div><div class="actions"><button class="btn secondary" onclick="refreshWorker()">Atualizar status</button></div><div class="notice" id="waNotice">Aguardando conexão com o worker persistente.</div></div>
    </section>

    <section class="tab-panel" id="groups">
      <div class="section"><h2>Grupos autorizados</h2><p class="muted">O bot só responde nos grupos selecionados.</p><div class="list" id="groupList"><div class="row"><span>Aguardando sincronização do WhatsApp</span><span class="badge">Worker</span></div></div><div class="actions"><button class="btn primary" id="saveGroups">Salvar grupos</button><button class="btn secondary" onclick="refreshWorker()">Atualizar grupos</button></div></div>
    </section>

    <section class="tab-panel" id="ai">
      <div class="section"><h2>Inteligência artificial</h2><p class="muted">Defina como o atendente automático deve interpretar e responder as mensagens.</p><label><input type="checkbox" id="aiEnabled"> Ativar respostas automáticas</label><label><div class="muted" style="margin-top:18px">Instruções do atendente</div><textarea id="aiInstructions">Você é o atendente operacional de uma empresa de guincho e assistência 24h. Responda em português do Brasil, de forma curta, natural e profissional. Nunca invente disponibilidade, localização, preço ou ETA.</textarea></label><div class="actions"><button class="btn primary" id="saveAi">Salvar configuração</button></div><div class="notice" id="aiNotice">A configuração da IA é executada no worker persistente.</div></div>
    </section>
  </main>
</div>
<script>
const workerBase = window.BOTGUINCHO_WORKER_URL || '';
const navButtons=[...document.querySelectorAll('.nav')];
navButtons.forEach(btn=>btn.addEventListener('click',()=>{navButtons.forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));document.getElementById(btn.dataset.tab).classList.add('active')}));
async function checkHealth(){try{const r=await fetch('/health',{cache:'no-store'});const d=await r.json();document.getElementById('statusText').textContent=d.ok?'Plataforma online':'Falha na API';document.getElementById('dot').style.background=d.ok?'#2ee59d':'#ff6b6b'}catch(e){document.getElementById('statusText').textContent='API indisponível';document.getElementById('dot').style.background='#ff6b6b'}}
async function refreshWorker(){if(!workerBase){document.getElementById('workerNotice').textContent='Frontend publicado. O endpoint público do worker ainda não foi configurado.';document.getElementById('waNotice').textContent='O WhatsApp continua rodando no servidor persistente; falta apenas expor o endpoint do worker para este painel.';return}try{const r=await fetch(workerBase+'/api/status');const d=await r.json();document.getElementById('waMetric').textContent=d.whatsapp?.status||'Offline';document.getElementById('groupsMetric').textContent=d.groupsSelected??0;document.getElementById('aiMetric').textContent=d.ai?.enabled?'Ativa':'Pausada';document.getElementById('workerNotice').textContent='Worker conectado com sucesso.';if(d.whatsapp?.qrDataUrl)document.getElementById('qrBox').innerHTML='<img src="'+d.whatsapp.qrDataUrl+'" style="max-width:100%;border-radius:12px">'}catch(e){document.getElementById('workerNotice').textContent='Não foi possível alcançar o worker persistente.'}}
checkHealth();refreshWorker();setInterval(checkHealth,30000);
</script>
</body>
</html>`;

app.get('/', (_req, res) => {
  res.type('html').send(platformHtml);
});

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
  const decision = decideRequest(request);
  return res.json({ request, decision });
});

const etaTestSchema = z.object({
  origin: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
  destinationAddress: z.string().min(3),
  roundToMinutes: z.number().int().positive().max(60).default(10),
});

app.post('/api/eta/test', async (req, res) => {
  const parsedBody = etaTestSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: 'invalid_request', details: parsedBody.error.flatten() });
  try {
    const route = await googleRoutes.computeEta({ origin: parsedBody.data.origin, destinationAddress: parsedBody.data.destinationAddress });
    const rawMinutes = route.durationSeconds / 60;
    const suggestedMinutes = roundEtaToOperationalMinutes(route.durationSeconds, parsedBody.data.roundToMinutes);
    return res.json({ route, distanceKm: Number((route.distanceMeters / 1000).toFixed(1)), rawEtaMinutes: Number(rawMinutes.toFixed(1)), suggestedEtaMinutes: suggestedMinutes, suggestedReply: `${suggestedMinutes} minutos ou menos` });
  } catch (error) {
    return res.status(502).json({ error: 'route_error', message: error instanceof Error ? error.message : 'Erro desconhecido ao consultar Google Routes.' });
  }
});

const gconnectTestSchema = z.object({ vehicleId: z.string().min(1).optional() });
app.post('/api/gconnect/position', async (req, res) => {
  const parsedBody = gconnectTestSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) return res.status(400).json({ error: 'invalid_request', details: parsedBody.error.flatten() });
  const vehicleId = parsedBody.data.vehicleId ?? process.env.GCONNECT_DEFAULT_VEHICLE ?? 'GSWOH17';
  try {
    const position = await gconnect.getCurrentPosition(vehicleId);
    return res.json({ vehicleId, position });
  } catch (error) {
    return res.status(502).json({ error: 'gconnect_error', message: error instanceof Error ? error.message : 'Erro desconhecido ao consultar GConnect.' });
  }
});

const liveEtaSchema = z.object({ vehicleId: z.string().min(1).optional(), destinationAddress: z.string().min(3), roundToMinutes: z.number().int().positive().max(60).default(10) });
app.post('/api/eta/live', async (req, res) => {
  const parsedBody = liveEtaSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: 'invalid_request', details: parsedBody.error.flatten() });
  const vehicleId = parsedBody.data.vehicleId ?? process.env.GCONNECT_DEFAULT_VEHICLE ?? 'GSWOH17';
  try {
    const position = await gconnect.getCurrentPosition(vehicleId);
    const route = await googleRoutes.computeEta({ origin: position, destinationAddress: parsedBody.data.destinationAddress });
    const rawMinutes = route.durationSeconds / 60;
    const suggestedMinutes = roundEtaToOperationalMinutes(route.durationSeconds, parsedBody.data.roundToMinutes);
    return res.json({ vehicleId, position, route, distanceKm: Number((route.distanceMeters / 1000).toFixed(1)), rawEtaMinutes: Number(rawMinutes.toFixed(1)), suggestedEtaMinutes: suggestedMinutes, suggestedReply: `${suggestedMinutes} minutos ou menos` });
  } catch (error) {
    return res.status(502).json({ error: 'live_eta_error', message: error instanceof Error ? error.message : 'Erro ao consultar posição e ETA.' });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, '0.0.0.0', () => {
  console.log(`botguincho listening on port ${port}`);
});
