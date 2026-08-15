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
  return /\b(quanto tempo|qual (?:o )?tempo|tempo de distancia|previsao de chegada|previsao|quanto demora|demora|eta|chega em|chegada|tempo (?:ate|para|pra) chegar|temp(?:o)? (?:ate|para|pra) chegar)\b/.test(value);
}

function asksDistance(text = '') {
  const value = normalizeForIntent(text);
  return /\b(qual (?:a )?distancia|quanto(?:s)? km|quantos quilometros|distancia (?:ate|para|pro|do guincho|do local|do cliente))\b/.test(value);
}

function asksTrackerLocation(text = '') {
  const value = normalizeForIntent(text);
  return /\b(onde esta o guincho|onde ta o guincho|localizacao do guincho|localizacao atual|posicao do guincho|posicao atual)\b/.test(value);
}

function isOperationalMessage(text = '') {
  const value = normalizeForIntent(text);
  if (!value) return false;
  if (looksLikeDispatch(value) || asksAvailability(value) || asksEta(value) || asksDistance(value) || asksTrackerLocation(value)) return true;
  return /\b(guincho|reboque|pane|veiculo|carro|moto|placa|origem|destino|assistencia|seguradora|acionamento|caminhao|rota|oficina|remocao|prestador|sinistro|chamado)\b/.test(value);
}

function extractLabeledField(text = '', label = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const target = normalizeForIntent(label);
  const aliases = target === 'origem'
    ? ['origem', 'endereco de origem', 'endereco origem', 'local de origem', 'local origem', 'localizacao de origem', 'localizacao origem']
    : target === 'destino'
      ? ['destino', 'endereco de destino', 'endereco destino', 'local de destino', 'local destino', 'localizacao de destino', 'localizacao destino']
      : [target];
  const escapedAliases = aliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`^(?:${escapedAliases.join('|')})\\s*[:\\-]\\s*(.*)$`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeForIntent(line);
    if (!pattern.test(normalized)) continue;

    const rawMatch = line.match(/^\s*[^:\-]+?\s*[:\-]\s*(.*)$/);
    const inlineValue = rawMatch?.[1]?.trim();
    if (inlineValue) return inlineValue;

    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      return candidate;
    }
  }
  return null;
}

function cleanAddressQuery(value = '') {
  return String(value)
    .replace(/\bref\.?\s*:.*$/i, '')
    .replace(/\bn[º°]\s*/gi, '')
    .replace(/[?]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+[–—-]\s+/g, ' - ')
    .trim();
}

function validCoordinates(latitude, longitude) {
  const missing = (value) => value === null
    || value === undefined
    || (typeof value === 'string' && !value.trim());
  if (missing(latitude) || missing(longitude)) return false;

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;

  return lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;
}

function coordinatesFromLocation(location) {
  if (!location || !validCoordinates(location.latitude, location.longitude)) return null;
  return {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
  };
}

function coordinatesFromText(value = '') {
  const raw = String(value || '');
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch {}
  const candidates = [decoded, raw];
  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,|\/|\?|$)/,
    /(?:[?&](?:q|query|ll)=)(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/i,
    /(?:^|[^\d.-])(-?\d{1,2}\.\d{4,})\s*[,;]\s*(-?\d{1,3}\.\d{4,})(?:[^\d.]|$)/,
  ];
  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (!match) continue;
      if (!validCoordinates(match[1], match[2])) continue;
      return { latitude: Number(match[1]), longitude: Number(match[2]) };
    }
  }
  return null;
}

function extractMapsUrl(value = '') {
  const match = String(value || '').match(/https?:\/\/(?:maps\.app\.goo\.gl|maps\.google\.[^/\s]+|www\.google\.[^/\s]+\/maps|goo\.gl\/maps)\/[^\s<>]+/i);
  return match?.[0]?.replace(/[),.;!?]+$/g, '') || null;
}

async function coordinatesFromMapsUrl(value = '') {
  const direct = coordinatesFromText(value);
  if (direct) return direct;
  const mapsUrl = extractMapsUrl(value);
  if (!mapsUrl) return null;
  try {
    const response = await fetch(mapsUrl, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 BotGuincho/1.2' },
      signal: AbortSignal.timeout(10000),
    });
    const finalUrl = response.url || mapsUrl;
    return coordinatesFromText(finalUrl);
  } catch (error) {
    logEvent('warning', 'Nao foi possivel resolver link do Google Maps.', { error: String(error), mapsUrl });
    return null;
  }
}

