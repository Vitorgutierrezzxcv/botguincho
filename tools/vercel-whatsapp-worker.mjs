import express from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import chromium from '@sparticuz/chromium';
import whatsappWebJs from 'whatsapp-web.js';

const { Client, LocalAuth } = whatsappWebJs;

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));

const port = Number(process.env.BOTGUINCHO_PLATFORM_PORT ?? 3001);
const clientId = process.env.WHATSAPP_CLIENT_ID ?? 'cliente-teste';
const dataDir = process.env.BOTGUINCHO_DATA_DIR ?? path.join(os.homedir(), '.botguincho-data');
const clientDir = path.join(dataDir, clientId);
const sessionDir = path.join(clientDir, 'whatsapp-session');
const settingsFile = path.join(clientDir, 'settings.json');
const groupsFile = path.join(clientDir, 'groups.json');
const registryFile = path.join(clientDir, 'group-registry.json');

let aiCredential = process.env.OPENAI_API_KEY ?? '';
let waClient = null;
let waStatus = 'iniciando';
let qrDataUrl = null;
let lastError = null;
const activity = [];
const groupMemory = new Map();

const DEFAULT_SETTINGS = {
  companyName: 'Bot Guincho',
  aiEnabled: true,
  aiModel: process.env.OPENAI_MODEL ?? 'openai/gpt-5-mini',
  aiInstructions: 'Você é o atendente operacional de uma empresa de guincho e assistência 24h. Responda em português do Brasil, de forma curta, natural, profissional e útil. Interprete cada mensagem considerando o histórico recente do grupo. Sua função é agilizar o despacho e coletar as informações necessárias. Nunca invente disponibilidade de guincho, localização do prestador, preço, prazo ou ETA. Enquanto a integração GConnect não estiver disponível, quando a resposta depender de disponibilidade, posição ou ETA, diga de forma natural que está verificando e peça somente a informação que realmente estiver faltando. Se o pedido já tiver origem, destino, tipo de veículo e situação, confirme resumidamente os dados e prossiga sem fazer perguntas repetidas. Não diga que é IA, bot, modelo de linguagem ou que recebeu instruções internas.',
  replyEveryMessage: true,
  humanTakeover: false,
};

function getAiClient() {
  if (!aiCredential) return null;
  return new OpenAI({
    apiKey: aiCredential,
    baseURL: 'https://ai-gateway.vercel.sh/v1',
  });
}

function logEvent(type, message, meta = {}) {
  activity.unshift({ id: Date.now() + Math.random(), at: new Date().toISOString(), type, message, meta });
  if (activity.length > 100) activity.length = 100;
  console.log(`[worker:${clientId}] ${type}: ${message}`);
}

