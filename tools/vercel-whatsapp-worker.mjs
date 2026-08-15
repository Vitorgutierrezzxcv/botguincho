import express from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
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
const trackerReadingFile = path.join(clientDir, 'gconnect-reading.json');
const trackerPairFile = path.join(clientDir, 'gconnect-pair-code.txt');
const dispatchStateFile = path.join(clientDir, 'dispatch-state.json');
const geocodeCacheFile = path.join(clientDir, 'geocode-cache.json');

let aiCredential = process.env.OPENAI_API_KEY ?? '';
let waClient = null;
let waStatus = 'iniciando';
let qrDataUrl = null;
let lastError = null;
let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;

const activity = [];
const groupMemory = new Map();
const sharedLocations = new Map();

const SYSTEM_AI_RULES = `
REGRAS PRIORITÁRIAS DO BOT GUINCHO:
- Responda somente ao assunto operacional da mensagem atual.
- É proibido responder "Disponível", "Confirmado" ou equivalentes quando a mensagem não estiver perguntando disponibilidade nem enviando um acionamento.
- Acionamentos, disponibilidade, localização e ETA são tratados pelo código antes de chegar até você. Não tente refazer esses fluxos.
- Não faça triagem. Não peça placa, contato, ponto de referência, segurança do local, chave, rodas, garagem, acessibilidade ou outros dados adicionais.
- Não faça listas ou checklists.
- Não termine com pergunta.
- Responda em português do Brasil, de forma natural e profissional, em no máximo duas linhas.
- Se a pessoa apenas informar uma condição operacional, como "a rua é estreita" ou "precisa caminhão menor", reconheça de forma curta, por exemplo "Entendido.".
- Nunca invente disponibilidade, localização, preço, ETA ou informação que não esteja no contexto.
- Nunca diga que é IA, bot ou modelo de linguagem.
`.trim();

const DEFAULT_SETTINGS = {
  companyName: 'Bot Guincho',
  aiEnabled: true,
  aiModel: process.env.OPENAI_MODEL ?? 'openai/gpt-5.4-mini',
  aiInstructions: 'Atenda somente mensagens operacionais relacionadas a guincho, reboque e assistência. Seja curto, direto e não faça perguntas de triagem.',
  replyEveryMessage: true,
  humanTakeover: false,
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
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
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

async function getPairCode() {
  await ensureDir();
  try {
    const code = (await fs.readFile(trackerPairFile, 'utf8')).trim().toUpperCase();
    if (/^[A-Z0-9]{8}$/.test(code)) return code;
  } catch {}
  const code = crypto.randomBytes(6).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8).padEnd(8, '7');
  await fs.writeFile(trackerPairFile, code, { mode: 0o600 });
  return code;
}