async function rememberSharedLocation(groupId, coordinates, source = 'whatsapp-location') {
  if (!coordinates || !validCoordinates(coordinates.latitude, coordinates.longitude)) return null;
  const normalized = {
    latitude: Number(coordinates.latitude),
    longitude: Number(coordinates.longitude),
  };
  const at = Date.now();
  sharedLocations.set(groupId, { coordinates: normalized, at, source });
  await setDispatchState(groupId, {
    lastSharedCoordinates: normalized,
    lastSharedAt: new Date(at).toISOString(),
    lastSharedSource: source,
  });
  return { coordinates: normalized, at, source };
}

async function getRecentSharedLocation(groupId, stateOverride = undefined) {
  const maxAge = 20 * 60 * 1000;
  const candidates = [];
  const memory = sharedLocations.get(groupId);
  if (memory?.coordinates && validCoordinates(memory.coordinates.latitude, memory.coordinates.longitude)) {
    candidates.push({ coordinates: memory.coordinates, at: Number(memory.at) || 0, source: memory.source || 'memory' });
  }
  const state = stateOverride === undefined ? await getDispatchState(groupId) : stateOverride;
  if (state?.lastSharedCoordinates && validCoordinates(state.lastSharedCoordinates.latitude, state.lastSharedCoordinates.longitude)) {
    const at = new Date(state.lastSharedAt || 0).getTime();
    candidates.push({ coordinates: state.lastSharedCoordinates, at, source: state.lastSharedSource || 'persisted' });
  }
  return candidates
    .filter((item) => Number.isFinite(item.at) && Date.now() - item.at <= maxAge)
    .sort((a, b) => b.at - a.at)[0] || null;
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

const BRAZIL_STATE_BY_NAME = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};
const BRAZIL_UFS = new Set(Object.values(BRAZIL_STATE_BY_NAME));

function normalizeBrazilState(value = '') {
  const key = normalizeForIntent(value).trim();
  if (!key) return '';
  const upper = key.toUpperCase();
  if (BRAZIL_UFS.has(upper)) return upper;
  return BRAZIL_STATE_BY_NAME[key] || '';
}

function extractCep(value = '') {
  const match = String(value || '').match(/\b(\d{5})-?(\d{3})\b/);
  return match ? `${match[1]}-${match[2]}` : '';
}

function parseBrazilAddress(address = '') {
  const query = cleanAddressQuery(address);
  const cep = extractCep(query);
  const withoutCep = query.replace(/\b\d{5}-?\d{3}\b/g, '').replace(/\s+,/g, ',').trim();
  const parts = withoutCep.split(',').map((part) => part.trim()).filter(Boolean);
  let street = parts[0] || withoutCep;
  let number = '';
  let district = '';
  let city = '';
  let state = '';

  if (parts.length > 1) {
    const second = parts[1].replace(/^n[º°]?\s*/i, '').trim();
    if (/^\d+[A-Za-z0-9/-]*$/.test(second.replace(/\s+/g, ''))) number = second;
  }

  if (!number) {
    const firstNumber = street.match(/^(.*?)(?:,|\s+n[º°]?\s*|\s+)(\d+[A-Za-z]?)\s*$/i);
    if (firstNumber && firstNumber[1].trim().length >= 3) {
      street = firstNumber[1].trim();
      number = firstNumber[2];
    }
  }

  if (parts.length >= 2) {
    const tail = parts.at(-1) || '';
    const cityState = tail.match(/^(.*?)\s*[-–—]\s*([A-Za-zÀ-ÿ ]{2,24}|[A-Za-z]{2})$/);
    if (cityState) {
      const normalizedState = normalizeBrazilState(cityState[2]);
      if (normalizedState) {
        city = cityState[1].trim();
        state = normalizedState;
      }
    }
    if (!state) {
      const tailState = normalizeBrazilState(tail);
      if (tailState && parts.length >= 3) {
        state = tailState;
        city = parts.at(-2) || '';
      } else {
        city = tail;
      }
    }
  }

  let middleEnd = parts.length;
  if (state && normalizeBrazilState(parts.at(-1) || '')) middleEnd -= 2;
  else if (city) middleEnd -= 1;
  const middleStart = number ? 2 : 1;
  if (middleEnd > middleStart) district = parts.slice(middleStart, middleEnd).join(', ').trim();

  return { query, street, number, district, city, state, cep };
}

