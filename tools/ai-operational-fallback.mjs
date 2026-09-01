import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { normalizeAddressInput } from './address-normalization.mjs';
import { historicalExamplesForAi } from './training-runtime-index.mjs';

const DEFAULT_MODEL = 'gpt-5.6-luna';
const DEFAULT_DAILY_LIMIT = 30;
const DEFAULT_TIMEOUT_MS = 3500;
const DATA_DIR = process.env.BOTGUINCHO_DATA_DIR || path.join(process.cwd(), '.botguincho-data');
const USAGE_FILE = path.join(DATA_DIR, 'ai-fallback-usage.json');

const AI_INTENTS = new Set([
  'availability',
  'quote',
  'authorization',
  'scheduled_dispatch',
  'cancellation',
  'pending_approval',
  'eta',
  'other',
]);

function enabled() {
  return String(process.env.OPENAI_FALLBACK_ENABLED || '').toLowerCase() === 'true'
    && Boolean(String(process.env.OPENAI_API_KEY || '').trim());
}

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function dayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function readUsage(now = new Date()) {
  try {
    const raw = JSON.parse(await fs.readFile(USAGE_FILE, 'utf8'));
    if (raw?.day === dayKey(now)) return { day: raw.day, calls: Math.max(0, Number(raw.calls || 0)) };
  } catch {}
  return { day: dayKey(now), calls: 0 };
}

async function reserveDailyCall(now = new Date()) {
  const limit = clampInt(process.env.OPENAI_FALLBACK_DAILY_LIMIT, DEFAULT_DAILY_LIMIT, 1, 200);
  const usage = await readUsage(now);
  if (usage.calls >= limit) return { allowed: false, calls: usage.calls, limit };
  const next = { day: usage.day, calls: usage.calls + 1, updatedAt: now.toISOString() };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(USAGE_FILE, JSON.stringify(next, null, 2));
  return { allowed: true, calls: next.calls, limit };
}

function operationalSignalCount(text = '') {
  const value = String(text || '').toLowerCase();
  return [
    /\borigem\b/.test(value),
    /\bdestino\b/.test(value),
    /\b(ve[ií]culo|modelo|carro|moto)\b/.test(value),
    /\b(servi[cç]o|reboque|guincho)\b/.test(value),
    /\b(protocolo|acionamento)\b/.test(value),
    /\b(dispon[ií]vel|cota[cç][aã]o|pr[eé]via|valor|km)\b/.test(value),
  ].filter(Boolean).length;
}

function messyStructuredMessage(text = '') {
  const value = String(text || '');
  return /\bn[º°]?\s*[-–—]\s*(?:,|$)/i.test(value)
    || /\b(?:s\s*\/\s*n|sem\s+n[uú]mero)\b/i.test(value)
    || /\b(?:BAIRRO|CIDADE|ESTADO|PA[IÍ]S|PAS)\s*:/i.test(value)
    || /\*[^*]{2,40}:\*/.test(value)
    || (/\borigem\b/i.test(value) && /\bdestino\b/i.test(value) && !/\n/.test(value));
}

export function shouldUseAiOperationalFallback({ text = '', facts = {}, intent = 'other' } = {}) {
  if (!String(text || '').trim() || operationalSignalCount(text) < 2) return false;
  if (['authorization', 'cancellation', 'closure', 'departure', 'arrival', 'destination_arrival'].includes(intent)) return false;
  if (intent === 'other' || intent === 'incomplete_dispatch') return true;
  if (!facts?.origin || !facts?.destination || !facts?.vehicleType) return true;
  // Se o parser deterministico ja reconheceu uma cotacao completa, nao gastamos
  // tempo nem credito com IA apenas por causa de ruido como "nº -". O endereco
  // passa pelo normalizador/geocoder; a IA continua sendo fallback quando faltar dado.
  if (intent === 'quote') return false;
  if (messyStructuredMessage(text)) return true;
  return false;
}