async function rotatePairCode() {
  const code = crypto.randomBytes(6).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8).padEnd(8, '9');
  await fs.writeFile(trackerPairFile, code, { mode: 0o600 });
  return code;
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanTrackerReading(value = {}) {
  const plate = String(value.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const ignitionRaw = String(value.ignition || '').toLowerCase();
  const ignition = ['on', 'off', 'no ignition'].includes(ignitionRaw) ? ignitionRaw : null;
  const text = (x, max = 500) => typeof x === 'string' ? x.trim().slice(0, max) || null : null;
  const latitude = numericOrNull(value.latitude ?? value.lat);
  const longitude = numericOrNull(value.longitude ?? value.lng ?? value.lon);

  return {
    provider: 'gconnect-emulator',
    plate,
    ignition,
    speedKph: numericOrNull(value.speedKph),
    odometerKm: numericOrNull(value.odometerKm),
    batteryVoltage: numericOrNull(value.batteryVoltage),
    latitude: latitude !== null && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: longitude !== null && longitude >= -180 && longitude <= 180 ? longitude : null,
    address: text(value.address),
    lastUpdateText: text(value.lastUpdateText, 200),
    capturedAt: text(value.capturedAt, 80) || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    agent: 'gconnect-emulator-v2',
  };
}

async function getTrackerReading() {
  return readJson(trackerReadingFile, null);
}

function trackerAgeSeconds(reading) {
  if (!reading?.receivedAt) return null;
  const ms = Date.now() - new Date(reading.receivedAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
}

function trackerSummary(reading, pairCode) {
  const ageSeconds = trackerAgeSeconds(reading);
  const connected = ageSeconds !== null && ageSeconds <= 90;
  return {
    provider: 'gconnect-emulator',
    mode: 'android-ui-automation',
    configured: connected,
    connected,
    pairCode,
    ageSeconds,
    lastLocation: reading,
    stale: reading ? !connected : false,
  };
}

async function getFreshTrackerReading() {
  const reading = await getTrackerReading();
  const age = trackerAgeSeconds(reading);
  if (!reading || age === null || age > 120) {
    if (reading) logEvent('warning', `Leitura do GConnect desatualizada (${age}s).`);
    return null;
  }
  return reading;
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
          if (contact?.isGroup || id.endsWith('@g.us')) {
            addGroup(id, contact?.name || contact?.pushname || contact?.shortName);
          }
        }
      } catch (error) {
        logEvent('warning', 'getContacts não conseguiu listar os grupos.', { error: String(error) });
      }
    }

    if (!discovered.size) {
      try {
        const fallback = await waClient.pupPage.evaluate(async () => {
          let chats = [];
          try {
            chats = await window.WWebJS?.getChats?.();
          } catch {}
          if (!Array.isArray(chats) || !chats.length) {
            try {
              chats = window.require?.('WAWebCollections')?.Chat?.getModelsArray?.() ?? [];
            } catch {}
          }
          return (chats ?? [])
            .map((chat) => ({
              id: chat?.id?._serialized || '',
              name: chat?.formattedTitle || chat?.name || 'Grupo do WhatsApp',
              isGroup: Boolean(chat?.isGroup),
            }))
            .filter((chat) => chat.isGroup || chat.id.endsWith('@g.us'));
        });
        for (const group of fallback) addGroup(group.id, group.name);
      } catch (error) {
        logEvent('warning', 'Fallback do WhatsApp Web não conseguiu listar os grupos.', { error: String(error) });
      }
    }

    for (const group of discovered.values()) {
      registry[group.id] = {
        id: group.id,
        name: group.name,
        lastSeenAt: registry[group.id]?.lastSeenAt ?? null,
      };
    }

    if (discovered.size) {
      await writeJson(registryFile, registry);
      logEvent('system', `${discovered.size} grupo(s) sincronizado(s) do WhatsApp.`);
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

function normalizeForIntent(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeDispatch(text = '') {
  const value = normalizeForIntent(text);
  const hasService = /\b(reboque|guincho|servico selecionado|assistencia 24h|remocao)\b/.test(value);
  const hasOrigin = /\borigem\s*[:\-]/.test(value);
  const hasDestination = /\bdestino\s*[:\-]/.test(value);
  const hasVehicleOrProblem = /\b(veiculo|carro|moto|pane|fiat|ford|chevrolet|volkswagen|renault|toyota|honda|hyundai|idea|gol|onix|ka)\b/.test(value);
  return (hasService && (hasOrigin || hasDestination || hasVehicleOrProblem)) || (hasOrigin && hasDestination);
}

function asksAvailability(text = '') {
  const value = normalizeForIntent(text);
  if (looksLikeDispatch(value)) return false;
  return /\b(disponivel|disponibilidade|tem guincho|tem reboque|consegue atender|pode atender|tem como atender|esta livre|ta livre)\b/.test(value);
}

function asksEta(text = '') {
  const value = normalizeForIntent(text);
  return /\b(quanto tempo|tempo de distancia|previsao de chegada|previsao|demora|eta|chega em|chegada|tempo para chegar|tempo pra chegar)\b/.test(value);
}

function asksTrackerLocation(text = '') {
  const value = normalizeForIntent(text);
  return /\b(onde esta o guincho|onde ta o guincho|localizacao do guincho|localizacao atual|posicao do guincho|posicao atual)\b/.test(value);
}

function isOperationalMessage(text = '') {
  const value = normalizeForIntent(text);
  if (!value) return false;
  if (looksLikeDispatch(value) || asksAvailability(value) || asksEta(value) || asksTrackerLocation(value)) return true;
  return /\b(guincho|reboque|pane|veiculo|carro|moto|placa|origem|destino|assistencia|seguradora|acionamento|caminhao|rota|oficina|remocao|prestador|sinistro|chamado)\b/.test(value);
}

function extractLabeledField(text = '', label = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const target = normalizeForIntent(label);
  for (const line of lines) {
    const normalized = normalizeForIntent(line);
    const match = normalized.match(new RegExp(`^${target}\\s*[:\\-]\\s*(.+)$`));
    if (!match) continue;
    const rawSeparator = line.search(/[:\-]/);
    if (rawSeparator >= 0) return line.slice(rawSeparator + 1).trim();
  }
  return null;
}

function cleanAddressQuery(value = '') {
  return String(value)
    .replace(/\bref\.?\s*:.*$/i, '')
    .replace(/\bn[º°]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .trim();
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(Number(latitude))
    && Number.isFinite(Number(longitude))
    && Number(latitude) >= -90
    && Number(latitude) <= 90
    && Number(longitude) >= -180
    && Number(longitude) <= 180;
}

function coordinatesFromLocation(location) {
  if (!location || !validCoordinates(location.latitude, location.longitude)) return null;
  return {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
  };
}

async function getDispatchStates() {
  return readJson(dispatchStateFile, {});
}

async function getDispatchState(groupId) {
  const states = await getDispatchStates();
  const state = states[groupId] ?? null;
  if (!state) return null;
  const age = Date.now() - new Date(state.updatedAt || state.createdAt || 0).getTime();
  if (!Number.isFinite(age) || age > 12 * 60 * 60 * 1000) return null;
  return state;
}

async function setDispatchState(groupId, patch = {}) {
  const states = await getDispatchStates();
  const previous = states[groupId] ?? {};
  states[groupId] = {
    ...previous,
    ...patch,
    createdAt: previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJson(dispatchStateFile, states, 0o600);
  return states[groupId];
}

async function getGeocodeCache() {
  return readJson(geocodeCacheFile, {});
}

async function saveGeocodeCache(cache) {
  const entries = Object.entries(cache);
  if (entries.length > 500) {
    entries.sort((a, b) => new Date(b[1]?.cachedAt || 0) - new Date(a[1]?.cachedAt || 0));
    cache = Object.fromEntries(entries.slice(0, 400));
  }
  await writeJson(geocodeCacheFile, cache, 0o600);
}

function geocodeCacheKey(address) {
  return normalizeForIntent(cleanAddressQuery(address));
}

async function scheduleNominatim(task) {
  const run = nominatimQueue.then(async () => {
    const waitMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastNominatimRequestAt = Date.now();
    return task();
  });
  nominatimQueue = run.catch(() => undefined);
  return run;
}

async function geocodeAddress(address) {
  const query = cleanAddressQuery(address);
  if (!query) return null;

  const key = geocodeCacheKey(query);
  const cache = await getGeocodeCache();
  const cached = cache[key];
  const cachedAge = cached?.cachedAt ? Date.now() - new Date(cached.cachedAt).getTime() : Infinity;
  if (cached && cachedAge < 90 * 24 * 60 * 60 * 1000 && validCoordinates(cached.latitude, cached.longitude)) {
    return { latitude: Number(cached.latitude), longitude: Number(cached.longitude), displayName: cached.displayName || query };
  }

  return scheduleNominatim(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', `${query}, Brasil`);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('addressdetails', '0');

    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/1.0 (+https://botguincho.vercel.app/)',
        referer: 'https://botguincho.vercel.app/',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!response.ok) throw new Error(`Geocodificação HTTP ${response.status}`);
    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    if (!first || !validCoordinates(first.lat, first.lon)) return null;

    const result = {
      latitude: Number(first.lat),
      longitude: Number(first.lon),
      displayName: first.display_name || query,
      cachedAt: new Date().toISOString(),
    };
    cache[key] = result;
    await saveGeocodeCache(cache);
    return result;
  });
}

async function routeBetween(start, end) {
  if (!start || !end) return null;
  const coordinates = `${start.longitude},${start.latitude};${end.longitude},${end.latitude}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&steps=false&alternatives=false`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'BotGuincho/1.0 (+https://botguincho.vercel.app/)' },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`Roteamento HTTP ${response.status}`);
  const data = await response.json();
  const route = data?.code === 'Ok' && Array.isArray(data.routes) ? data.routes[0] : null;
  if (!route || !Number.isFinite(Number(route.duration))) return null;
  return {
    minutes: Math.max(1, Math.ceil(Number(route.duration) / 60)),
    distanceKm: Number.isFinite(Number(route.distance)) ? Math.round(Number(route.distance) / 100) / 10 : null,
  };
}

async function trackerCoordinates(reading) {
  if (!reading) return null;
  if (validCoordinates(reading.latitude, reading.longitude)) {
    return { latitude: Number(reading.latitude), longitude: Number(reading.longitude) };
  }
  if (!reading.address) return null;
  return geocodeAddress(reading.address);
}

async function computeEtaToClient({ targetAddress = null, targetCoordinates = null } = {}) {
  const reading = await getFreshTrackerReading();
  if (!reading) return null;

  let destination = targetCoordinates && validCoordinates(targetCoordinates.latitude, targetCoordinates.longitude)
    ? { latitude: Number(targetCoordinates.latitude), longitude: Number(targetCoordinates.longitude) }
    : null;

  if (!destination && targetAddress) {
    destination = await geocodeAddress(targetAddress);
  }
  if (!destination) return null;

  const start = await trackerCoordinates(reading);
  if (!start) return null;

  const route = await routeBetween(start, destination);
  if (!route) return null;

  return {
    ...route,
    trackerAddress: reading.address || null,
    trackerPlate: reading.plate || null,
    targetAddress: targetAddress || null,
  };
}

function trackerContextText(location) {
  if (!location) return '';
  const parts = [`Veículo rastreado: ${location.plate || 'guincho'}`];
  if (location.address) parts.push(`Endereço mostrado no GConnect: ${location.address}`);
  if (location.ignition) parts.push(`Estado/ignição no GConnect: ${location.ignition}`);
  if (location.speedKph !== null && location.speedKph !== undefined) parts.push(`Velocidade: ${location.speedKph} km/h`);
  if (location.odometerKm !== null && location.odometerKm !== undefined) parts.push(`Odômetro: ${location.odometerKm} km`);
  if (location.batteryVoltage !== null && location.batteryVoltage !== undefined) parts.push(`Bateria/tensão: ${location.batteryVoltage} V`);
  if (location.lastUpdateText) parts.push(`Última atualização mostrada pelo GConnect: ${location.lastUpdateText}`);
  if (location.receivedAt) parts.push(`Leitura recebida pelo Bot Guincho em: ${location.receivedAt}`);
  return parts.join('\n');
}

async function fetchTrackerContext(text) {
  if (!isOperationalMessage(text)) return '';
  const reading = await getFreshTrackerReading();
  return reading ? trackerContextText(reading) : '';
}

function safeCustomInstructions(settings) {
  const custom = String(settings?.aiInstructions || '').trim();
  if (!custom) return '';
  if (/regra absoluta|responda somente.*confirmado|confirmado\s*✅/i.test(custom)) return '';
  return custom.slice(0, 5000);
}

async function buildAiReply({ groupId, groupName, author, text, imageDataUrl, memoryOverride, trackerContext = '' }) {
  const settings = await getSettings();
  const openai = getAiClient();
  if (!openai) throw new Error('Credencial OIDC da IA ainda não sincronizada.');

  const memory = memoryOverride ?? groupMemory.get(groupId) ?? [];
  const context = memory
    .map((item) => `${item.role === 'assistant' ? 'Atendente' : 'Pessoa'}: ${item.text}`)
    .join('\n');
  const live = trackerContext ? `\n\nDADOS AO VIVO LIDOS DO APP GCONNECT NO ANDROID:\n${trackerContext}` : '';
  const content = [{
    type: 'input_text',
    text: `Grupo: ${groupName || groupId}\nAutor: ${author || 'participante'}\nHistórico recente:\n${context || '(sem histórico)'}${live}\n\nMensagem atual:\n${text || '[mensagem sem texto]'}`,
  }];
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl });

  const custom = safeCustomInstructions(settings);
  const instructions = [custom, SYSTEM_AI_RULES].filter(Boolean).join('\n\n');

  const response = await openai.responses.create({
    model: settings.aiModel || 'openai/gpt-5.4-mini',
    instructions,
    input: [{ role: 'user', content }],
    reasoning: { effort: 'minimal' },
    store: false,
    max_output_tokens: 220,
  });

  const reply = extractResponseText(response);
  if (!reply) {
    throw new Error(`A IA respondeu sem texto (${response?.incomplete_details?.reason || response?.status || 'sem detalhe'}).`);
  }
  return reply;
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

  const location = coordinatesFromLocation(msg.location);
  return { text, imageDataUrl, location };
}