function uniqueQueries(values) {
  const seen = new Set();
  return values.map((v) => String(v || '').replace(/\s+/g, ' ').trim()).filter((v) => {
    const key = normalizeForIntent(v);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function nominatimLookup(params) {
  return scheduleNominatim(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/1.1 (operacao-guincho; https://botguincho.vercel.app/)',
        referer: 'https://botguincho.vercel.app/',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`Geocodificação HTTP ${response.status}`);
    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    if (!first || !validCoordinates(first.lat, first.lon)) return null;
    return {
      latitude: Number(first.lat),
      longitude: Number(first.lon),
      displayName: first.display_name || '',
      postcode: first.address?.postcode || null,
    };
  });
}

async function lookupCep(cep) {
  const digits = String(cep || '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
    headers: { 'user-agent': 'BotGuincho/1.2' },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) return null;
  const item = await response.json();
  if (!item || item.erro) return null;
  return item;
}

async function findCepByAddress(parts) {
  if (!parts.state || !parts.city || !parts.street || parts.street.length < 3) return null;
  const state = encodeURIComponent(parts.state);
  const city = encodeURIComponent(parts.city);
  const street = encodeURIComponent(parts.street.replace(/^(rua|avenida|av\.?|travessa|rodovia)\s+/i, '').trim());
  const url = `https://viacep.com.br/ws/${state}/${city}/${street}/json/`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'BotGuincho/1.1' },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) return null;
  const items = await response.json();
  if (!Array.isArray(items) || !items.length) return null;
  const districtKey = normalizeForIntent(parts.district);
  const streetKey = normalizeForIntent(parts.street);
  const ranked = items.map((item) => {
    let score = 0;
    const itemStreet = normalizeForIntent(item.logradouro || '');
    const itemDistrict = normalizeForIntent(item.bairro || '');
    if (itemStreet === streetKey) score += 5;
    else if (itemStreet.includes(streetKey) || streetKey.includes(itemStreet)) score += 3;
    if (districtKey && itemDistrict === districtKey) score += 5;
    else if (districtKey && (itemDistrict.includes(districtKey) || districtKey.includes(itemDistrict))) score += 2;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.item || null;
}


function stripRouteQuestionFragments(value = '') {
  let text = String(value || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:qual|quanto)\s+(?:e|é\s+)?(?:o\s+|a\s+)?(?:tempo(?:\s+de\s+dist[aâ]ncia)?|dist[aâ]ncia|previs[aã]o(?:\s+de\s+chegada)?)\s*\??/gi,
    /\b(?:qual\s+seria\s+)?(?:o\s+)?tempo\s+(?:at[eé]|para|pra)\s+chegar(?:\s+(?:no|ao)\s+cliente)?\s*\??/gi,
    /\bquanto\s+tempo\s+(?:at[eé]|para|pra)\s+chegar(?:\s+(?:no|ao)\s+cliente)?\s*\??/gi,
    /\bquanto\s+demora(?:\s+(?:at[eé]|para|pra)\s+chegar)?\s*\??/gi,
    /\b(?:eta|previs[aã]o\s+de\s+chegada)\s*[:?]\s*/gi,
  ];
  for (const pattern of patterns) text = text.replace(pattern, ' ');
  return text
    .replace(/\s*[,;|]+\s*$/g, '')
    .replace(/^\s*[,;|]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectBrazilState(value = '') {
  const normalized = normalizeForIntent(value);
  for (const [name, uf] of Object.entries(BRAZIL_STATE_BY_NAME)) {
    if (normalized === name || normalized.includes(` ${name} `) || normalized.endsWith(` ${name}`) || normalized.startsWith(`${name} `)) return uf;
  }
  const ufMatch = String(value || '').toUpperCase().match(/(?:^|[^A-Z])([A-Z]{2})(?:[^A-Z]|$)/);
  return ufMatch && BRAZIL_UFS.has(ufMatch[1]) ? ufMatch[1] : '';
}

function normalizeAddressForLookup(value = '') {
  let query = stripRouteQuestionFragments(value);
  query = cleanAddressQuery(query)
    .replace(/\b(?:n[uú]mero|numero|nro\.?|num\.?|n[º°])\s*[:#-]?\s*(\d{1,6}[A-Za-z]?)/gi, '$1')
    .replace(/\bbrasil\b(?:\s*,?\s*\bbrasil\b)+/gi, 'Brasil')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,{2,}/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  return query;
}

function looseAddressCandidates(value = '') {
  const query = normalizeAddressForLookup(value);
  const state = detectBrazilState(query);
  const pieces = query
    .replace(/\bBrasil\b/gi, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!state || !pieces.length) return [];

  const street = pieces[0] || '';
  let number = '';
  if (pieces[1] && /^\d{1,6}[A-Za-z]?$/.test(pieces[1])) number = pieces[1];

  let beforeState = '';
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    if (detectBrazilState(pieces[i])) {
      beforeState = pieces[i - 1] || '';
      break;
    }
  }
  if (!beforeState && pieces.length >= 2) beforeState = pieces.at(-2) || '';

  const words = beforeState.split(/\s+/).filter(Boolean);
  const cities = [];
  for (let size = 1; size <= Math.min(4, words.length); size += 1) cities.push(words.slice(-size).join(' '));
  return uniqueQueries(cities).map((city) => ({ street, number, city, state }));
}

function buildLookupVariants(value = '') {
  const query = normalizeAddressForLookup(value);
  const state = detectBrazilState(query);
  const variants = [query, `${query}, Brasil`];
  const pieces = query.replace(/\bBrasil\b/gi, '').split(',').map((x) => x.trim()).filter(Boolean);
  if (state && pieces.length >= 2) {
    const street = pieces[0];
    const number = pieces[1] && /^\d{1,6}[A-Za-z]?$/.test(pieces[1]) ? pieces[1] : '';
    for (const candidate of looseAddressCandidates(query)) {
      variants.push([street, number, candidate.city, state, 'Brasil'].filter(Boolean).join(', '));
      variants.push([street, candidate.city, state, 'Brasil'].filter(Boolean).join(', '));
    }
  }
  return uniqueQueries(variants);
}

async function photonLookup(query) {
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('lang', 'pt');
    const response = await fetch(url, {
      headers: { 'user-agent': 'BotGuincho/1.3 (+https://botguincho.vercel.app/)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    for (const feature of features) {
      const coords = feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const countryCode = String(feature?.properties?.countrycode || '').toUpperCase();
      if (countryCode && countryCode !== 'BR') continue;
      if (!validCoordinates(coords[1], coords[0])) continue;
      return {
        latitude: Number(coords[1]),
        longitude: Number(coords[0]),
        displayName: [feature?.properties?.name, feature?.properties?.street, feature?.properties?.city, feature?.properties?.state].filter(Boolean).join(', '),
      };
    }
  } catch (error) {
    logEvent('warning', 'Photon geocoder falhou.', { error: String(error), query });
  }
  return null;
}

async function geocodeAddress(address) {
  const query = normalizeAddressForLookup(address);
  if (!query) return null;

  const key = geocodeCacheKey(query);
  const cache = await getGeocodeCache();
  const cached = cache[key];
  const cachedAge = cached?.cachedAt ? Date.now() - new Date(cached.cachedAt).getTime() : Infinity;
  if (cached && cachedAge < 90 * 24 * 60 * 60 * 1000 && validCoordinates(cached.latitude, cached.longitude)) {
    return { latitude: Number(cached.latitude), longitude: Number(cached.longitude), displayName: cached.displayName || query };
  }

  const save = async (found, source) => {
    if (!found || !validCoordinates(found.latitude, found.longitude)) return null;
    const result = { ...found, source, cachedAt: new Date().toISOString() };
    cache[key] = result;
    await saveGeocodeCache(cache);
    logEvent('geocode', `${query} -> ${result.latitude},${result.longitude} (${source})`);
    return result;
  };

  const directCoordinates = coordinatesFromText(query);
  if (directCoordinates) return save({ ...directCoordinates, displayName: query }, 'coordinates-text');

  if (extractMapsUrl(query)) {
    const mapCoordinates = await coordinatesFromMapsUrl(query);
    if (mapCoordinates) return save({ ...mapCoordinates, displayName: query }, 'google-maps-url');
  }

  const parts = parseBrazilAddress(query);

  if (parts.cep) {
    const byCep = await lookupCep(parts.cep).catch((error) => {
      logEvent('warning', 'Consulta direta de CEP falhou.', { error: String(error), cep: parts.cep });
      return null;
    });
    if (byCep) {
      const cepVariants = uniqueQueries([
        [byCep.logradouro, parts.number, byCep.bairro, `${byCep.localidade} - ${byCep.uf}`, byCep.cep, 'Brasil'].filter(Boolean).join(', '),
        [byCep.logradouro, parts.number, `${byCep.localidade} - ${byCep.uf}`, 'Brasil'].filter(Boolean).join(', '),
        [byCep.cep, byCep.localidade, byCep.uf, 'Brasil'].filter(Boolean).join(', '),
      ]);
      for (const variant of cepVariants) {
        const found = await nominatimLookup({ q: variant }).catch(() => null);
        if (found) return save(found, 'viacep-direct+nominatim');
      }
    }
  }

  if (parts.street && parts.city) {
    const structured = await nominatimLookup({
      street: [parts.number, parts.street].filter(Boolean).join(' '),
      city: parts.city,
      state: parts.state || undefined,
      postalcode: parts.cep || undefined,
      country: 'Brasil',
    }).catch((error) => {
      logEvent('warning', 'Nominatim estruturado falhou.', { error: String(error), query });
      return null;
    });
    if (structured) return save(structured, 'nominatim-structured');
  }

  const cityState = [parts.city, parts.state].filter(Boolean).join(' - ');
  const variants = uniqueQueries([
    ...buildLookupVariants(query),
    [parts.street, parts.number, parts.district, cityState, parts.cep, 'Brasil'].filter(Boolean).join(', '),
    [parts.street, parts.number, cityState, 'Brasil'].filter(Boolean).join(', '),
    [parts.street, parts.district, cityState, 'Brasil'].filter(Boolean).join(', '),
    [parts.street, cityState, 'Brasil'].filter(Boolean).join(', '),
  ]);

  for (const variant of variants) {
    const found = await nominatimLookup({ q: variant }).catch((error) => {
      logEvent('warning', 'Nominatim livre falhou.', { error: String(error), variant });
      return null;
    });
    if (found) return save(found, 'nominatim-free');
  }

  const cep = await findCepByAddress(parts).catch((error) => {
    logEvent('warning', 'ViaCEP por endereco falhou.', { error: String(error), query });
    return null;
  });
  if (cep?.cep) {
    const found = await nominatimLookup({
      q: [cep.logradouro || parts.street, parts.number, cep.bairro, `${cep.localidade} - ${cep.uf}`, cep.cep, 'Brasil'].filter(Boolean).join(', '),
    }).catch(() => null);
    if (found) return save(found, 'viacep-address+nominatim');
  }

  for (const loose of looseAddressCandidates(query)) {
    const cepItem = await findCepByAddress({ street: loose.street, number: loose.number, district: '', city: loose.city, state: loose.state }).catch(() => null);
    if (!cepItem?.cep) continue;
    const variant = [cepItem.logradouro || loose.street, loose.number, cepItem.bairro, `${cepItem.localidade} - ${cepItem.uf}`, cepItem.cep, 'Brasil'].filter(Boolean).join(', ');
    const found = await nominatimLookup({ q: variant }).catch(() => null);
    if (found) return save(found, 'viacep-loose+nominatim');
  }

  for (const variant of buildLookupVariants(query)) {
    const found = await photonLookup(variant);
    if (found) return save(found, 'photon-fallback');
  }

  logEvent('warning', 'Endereco nao geocodificado apos todos os fallbacks.', { query, parts });
  return null;
}

async function routeBetween(start, end) {
  if (!start || !end) return null;
  if (!validCoordinates(start.latitude, start.longitude) || !validCoordinates(end.latitude, end.longitude)) {
    throw new Error('Coordenadas inválidas para roteamento.');
  }

  const coordinates = `${Number(start.longitude)},${Number(start.latitude)};${Number(end.longitude)},${Number(end.latitude)}`;
  const providers = [
    { name: 'osrm-main', base: 'https://router.project-osrm.org/route/v1/driving/' },
    { name: 'osrm-osmde', base: 'https://routing.openstreetmap.de/routed-car/route/v1/driving/' },
  ];
  let lastError = null;

  for (const provider of providers) {
    const url = `${provider.base}${coordinates}?overview=false&steps=false&alternatives=false`;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'BotGuincho/1.1 (+https://botguincho.vercel.app/)' },
        signal: AbortSignal.timeout(6500),
      });
      if (!response.ok) {
        const body = (await response.text().catch(() => '')).slice(0, 180);
        throw new Error(`${provider.name} HTTP ${response.status}${body ? `: ${body}` : ''}`);
      }
      const data = await response.json();
      const route = data?.code === 'Ok' && Array.isArray(data.routes) ? data.routes[0] : null;
      if (!route || !Number.isFinite(Number(route.duration))) {
        throw new Error(`${provider.name} não retornou rota válida (${data?.code || 'sem código'}).`);
      }
      if (provider.name !== 'osrm-main') {
        logEvent('route-fallback', `Rota calculada pelo fallback ${provider.name}.`);
      }
      return {
        minutes: Math.max(1, Math.ceil(Number(route.duration) / 60)),
        distanceKm: Number.isFinite(Number(route.distance)) ? Math.round(Number(route.distance) / 100) / 10 : null,
      };
    } catch (error) {
      lastError = error;
      logEvent('warning', `Falha no roteador ${provider.name}; tentando alternativa.`, {
        error: String(error),
        coordinates,
      });
    }
  }

  throw lastError || new Error('Nenhum roteador conseguiu calcular a rota.');
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
      logEvent('warning', 'Nao foi possivel baixar a midia recebida.', { error: String(error) });
    }
  }

  const location = coordinatesFromLocation(msg.location);
  const locationMeta = msg.location ? {
    name: msg.location.name || null,
    address: msg.location.address || null,
    url: msg.location.url || null,
  } : null;

  let quotedLocation = null;
  let quotedText = '';
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      quotedLocation = coordinatesFromLocation(quoted?.location);
      quotedText = quoted?.body?.trim() || '';
    } catch (error) {
      logEvent('warning', 'Nao foi possivel ler a mensagem citada.', { error: String(error) });
    }
  }

  return { text, imageDataUrl, location, locationMeta, quotedLocation, quotedText };
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
  const shared = await getRecentSharedLocation(msg.from);
  const originCoordinates = location || (!originAddress ? shared?.coordinates || null : null);
  const originMoment = originCoordinates && !originAddress && shared?.at
    ? new Date(shared.at).toISOString()
    : new Date().toISOString();

  const state = await setDispatchState(msg.from, {
    originAddress: originAddress || null,
    originCoordinates: originCoordinates || null,
    destinationAddress: destinationAddress || null,
    originUpdatedAt: originMoment,
  });

  let eta = null;
  try {
    eta = await computeEtaToClient({
      targetAddress: state.originAddress,
      targetCoordinates: state.originCoordinates,
    });
  } catch (error) {
    logEvent('warning', 'Nao foi possivel calcular ETA do acionamento.', { error: String(error), origin: state.originAddress });
  }

  if (eta) {
    await setDispatchState(msg.from, {
    lastEta: eta,
    lastEtaAt: new Date().toISOString(),
    ...(target.source === 'inline-address' || target.source === 'quoted-address'
      ? { originAddress: target.targetAddress, originCoordinates: null, originUpdatedAt: new Date().toISOString() }
      : {}),
  });
    logEvent('route', `${groupName}: ETA ${eta.minutes} min${eta.distanceKm ? ` · ${eta.distanceKm} km` : ''}.`, { groupId: msg.from });
  }

  const reply = formatEtaReply(eta, true);
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'dispatch', etaMinutes: eta?.minutes ?? null });
}

