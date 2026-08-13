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

let status = 'iniciando';
let qrDataUrl = null;
let client = null;
let lastError = null;

async function getAllowed() {
  try {
    const raw = await fs.readFile(configFile, 'utf8');
    return new Set(JSON.parse(raw).groupIds || []);
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set();
    throw error;
  }
}

async function saveAllowed(groupIds) {
  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify({ groupIds: [...new Set(groupIds)] }, null, 2));
}

async function listGroups() {
  if (!client || status !== 'pronto') return [];
  const allowed = await getAllowed();
  const chats = await client.getChats();
  return chats
    .filter((chat) => chat?.id?._serialized?.endsWith('@g.us') || chat.isGroup)
    .map((chat) => ({
      id: chat.id._serialized,
      name: chat.name || 'Grupo sem nome',
      selected: allowed.has(chat.id._serialized),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function startWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: sessionDir }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  client.on('qr', async (qr) => {
    status = 'qr';
    lastError = null;
    qrDataUrl = await QRCode.toDataURL(qr, { width: 420, margin: 1 });
    console.log(`[wa-admin:${clientId}] QR gerado`);
  });

  client.on('authenticated', () => {
    status = 'autenticado';
    qrDataUrl = null;
    lastError = null;
    console.log(`[wa-admin:${clientId}] autenticado`);
  });

  client.on('ready', () => {
    status = 'pronto';
    qrDataUrl = null;
    lastError = null;
    console.log(`[wa-admin:${clientId}] pronto`);
  });

  client.on('auth_failure', (message) => {
    status = 'erro';
    lastError = String(message);
    console.error(`[wa-admin:${clientId}] falha de autenticação`, message);
  });

  client.on('disconnected', (reason) => {
    status = 'desconectado';
    lastError = String(reason);
    console.warn(`[wa-admin:${clientId}] desconectado`, reason);
  });

  client.on('message', async (msg) => {
    try {
      if (msg.from === 'status@broadcast') return;
      if (!msg.from.endsWith('@g.us')) return;
      const allowed = await getAllowed();
      if (!allowed.has(msg.from)) {
        console.log(`[wa-admin:${clientId}] ignorado grupo=${msg.from}`);
        return;
      }
      const text = msg.body?.trim() ?? '';
      console.log(`[wa-admin:${clientId}] autorizado grupo=${msg.from} texto=${text}`);
      if (text.toLowerCase() === (process.env.WHATSAPP_WEB_TEST_COMMAND ?? '!ping').toLowerCase()) {
        await msg.reply(process.env.WHATSAPP_WEB_TEST_REPLY ?? 'PONG - Bot Guincho funcionando no grupo autorizado!');
        console.log(`[wa-admin:${clientId}] resposta enviada`);
      }
    } catch (error) {
      console.error(`[wa-admin:${clientId}] erro ao processar mensagem`, error);
    }
  });

  await client.initialize();
}

app.get('/api/status', (_req, res) => {
  res.json({ status, qrDataUrl, lastError, clientId });
});

app.get('/api/groups', async (_req, res) => {
  try {
    const groups = await listGroups();
    res.json({ groups });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    let groups = req.body.groupIds ?? [];
    if (!Array.isArray(groups)) groups = [groups];
    await saveAllowed(groups);
    res.json({ ok: true, groupIds: groups });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/', async (_req, res) => {
  let groups = [];
  let groupError = null;
  if (status === 'pronto') {
    try {
      groups = await listGroups();
    } catch (error) {
      groupError = error instanceof Error ? error.message : String(error);
    }
  }

  const groupCards = groups.map((group) => `
    <label class="group-card">
      <input type="checkbox" name="groups" value="${escapeHtml(group.id)}" ${group.selected ? 'checked' : ''}>
      <span class="check"></span>
      <span class="group-copy">
        <strong>${escapeHtml(group.name)}</strong>
        <small>${escapeHtml(group.id)}</small>
      </span>
    </label>
  `).join('');

  const statusMap = {
    iniciando: ['Preparando', 'neutral'],
    qr: ['Aguardando conexão', 'warning'],
    autenticado: ['Autenticando', 'warning'],
    pronto: ['Conectado', 'success'],
    desconectado: ['Desconectado', 'danger'],
    erro: ['Erro', 'danger'],
  };
  const [statusLabel, statusClass] = statusMap[status] ?? [status, 'neutral'];

  res.send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${status === 'pronto' ? 20 : 4}">
<title>Bot Guincho • WhatsApp</title>
<style>
:root{--bg:#07111f;--panel:#0d1b2d;--panel2:#12233a;--text:#f7fbff;--muted:#8fa6bf;--line:#20344d;--brand:#2ee59d;--brand2:#16b97f;--warning:#ffcf5a;--danger:#ff6b6b;--shadow:0 24px 80px rgba(0,0,0,.35)}
*{box-sizing:border-box} body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0%,#112b43 0,transparent 36%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text)}
.shell{max-width:1040px;margin:0 auto;padding:48px 24px 80px}.top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:28px}.brand{display:flex;align-items:center;gap:14px}.logo{width:48px;height:48px;border-radius:15px;background:linear-gradient(145deg,var(--brand),#0da86f);display:grid;place-items:center;color:#042416;font-weight:900;font-size:22px;box-shadow:0 10px 30px rgba(46,229,157,.2)}.brand h1{font-size:22px;margin:0}.brand p{margin:4px 0 0;color:var(--muted);font-size:14px}.badge{display:inline-flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.03);font-size:13px}.dot{width:8px;height:8px;border-radius:50%;background:#758aa2}.badge.success .dot{background:var(--brand);box-shadow:0 0 0 5px rgba(46,229,157,.1)}.badge.warning .dot{background:var(--warning)}.badge.danger .dot{background:var(--danger)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:22px}.card{background:linear-gradient(180deg,rgba(18,35,58,.96),rgba(13,27,45,.96));border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow);overflow:hidden}.card-head{padding:26px 28px 18px;border-bottom:1px solid var(--line)}.card-head h2{margin:0 0 7px;font-size:20px}.card-head p{margin:0;color:var(--muted);line-height:1.5;font-size:14px}.content{padding:24px 28px 28px}.qr-wrap{display:flex;flex-direction:column;align-items:center;text-align:center;padding:10px 0 6px}.qr-box{background:white;padding:16px;border-radius:20px;box-shadow:0 16px 50px rgba(0,0,0,.28);margin:6px 0 20px}.qr-box img{display:block;width:min(340px,70vw);height:auto}.steps{color:var(--muted);font-size:14px;line-height:1.7;max-width:520px}.groups{display:grid;gap:10px}.group-card{position:relative;display:flex;align-items:center;gap:14px;padding:15px 16px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.025);cursor:pointer;transition:.2s}.group-card:hover{border-color:#31506f;background:rgba(255,255,255,.04)}.group-card input{position:absolute;opacity:0}.check{width:22px;height:22px;border:1px solid #40607f;border-radius:7px;flex:none;display:grid;place-items:center}.group-card input:checked + .check{background:var(--brand);border-color:var(--brand)}.group-card input:checked + .check:after{content:'✓';color:#05271a;font-weight:900}.group-copy{min-width:0}.group-copy strong{display:block;font-size:14px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.group-copy small{color:var(--muted);font-size:11px}.actions{display:flex;gap:10px;margin-top:18px}.btn{border:0;border-radius:12px;padding:12px 16px;font-weight:750;cursor:pointer}.btn-primary{background:var(--brand);color:#042416}.btn-secondary{background:#172b43;color:var(--text);border:1px solid var(--line)}.empty{padding:26px;border:1px dashed #31506f;border-radius:16px;color:var(--muted);text-align:center;line-height:1.6}.side{padding:24px}.side h3{margin:0 0 14px;font-size:16px}.metric{padding:14px 0;border-bottom:1px solid var(--line)}.metric:last-child{border-bottom:0}.metric small{display:block;color:var(--muted);margin-bottom:5px}.metric strong{font-size:14px}.notice{margin-top:16px;padding:13px 14px;border-radius:13px;background:rgba(255,207,90,.08);border:1px solid rgba(255,207,90,.2);color:#f4d985;font-size:12px;line-height:1.5}.error{margin-top:12px;color:#ff9b9b;font-size:13px}
@media(max-width:820px){.grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}.shell{padding:28px 16px 50px}}
</style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div class="brand"><div class="logo">BG</div><div><h1>Bot Guincho</h1><p>Central de conexão do WhatsApp</p></div></div>
    <div class="badge ${statusClass}"><span class="dot"></span>${escapeHtml(statusLabel)}</div>
  </div>
  <div class="grid">
    <section class="card">
      <div class="card-head">
        <h2>${status === 'pronto' ? 'Grupos monitorados' : 'Conecte o WhatsApp'}</h2>
        <p>${status === 'pronto' ? 'Selecione somente os grupos de seguradoras nos quais o bot poderá ler e responder.' : 'Use o WhatsApp do número que será operado pelo Bot Guincho.'}</p>
      </div>
      <div class="content">
        ${qrDataUrl ? `<div class="qr-wrap"><div class="qr-box"><img src="${qrDataUrl}" alt="QR Code do WhatsApp"></div><div class="steps"><strong>No celular:</strong><br>WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho</div></div>` : ''}
        ${status === 'pronto' ? `
          <form id="groups-form">
            <div class="groups">${groupCards || `<div class="empty"><strong>Nenhum grupo apareceu ainda.</strong><br>O WhatsApp pode levar alguns segundos para sincronizar as conversas. Atualize os grupos abaixo.</div>`}</div>
            <div class="actions"><button class="btn btn-primary" type="submit">Salvar grupos</button><button class="btn btn-secondary" type="button" onclick="location.reload()">Atualizar grupos</button></div>
            <div id="save-result"></div>
          </form>` : ''}
        ${lastError ? `<div class="error">${escapeHtml(lastError)}</div>` : ''}
        ${groupError ? `<div class="error">Não foi possível carregar os grupos: ${escapeHtml(groupError)}</div>` : ''}
      </div>
    </section>
    <aside class="card side">
      <h3>Configuração</h3>
      <div class="metric"><small>Cliente</small><strong>${escapeHtml(clientId)}</strong></div>
      <div class="metric"><small>Sessão</small><strong>${status === 'pronto' ? 'Ativa' : 'Aguardando'}</strong></div>
      <div class="metric"><small>Grupos encontrados</small><strong>${groups.length}</strong></div>
      <div class="metric"><small>Grupos selecionados</small><strong>${groups.filter(g => g.selected).length}</strong></div>
      <div class="notice">Por segurança, conversas individuais, Status e grupos não selecionados são ignorados pelo bot.</div>
    </aside>
  </div>
</div>
<script>
const form=document.getElementById('groups-form');
if(form){form.addEventListener('submit',async(e)=>{e.preventDefault();const groupIds=[...form.querySelectorAll('input[name="groups"]:checked')].map(i=>i.value);const box=document.getElementById('save-result');box.textContent='Salvando...';box.style.color='#8fa6bf';try{const r=await fetch('/api/groups',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({groupIds})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Falha ao salvar');box.textContent='✓ Grupos salvos com sucesso';box.style.color='#2ee59d';}catch(err){box.textContent='Erro: '+err.message;box.style.color='#ff9b9b';}})}
</script>
</body>
</html>`);
});

app.listen(port, '0.0.0.0', async () => {
  console.log(`[wa-admin:${clientId}] painel em http://localhost:${port}`);
  try {
    await startWhatsApp();
  } catch (error) {
    status = 'erro';
    lastError = error instanceof Error ? error.message : String(error);
    console.error(`[wa-admin:${clientId}] falha ao iniciar`, error);
  }
});