async function replyAndRemember(msg, groupName, incomingText, reply, meta = {}) {
  await msg.reply(reply);
  remember(msg.from, 'user', incomingText);
  remember(msg.from, 'assistant', reply);
  logEvent('reply', `${groupName}: ${reply}`, { groupId: msg.from, ...meta });
}

function formatEtaReply(eta, withConfirmation = false) {
  if (!eta?.minutes) return withConfirmation ? 'Confirmado ✅' : null;
  const etaLine = `Previsão de chegada: ${eta.minutes} min.`;
  return withConfirmation ? `Confirmado ✅\n${etaLine}` : etaLine;
}

async function handleDispatch(msg, groupName, readableText, location) {
  const originAddress = extractLabeledField(readableText, 'Origem');
  const destinationAddress = extractLabeledField(readableText, 'Destino');
  const shared = sharedLocations.get(msg.from);
  const sharedFresh = shared && Date.now() - shared.at <= 10 * 60 * 1000 ? shared.coordinates : null;
  const originCoordinates = location || (!originAddress ? sharedFresh : null);

  const state = await setDispatchState(msg.from, {
    originAddress: originAddress || null,
    originCoordinates: originCoordinates || null,
    destinationAddress: destinationAddress || null,
  });

  let eta = null;
  try {
    eta = await computeEtaToClient({
      targetAddress: state.originAddress,
      targetCoordinates: state.originCoordinates,
    });
  } catch (error) {
    logEvent('warning', 'Não foi possível calcular ETA do acionamento.', { error: String(error), origin: state.originAddress });
  }

  if (eta) {
    await setDispatchState(msg.from, { lastEta: eta, lastEtaAt: new Date().toISOString() });
    logEvent('route', `${groupName}: ETA ${eta.minutes} min${eta.distanceKm ? ` · ${eta.distanceKm} km` : ''}.`, { groupId: msg.from });
  }

  const reply = formatEtaReply(eta, true);
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'dispatch', etaMinutes: eta?.minutes ?? null });
}