function looksLikeAddressCandidate(value = '') {
  const candidate = cleanAddressQuery(value);
  if (!candidate || candidate.length < 4) return false;
  if (coordinatesFromText(candidate) || extractMapsUrl(candidate) || extractCep(candidate)) return true;

  const normalized = normalizeForIntent(candidate);
  const streetHint = /\b(rua|r\.?|avenida|av\.?|alameda|travessa|estrada|rodovia|rod\.?|br-?\d+|mg-?\d+|praca|largo|via|marginal|fazenda|sitio|condominio|loteamento|bairro)\b/i.test(normalized);
  const hasNumber = /\b\d{1,6}[a-z]?\b/i.test(normalized);
  const hasComma = candidate.includes(',');
  const hasUf = new RegExp(`\\b(?:${[...BRAZIL_UFS].join('|')})\\b`, 'i').test(candidate);
  return streetHint || (hasComma && (hasNumber || hasUf)) || (hasNumber && hasUf) || (hasComma && candidate.length >= 12);
}

function extractInlineRouteTarget(text = '') {
  const raw = String(text || '').replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const mapsUrl = extractMapsUrl(raw);
  if (mapsUrl) return mapsUrl;
  const directCoordinates = coordinatesFromText(raw);
  if (directCoordinates) return `${directCoordinates.latitude},${directCoordinates.longitude}`;

  const labeled = raw.match(/(?:^|\b)(?:origem|endereco|endereço|local|localizacao|localização|local do cliente|endereco do cliente|endereço do cliente|cliente)\s*[:=\-–—]\s*(.+)$/i);
  if (labeled?.[1]) {
    const labeledCandidate = normalizeAddressForLookup(labeled[1]);
    if (looksLikeAddressCandidate(labeledCandidate)) return labeledCandidate;
  }

  const withoutQuestion = normalizeAddressForLookup(raw);
  if (looksLikeAddressCandidate(withoutQuestion)) return withoutQuestion;

  const embedded = withoutQuestion.match(/\b(?:rua|r\.?|avenida|av\.?|alameda|travessa|estrada|rodovia|rod\.?|br-?\d+|mg-?\d+|praca|praça|largo|via|marginal|fazenda|sitio|sítio|condominio|condomínio|loteamento|bairro)\b.+$/i);
  if (embedded?.[0]) {
    const candidate = normalizeAddressForLookup(embedded[0]);
    if (looksLikeAddressCandidate(candidate)) return candidate;
  }
  return null;
}