async function ensureDir() {
  await fs.mkdir(clientDir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await ensureDir();
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function getSettings() {
  const saved = await readJson(settingsFile, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await writeJson(settingsFile, next);
  return next;
}

async function getAllowedGroupIds() {
  const data = await readJson(groupsFile, { groupIds: [] });
  return new Set(Array.isArray(data.groupIds) ? data.groupIds : []);
}

async function setAllowedGroupIds(groupIds) {
  const unique = [...new Set(groupIds.filter((id) => typeof id === 'string' && id.endsWith('@g.us')))];
  await writeJson(groupsFile, { groupIds: unique });
  return unique;
}

async function getRegistry() {
  return readJson(registryFile, {});
}

async function registerGroup(id, name = '') {
  if (!id?.endsWith('@g.us')) return;
  const registry = await getRegistry();
  registry[id] = {
    id,
    name: name || registry[id]?.name || 'Grupo do WhatsApp',
    lastSeenAt: new Date().toISOString(),
  };
  await writeJson(registryFile, registry);
}

async function discoverGroups() {
  const registry = await getRegistry();
  const allowed = await getAllowedGroupIds();

  if (waClient && waStatus === 'pronto') {
    try {
      const discovered = await waClient.pupPage.evaluate(() => {
        const chats = window.Store?.Chat?.getModelsArray?.() ?? [];
        return chats
          .filter((chat) => chat?.id?._serialized?.endsWith('@g.us'))
          .map((chat) => ({
            id: chat.id._serialized,
            name: chat.formattedTitle || chat.name || 'Grupo do WhatsApp',
          }));
      });
      for (const group of discovered) {
        registry[group.id] = {
          id: group.id,
          name: group.name,
          lastSeenAt: registry[group.id]?.lastSeenAt ?? null,
        };
      }
      await writeJson(registryFile, registry);
    } catch (error) {
      logEvent('warning', 'Não foi possível sincronizar todos os grupos.', { error: String(error) });
    }
  }

  for (const id of allowed) {
    if (!registry[id]) registry[id] = { id, name: 'Grupo selecionado', lastSeenAt: null };
  }

  return Object.values(registry)
    .map((group) => ({ ...group, selected: allowed.has(group.id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

function remember(groupId, role, text) {
  const memory = groupMemory.get(groupId) ?? [];
  memory.push({ role, text: String(text).slice(0, 1800) });
  if (memory.length > 12) memory.splice(0, memory.length - 12);
  groupMemory.set(groupId, memory);
}

async function buildAiReply({ groupId, groupName, author, text, imageDataUrl, memoryOverride }) {
  const settings = await getSettings();
  const openai = getAiClient();
  if (!openai) throw new Error('Credencial OIDC da IA ainda não sincronizada.');

  const memory = memoryOverride ?? groupMemory.get(groupId) ?? [];
  const context = memory
    .map((item) => `${item.role === 'assistant' ? 'Atendente' : 'Pessoa'}: ${item.text}`)
    .join('\n');

  const content = [{
    type: 'input_text',
    text: `Grupo: ${groupName || groupId}\nAutor: ${author || 'participante'}\nHistórico recente:\n${context || '(sem histórico)'}\n\nMensagem atual:\n${text || '[mensagem sem texto]'}`,
  }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl });

  const response = await openai.responses.create({
    model: settings.aiModel || 'openai/gpt-5-mini',
    instructions: settings.aiInstructions,
    input: [{ role: 'user', content }],
    store: false,
    max_output_tokens: 220,
  });
  return response.output_text?.trim() || '';
}

async function extractMessageInput(msg) {
  const text = msg.body?.trim() ?? '';
  let imageDataUrl = null;
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media?.mimetype?.startsWith('image/') && media.data) {
        imageDataUrl = `data:${media.mimetype};base64,${media.data}`;
      }
    } catch (error) {
      logEvent('warning', 'Não foi possível baixar a mídia recebida.', { error: String(error) });
    }
  }
  return { text, imageDataUrl };
}

async function processIncomingMessage(msg) {
  try {
    if (msg.from === 'status@broadcast' || !msg.from?.endsWith('@g.us')) return;

    let groupName = 'Grupo do WhatsApp';
    try {
      const chat = await msg.getChat();
      groupName = chat?.name || groupName;
    } catch {}
    await registerGroup(msg.from, groupName);

    const allowed = await getAllowedGroupIds();
    if (!allowed.has(msg.from)) return;

    const settings = await getSettings();
    const { text, imageDataUrl } = await extractMessageInput(msg);
    const author = msg.author || 'participante';
    const readableText = text || (imageDataUrl ? '[imagem recebida]' : '[mídia recebida]');
    logEvent('message', `${groupName}: ${readableText}`, { groupId: msg.from, author });

    if (settings.humanTakeover) return;

    if (text.toLowerCase() === '!ping') {
      await msg.reply('PONG — Bot Guincho funcionando no grupo autorizado!');
      logEvent('reply', `Teste respondido em ${groupName}.`);
      return;
    }

    if (!settings.aiEnabled || !settings.replyEveryMessage) return;

    remember(msg.from, 'user', readableText);
    const reply = await buildAiReply({
      groupId: msg.from,
      groupName,
      author,
      text: readableText,
      imageDataUrl,
    });
    if (!reply) return;

    await msg.reply(reply);
    remember(msg.from, 'assistant', reply);
    logEvent('reply', `${groupName}: ${reply}`, { groupId: msg.from });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    logEvent('error', 'Erro ao processar mensagem.', { error: lastError });
  }
}

async function startWhatsApp() {
  if (waClient) return;
  waStatus = 'iniciando';
  lastError = null;

  chromium.setGraphicsMode = false;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath();
  const browserArgs = [...new Set([
    ...chromium.args,
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
  ])];

  logEvent('system', `Chromium serverless: ${executablePath}`);

  waClient = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: sessionDir }),
    puppeteer: {
      executablePath,
      headless: true,
      args: browserArgs,
      protocolTimeout: 120000,
    },
  });

  waClient.on('qr', async (qr) => {
    waStatus = 'qr';
    qrDataUrl = await QRCode.toDataURL(qr, { width: 420, margin: 1 });
    logEvent('whatsapp', 'QR Code gerado.');
  });
  waClient.on('authenticated', () => {
    waStatus = 'autenticado';
    qrDataUrl = null;
    logEvent('whatsapp', 'WhatsApp autenticado.');
  });
  waClient.on('ready', async () => {
    waStatus = 'pronto';
    qrDataUrl = null;
    logEvent('whatsapp', 'WhatsApp conectado e pronto.');
    try { await discoverGroups(); } catch {}
  });
  waClient.on('auth_failure', (message) => {
    waStatus = 'erro';
    lastError = String(message);
    logEvent('error', 'Falha de autenticação do WhatsApp.', { error: lastError });
  });
  waClient.on('disconnected', (reason) => {
    waStatus = 'desconectado';
    lastError = String(reason);
    logEvent('warning', 'WhatsApp desconectado.', { reason: lastError });
  });
  waClient.on('message', processIncomingMessage);

  waClient.initialize().catch((error) => {
    waStatus = 'erro';
    lastError = error instanceof Error ? error.message : String(error);
    logEvent('error', 'Falha ao iniciar WhatsApp.', { error: lastError });
  });
}