async function handleEtaQuestion(msg, groupName, readableText) {
  const state = await getDispatchState(msg.from);
  if (!state?.originAddress && !state?.originCoordinates) {
    await replyAndRemember(msg, groupName, readableText, 'Sem origem ativa para calcular o tempo.', { intent: 'eta-no-origin' });
    return;
  }

  let eta = null;
  try {
    eta = await computeEtaToClient({
      targetAddress: state.originAddress,
      targetCoordinates: state.originCoordinates,
    });
  } catch (error) {
    logEvent('warning', 'Não foi possível recalcular ETA.', { error: String(error) });
  }

  if (!eta) {
    await replyAndRemember(msg, groupName, readableText, 'Não consegui calcular a previsão agora.', { intent: 'eta-unavailable' });
    return;
  }

  await setDispatchState(msg.from, { lastEta: eta, lastEtaAt: new Date().toISOString() });
  const reply = formatEtaReply(eta, false);
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'eta', etaMinutes: eta.minutes });
}

async function handleTrackerLocationQuestion(msg, groupName, readableText) {
  const reading = await getFreshTrackerReading();
  const reply = reading?.address
    ? `Localização atual: ${reading.address}`
    : 'Localização indisponível no momento.';
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'tracker-location' });
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
    const { text, imageDataUrl, location } = await extractMessageInput(msg);
    const author = msg.author || 'participante';
    const readableText = text || (
      location
        ? `[localização compartilhada: ${location.latitude}, ${location.longitude}]`
        : (imageDataUrl ? '[imagem recebida]' : '[mídia recebida]')
    );

    logEvent('message', `${groupName}: ${readableText}`, { groupId: msg.from, author });

    if (settings.humanTakeover) return;

    if (text.toLowerCase() === '!ping') {
      await msg.reply('PONG — Bot Guincho funcionando no grupo autorizado!');
      logEvent('reply', `Teste respondido em ${groupName}.`);
      return;
    }

    if (location && !text) {
      sharedLocations.set(msg.from, { coordinates: location, at: Date.now() });
      const state = await getDispatchState(msg.from);
      if (state && (!state.originCoordinates || !state.originAddress)) {
        await setDispatchState(msg.from, { originCoordinates: location });
        await handleEtaQuestion(msg, groupName, readableText);
      } else {
        logEvent('system', `${groupName}: localização compartilhada armazenada para o próximo acionamento.`, { groupId: msg.from });
      }
      return;
    }

    if (looksLikeDispatch(readableText)) {
      await handleDispatch(msg, groupName, readableText, location);
      return;
    }

    if (asksEta(readableText)) {
      await handleEtaQuestion(msg, groupName, readableText);
      return;
    }

    if (asksTrackerLocation(readableText)) {
      await handleTrackerLocationQuestion(msg, groupName, readableText);
      return;
    }

    if (asksAvailability(readableText)) {
      await replyAndRemember(msg, groupName, readableText, 'Disponível ✅', { intent: 'availability' });
      return;
    }

    if (!isOperationalMessage(readableText)) {
      logEvent('ignored', `${groupName}: mensagem não operacional ignorada.`, { groupId: msg.from });
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
    logEvent('reply', `${groupName}: ${reply}`, { groupId: msg.from, intent: 'operational-ai' });
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
    try {
      await discoverGroups();
    } catch {}
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
    const text = typeof req.body?.text === 'string'
      ? req.body.text
      : 'A rua é estreita e precisa de um caminhão menor.';
    if (!isOperationalMessage(text)) {
      return res.json({ ok: true, reply: null, ignored: true, reason: 'non_operational' });
    }
    const trackerContext = await fetchTrackerContext(text);
    const reply = await buildAiReply({
      groupId: 'teste@g.us',
      groupName: 'Teste operacional',
      author: 'seguradora',
      text,
      imageDataUrl: null,
      memoryOverride: [],
      trackerContext,
    });
    return res.json({
      ok: true,
      reply,
      model: (await getSettings()).aiModel,
      trackerUsed: Boolean(trackerContext),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/status', async (_req, res) => {
  const settings = await getSettings();
  const allowed = await getAllowedGroupIds();
  const reading = await getTrackerReading();
  const pairCode = await getPairCode();

  res.json({
    clientId,
    whatsapp: { status: waStatus, qrDataUrl, lastError },
    ai: { configured: Boolean(aiCredential), enabled: settings.aiEnabled, model: settings.aiModel },
    tracker: trackerSummary(reading, pairCode),
    groupsSelected: allowed.size,
  });
});

app.get('/api/groups', async (_req, res) => {
  try {
    res.json({ groups: await discoverGroups() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
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
  const pairCode = await getPairCode();
  const reading = await getTrackerReading();
  res.json(trackerSummary(reading, pairCode));
});

app.post('/api/tracker', async (req, res) => {
  const action = String(req.body?.action || 'status');

  if (action === 'rotate_pair_code') {
    const pairCode = await rotatePairCode();
    await fs.rm(trackerReadingFile, { force: true });
    logEvent('tracker', 'Código de pareamento do Android foi renovado.');
    return res.json(trackerSummary(null, pairCode));
  }

  if (action === 'clear') {
    await fs.rm(trackerReadingFile, { force: true });
    return res.json(trackerSummary(null, await getPairCode()));
  }

  return res.json(trackerSummary(await getTrackerReading(), await getPairCode()));
});

app.get('/api/tracker-bridge', async (_req, res) => {
  res.json({ ok: true, ...trackerSummary(await getTrackerReading(), await getPairCode()) });
});

app.post('/api/tracker-bridge', async (req, res) => {
  try {
    const supplied = String(req.headers['x-botguincho-pair-code'] || '').trim().toUpperCase();
    const expected = await getPairCode();
    if (!supplied || supplied !== expected) {
      return res.status(401).json({ ok: false, error: 'pair_code_invalid' });
    }

    const reading = cleanTrackerReading(req.body || {});
    if (!reading.plate) return res.status(400).json({ ok: false, error: 'plate_missing' });

    await writeJson(trackerReadingFile, reading, 0o600);
    logEvent(
      'tracker',
      `GConnect Android: ${reading.plate} · ${reading.speedKph ?? '?'} km/h · ${reading.address || 'sem endereço'}.`,
    );

    return res.json({ ok: true, receivedAt: reading.receivedAt });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/activity', (_req, res) => {
  res.json({ activity: activity.slice(0, 50) });
});

app.get('/health', async (_req, res) => {
  const reading = await getTrackerReading();
  const age = trackerAgeSeconds(reading);
  res.json({
    ok: true,
    status: waStatus,
    aiConfigured: Boolean(aiCredential),
    trackerConfigured: age !== null && age <= 90,
    trackerMode: 'gconnect-emulator',
  });
});

await ensureDir();
await getPairCode();
await startWhatsApp();

app.listen(port, '0.0.0.0', () => console.log(`[worker:${clientId}] listening on ${port}`));