function safeText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function mergeAiOperationalInterpretation({ text = '', facts = {}, intent = 'other', ai = null } = {}) {
  const confidence = Number(ai?.confidence || 0);
  if (!ai || confidence < 0.82) return { facts, intent, used: false };

  const source = String(text || '');
  const merged = { ...facts };
  const canUseOrigin = Boolean(facts?.origin) || /\borigem\b/i.test(source);
  const canUseDestination = Boolean(facts?.destination) || /\bdestino\b/i.test(source);
  const canUseVehicle = Boolean(facts?.vehicle) || /\b(ve[ií]culo|modelo|carro|moto|volkswagen|vw|fiat|chevrolet|ford|renault|hyundai|toyota|honda)\b/i.test(source);

  if (canUseOrigin && ai.origin) merged.origin = normalizeAddressInput(safeText(ai.origin)) || safeText(ai.origin);
  if (canUseDestination && ai.destination) merged.destination = normalizeAddressInput(safeText(ai.destination)) || safeText(ai.destination);
  if (canUseVehicle && ai.vehicle) merged.vehicle = safeText(ai.vehicle, 180);
  if (ai.vehicleType && ai.vehicleType !== 'unknown') merged.vehicleType = ai.vehicleType;
  if (!merged.service && ai.service) merged.service = safeText(ai.service, 180);
  if (!merged.protocol && ai.protocol) merged.protocol = safeText(ai.protocol, 120);

  let nextIntent = intent;
  if (intent === 'other' || intent === 'incomplete_dispatch') {
    if (AI_INTENTS.has(ai.intent) && ai.intent !== 'other') {
      nextIntent = ai.intent;
    } else {
      // Nao dependemos apenas do rotulo probabilistico do modelo. Se a IA extraiu
      // uma ficha operacional completa com alta confianca, os proprios campos sao
      // evidencia deterministica de uma nova cotacao.
      const hasCompleteQuote = Boolean(merged.origin && merged.destination && (merged.vehicleType || merged.vehicle || merged.service));
      if (hasCompleteQuote) nextIntent = 'quote';
    }
  }

  return { facts: merged, intent: nextIntent, used: true };
}

function responseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: [...AI_INTENTS] },
      origin: { type: 'string' },
      destination: { type: 'string' },
      vehicle: { type: 'string' },
      vehicleType: { type: 'string', enum: ['leve', 'moto', 'utilitario', 'pesado', 'unknown'] },
      service: { type: 'string' },
      protocol: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['intent', 'origin', 'destination', 'vehicle', 'vehicleType', 'service', 'protocol', 'confidence'],
  };
}

async function interpretWithOpenAI({ text, groupName }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  const baseURL = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim();
  const model = String(process.env.OPENAI_FALLBACK_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const timeout = clampInt(process.env.OPENAI_FALLBACK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 10000);
  const historicalExamples = historicalExamplesForAi(text, groupName, 4);
  const examplesInstruction = historicalExamples.length
    ? ['Exemplos anonimizados de linguagem real já observada (use apenas como referência de intenção):', ...historicalExamples.map((item) => `- ${item.intent}: ${item.phrase}`)].join('\n')
    : '';
  const openai = new OpenAI({ apiKey, baseURL });
  const response = await openai.responses.create({
    model,
    store: false,
    reasoning: { effort: 'none' },
    max_output_tokens: 260,
    instructions: [
      'Você é um extrator de dados para uma operação brasileira de guincho.',
      'Sua única tarefa é normalizar a mensagem recebida. Nunca calcule preço, distância, ETA ou disponibilidade.',
      'Nunca invente um dado ausente. Se não houver um campo, retorne string vazia.',
      'Em endereços, remova ruído como "nº -", referências, telefone e rótulos repetidos, mas preserve rua, número quando existir, bairro, cidade e UF.',
      'Uma ficha com origem, destino e veículo/serviço é uma cotação, salvo quando a mensagem contiver uma autorização, cancelamento ou agendamento explícito.',
      'Classifique intenção apenas entre as opções do schema.',
      examplesInstruction,
      `Grupo WhatsApp: ${safeText(groupName, 120) || 'não informado'}.`,
    ].join('\n'),
    input: String(text || '').slice(0, 5000),
    text: {
      format: {
        type: 'json_schema',
        name: 'bot_guincho_operational_message',
        strict: true,
        schema: responseSchema(),
      },
      verbosity: 'low',
    },
  }, { timeout });
  return { data: JSON.parse(response.output_text || '{}'), model, usage: response.usage || null };
}

export async function maybeInterpretOperationalMessage({ text = '', groupName = '', facts = {}, intent = 'other' } = {}) {
  if (!enabled() || !shouldUseAiOperationalFallback({ text, facts, intent })) return null;
  const reservation = await reserveDailyCall();
  if (!reservation.allowed) return { facts, intent, meta: { used: false, reason: 'daily_limit', ...reservation } };
  try {
    const result = await interpretWithOpenAI({ text, groupName });
    const merged = mergeAiOperationalInterpretation({ text, facts, intent, ai: result.data });
    return {
      facts: merged.facts,
      intent: merged.intent,
      meta: {
        used: merged.used,
        model: result.model,
        confidence: Number(result.data?.confidence || 0),
        dailyCall: reservation.calls,
        dailyLimit: reservation.limit,
        inputTokens: Number(result.usage?.input_tokens || 0),
        outputTokens: Number(result.usage?.output_tokens || 0),
      },
    };
  } catch (error) {
    return { facts, intent, meta: { used: false, reason: 'api_error', error: String(error?.message || error).slice(0, 180) } };
  }
}