async function resolveRouteQuestionTarget(groupId, readableText, quotedText = '') {
  const inlineAddress = extractInlineRouteTarget(readableText);
  const quotedAddress = inlineAddress ? null : extractInlineRouteTarget(quotedText);
  const explicitAddress = inlineAddress || quotedAddress || null;
  let state = await getDispatchState(groupId);
  const shared = explicitAddress ? null : await getRecentSharedLocation(groupId, state);
  const originAt = new Date(state?.originUpdatedAt || state?.createdAt || 0).getTime();
  const stateHasOrigin = Boolean(state?.originAddress || state?.originCoordinates);
  const sharedIsNewer = shared && (!stateHasOrigin || !Number.isFinite(originAt) || shared.at >= originAt);

  if (explicitAddress) {
    // Nao persiste ainda: evita contaminar o grupo com endereco invalido.
  } else if (sharedIsNewer) {
    state = await setDispatchState(groupId, {
      originAddress: null,
      originCoordinates: shared.coordinates,
      originUpdatedAt: new Date(shared.at).toISOString(),
    });
  }

  return {
    state,
    inlineAddress,
    quotedAddress,
    targetAddress: explicitAddress || state?.originAddress || null,
    targetCoordinates: explicitAddress ? null : (sharedIsNewer ? shared.coordinates : state?.originCoordinates || null),
    source: inlineAddress
      ? 'inline-address'
      : quotedAddress
        ? 'quoted-address'
        : sharedIsNewer
          ? shared.source
          : 'dispatch-state',
  };
}

