import express from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import whatsappWebJs from 'whatsapp-web.js';

const { Client, LocalAuth } = whatsappWebJs;
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const port = Number(process.env.WHATSAPP_ADMIN_PORT ?? 3001);
const clientId = process.env.WHATSAPP_CLIENT_ID ?? 'cliente-teste';
const baseDir = process.env.WHATSAPP_ADMIN_DATA_DIR ?? path.join(os.homedir(), '.botguincho-wa');
const sessionDir = path.join(baseDir, 'sessions');
const configFile = path.join(baseDir, `${clientId}-groups.json`);
const discoveredFile = path.join(baseDir, `${clientId}-discovered-groups.json`);

let status = 'iniciando';
let qrDataUrl = null;
let client = null;
let lastError = null;

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

async function writeJson(file, value) {
  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function getAllowed() {
  const data = await readJson(configFile, { groupIds: [] });
  return new Set(data.groupIds || []);
}

async function saveAllowed(groupIds) {
  await writeJson(configFile, { groupIds: [...new Set(groupIds)] });
}

async function getDiscovered() {
  const data = await readJson(discoveredFile, { groups: [] });
  return Array.isArray(data.groups) ? data.groups : [];
}

async function rememberGroup(id, name = '') {
  if (!id?.endsWith('@g.us')) return;
  const groups = await getDiscovered();
  const index = groups.findIndex(g => g.id === id);
  const next = { id, name: name || groups[index]?.name || `Grupo ${id.slice(0, 8)}` };
  if (index >= 0) groups[index] = next; else groups.push(next);
  await writeJson(discoveredFile, { groups });
}

async function discoverGroupsFromStore() {
  if (!client?.pupPage || status !== 'pronto') return [];
  try {
    const groups = await client.pupPage.evaluate(() => {
      const chats = window.Store?.Chat?.getModelsArray?.() ?? [];
      return chats.map((chat) => {
        const id = chat?.id?._serialized || chat?.id?.toString?.() || '';
        const name = chat?.formattedTitle || chat?.name || chat?.contact?.name || chat?.contact?.pushname || '';
        return { id, name: String(name || '') };
      }).filter((chat) => typeof chat.id === 'string' && chat.id.endsWith('@g.us'));
    });
    for (const group of groups) await rememberGroup(group.id, group.name);
    return groups;
  } catch (error) {
    console.warn(`[wa-admin:${clientId}] descoberta direta falhou; usando grupos observados`, error?.message ?? error);
    return [];
  }
}

async function listGroups() {
  await discoverGroupsFromStore();
  const allowed = await getAllowed();
  const observed = await getDiscovered();
  for (const id of allowed) {
    if (!observed.some(g => g.id === id)) observed.push({ id, name: `Grupo ${id.slice(0, 8)}` });
  }
  return observed.map(g => ({ ...g, selected: allowed.has(g.id) }))
    .sort((a,b) => (a.name || a.id).localeCompare(b.name || b.id, 'pt-BR'));
}

function escapeHtml(value='') {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

async function startWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: sessionDir }),
    puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] },
  });

  client.on('qr', async qr => { status='qr'; lastError=null; qrDataUrl=await QRCode.toDataURL(qr,{width:420,margin:1}); console.log(`[wa-admin:${clientId}] QR gerado`); });
  client.on('authenticated', () => { status='autenticado'; qrDataUrl=null; lastError=null; console.log(`[wa-admin:${clientId}] autenticado`); });
  client.on('ready', async () => { status='pronto'; qrDataUrl=null; lastError=null; console.log(`[wa-admin:${clientId}] pronto`); await discoverGroupsFromStore(); });
  client.on('auth_failure', message => { status='erro'; lastError=String(message); console.error(`[wa-admin:${clientId}] falha de autenticação`, message); });
  client.on('disconnected', reason => { status='desconectado'; lastError=String(reason); console.warn(`[wa-admin:${clientId}] desconectado`, reason); });
  client.on('message', async msg => {
    try {
      if (msg.from === 'status@broadcast' || !msg.from.endsWith('@g.us')) return;
      await rememberGroup(msg.from);
      const allowed = await getAllowed();
      if (!allowed.has(msg.from)) { console.log(`[wa-admin:${clientId}] ignorado grupo=${msg.from}`); return; }
      const text = msg.body?.trim() ?? '';
      console.log(`[wa-admin:${clientId}] autorizado grupo=${msg.from} texto=${text}`);
      if (text.toLowerCase() === (process.env.WHATSAPP_WEB_TEST_COMMAND ?? '!ping').toLowerCase()) {
        await msg.reply(process.env.WHATSAPP_WEB_TEST_REPLY ?? 'PONG - Bot Guincho funcionando no grupo autorizado!');
        console.log(`[wa-admin:${clientId}] resposta enviada`);
      }
    } catch (error) { console.error(`[wa-admin:${clientId}] erro ao processar mensagem`, error); }
  });
  await client.initialize();
}

