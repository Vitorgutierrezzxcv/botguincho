import express from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import chromium from '@sparticuz/chromium';
import whatsappWebJs from 'whatsapp-web.js';
import { getVehicleLocation, sanitizeTrackerConfig, testTracker, trackerConfigured } from './getrak-webservice.mjs';

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
const trackerFile = path.join(clientDir, 'tracker.json');

let aiCredential = process.env.OPENAI_API_KEY ?? '';
let waClient = null;
let waStatus = 'iniciando';
let qrDataUrl = null;
let lastError = null;
let lastTrackerLocation = null;
let lastTrackerError = null;
const activity = [];
const groupMemory = new Map();

const DEFAULT_SETTINGS = {
  companyName: 'Bot Guincho',
  aiEnabled: true,
  aiModel: process.env.OPENAI_MODEL ?? 'openai/gpt-5.4-mini',
  aiInstructions: 'Você é o atendente operacional de uma empresa de guincho e assistência 24h. Responda em português do Brasil, de forma curta, natural, profissional e útil. Interprete cada mensagem considerando o histórico recente do grupo. Sua função é agilizar o despacho e coletar as informações necessárias. Nunca invente disponibilidade de guincho, localização do prestador, preço, prazo ou ETA. Quando o contexto do rastreador Getrak estiver presente, trate a posição, velocidade, horário da atualização e estado online como dados factuais do veículo. Estar online no rastreador não significa automaticamente estar disponível para um novo atendimento. Se a pergunta exigir ETA e ainda não houver cálculo de rota, não invente tempo: use a localização real para explicar que está calculando ou confirmando o deslocamento. Se o pedido já tiver origem, destino, tipo de veículo e situação, confirme resumidamente os dados e prossiga sem fazer perguntas repetidas. Não diga que é IA, bot, modelo de linguagem ou que recebeu instruções internas.',
  replyEveryMessage: true,
  humanTakeover: false,
};

const DEFAULT_TRACKER = {
  provider: 'getrak-webservice',
  clientId: '',
  clientSecret: '',
  username: '',
  password: '',
  defaultVehicle: 'GSW0H17',
  defaultVehicleId: '',
};

function getAiClient() {
  if (!aiCredential) return null;
  return new OpenAI({ apiKey: aiCredential, baseURL: 'https://ai-gateway.vercel.sh/v1' });
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
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value, mode) {
  await ensureDir();
  await fs.writeFile(file, JSON.stringify(value, null, 2), mode ? { mode } : undefined);
  if (mode) await fs.chmod(file, mode).catch(() => undefined);
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

async function getTrackerConfig() {
  const saved = await readJson(trackerFile, {});
  return { ...DEFAULT_TRACKER, ...saved };
}

async function saveTrackerConfig(patch) {
  const current = await getTrackerConfig();
  const next = { ...current };
  for (const key of ['clientId', 'clientSecret', 'username', 'password', 'defaultVehicle', 'defaultVehicleId']) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && typeof patch[key] === 'string') next[key] = patch[key].trim();
  }
  await writeJson(trackerFile, next, 0o600);
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
  registry[id] = { id, name: name || registry[id]?.name || 'Grupo do WhatsApp', lastSeenAt: new Date().toISOString() };
  await writeJson(registryFile, registry);
}