async function handleEtaQuestion(msg, groupName, readableText, quotedText = '') {
  const target = await resolveRouteQuestionTarget(msg.from, readableText, quotedText);
  if (!target.targetAddress && !target.targetCoordinates) {
    logEvent('ignored', `${groupName}: pergunta de ETA sem destino identificável ignorada.`, { groupId: msg.from });
    return;
  }

  let eta = null;
  try {
    eta = await computeEtaToClient({
      targetAddress: target.targetAddress,
      targetCoordinates: target.targetCoordinates,
    });
  } catch (error) {
    logEvent('warning', 'Não foi possível recalcular ETA.', {
      error: String(error),
      targetAddress: target.targetAddress,
      source: target.source,
    });
  }

  if (!eta) {
    await replyAndRemember(msg, groupName, readableText, 'Não consegui calcular a previsão agora.', { intent: 'eta-unavailable', targetSource: target.source });
    return;
  }

  await setDispatchState(msg.from, {
    lastEta: eta,
    lastEtaAt: new Date().toISOString(),
    ...(target.source === 'inline-address' || target.source === 'quoted-address'
      ? { originAddress: target.targetAddress, originCoordinates: null, originUpdatedAt: new Date().toISOString() }
      : {}),
  });
  const reply = formatEtaReply(eta, false);
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: 'eta',
    etaMinutes: eta.minutes,
    distanceKm: eta.distanceKm,
    targetSource: target.source,
    targetAddress: target.targetAddress,
  });
}