app.post('/api/internal/credential', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return res.status(400).json({ ok: false, error: 'missing_token' });
  aiCredential = token;
  return res.json({ ok: true, configured: true });
});

app.post('/api/ai-test', async (req, res) => {
  try {
    const reply = await buildAiReply({
      groupId: 'teste@g.us',
      groupName: 'Teste operacional',
      author: 'seguradora',
      text: typeof req.body?.text === 'string'
        ? req.body.text
        : 'Preciso de um guincho para um carro parado. O que você precisa saber?',
      imageDataUrl: null,
      memoryOverride: [],
    });
    res.json({ ok: true, reply, model: (await getSettings()).aiModel });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/status', async (_req, res) => {
  const settings = await getSettings();
  const allowed = await getAllowedGroupIds();
  res.json({
    clientId,
    whatsapp: { status: waStatus, qrDataUrl, lastError },
    ai: {
      configured: Boolean(aiCredential),
      enabled: settings.aiEnabled,
      model: settings.aiModel,
    },
    groupsSelected: allowed.size,
  });
});

app.get('/api/groups', async (_req, res) => {
  try { res.json({ groups: await discoverGroups() }); }
  catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.post('/api/groups', async (req, res) => {
  const groupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds : [];
  res.json({ ok: true, groupIds: await setAllowedGroupIds(groupIds) });
});

app.get('/api/settings', async (_req, res) => {
  res.json({ ...await getSettings(), apiKeyConfigured: Boolean(aiCredential) });
});

app.post('/api/settings', async (req, res) => {
  const patch = {
    companyName: typeof req.body?.companyName === 'string' ? req.body.companyName.slice(0, 100) : undefined,
    aiEnabled: req.body?.aiEnabled !== false,
    aiModel: typeof req.body?.aiModel === 'string' ? req.body.aiModel.slice(0, 80) : undefined,
    aiInstructions: typeof req.body?.aiInstructions === 'string' ? req.body.aiInstructions.slice(0, 8000) : undefined,
    replyEveryMessage: req.body?.replyEveryMessage !== false,
    humanTakeover: Boolean(req.body?.humanTakeover),
  };
  Object.keys(patch).forEach((key) => patch[key] === undefined && delete patch[key]);
  res.json({ ok: true, settings: await saveSettings(patch) });
});

app.get('/api/activity', (_req, res) => res.json({ activity: activity.slice(0, 50) }));
app.get('/health', (_req, res) => res.json({ ok: true, status: waStatus, aiConfigured: Boolean(aiCredential) }));

await ensureDir();
await startWhatsApp();

app.listen(port, '0.0.0.0', () => {
  console.log(`[worker:${clientId}] listening on ${port}`);
});