async function discoverGroups() {
  const registry = await getRegistry();
  const allowed = await getAllowedGroupIds();

  if (waClient && waStatus === 'pronto') {
    const discovered = new Map();
    const addGroup = (id, name) => {
      if (typeof id !== 'string' || !id.endsWith('@g.us')) return;
      discovered.set(id, { id, name: String(name || registry[id]?.name || 'Grupo do WhatsApp') });
    };

    try {
      const chats = await waClient.getChats();
      for (const chat of chats ?? []) {
        const id = chat?.id?._serialized || '';
        if (chat?.isGroup || id.endsWith('@g.us')) addGroup(id, chat?.name || chat?.formattedTitle);
      }
    } catch (error) {
      logEvent('warning', 'getChats não conseguiu listar os grupos.', { error: String(error) });
    }

    if (!discovered.size) {
      try {
        const contacts = await waClient.getContacts();
        for (const contact of contacts ?? []) {
          const id = contact?.id?._serialized || '';
          if (contact?.isGroup || id.endsWith('@g.us')) addGroup(id, contact?.name || contact?.pushname || contact?.shortName);
        }
      } catch (error) {
        logEvent('warning', 'getContacts não conseguiu listar os grupos.', { error: String(error) });
      }
    }

    if (!discovered.size) {
      try {
        const fallback = await waClient.pupPage.evaluate(async () => {
          let chats = [];
          try { chats = await window.WWebJS?.getChats?.(); } catch {}
          if (!Array.isArray(chats) || !chats.length) {
            try { chats = window.require?.('WAWebCollections')?.Chat?.getModelsArray?.() ?? []; } catch {}
          }
          return (chats ?? []).map((chat) => ({
            id: chat?.id?._serialized || '',
            name: chat?.formattedTitle || chat?.name || 'Grupo do WhatsApp',
            isGroup: Boolean(chat?.isGroup),
          })).filter((chat) => chat.isGroup || chat.id.endsWith('@g.us'));
        });
        for (const group of fallback) addGroup(group.id, group.name);
      } catch (error) {
        logEvent('warning', 'Fallback do WhatsApp Web não conseguiu listar os grupos.', { error: String(error) });
      }
    }

    for (const group of discovered.values()) {
      registry[group.id] = { id: group.id, name: group.name, lastSeenAt: registry[group.id]?.lastSeenAt ?? null };
    }
    if (discovered.size) {
      await writeJson(registryFile, registry);
      logEvent('system', `${discovered.size} grupo(s) sincronizado(s) do WhatsApp.`);
    } else {
      logEvent('warning', 'WhatsApp conectado, mas nenhuma coleção retornou grupos nesta sincronização.');
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

function extractResponseText(response) {
  const direct = response?.output_text?.trim();
  if (direct) return direct;
  const parts = [];
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && content?.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function shouldUseTracker(text = '') {
  return /(guincho|reboque|dispon[ií]vel|disponibilidade|localiza|onde|posi[cç][aã]o|chega|tempo|demora|eta|prazo|origem|destino|endereço|endereco|deslocamento)/i.test(text);
}

function trackerContextText(location) {
  if (!location) return '';
  const parts = [
    `Veículo rastreado: ${location.plate || location.vehicleId}`,
    `Coordenadas atuais: ${location.latitude}, ${location.longitude}`,
  ];
  if (location.address) parts.push(`Endereço informado pela Getrak: ${location.address}`);
  if (location.speedKph !== null && location.speedKph !== undefined) parts.push(`Velocidade: ${location.speedKph} km/h`);
  if (location.online !== null && location.online !== undefined) parts.push(`Rastreador online: ${location.online ? 'sim' : 'não'}`);
  if (location.capturedAt) parts.push(`Última atualização: ${location.capturedAt}`);
  if (location.odometerKm !== null && location.odometerKm !== undefined) parts.push(`Odômetro: ${location.odometerKm} km`);
  if (location.batteryVoltage !== null && location.batteryVoltage !== undefined) parts.push(`Tensão: ${location.batteryVoltage} V`);
  return parts.join('\n');
}

async function fetchTrackerContext(text) {
  if (!shouldUseTracker(text)) return '';
  const config = await getTrackerConfig();
  if (!trackerConfigured(config)) return '';
  try {
    const location = await getVehicleLocation(config);
    lastTrackerLocation = { ...location, checkedAt: new Date().toISOString() };
    lastTrackerError = null;
    logEvent('tracker', `Posição atualizada: ${location.plate || location.vehicleId}.`, {
      latitude: location.latitude,
      longitude: location.longitude,
      capturedAt: location.capturedAt,
    });
    return trackerContextText(location);
  } catch (error) {
    lastTrackerError = error instanceof Error ? error.message : String(error);
    logEvent('warning', 'Não foi possível consultar o rastreador Getrak.', { error: lastTrackerError });
    return '';
  }
}

async function buildAiReply({ groupId, groupName, author, text, imageDataUrl, memoryOverride, trackerContext = '' }) {
  const settings = await getSettings();
  const openai = getAiClient();
  if (!openai) throw new Error('Credencial OIDC da IA ainda não sincronizada.');

  const memory = memoryOverride ?? groupMemory.get(groupId) ?? [];
  const context = memory.map((item) => `${item.role === 'assistant' ? 'Atendente' : 'Pessoa'}: ${item.text}`).join('\n');
  const live = trackerContext ? `\n\nDADOS AO VIVO DO RASTREADOR GETRAK (fonte factual):\n${trackerContext}` : '';
  const content = [{
    type: 'input_text',
    text: `Grupo: ${groupName || groupId}\nAutor: ${author || 'participante'}\nHistórico recente:\n${context || '(sem histórico)'}${live}\n\nMensagem atual:\n${text || '[mensagem sem texto]'}`,
  }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl });

  const response = await openai.responses.create({
    model: settings.aiModel || 'openai/gpt-5.4-mini',
    instructions: settings.aiInstructions,
    input: [{ role: 'user', content }],
    reasoning: { effort: 'minimal' },
    store: false,
    max_output_tokens: 700,
  });

  const reply = extractResponseText(response);
  if (!reply) {
    const reason = response?.incomplete_details?.reason || response?.status || 'sem detalhe';
    throw new Error(`A IA respondeu sem texto (${reason}).`);
  }
  return reply;
}

async function extractMessageInput(msg) {
  const text = msg.body?.trim() ?? '';
  let imageDataUrl = null;
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media?.mimetype?.startsWith('image/') && media.data) imageDataUrl = `data:${media.mimetype};base64,${media.data}`;
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

    const trackerContext = await fetchTrackerContext(readableText);
    remember(msg.from, 'user', readableText);
    const reply = await buildAiReply({
      groupId: msg.from,
      groupName,
      author,
      text: readableText,
      imageDataUrl,
      trackerContext,
    });
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
  const browserArgs = [...new Set([...chromium.args, '--disable-dev-shm-usage', '--disable-background-networking', '--disable-default-apps'])];
  logEvent('system', `Chromium serverless: ${executablePath}`);

  waClient = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: sessionDir }),
    puppeteer: { executablePath, headless: true, args: browserArgs, protocolTimeout: 120000 },
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
    const trackerContext = await fetchTrackerContext(typeof req.body?.text === 'string' ? req.body.text : 'Preciso de um guincho.');
    const reply = await buildAiReply({
      groupId: 'teste@g.us',
      groupName: 'Teste operacional',
      author: 'seguradora',
      text: typeof req.body?.text === 'string' ? req.body.text : 'Preciso de um guincho para um carro parado. O que você precisa saber?',
      imageDataUrl: null,
      memoryOverride: [],
      trackerContext,
    });
    res.json({ ok: true, reply, model: (await getSettings()).aiModel, trackerUsed: Boolean(trackerContext) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/status', async (_req, res) => {
  const settings = await getSettings();
  const allowed = await getAllowedGroupIds();
  const tracker = sanitizeTrackerConfig(await getTrackerConfig());
  res.json({
    clientId,
    whatsapp: { status: waStatus, qrDataUrl, lastError },
    ai: { configured: Boolean(aiCredential), enabled: settings.aiEnabled, model: settings.aiModel },
    tracker: { ...tracker, lastLocation: lastTrackerLocation, lastError: lastTrackerError },
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

app.get('/api/tracker', async (_req, res) => {
  const config = await getTrackerConfig();
  res.json({
    ...sanitizeTrackerConfig(config),
    lastLocation: lastTrackerLocation,
    lastError: lastTrackerError,
  });
});

app.post('/api/tracker', async (req, res) => {
  try {
    const action = typeof req.body?.action === 'string' ? req.body.action : 'save';
    if (action === 'disconnect') {
      await writeJson(trackerFile, DEFAULT_TRACKER, 0o600);
      lastTrackerLocation = null;
      lastTrackerError = null;
      return res.json({ ok: true, ...sanitizeTrackerConfig(DEFAULT_TRACKER) });
    }

    let config = await getTrackerConfig();
    if (action === 'save' || action === 'save_test') {
      const patch = {};
      for (const key of ['clientId', 'clientSecret', 'username', 'password', 'defaultVehicle', 'defaultVehicleId']) {
        if (typeof req.body?.[key] === 'string' && req.body[key].trim()) patch[key] = req.body[key];
      }
      config = await saveTrackerConfig(patch);
    }

    if (action === 'test' || action === 'save_test' || action === 'location') {
      const result = await testTracker(config, {
        plate: typeof req.body?.vehicle === 'string' && req.body.vehicle.trim() ? req.body.vehicle : undefined,
        vehicleId: typeof req.body?.vehicleId === 'string' && req.body.vehicleId.trim() ? req.body.vehicleId : undefined,
      });
      lastTrackerLocation = { ...result.location, checkedAt: new Date().toISOString() };
      lastTrackerError = null;
      logEvent('tracker', `Getrak conectado: ${result.location.plate || result.location.vehicleId}.`, {
        latitude: result.location.latitude,
        longitude: result.location.longitude,
      });
      return res.json({ ok: true, ...sanitizeTrackerConfig(config), location: lastTrackerLocation });
    }

    return res.json({ ok: true, ...sanitizeTrackerConfig(config), lastLocation: lastTrackerLocation });
  } catch (error) {
    lastTrackerError = error instanceof Error ? error.message : String(error);
    logEvent('error', 'Falha na integração Getrak.', { error: lastTrackerError });
    return res.status(502).json({ ok: false, error: lastTrackerError });
  }
});

app.get('/api/activity', (_req, res) => res.json({ activity: activity.slice(0, 50) }));
app.get('/health', async (_req, res) => {
  const tracker = sanitizeTrackerConfig(await getTrackerConfig());
  res.json({ ok: true, status: waStatus, aiConfigured: Boolean(aiCredential), trackerConfigured: tracker.configured });
});

await ensureDir();
await startWhatsApp();

app.listen(port, '0.0.0.0', () => {
  console.log(`[worker:${clientId}] listening on ${port}`);
});