async function handleDistanceQuestion(msg, groupName, readableText, quotedText = '') {
  const target = await resolveRouteQuestionTarget(msg.from, readableText, quotedText);
  if (!target.targetAddress && !target.targetCoordinates) {
    logEvent('ignored', `${groupName}: pergunta de distância sem destino identificável ignorada.`, { groupId: msg.from });
    return;
  }

  let eta = null;
  try {
    eta = await computeEtaToClient({
      targetAddress: target.targetAddress,
      targetCoordinates: target.targetCoordinates,
    });
  } catch (error) {
    logEvent('warning', 'Não foi possível recalcular distância/ETA.', {
      error: String(error),
      targetAddress: target.targetAddress,
      source: target.source,
    });
  }

  if (!eta) {
    await replyAndRemember(msg, groupName, readableText, 'Não consegui calcular a rota agora.', { intent: 'distance-unavailable', targetSource: target.source });
    return;
  }

  await setDispatchState(msg.from, { lastEta: eta, lastEtaAt: new Date().toISOString() });
  const distance = Number.isFinite(Number(eta.distanceKm)) ? `${eta.distanceKm} km` : 'indisponível';
  const reply = `Distância até o cliente: ${distance}.
Previsão de chegada: ${eta.minutes} min.`;
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: 'distance',
    etaMinutes: eta.minutes,
    distanceKm: eta.distanceKm,
    targetSource: target.source,
    targetAddress: target.targetAddress,
  });
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
    const { text, imageDataUrl, location, locationMeta, quotedLocation, quotedText } = await extractMessageInput(msg);
    const author = msg.author || 'participante';
    const incomingLocation = location || quotedLocation || null;

    if (location) {
      await rememberSharedLocation(msg.from, location, 'whatsapp-location');
      logEvent('location', `${groupName}: localizacao nativa do WhatsApp recebida.`, { groupId: msg.from, ...location, locationMeta });
    } else if (quotedLocation) {
      await rememberSharedLocation(msg.from, quotedLocation, 'whatsapp-quoted-location');
      logEvent('location', `${groupName}: localizacao encontrada na mensagem citada.`, { groupId: msg.from, ...quotedLocation });
    }

    const readableText = text || (
      location
        ? `[localização WhatsApp: ${location.latitude}, ${location.longitude}]`
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
      logEvent('system', `${groupName}: localizacao do WhatsApp armazenada; aguardando pergunta/acionamento.`, { groupId: msg.from });
      return;
    }

    if (looksLikeDispatch(readableText)) {
      await handleDispatch(msg, groupName, readableText, incomingLocation);
      return;
    }

    if (asksEta(readableText)) {
      await handleEtaQuestion(msg, groupName, readableText, quotedText);
      return;
    }

    if (asksDistance(readableText)) {
      await handleDistanceQuestion(msg, groupName, readableText, quotedText);
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

app.post('/api/route-test', async (req, res) => {
  try {
    const fromTracker = req.body?.fromTracker === true;
    const fromAddress = typeof req.body?.from === 'string' ? req.body.from.trim() : '';
    const toAddress = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
    const toCoordinates = validCoordinates(req.body?.toLatitude, req.body?.toLongitude)
      ? { latitude: Number(req.body.toLatitude), longitude: Number(req.body.toLongitude) }
      : null;

    if (fromTracker) {
      const testMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const testQuotedText = typeof req.body?.quotedText === 'string' ? req.body.quotedText.trim() : '';
      const inlineTarget = testMessage ? extractInlineRouteTarget(testMessage) : null;
      const quotedTarget = !inlineTarget && testQuotedText ? extractInlineRouteTarget(testQuotedText) : null;
      const parsedTarget = inlineTarget || quotedTarget || toAddress || null;
      const parsedSource = inlineTarget ? 'inline-address' : quotedTarget ? 'quoted-address' : toCoordinates ? 'coordinates' : 'to';
      if (!parsedTarget && !toCoordinates) return res.status(400).json({ ok: false, error: 'to_required' });
      const route = await computeEtaToClient({ targetAddress: parsedTarget, targetCoordinates: toCoordinates });
      if (!route) return res.status(422).json({ ok: false, error: 'tracker_eta_failed', parsedTarget, parsedSource });
      return res.json({ ok: true, fromTracker: true, parsedTarget, parsedSource, route });
    }

    if (!fromAddress || !toAddress) return res.status(400).json({ ok: false, error: 'from_and_to_required' });
    const from = await geocodeAddress(fromAddress);
    const to = await geocodeAddress(toAddress);
    if (!from || !to) return res.status(422).json({ ok: false, error: 'geocode_failed', from, to });
    const route = await routeBetween(from, to);
    if (!route) return res.status(422).json({ ok: false, error: 'route_failed', from, to });
    return res.json({ ok: true, from, to, route });
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