app.get('/api/status', (_req,res) => res.json({status,qrDataUrl,lastError,clientId}));
app.get('/api/groups', async (_req,res) => { try { res.json({groups:await listGroups()}); } catch(error){ res.status(500).json({error:error instanceof Error?error.message:String(error)}); } });
app.post('/api/groups', async (req,res) => { try { let groups=req.body.groupIds??[]; if(!Array.isArray(groups)) groups=[groups]; await saveAllowed(groups); res.json({ok:true,groupIds:groups}); } catch(error){ res.status(500).json({error:error instanceof Error?error.message:String(error)}); } });

app.get('/', async (_req,res) => {
  let groups=[]; let groupError=null;
  if(status==='pronto'){ try{ groups=await listGroups(); }catch(error){ groupError=error instanceof Error?error.message:String(error); } }
  const selectedCount=groups.filter(g=>g.selected).length;
  const cards=groups.map(g=>`<label class="group"><input type="checkbox" name="groups" value="${escapeHtml(g.id)}" ${g.selected?'checked':''}><span class="tick"></span><span><strong>${escapeHtml(g.name||'Grupo sem nome')}</strong><small>${escapeHtml(g.id)}</small></span></label>`).join('');
  const statusLabel={iniciando:'Preparando',qr:'Aguardando QR',autenticado:'Autenticando',pronto:'Conectado',desconectado:'Desconectado',erro:'Erro'}[status]||status;
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bot Guincho</title><style>
  :root{--bg:#07121e;--panel:#0d1c2c;--panel2:#13263b;--line:#203a55;--text:#f6fbff;--muted:#8ba2b8;--green:#28e39d}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% 0,#16334e,transparent 35%),var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,sans-serif}.wrap{max-width:1050px;margin:auto;padding:42px 22px 70px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}.brand{display:flex;gap:13px;align-items:center}.logo{width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,var(--green),#0ca873);display:grid;place-items:center;color:#05271a;font-weight:900}.brand h1{margin:0;font-size:22px}.brand p{margin:4px 0 0;color:var(--muted);font-size:13px}.status{padding:9px 13px;border:1px solid var(--line);border-radius:999px;background:#102238}.status:before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:${status==='pronto'?'var(--green)':'#ffcf5a'};margin-right:8px}.grid{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:20px}.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:23px;overflow:hidden;box-shadow:0 24px 70px #0005}.head{padding:25px 27px 18px;border-bottom:1px solid var(--line)}.head h2{margin:0 0 6px;font-size:20px}.head p{margin:0;color:var(--muted);font-size:14px;line-height:1.5}.content{padding:23px 27px 28px}.qr{text-align:center}.qr img{background:white;padding:14px;border-radius:18px;width:min(350px,75vw)}.groups{display:grid;gap:10px}.group{display:flex;align-items:center;gap:13px;padding:14px 15px;border:1px solid var(--line);border-radius:15px;background:#ffffff05;cursor:pointer}.group input{position:absolute;opacity:0}.tick{width:22px;height:22px;border:1px solid #456481;border-radius:7px;flex:none}.group input:checked+.tick{background:var(--green);border-color:var(--green)}.group input:checked+.tick:after{content:'✓';display:grid;place-items:center;color:#05271a;font-weight:900}.group strong{display:block;font-size:14px}.group small{display:block;color:var(--muted);font-size:11px;margin-top:4px}.actions{display:flex;gap:10px;margin-top:17px}.btn{border:0;border-radius:12px;padding:12px 16px;font-weight:800;cursor:pointer}.primary{background:var(--green);color:#042619}.secondary{background:#172d44;color:var(--text);border:1px solid var(--line)}.empty{padding:24px;border:1px dashed #365875;border-radius:15px;color:var(--muted);text-align:center;line-height:1.6}.side{padding:23px}.metric{padding:13px 0;border-bottom:1px solid var(--line)}.metric small{display:block;color:var(--muted);margin-bottom:4px}.notice{margin-top:16px;padding:13px;border:1px solid #35536d;border-radius:13px;color:#b4c6d8;background:#ffffff05;font-size:12px;line-height:1.5}.error{margin-top:12px;color:#ff9c9c}@media(max-width:820px){.grid{grid-template-columns:1fr}.top{align-items:flex-start;gap:15px;flex-direction:column}}
  </style></head><body><div class="wrap"><div class="top"><div class="brand"><div class="logo">BG</div><div><h1>Bot Guincho</h1><p>Central de automação do WhatsApp</p></div></div><div class="status">${escapeHtml(statusLabel)}</div></div><div class="grid"><section class="card"><div class="head"><h2>${status==='pronto'?'Grupos monitorados':'Conecte o WhatsApp'}</h2><p>${status==='pronto'?'Escolha exatamente os grupos em que o bot poderá ler e responder.':'Conecte o número do cliente pelo QR Code.'}</p></div><div class="content">${qrDataUrl?`<div class="qr"><img src="${qrDataUrl}" alt="QR"><p>WhatsApp → Aparelhos conectados → Conectar um aparelho</p></div>`:''}${status==='pronto'?`<form id="f"><div class="groups">${cards||'<div class="empty"><strong>Aguardando grupos.</strong><br>Envie uma mensagem em um grupo ou clique em Atualizar grupos.</div>'}</div><div class="actions"><button class="btn primary">Salvar grupos</button><button type="button" class="btn secondary" onclick="location.reload()">Atualizar grupos</button></div><div id="result"></div></form>`:''}${lastError?`<div class="error">${escapeHtml(lastError)}</div>`:''}${groupError?`<div class="error">${escapeHtml(groupError)}</div>`:''}</div></section><aside class="card side"><h3>Operação</h3><div class="metric"><small>Cliente</small><strong>${escapeHtml(clientId)}</strong></div><div class="metric"><small>Sessão</small><strong>${status==='pronto'?'Ativa':'Aguardando'}</strong></div><div class="metric"><small>Grupos encontrados</small><strong>${groups.length}</strong></div><div class="metric"><small>Selecionados</small><strong>${selectedCount}</strong></div><div class="notice">Status, conversas individuais e grupos não selecionados são ignorados.</div></aside></div></div><script>const f=document.getElementById('f');if(f)f.addEventListener('submit',async e=>{e.preventDefault();const groupIds=[...f.querySelectorAll('input[name="groups"]:checked')].map(x=>x.value);const r=document.getElementById('result');r.textContent='Salvando...';const x=await fetch('/api/groups',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({groupIds})});const j=await x.json();r.textContent=x.ok?'Grupos salvos com sucesso.':(j.error||'Erro ao salvar');r.style.marginTop='12px';r.style.color=x.ok?'#28e39d':'#ff9c9c';});</script></body></html>`);
});

app.listen(port,'0.0.0.0',async()=>{console.log(`[wa-admin:${clientId}] painel em http://127.0.0.1:${port}`);try{await startWhatsApp();}catch(error){status='erro';lastError=error instanceof Error?error.message:String(error);console.error(error);}});
