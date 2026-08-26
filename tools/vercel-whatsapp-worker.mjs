import express from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';
import chromium from '@sparticuz/chromium';
import whatsappWebJs from 'whatsapp-web.js';
import { createLearningStore, inferLearningIntent } from './learning-engine.mjs';
import { classifyRuntimeIntent, resolveGroupProfile, extractOperationalFacts, buildEvidenceChecklist, markEvidenceChecklist, appendOperationalTimeline, calculateApprovedCommercial, reconcileCommercial, learningContextForGroup, shouldStaySilent } from './operational-knowledge.mjs';
import { sanitizeExcludedAreas, matchExcludedArea } from './excluded-areas.mjs';
import { DEFAULT_WEEKLY_SCHEDULE, sanitizeWeeklySchedule, evaluateOperatingHours } from './operating-hours.mjs';
import { sanitizeBillingProfile, ensureBillingProfile, settlementForCall, upsertBillingBatch, financeEntryFromCall, sanitizeBillingBatch, updateBatchTemporalStatuses, buildInsurerSummaries, selectedGroupBillingView, closureReply } from './financial-engine.mjs';
import { MAX_CONCURRENT_CALLS, isCapacityActiveCall, activeCallsForCapacity, capacitySnapshot, plannedRemainingMinutes, capSecondCallEta } from './dispatch-capacity.mjs';
import { FREE_CANCELLATION_WINDOW_MINUTES, cancellationDeadlineFor, cancellationReply, enforceFullCancellationCommercial, evaluateCancellationPolicy } from './cancellation-policy.mjs';
import { ON_SITE_GRACE_MINUTES, WORKED_HOUR_RATE, addWorkedTimeToCommercial, evaluateWorkedTime } from './worked-time-policy.mjs';
import { driverPayForCall, driverPayrollPeriodFor, markDriverPayrollPaid, syncDriverPayrolls } from './driver-payroll.mjs';
import { importHistoricalRecords } from './historical-spreadsheet-import.mjs';
import { TEST_GROUP_NAME, TEST_MESSAGE_INTERVAL_MS, TEST_RESPONSE_TIMEOUT_MS, TEST_SCENARIOS, TEST_SUITE_VERSION, createTestRun, currentTestHistory, isTestCall, isTestGroupName, responseMatches, summarizeTestRun } from './test-center.mjs';
import { driverDispatchMessage, isConfirmedCall, publicEtaMinutes, primaryTruck, truckAvailability, whatsappChatId } from './simple-operation.mjs';

const { Client, LocalAuth } = whatsappWebJs;

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));

const port = Number(process.env.BOTGUINCHO_PLATFORM_PORT ?? 3001);
const clientId = process.env.WHATSAPP_CLIENT_ID ?? 'cliente-teste';
const adminToken = String(process.env.BOTGUINCHO_ADMIN_TOKEN ?? '').trim();
const dataDir = process.env.BOTGUINCHO_DATA_DIR ?? path.join(os.homedir(), '.botguincho-data');
const clientDir = path.join(dataDir, clientId);
const sessionDir = path.join(clientDir, 'whatsapp-session');
const simulatorSessionDir = path.join(clientDir, 'whatsapp-simulator-session');
const simulatorSessionRoot = path.join(simulatorSessionDir, `session-${clientId}-simulator`);
const simulatorAutoConnectFile = path.join(clientDir, 'whatsapp-simulator-enabled.json');
const testCenterFile = path.join(clientDir, 'test-center.json');
const settingsFile = path.join(clientDir, 'settings.json');
const groupsFile = path.join(clientDir, 'groups.json');
const registryFile = path.join(clientDir, 'group-registry.json');
const trackerReadingFile = path.join(clientDir, 'gconnect-reading.json');
const trackerPairFile = path.join(clientDir, 'gconnect-pair-code.txt');
const dispatchStateFile = path.join(clientDir, 'dispatch-state.json');
const geocodeCacheFile = path.join(clientDir, 'geocode-cache.json');
const managementFile = path.join(clientDir, 'management.json');
const auditFile = path.join(clientDir, 'audit.jsonl');
const groupKnowledgeFile = path.join(clientDir, 'group-knowledge.json');
const learningHistoryFile = path.join(clientDir, 'learning-history.jsonl');
const learningIndexFile = path.join(clientDir, 'learning-index.json');

function validAdminToken(value) {
  if (!adminToken) return true;
  const supplied = Buffer.from(String(Array.isArray(value) ? value[0] : value || ''));
  const expected = Buffer.from(adminToken);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

app.use('/api', (req, res, next) => {
  // O rastreador do motorista usa um código de pareamento próprio e não recebe
  // o segredo administrativo compartilhado entre Vercel e VPS.
  if (req.path === '/tracker-bridge') return next();
  if (validAdminToken(req.headers['x-botguincho-token'])) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
});

let aiCredential = process.env.OPENAI_API_KEY ?? '';
// Numa VPS o Chromium e o do sistema e roda com processos separados. Os argumentos
// do @sparticuz/chromium sao para AWS Lambda e trazem --single-process/--no-zygote:
// o renderizador passa a morar no mesmo processo do navegador, e qualquer travada
// do WhatsApp Web derruba tudo com "Target closed".
const SERVERLESS_ONLY_ARGS = new Set(['--single-process', '--no-zygote', '--in-process-gpu']);
function browserBaseArgs() {
  if (!process.env.PUPPETEER_EXECUTABLE_PATH) return chromium.args;
  return chromium.args.filter((arg) => !SERVERLESS_ONLY_ARGS.has(arg));
}

let waClient = null;
let waStatus = 'iniciando';
let qrDataUrl = null;
let lastError = null;
let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;
let whatsappRecoveryTimer = null;
let lastWhatsappRecoveryAt = 0;
let simulatorClient = null;
let simulatorStatus = 'desconectado';
let simulatorQrDataUrl = null;
let simulatorLastError = null;
let simulatorStartedAt = 0;
let simulatorWatchdog = null;
let simulatorRecoveryTimer = null;
let testCenterRuntime = { currentRun: null, targetGroupId: null, inbound: [] };

const activity = [];
const groupMemory = new Map();
const sharedLocations = new Map();
const routeProviderState = new Map();
const processedMessageIds = new Map();
const lastInboundByGroup = new Map();
const botReplyFingerprints = new Map();
const learningStore = createLearningStore({ knowledgeFile: groupKnowledgeFile, historyFile: learningHistoryFile, indexFile: learningIndexFile });

const SYSTEM_AI_RULES = `
REGRAS PRIORITÁRIAS DO BOT GUINCHO:
- Responda somente ao assunto operacional da mensagem atual.
- É proibido responder "Disponível", "Confirmado" ou equivalentes sem uma pergunta de disponibilidade ou uma autorização expressa vinculada a uma corrida registrada.
- Uma ficha completa, um protocolo, uma cotação ou a frase "confirmado" da própria central não equivalem, sozinhos, a "pode seguir".
- Consulta, cotação, dados recebidos, aguardando autorização, autorização, saída, chegada, ocorrência, evidência e fechamento são estados diferentes. Nunca reinicie o fluxo por causa de uma atualização.
- Acionamentos, disponibilidade, localização, ETA, cancelamento, hora trabalhada, estrada de terra e fechamento são tratados pelo código antes de chegar até você. Não tente refazer esses fluxos.
- Só peça dados quando o código indicar que faltam origem/localização, destino ou veículo. Não invente outras perguntas de triagem.
- Não faça listas ou checklists.
- Não termine com pergunta.
- Responda em português do Brasil, de forma natural e profissional, em no máximo duas linhas.
- Se a pessoa apenas informar uma condição operacional, como "a rua é estreita" ou "precisa caminhão menor", reconheça de forma curta, por exemplo "Entendido.".
- Nunca invente disponibilidade, localização, preço, ETA ou informação que não esteja no contexto.
- Comunicados internos, reuniões, cadastro, financeiro e avisos gerais devem ficar sem resposta.
- Nunca diga que é IA, bot ou modelo de linguagem.
`.trim();

const DEFAULT_SETTINGS = {
  companyName: 'Bot Guincho',
  simpleMode: true,
  aiEnabled: false,
  aiModel: process.env.OPENAI_MODEL ?? 'openai/gpt-5.4-mini',
  aiInstructions: 'Atenda somente mensagens operacionais relacionadas a guincho, reboque e assistência. Seja curto, direto e não faça perguntas de triagem.',
  replyEveryMessage: false,
  humanTakeover: false,
  serviceState: 'MG',
  priorityCities: [],
  excludedAreas: [],
  outOfRouteReply: 'Motorista fora de rota.',
  operatingHoursEnabled: false,
  operatingTimezone: 'America/Sao_Paulo',
  weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
  outOfHoursReply: 'Motorista fora de rota.',
  operationalBaseAddress: '',
};

const FLOW_ACTIVE_STATUSES = new Set(['autorizado', 'a_caminho', 'em_atendimento']);
const DEFAULT_TEST_COMMERCIAL_RULES = {
  detected: true,
  source: 'test_default',
  services: {
    leve: { basePrice: 135, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.8 },
    moto: { basePrice: 135, includedKm: 40, pricePerKm: 3, dirtRoadPricePerKm: 3.8 },
    utilitario: { basePrice: 160, includedKm: 40, pricePerKm: 3.2, dirtRoadPricePerKm: 3.8 },
  },
  workedHour: WORKED_HOUR_RATE,
  stoppedHour: WORKED_HOUR_RATE,
  tollAllowed: true,
};

function isFlowActiveCall(call = {}) {
  return FLOW_ACTIVE_STATUSES.has(String(call?.status || '').toLowerCase());
}

function commercialRulesForGroup(knowledge = null, groupName = '') {
  if (knowledge?.commercialStatus === 'approved' && knowledge?.approvedCommercialRules) {
    return { rules: knowledge.approvedCommercialRules, source: 'approved' };
  }
  if (knowledge?.draftCommercialRules?.detected) {
    return { rules: knowledge.draftCommercialRules, source: 'group_description' };
  }
  if (isTestGroupName(groupName)) {
    return { rules: DEFAULT_TEST_COMMERCIAL_RULES, source: 'test_default' };
  }
  return { rules: null, source: 'missing' };
}

function getAiClient() {
  if (!aiCredential) return null;
  return new OpenAI({ apiKey: aiCredential, baseURL: 'https://ai-gateway.vercel.sh/v1' });
}

function logEvent(type, message, meta = {}) {
  const entry = { id: Date.now() + Math.random(), at: new Date().toISOString(), type, message, meta };
  activity.unshift(entry);
  if (activity.length > 100) activity.length = 100;
  console.log(`[worker:${clientId}] ${type}: ${message}`);
  void ensureDir()
    .then(() => fs.appendFile(auditFile, `${JSON.stringify(entry)}\n`))
    .catch(() => undefined);
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

const DEFAULT_MANAGEMENT = {
  company: { name: 'Central Guincho', document: '', phone: '', email: '' },
  calls: [],
  clients: [],
  finance: [],
  billingProfiles: [],
  billingBatches: [],
  driverPayrolls: [],
  historicalImports: [],
  fleet: [{ id: 'fleet-gsw0h17', plate: 'GSW0H17', name: 'Guincho principal', status: 'disponivel', driver: '', notes: '' }],
  automations: [
    { id: 'auto-confirm', name: 'Confirmar acionamento automaticamente', enabled: true, trigger: 'dispatch', action: 'confirm_eta' },
    { id: 'auto-finance', name: 'Registrar corrida confirmada no financeiro', enabled: true, trigger: 'call_confirmed', action: 'create_receivable' },
    { id: 'auto-overdue', name: 'Destacar recebimentos vencidos', enabled: true, trigger: 'daily', action: 'flag_overdue' }
  ],
  updatedAt: null,
};

function normalizeManagement(data = {}) {
  return {
    company: { ...DEFAULT_MANAGEMENT.company, ...(data.company || {}) },
    calls: Array.isArray(data.calls) ? data.calls : [],
    clients: Array.isArray(data.clients) ? data.clients : [],
    finance: Array.isArray(data.finance) ? data.finance : [],
    billingProfiles: Array.isArray(data.billingProfiles) ? data.billingProfiles.map(sanitizeBillingProfile) : [],
    billingBatches: updateBatchTemporalStatuses(Array.isArray(data.billingBatches) ? data.billingBatches : []),
    driverPayrolls: Array.isArray(data.driverPayrolls) ? data.driverPayrolls : [],
    historicalImports: Array.isArray(data.historicalImports) ? data.historicalImports : [],
    fleet: Array.isArray(data.fleet) ? data.fleet : DEFAULT_MANAGEMENT.fleet,
    automations: Array.isArray(data.automations) ? data.automations : DEFAULT_MANAGEMENT.automations,
    updatedAt: data.updatedAt || null,
  };
}

async function getManagement() {
  return normalizeManagement(await readJson(managementFile, DEFAULT_MANAGEMENT));
}

async function saveManagement(next) {
  const normalized = normalizeManagement({ ...next, updatedAt: new Date().toISOString() });
  await writeJson(managementFile, normalized);
  return normalized;
}

function cleanManagementItem(value = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(value || {})) {
    if (typeof raw === 'string') out[key] = raw.trim().slice(0, 2000);
    else if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === 'boolean' || raw === null) out[key] = raw;
  }
  if (!out.id) out.id = crypto.randomUUID();
  if (!out.createdAt) out.createdAt = new Date().toISOString();
  out.updatedAt = new Date().toISOString();
  return out;
}

function managementAutomationEnabled(state, id) {
  return (state.automations || []).some((x) => x.id === id && x.enabled !== false);
}

function dispatchFingerprint({ groupId = '', vehicle = '', service = '', originAddress = '', destinationAddress = '' } = {}) {
  const normalized = [groupId, vehicle, service, originAddress, destinationAddress]
    .map((value) => normalizeForIntent(String(value || '')).replace(/\s+/g, ' ').trim())
    .join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

async function getGroupKnowledgeEntry(groupId) {
  const all = await learningStore.getAll();
  return all[groupId] || null;
}

function recentManagementCall(state, groupId, maxAgeMs = 48 * 60 * 60 * 1000) {
  const now = Date.now();
  return (state.calls || [])
    .filter((call) => {
      if (call.sourceGroupId !== groupId) return false;
      const age = now - new Date(call.updatedAt || call.createdAt || 0).getTime();
      return age >= 0 && age < maxAgeMs && !['concluido','cancelado'].includes(call.status);
    })
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0] || null;
}

function recentManagementRecord(state, groupId, maxAgeMs = 48 * 60 * 60 * 1000) {
  const now = Date.now();
  return (state.calls || [])
    .filter((call) => {
      if (call.sourceGroupId !== groupId) return false;
      const age = now - new Date(call.updatedAt || call.createdAt || 0).getTime();
      return age >= 0 && age < maxAgeMs;
    })
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0] || null;
}

function oldestActiveManagementCallForGroup(state, groupId) {
  return activeCallsForCapacity(state).find((call) => call.sourceGroupId === groupId) || null;
}

function routePointCoordinates(point) {
  if (!point || !validCoordinates(point.latitude, point.longitude)) return null;
  return { latitude: Number(point.latitude), longitude: Number(point.longitude) };
}

async function estimateSecondCallArrival({ management, targetAddress = null, targetCoordinates = null, excludeCallId = '' } = {}) {
  const capacity = capacitySnapshot(management, excludeCallId);
  if (!capacity.canAccept) {
    return { available: false, activeCount: capacity.activeCount, slotsAvailable: 0, eta: null };
  }

  if (capacity.activeCount === 0) {
    const direct = (targetAddress || targetCoordinates)
      ? await computeEtaWithRetry({ targetAddress, targetCoordinates }).catch(() => null)
      : null;
    return { available: true, activeCount: 0, slotsAvailable: capacity.slotsAvailable, eta: direct, queued: false };
  }

  // Há exatamente uma corrida ativa. A segunda pode ser aceita e entra na fila operacional.
  const current = capacity.activeCalls[0];
  let nextOrigin = targetCoordinates && validCoordinates(targetCoordinates.latitude, targetCoordinates.longitude)
    ? { latitude: Number(targetCoordinates.latitude), longitude: Number(targetCoordinates.longitude) }
    : null;
  if (!nextOrigin && targetAddress) nextOrigin = await geocodeAddress(targetAddress).catch(() => null);

  let activeDestination = routePointCoordinates(current?.routeBreakdown?.destination);
  if (!activeDestination && current?.destination) activeDestination = await geocodeAddress(current.destination).catch(() => null);

  const plannedRemaining = plannedRemainingMinutes(current);
  let liveRemaining = null;
  const reading = await getFreshTrackerReading().catch(() => null);
  const liveTruck = reading ? await trackerCoordinates(reading).catch(() => null) : null;
  if (liveTruck && activeDestination) {
    const liveRoute = await routeBetween(liveTruck, activeDestination).catch(() => null);
    liveRemaining = liveRoute?.minutes ?? null;
  }

  const remainingCandidates = [plannedRemaining, liveRemaining]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  let remainingToFinish = remainingCandidates.length ? Math.max(...remainingCandidates) : null;

  let handoff = null;
  if (activeDestination && nextOrigin) handoff = await routeBetween(activeDestination, nextOrigin).catch(() => null);

  const rawMinutes = Number.isFinite(Number(remainingToFinish)) && Number.isFinite(Number(handoff?.minutes))
    ? Number(remainingToFinish) + Number(handoff.minutes)
    : null;
  const capped = capSecondCallEta(rawMinutes, 60);
  const eta = {
    minutes: capped.minutes,
    rawMinutes: capped.rawMinutes,
    cappedAtOneHour: capped.cappedAtOneHour,
    queued: true,
    distanceKm: handoff?.distanceKm ?? null,
    precedingCallId: current?.id || null,
    precedingGroupId: current?.sourceGroupId || null,
    remainingPreviousMinutes: remainingToFinish,
    handoffMinutes: handoff?.minutes ?? null,
  };
  return {
    available: true,
    activeCount: 1,
    slotsAvailable: capacity.slotsAvailable,
    queued: true,
    eta,
    precedingCall: current,
  };
}

async function recordDispatchInManagement({ groupId, groupName, text, originAddress, destinationAddress, originCoordinates = null, eta, status = 'autorizado', facts = null, commercial: requestedCommercial = null, estimatedTotalKm = null, routeSnapshotOverride = null, evidenceChecklist = null, existingCallId = null, cancellation = null, serviceOutcome = null, arrival = null, workedTime = null, dirtRoad = null, dirtRoadEnd = null, eventType = null, phase = null, towPerformed = null }) {
  try {
    const state = await getManagement();
    const parsed = facts || extractOperationalFacts(text);
    const billingProfile = ensureBillingProfile(state, groupId, groupName);
    const routeOrigin = originAddress || parsed.origin || '';
    const routeDestination = destinationAddress || parsed.destination || '';
    let routeSnapshot = routeSnapshotOverride;
    if (!routeSnapshot && status === 'autorizado' && (routeOrigin || originCoordinates) && routeDestination) {
      routeSnapshot = await computeFullServiceRoute({ originAddress: routeOrigin || null, originCoordinates, destinationAddress: routeDestination, baseAddressOverride: billingProfile?.baseAddress || '' }).catch((error) => {
        logEvent('warning', 'Não foi possível congelar a rota completa do atendimento autorizado.', { error: String(error), groupId });
        return null;
      });
    }
    const vehicle = parsed.vehicle || extractLabeledField(text, 'Veículo') || extractLabeledField(text, 'Veiculo') || '';
    const service = parsed.service || extractLabeledField(text, 'Serviço') || extractLabeledField(text, 'Servico') || 'Reboque';
    const now = Date.now();
    const dispatchKey = dispatchFingerprint({ groupId, vehicle, service, originAddress, destinationAddress });
    const exact = state.calls.find((call) => {
      const age = now - new Date(call.createdAt || 0).getTime();
      if (call.dispatchKey && call.dispatchKey === dispatchKey && age < 6 * 60 * 60 * 1000) return true;
      return call.sourceGroupId === groupId && age < 30 * 60 * 1000 && call.origin === (originAddress || '') && call.destination === (destinationAddress || '') && !['concluido','cancelado'].includes(call.status);
    });
    const transitionCanAttach = ['aguardando_aprovacao','autorizado','agendado','cancelado','concluido'].includes(status);
    const explicitExisting = existingCallId ? state.calls.find((call) => call.id === existingCallId) || null : null;
    const recent = recentManagementCall(state, groupId);
    // Um novo pedido no mesmo grupo não pode sobrescrever uma corrida que já
    // está em execução. Atualizações de uma corrida ativa sempre passam o id.
    const recentCanAttach = transitionCanAttach && recent && !isFlowActiveCall(recent);
    const isActiveTestGroup = isTestGroupName(groupName) || (testCenterRuntime.currentRun?.status === 'running' && testCenterRuntime.targetGroupId === groupId);
    const passiveOpportunityStatus = ['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(status);
    const exactCanAttach = exact && !(passiveOpportunityStatus && isFlowActiveCall(exact));
    const candidateExisting = explicitExisting || exactCanAttach || (recentCanAttach ? recent : null);
    const existing = isActiveTestGroup && candidateExisting?.testMode !== true ? null : candidateExisting;
    const knowledge = await getGroupKnowledgeEntry(groupId);
    const checklist = Array.isArray(evidenceChecklist) ? evidenceChecklist : buildEvidenceChecklist(groupName, text);
    const previousChecklist = Array.isArray(existing?.evidenceChecklist) ? existing.evidenceChecklist : [];
    const mergedChecklist = [...previousChecklist];
    for (const item of checklist) {
      const index = mergedChecklist.findIndex((x) => x.label === item.label);
      if (index < 0) mergedChecklist.push(item);
      else mergedChecklist[index] = {
        ...mergedChecklist[index],
        ...item,
        done: mergedChecklist[index]?.done === true || item?.done === true,
        completedAt: mergedChecklist[index]?.completedAt || item?.completedAt || null,
      };
    }

    let autoBillableKm = billingProfile?.routeBasis === 'origin_destination'
      ? (routeSnapshot?.serviceLeg?.km ?? existing?.routeBreakdown?.serviceLeg?.km ?? estimatedTotalKm ?? existing?.estimatedTotalKm ?? null)
      : billingProfile?.routeBasis === 'insurer_reported'
        ? (parsed.totalKm ?? existing?.totalKm ?? null)
        : billingProfile?.routeBasis === 'manual'
          ? (isTestGroupName(groupName) ? (routeSnapshot?.totalKm ?? existing?.billableKm ?? estimatedTotalKm ?? existing?.estimatedTotalKm ?? null) : null)
          : (routeSnapshot?.totalKm ?? existing?.billableKm ?? estimatedTotalKm ?? existing?.estimatedTotalKm ?? null);

    const transitionAt = new Date().toISOString();
    const assignedFleet = (state.fleet || []).find((item) => item.status === 'em_servico' && item.driver) || (state.fleet || []).find((item) => item.driver) || (state.fleet || [])[0] || null;
    const isBillableCancellation = status === 'cancelado' && cancellation?.chargeRequired === true;
    const displacementWithoutTow = serviceOutcome?.type === 'deslocamento_sem_reboque';
    if (isBillableCancellation && Number.isFinite(Number(cancellation?.billableKm))) {
      autoBillableKm = Number(cancellation.billableKm);
    }
    if (displacementWithoutTow && Number.isFinite(Number(serviceOutcome?.billableKm))) {
      autoBillableKm = Number(serviceOutcome.billableKm);
    }
    const resolvedRules = commercialRulesForGroup(knowledge, groupName);
    let commercial = requestedCommercial;
    if (!commercial && (isFlowActiveCall({ status }) || status === 'concluido' || isBillableCancellation)) {
      const automaticFacts = {
        ...parsed,
        vehicleType: parsed.vehicleType || existing?.vehicleType || null,
        totalKm: autoBillableKm ?? parsed.totalKm ?? routeSnapshot?.totalKm ?? existing?.billableKm ?? existing?.totalKm ?? null,
        extras: {
          ...(parsed.extras || {}),
          dirtRoadKm: parsed.extras?.dirtRoadKm ?? dirtRoad?.billableKm ?? existing?.dirtRoadBillableKm ?? 0,
        },
      };
      commercial = reconcileCommercial({ approvedRules: resolvedRules.rules, facts: automaticFacts, estimatedTotalKm: automaticFacts.totalKm });
      commercial.ruleSource = resolvedRules.source;
    }
    const authorizedAt = status === 'autorizado'
      ? (existing?.authorizedAt || transitionAt)
      : (existing?.authorizedAt || null);
    const cancellationDeadlineAt = authorizedAt
      ? (existing?.cancellationDeadlineAt || cancellationDeadlineFor(authorizedAt))
      : (existing?.cancellationDeadlineAt || null);

    let value = Number(existing?.value || 0);
    const financiallyFinalized = status === 'concluido' || isBillableCancellation;
    const financiallyTracked = isConfirmedCall({ status }) || isBillableCancellation;
    if (financiallyTracked && commercial?.status === 'ok' && Number(commercial.calculatedAmount) > 0) value = Number(commercial.calculatedAmount);
    if (financiallyTracked && commercial?.reviewRequired) value = 0;

    const groupProfile = resolveGroupProfile(groupName);
    const associationMissing = financiallyFinalized && groupProfile.associationRequired === true && !(parsed.association || existing?.association);
    const incompleteEvidence = financiallyFinalized && mergedChecklist.some((item) => item?.done !== true);
    const commercialReviewRequired = commercial ? commercial.reviewRequired === true : existing?.commercialReviewRequired === true;
    const commercialReviewReason = commercial?.reviewRequired
      ? (commercial.reviewReason || `Valor informado diverge do cálculo aprovado em ${commercial.delta ?? 'valor não calculável'}.`)
      : (commercialReviewRequired ? existing?.commercialReviewReason || '' : '');
    const reviewReasons = [
      commercialReviewReason,
      associationMissing ? 'A associação responsável precisa ser informada antes do faturamento.' : '',
      incompleteEvidence ? 'Existem evidências obrigatórias pendentes antes do faturamento.' : '',
    ].filter(Boolean);
    const financeReviewRequired = reviewReasons.length > 0;
    if (financiallyFinalized && financeReviewRequired) value = 0;
    if (financiallyFinalized && !financeReviewRequired && !(value > 0)) {
      const resolvedCalculatedValue = Number(commercial?.calculatedAmount ?? existing?.calculatedValue ?? 0);
      if (resolvedCalculatedValue > 0) value = resolvedCalculatedValue;
    }

    const derivedEventType = eventType || ({
      cotacao: 'consulta_registrada', aguardando_aprovacao: 'aguardando_autorizacao', autorizado: 'autorizacao',
      a_caminho: 'saida', em_atendimento: 'atendimento_no_local', agendado: 'agendamento',
      cancelado: 'cancelamento', concluido: 'fechamento', aguardando_dados: 'dados_incompletos',
    })[status] || 'atualizacao';
    const operationalTimeline = appendOperationalTimeline(existing?.operationalTimeline || [], {
      at: transitionAt,
      type: derivedEventType,
      fromStatus: existing?.status || null,
      toStatus: status,
      text,
      meta: {
        phase: phase || existing?.operationalPhase || null,
        protocol: parsed.protocol || null,
        cancellationChargeRequired: cancellation?.chargeRequired === true,
        workedTimeAmount: workedTime?.amount ?? null,
        dirtRoadBillableKm: dirtRoad?.billableKm ?? existing?.dirtRoadBillableKm ?? null,
      },
    });

    const patch = {
      id: existing?.id || crypto.randomUUID(),
      dispatchKey: existing?.dispatchKey || dispatchKey,
      vehicle: vehicle || existing?.vehicle || 'Veículo não informado',
      vehicleType: parsed.vehicleType || existing?.vehicleType || '',
      plate: parsed.plate || existing?.plate || '',
      service: service || existing?.service || 'Reboque',
      client: groupName || existing?.client || 'Seguradora',
      insurer: groupName || existing?.insurer || '',
      driverId: existing?.driverId || assignedFleet?.driverId || assignedFleet?.id || 'driver-primary',
      driverName: existing?.driverName || assignedFleet?.driver || 'Motorista principal',
      driverFleetId: existing?.driverFleetId || assignedFleet?.id || null,
      association: parsed.association || existing?.association || '',
      protocol: parsed.protocol || existing?.protocol || '',
      associatedName: parsed.associatedName || existing?.associatedName || '',
      contactPhone: parsed.contactPhone || existing?.contactPhone || '',
      serviceReason: parsed.serviceReason || existing?.serviceReason || '',
      companions: parsed.companions ?? existing?.companions ?? null,
      origin: originAddress || parsed.origin || existing?.origin || '',
      originCoordinates: originCoordinates || routePointCoordinates(routeSnapshot?.origin) || existing?.originCoordinates || null,
      destination: destinationAddress || parsed.destination || existing?.destination || '',
      status,
      value,
      source: 'whatsapp',
      sourceGroupId: groupId,
      etaMinutes: eta?.minutes ?? existing?.etaMinutes ?? null,
      distanceKm: eta?.distanceKm ?? existing?.distanceKm ?? null,
      totalKm: isBillableCancellation ? autoBillableKm : (parsed.totalKm ?? routeSnapshot?.totalKm ?? existing?.totalKm ?? null),
      billableKm: autoBillableKm,
      routeBreakdown: routeSnapshot || existing?.routeBreakdown || null,
      routeCapturedAt: routeSnapshot?.capturedAt || existing?.routeCapturedAt || null,
      estimatedTotalKm: estimatedTotalKm ?? routeSnapshot?.totalKm ?? existing?.estimatedTotalKm ?? null,
      reportedValue: parsed.centralReportedValue ?? existing?.reportedValue ?? null,
      calculatedValue: commercial?.calculatedAmount ?? existing?.calculatedValue ?? null,
      commercialRuleStatus: resolvedRules.source === 'test_default' ? 'test_default' : (knowledge?.commercialStatus || existing?.commercialRuleStatus || 'none'),
      commercialRuleSource: commercial?.ruleSource || resolvedRules.source || existing?.commercialRuleSource || 'missing',
      financeReviewRequired,
      financeReviewReason: reviewReasons.join(' '),
      commercialReviewRequired,
      commercialReviewReason,
      evidenceChecklist: mergedChecklist,
      evidenceComplete: mergedChecklist.length === 0 || mergedChecklist.every((item) => item?.done === true),
      operationalTimeline,
      operationalPhase: phase || existing?.operationalPhase || null,
      scheduledAt: parsed.scheduledAt || existing?.scheduledAt || null,
      lastOperationalText: String(text || '').slice(0, 4000),
      completedAt: status === 'concluido' ? transitionAt : (existing?.completedAt || null),
      serviceOutcome: displacementWithoutTow ? 'deslocamento_sem_reboque' : (existing?.serviceOutcome || null),
      towPerformed: displacementWithoutTow ? false : (towPerformed ?? existing?.towPerformed ?? null),
      arrivalConfirmed: (displacementWithoutTow || arrival) ? true : (existing?.arrivalConfirmed === true),
      arrivalConfirmedAt: displacementWithoutTow ? (serviceOutcome.arrivedAt || transitionAt) : (arrival?.arrivedAt || existing?.arrivalConfirmedAt || null),
      arrivalSource: arrival?.source || existing?.arrivalSource || null,
      onSiteGraceDeadlineAt: (arrival?.arrivedAt || existing?.arrivalConfirmedAt)
        ? (existing?.onSiteGraceDeadlineAt || new Date(new Date(arrival?.arrivedAt || existing.arrivalConfirmedAt).getTime() + ON_SITE_GRACE_MINUTES * 60_000).toISOString())
        : null,
      onSiteFinishedAt: workedTime?.finishedAt || existing?.onSiteFinishedAt || null,
      onSiteElapsedMinutes: workedTime?.elapsedMinutes ?? existing?.onSiteElapsedMinutes ?? null,
      onSiteGraceMinutes: workedTime ? ON_SITE_GRACE_MINUTES : (existing?.onSiteGraceMinutes ?? ON_SITE_GRACE_MINUTES),
      workedTimeChargeRequired: workedTime?.chargeRequired === true || existing?.workedTimeChargeRequired === true,
      workedTimeChargedHours: workedTime?.chargedHours ?? existing?.workedTimeChargedHours ?? 0,
      workedTimeHourlyRate: workedTime ? WORKED_HOUR_RATE : (existing?.workedTimeHourlyRate ?? WORKED_HOUR_RATE),
      workedTimeAmount: workedTime?.amount ?? existing?.workedTimeAmount ?? 0,
      workedTimeRoundingRule: workedTime?.roundingRule || existing?.workedTimeRoundingRule || 'hora_iniciada_apos_tolerancia',
      dirtRoadStartCoordinates: dirtRoad?.startCoordinates || existing?.dirtRoadStartCoordinates || null,
      dirtRoadCapturedAt: dirtRoad?.capturedAt || existing?.dirtRoadCapturedAt || null,
      dirtRoadEndCoordinates: dirtRoadEnd?.endCoordinates || existing?.dirtRoadEndCoordinates || null,
      dirtRoadEndedAt: dirtRoadEnd?.endedAt || existing?.dirtRoadEndedAt || null,
      dirtRoadOneWayKm: dirtRoad?.oneWayKm ?? existing?.dirtRoadOneWayKm ?? null,
      dirtRoadBillableKm: dirtRoad?.billableKm ?? existing?.dirtRoadBillableKm ?? null,
      dirtRoadRatePerKm: dirtRoad ? 3.8 : (existing?.dirtRoadRatePerKm ?? 3.8),
      dirtRoadChargeAmount: dirtRoad ? Math.round(Number(dirtRoad.billableKm || 0) * 3.8 * 100) / 100 : (existing?.dirtRoadChargeAmount ?? null),
      dirtRoadRoundTrip: dirtRoad ? true : (existing?.dirtRoadRoundTrip === true),
      displacementChargeRequired: displacementWithoutTow ? true : (existing?.displacementChargeRequired === true),
      displacementChargeBasis: displacementWithoutTow ? 'trajeto_ate_origem' : (existing?.displacementChargeBasis || null),
      displacementBillableKm: displacementWithoutTow ? Number(serviceOutcome.billableKm || 0) : (existing?.displacementBillableKm ?? null),
      displacementPartialPaymentAllowed: displacementWithoutTow ? false : (existing?.displacementPartialPaymentAllowed ?? null),
      displacementCalculatedAmount: displacementWithoutTow ? (commercial?.calculatedAmount ?? null) : (existing?.displacementCalculatedAmount ?? null),
      authorizedAt,
      cancellationDeadlineAt,
      cancellationWindowMinutes: authorizedAt ? FREE_CANCELLATION_WINDOW_MINUTES : (existing?.cancellationWindowMinutes || null),
      cancelledAt: status === 'cancelado' ? (cancellation?.cancelledAt || transitionAt) : (existing?.cancelledAt || null),
      cancellationElapsedMinutes: status === 'cancelado' ? (cancellation?.elapsedMinutes ?? null) : (existing?.cancellationElapsedMinutes ?? null),
      cancellationWithinFreeWindow: status === 'cancelado' ? cancellation?.withinFreeWindow === true : (existing?.cancellationWithinFreeWindow ?? null),
      cancellationChargeRequired: status === 'cancelado' ? isBillableCancellation : (existing?.cancellationChargeRequired === true),
      cancellationChargeType: status === 'cancelado' ? (cancellation?.chargeType || 'sem_cobranca') : (existing?.cancellationChargeType || null),
      cancellationChargeBasis: status === 'cancelado' ? (cancellation?.chargeBasis || 'none') : (existing?.cancellationChargeBasis || null),
      cancellationPartialPaymentAllowed: authorizedAt ? false : (existing?.cancellationPartialPaymentAllowed ?? null),
      cancellationBillableKm: isBillableCancellation ? autoBillableKm : (status === 'cancelado' ? 0 : (existing?.cancellationBillableKm ?? null)),
      cancellationReportedAmount: status === 'cancelado' ? (commercial?.reportedAmount ?? parsed.centralReportedValue ?? null) : (existing?.cancellationReportedAmount ?? null),
      cancellationReportedAmountRejected: status === 'cancelado' ? commercial?.reportedAmountRejected === true : (existing?.cancellationReportedAmountRejected === true),
      cancellationRejectedReportedAmount: status === 'cancelado' ? (commercial?.rejectedReportedAmount ?? null) : (existing?.cancellationRejectedReportedAmount ?? null),
      cancellationCalculatedAmount: isBillableCancellation ? (commercial?.calculatedAmount ?? null) : (existing?.cancellationCalculatedAmount ?? null),
      cancellationChargeStatus: status === 'cancelado'
        ? (isBillableCancellation ? (Number(commercial?.calculatedAmount) > 0 ? 'integral_calculada' : 'aguardando_tabela') : 'sem_cobranca_no_prazo')
        : (existing?.cancellationChargeStatus || null),
      valueSource: displacementWithoutTow && Number(commercial?.calculatedAmount) > 0 ? 'deslocamento_ate_origem' : (isBillableCancellation && Number(commercial?.calculatedAmount) > 0 ? 'politica_cancelamento_km_total' : (status === 'autorizado' && Number(commercial?.calculatedAmount) > 0 ? 'estimativa_na_confirmacao' : (existing?.valueSource || null))),
      createdAt: existing?.createdAt || transitionAt,
      updatedAt: transitionAt,
      testMode: existing?.testMode === true || isTestGroupName(groupName) || (testCenterRuntime.currentRun?.status === 'running' && testCenterRuntime.targetGroupId === groupId),
      testRunId: existing?.testRunId || (testCenterRuntime.targetGroupId === groupId ? testCenterRuntime.currentRun?.id || null : null),
    };

    if (existing) state.calls = state.calls.map((x) => x.id === existing.id ? { ...x, ...patch } : x);
    else state.calls.unshift(patch);
    if (isConfirmedCall(patch)) ensureConfirmedFinanceTracking(state, patch, { finalized: status === 'concluido' });
    if (isBillableCancellation) maybeCreateFinanceFromBillableCall(state, patch);
    if (status === 'cancelado' && !isBillableCancellation) removeUnbilledConfirmedTracking(state, patch.id);
    if (isConfirmedCall(patch) || status === 'cancelado') syncDriverPayrolls(state);
    await saveManagement(state);
    logEvent('management', `${groupName}: chamado ${existing ? 'atualizado' : 'criado'} → ${status}.`, { callId: patch.id, commercialStatus: patch.commercialRuleStatus, financeReviewRequired: patch.financeReviewRequired, cancellationChargeRequired: patch.cancellationChargeRequired, cancellationBillableKm: patch.cancellationBillableKm });
    return patch;
  } catch (error) {
    logEvent('warning', 'Não foi possível registrar o estado operacional na gestão.', { error: String(error) });
    return null;
  }
}

function confirmedFinanceAmount(item = {}) {
  const candidates = [item.value, item.calculatedValue, item.estimatedValue]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  return candidates[0] || 0;
}

function ensureConfirmedFinanceTracking(state, item, { finalized = false } = {}) {
  if (!item || item?.historicalImport === true || isTestCall(item) || !managementAutomationEnabled(state, 'auto-finance')) return null;
  const amount = confirmedFinanceAmount(item);
  const profile = ensureBillingProfile(state, item.sourceGroupId || '', item.insurer || item.client || '');
  const settlementAt = item.authorizedAt || item.completedAt || item.updatedAt || item.createdAt || new Date();
  const settlement = settlementForCall(profile, item, settlementAt);
  const batch = settlement.status === 'ok' ? upsertBillingBatch(state, { ...item, value: amount }, profile, settlement) : null;
  const now = new Date().toISOString();
  let entry = (state.finance || []).find((candidate) => candidate.sourceCallId === item.id && candidate.type === 'receita');
  const patch = {
    description: `Corrida ${finalized ? 'concluída' : 'confirmada'} · ${item.insurer || item.client || 'Transportadora'} · ${item.vehicle || 'Veículo'}`,
    category: finalized ? 'Serviço de guincho' : 'Corrida confirmada',
    amount,
    type: 'receita',
    status: entry?.status === 'pago' ? 'pago' : 'pendente',
    financialStage: finalized ? 'faturado' : 'a_faturar',
    needsValueReview: !(amount > 0),
    dueDate: settlement.dueDate || entry?.dueDate || null,
    client: item.client || item.insurer || '',
    insurer: item.insurer || item.client || '',
    groupId: item.sourceGroupId || '',
    sourceCallId: item.id,
    billingBatchId: batch?.id || entry?.billingBatchId || null,
    billableKm: Number(item.billableKm ?? item.totalKm ?? item.estimatedTotalKm ?? 0),
    billingPeriodStart: settlement.batch?.periodStart || entry?.billingPeriodStart || null,
    billingPeriodEnd: settlement.batch?.periodEnd || entry?.billingPeriodEnd || null,
    statementDue: settlement.batch?.statementDue || entry?.statementDue || null,
    invoiceDue: settlement.batch?.invoiceDue || entry?.invoiceDue || null,
    paymentDue: settlement.batch?.paymentDue || settlement.dueDate || entry?.paymentDue || null,
    source: 'confirmation_automation',
    updatedAt: now,
  };
  if (entry) Object.assign(entry, patch);
  else {
    entry = { id: crypto.randomUUID(), ...patch, createdAt: now };
    state.finance.unshift(entry);
  }

  const call = (state.calls || []).find((candidate) => candidate.id === item.id);
  if (call) {
    call.billingProfileId = profile.id;
    call.billingBatchId = batch?.id || call.billingBatchId || null;
    call.paymentRuleStatus = settlement.status;
    call.paymentDue = settlement.dueDate || null;
    call.billingPeriodStart = settlement.batch?.periodStart || null;
    call.billingPeriodEnd = settlement.batch?.periodEnd || null;
    call.driverPayStatus = 'previsto';
  }
  return entry;
}

function removeUnbilledConfirmedTracking(state, callId) {
  const entries = (state.finance || []).filter((entry) => entry.sourceCallId === callId && entry.type === 'receita' && entry.status !== 'pago');
  if (!entries.length) return;
  state.finance = (state.finance || []).filter((entry) => !entries.some((removed) => removed.id === entry.id));
  for (const batch of state.billingBatches || []) {
    batch.callIds = (batch.callIds || []).filter((id) => id !== callId);
    const included = (state.calls || []).filter((call) => batch.callIds.includes(call.id));
    batch.callCount = included.length;
    batch.totalAmount = Math.round(included.reduce((sum, call) => sum + confirmedFinanceAmount(call), 0) * 100) / 100;
    batch.totalKm = Math.round(included.reduce((sum, call) => sum + Number(call.billableKm || call.totalKm || 0), 0) * 100) / 100;
  }
}

function maybeCreateFinanceFromBillableCall(state, item) {
  if (item?.historicalImport === true || isTestCall(item)) return;
  const billableCancellation = item?.status === 'cancelado' && item?.cancellationChargeRequired === true;
  if (!item || (item.status !== 'concluido' && !billableCancellation) || !managementAutomationEnabled(state, 'auto-finance')) return;
  const confirmedEntry = (state.finance || []).find((entry) => entry.sourceCallId === item.id && entry.type === 'receita');
  if (confirmedEntry) {
    ensureConfirmedFinanceTracking(state, item, { finalized: true });
    return;
  }
  if (item.financeReviewRequired === true || !(Number(item.value) > 0)) return;

  const profile = ensureBillingProfile(state, item.sourceGroupId || '', item.insurer || item.client || '');
  const settlementAt = billableCancellation ? item.cancelledAt : item.completedAt;
  const settlement = settlementForCall(profile, item, settlementAt || item.updatedAt || new Date());
  if (settlement.status !== 'ok') {
    const call = (state.calls || []).find((x) => x.id === item.id);
    if (call) {
      call.paymentRuleStatus = settlement.status;
      call.paymentDue = settlement.dueDate || null;
    }
    return;
  }

  const batch = upsertBillingBatch(state, item, profile, settlement);
  const entry = financeEntryFromCall(item, settlement, batch);
  if (!entry) return;
  state.finance.unshift(entry);
  const call = (state.calls || []).find((x) => x.id === item.id);
  if (call) {
    call.billingProfileId = profile.id;
    call.billingBatchId = batch?.id || null;
    call.paymentRuleStatus = 'ok';
    call.paymentDue = settlement.dueDate || null;
    call.billingPeriodStart = settlement.batch?.periodStart || null;
    call.billingPeriodEnd = settlement.batch?.periodEnd || null;
  }
}

async function applyManagementAction(body = {}) {
  const state = await getManagement();
  const action = String(body.action || 'get');
  const collection = String(body.collection || '');
  const allowed = new Set(['calls','clients','finance','fleet','automations']);

  if (action === 'replace_company') {
    state.company = { ...state.company, ...cleanManagementItem(body.item || {}) };
    delete state.company.id; delete state.company.createdAt; delete state.company.updatedAt;
    return saveManagement(state);
  }
  if (!allowed.has(collection)) throw new Error('collection_invalid');
  if (action === 'upsert') {
    const item = cleanManagementItem(body.item || {});
    const idx = state[collection].findIndex((x) => x.id === item.id);
    if (idx >= 0) state[collection][idx] = { ...state[collection][idx], ...item };
    else state[collection].unshift(item);
    if (collection === 'calls') {
      const savedCall = idx >= 0 ? state[collection][idx] : state[collection][0];
      if (body.item?.status === 'concluido' && Number(body.item?.value || 0) > 0) {
        savedCall.financeReviewRequired = false;
        savedCall.financeReviewReason = '';
        savedCall.financeReviewResolvedAt = new Date().toISOString();
        savedCall.valueSource = 'manual';
      }
      if (isConfirmedCall(savedCall)) ensureConfirmedFinanceTracking(state, savedCall, { finalized: savedCall.status === 'concluido' });
      else maybeCreateFinanceFromBillableCall(state, savedCall);
      if (savedCall.status === 'cancelado' && savedCall.cancellationChargeRequired !== true) removeUnbilledConfirmedTracking(state, savedCall.id);
      syncDriverPayrolls(state);
    }
    return saveManagement(state);
  }
  if (action === 'delete') {
    const id = String(body.id || '');
    state[collection] = state[collection].filter((x) => x.id !== id);
    return saveManagement(state);
  }
  if (action === 'toggle_automation') {
    const id = String(body.id || '');
    state.automations = state.automations.map((x) => x.id === id ? { ...x, enabled: body.enabled !== false, updatedAt: new Date().toISOString() } : x);
    return saveManagement(state);
  }
  throw new Error('action_invalid');
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

const GROUPS_SYNC_TIMEOUT_MS = 9000;
let liveDiscoveryInFlight = null;

async function savedGroupsList() {
  const previousRegistry = await getRegistry();
  const allowed = await getAllowedGroupIds();
  return Object.values(previousRegistry)
    .map((group) => ({ ...group, selected: allowed.has(group.id) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

async function discoverGroups() {
  if (!liveDiscoveryInFlight) {
    const started = discoverGroupsLive();
    started
      .catch(() => undefined)
      .finally(() => {
        if (liveDiscoveryInFlight === started) liveDiscoveryInFlight = null;
      });
    liveDiscoveryInFlight = started;
  }
  const running = liveDiscoveryInFlight;

  let timer = null;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve('__timeout__'), GROUPS_SYNC_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([running.catch(() => '__failed__'), guard]);
    if (result === '__timeout__' || result === '__failed__') {
      logEvent('warning', 'Sincronizacao ao vivo dos grupos nao respondeu; devolvendo a lista salva no servidor.');
      return await savedGroupsList();
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function discoverGroupsLive() {
  const previousRegistry = await getRegistry();
  const allowed = await getAllowedGroupIds();

  if (waClient && waStatus === 'pronto') {
    const discovered = new Map();
    const addGroup = (id, name, description = '') => {
      if (typeof id !== 'string' || !id.endsWith('@g.us')) return;
      discovered.set(id, {
        id,
        name: String(name || previousRegistry[id]?.name || 'Grupo do WhatsApp'),
        description: String(description || ''),
        lastSeenAt: new Date().toISOString(),
      });
    };

    try {
      const chats = await waClient.getChats();
      for (const chat of chats ?? []) {
        const id = chat?.id?._serialized || '';
        if (chat?.isGroup || id.endsWith('@g.us')) addGroup(id, chat?.name || chat?.formattedTitle, chat?.description || chat?.groupMetadata?.desc || '');
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
          try { chats = await window.WWebJS?.getChats?.(); } catch {}
          if (!Array.isArray(chats) || !chats.length) {
            try { chats = window.require?.('WAWebCollections')?.Chat?.getModelsArray?.() ?? []; } catch {}
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

    if (discovered.size) {
      // Fonte da verdade = conta do WhatsApp atualmente conectada.
      // Remove grupos antigos do registry e também permissões que não existem na conta atual.
      const nextRegistry = Object.fromEntries([...discovered.entries()]);
      await writeJson(registryFile, nextRegistry);
      for (const group of discovered.values()) await learningStore.syncGroup({ groupId: group.id, name: group.name, description: group.description || '' });

      const validAllowed = [...allowed].filter((id) => discovered.has(id));
      if (validAllowed.length !== allowed.size) {
        await setAllowedGroupIds(validAllowed);
        logEvent('security', `${allowed.size - validAllowed.length} autorização(ões) de grupo antigo removida(s) após troca/reconexão do WhatsApp.`);
      }

      logEvent('system', `${discovered.size} grupo(s) sincronizado(s) da conta atual do WhatsApp.`);
      return [...discovered.values()]
        .map((group) => ({ ...group, selected: validAllowed.includes(group.id) }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
    }
  }

  // Se o WhatsApp ainda não terminou de carregar, não destrói o registry salvo.
  // Porém esta lista só é fallback temporário até uma sincronização bem-sucedida.
  return Object.values(previousRegistry)
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
    .replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, (match) => match.replace(/\s+/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeDispatch(text = '') {
  const value = normalizeForIntent(text);
  const hasService = /\b(reboque|guincho|servico selecionado|assistencia 24h|remocao|acionamento)\b/.test(value);
  const hasOrigin = /\b(?:endereco\s+(?:de\s+)?)?origem\b/.test(value);
  const hasDestination = /\b(?:endereco\s+(?:de\s+)?)?destino\b/.test(value);
  const hasVehicleOrProblem = /\b(veiculo|carro|moto|pane|fiat|ford|chevrolet|volkswagen|renault|toyota|honda|hyundai|idea|gol|onix|ka|strada|palio|uno|classic)\b/.test(value);
  return (hasService && (hasOrigin || hasDestination || hasVehicleOrProblem)) || (hasOrigin && hasDestination);
}

function asksAvailability(text = '') {
  const value = normalizeForIntent(text);
  if (/^consegue\s*\?+$/.test(value)) return true;
  if (/\bconsegue\s+(?:fazer|atender|pegar|buscar|ir|assumir|realizar)\b/.test(value)) return true;
  return /\b(disponivel|disponibilidade|tem guincho|tem reboque|consegue atender|pode atender|tem como atender|esta livre|ta livre|disponivel para remocao|disponivel para o reboque)\b/.test(value);
}

function greetingReply(text = '') {
  const value = normalizeForIntent(text).replace(/[!.,;:?]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(bom dia|oi bom dia|ola bom dia|opa bom dia)$/.test(value)) return 'Bom dia! 👋';
  if (/^(boa tarde|oi boa tarde|ola boa tarde|opa boa tarde)$/.test(value)) return 'Boa tarde! 👋';
  if (/^(boa noite|oi boa noite|ola boa noite|opa boa noite)$/.test(value)) return 'Boa noite! 👋';
  if (/^(oi|ola|opa)$/.test(value)) return 'Olá! 👋';
  return null;
}

function asksEta(text = '') {
  const value = normalizeForIntent(text);
  // ATALHOS_FALLBACK: "60?", "chegando?", "proximo?" tambem sao perguntas de tempo.
  const shortMinutes = value.match(/^(\d{2,3})\s*\?+$/);
  if (shortMinutes) {
    const minutes = Number(shortMinutes[1]);
    if (minutes >= 10 && minutes <= 180 && minutes % 5 === 0) return true;
  }
  if (/^(?:ja\s+)?(?:chegou|chegando|chegaram)\s*\?+$/.test(value)
    || /^(?:achou|localizou|encontrou)\s*\?+$/.test(value)
    || /^proximos?\s*\?+$/.test(value)) return true;
  return /\b(quanto tempo|qual (?:o )?tempo|qual (?:a )?previa|previa|tempo de distancia|previsao de chegada|previsao|quanto demora|demora|eta|chega em|chegada|tempo (?:ate|para|pra) chegar|temp(?:o)? (?:ate|para|pra) chegar)\b/.test(value);
}

function asksDistance(text = '') {
  const value = normalizeForIntent(text);
  if (/^kms?\s*\?+$/.test(value)) return true;
  return /\b(qual (?:a )?distancia|quanto(?:s)? km|quantos quilometros|distancia (?:ate|para|pro|do guincho|do local|do cliente)|km totais?|quilometragem(?: total)?)\b/.test(value);
}

function asksTrackerLocation(text = '') {
  const value = normalizeForIntent(text);
  return /\b(onde esta o guincho|onde ta o guincho|localizacao do guincho|localizacao atual|posicao do guincho|posicao atual)\b/.test(value);
}

function formatKm(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null;
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null;
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
  const pattern = new RegExp(`^(?:${escapedAliases.join('|')})\\b\\s*(?:[:\\-]\\s*)?(.*)$`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeForIntent(line);
    const normalizedMatch = normalized.match(pattern);
    if (!normalizedMatch) continue;

    const inlineValueNormalized = normalizedMatch?.[1]?.trim();
    if (inlineValueNormalized) {
      // Remove o rótulo mantendo a grafia original do endereço.
      const labelRegex = target === 'origem'
        ? /^\s*(?:endere[cç]o\s+(?:de\s+)?)?origem\s*(?:[:\-]\s*)?/i
        : /^\s*(?:endere[cç]o\s+(?:de\s+)?)?destino\s*(?:[:\-]\s*)?/i;
      const inlineValue = line.replace(labelRegex, '').trim();
      if (inlineValue) return inlineValue;
    }

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
  if (!Number.isFinite(age) || age > 2 * 60 * 60 * 1000) return null;
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
  // v3 invalida coordenadas antigas que possam ter sido salvas para uma cidade homonima.
  return `v3:${normalizeForIntent(cleanAddressQuery(address))}`;
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

const DEFAULT_SERVICE_STATE = 'MG';
const DEFAULT_PRIORITY_CITIES = [
  'Belo Horizonte','Betim','Contagem','Nova Lima','Ribeirão das Neves','Sabará','Santa Luzia',
  'Ibirité','Confins','Lagoa Santa','Vespasiano','Pedro Leopoldo','São José da Lapa','Matozinhos',
  'Sarzedo','Mário Campos','Brumadinho','Igarapé','Juatuba','Mateus Leme','Esmeraldas','Caeté',
  'Nova União','Rio Acima','Raposos','Itaguara','Itatiaiuçu','Florestal','Baldim','Capim Branco',
];
let configuredServiceState = DEFAULT_SERVICE_STATE;
let configuredPriorityCities = [...DEFAULT_PRIORITY_CITIES];
let configuredPriorityKeys = configuredPriorityCities.map((city) => normalizeForIntent(city));

async function refreshServiceArea() {
  const settings = await getSettings();
  const state = normalizeBrazilState(settings.serviceState || DEFAULT_SERVICE_STATE);
  configuredServiceState = state || DEFAULT_SERVICE_STATE;
  const cities = Array.isArray(settings.priorityCities) ? settings.priorityCities.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80) : [];
  configuredPriorityCities = cities.length ? cities : (configuredServiceState === 'MG' ? [...DEFAULT_PRIORITY_CITIES] : []);
  configuredPriorityKeys = configuredPriorityCities.map((city) => normalizeForIntent(city));
}

function serviceAreaLabel() {
  return configuredPriorityCities.length ? `${configuredServiceState} · cidades prioritárias configuradas` : configuredServiceState;
}

function explicitBrazilState(value = '') {
  const state = detectBrazilState(value);
  return state || '';
}

function isExplicitlyOutOfCoverage(value = '') {
  const state = explicitBrazilState(value);
  return Boolean(state && state !== configuredServiceState);
}

function preferredRmbhCity(value = '') {
  const normalized = normalizeForIntent(value);
  const index = configuredPriorityKeys.findIndex((key) => normalized.includes(key));
  return index >= 0 ? configuredPriorityCities[index] : '';
}

async function reverseGeocodeState(coordinates) {
  if (!coordinates || !validCoordinates(coordinates.latitude, coordinates.longitude)) return '';
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(coordinates.latitude));
    url.searchParams.set('lon', String(coordinates.longitude));
    url.searchParams.set('zoom', '10');
    url.searchParams.set('addressdetails', '1');
    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/2.0 (cobertura-configuravel; https://botguincho.vercel.app/)',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return '';
    const data = await response.json();
    const address = data?.address || {};
    return normalizeBrazilState(address.state || String(address['ISO3166-2-lvl4'] || '').split('-').pop() || '');
  } catch (error) {
    logEvent('warning', 'Não foi possível validar UF das coordenadas.', { error: String(error) });
    return '';
  }
}

async function targetWithinServiceArea({ address = null, coordinates = null } = {}) {
  if (address && isExplicitlyOutOfCoverage(address)) return false;
  if (coordinates && validCoordinates(coordinates.latitude, coordinates.longitude)) {
    const state = await reverseGeocodeState(coordinates);
    if (state) return state === configuredServiceState;
  }
  return true;
}

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

function normalizeLabeledBrazilAddress(value = '') {
  return cleanAddressQuery(value)
    .replace(/\bBAIRRO\s*:\s*/gi, ', ')
    .replace(/\bCIDADE\s*:\s*/gi, ', ')
    .replace(/\bESTADO\s*:\s*/gi, ', ')
    .replace(/\b(?:PA[IÍ]S|PAS)\s*:\s*(?:BRASIL)?/gi, '')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+-\s*,/g, ',')
    .replace(/,\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBrazilAddress(address = '') {
  const query = normalizeLabeledBrazilAddress(address);
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

function geocoderResultMatchesExpected(found, expected = null) {
  if (!expected) return true;
  const expectedState = normalizeBrazilState(expected.state || '');
  const expectedCities = uniqueQueries([
    ...(Array.isArray(expected.cities) ? expected.cities : []),
    expected.city || '',
  ]).map(normalizeForIntent).filter(Boolean);

  const actualState = normalizeBrazilState(found?.state || '');
  const actualCity = normalizeForIntent(found?.city || '');
  const display = normalizeForIntent(found?.displayName || '');

  if (expectedState) {
    if (actualState && actualState !== expectedState) return false;
    if (!actualState) return false;
  }

  if (expectedCities.length) {
    const cityMatches = expectedCities.some((expectedCity) => {
      if (actualCity && (actualCity === expectedCity || actualCity.includes(expectedCity) || expectedCity.includes(actualCity))) return true;
      return display.includes(expectedCity);
    });
    if (!cityMatches) return false;
  }

  return true;
}

async function nominatimLookup(params, expected = null) {
  return scheduleNominatim(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', expected ? '5' : '1');
    url.searchParams.set('countrycodes', 'br');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/1.4 (operacao-guincho; https://botguincho.vercel.app/)',
        referer: 'https://botguincho.vercel.app/',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`Geocodificação HTTP ${response.status}`);
    const results = await response.json();
    if (!Array.isArray(results)) return null;

    for (const item of results) {
      if (!item || !validCoordinates(item.lat, item.lon)) continue;
      const address = item.address || {};
      const found = {
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        displayName: item.display_name || '',
        postcode: address.postcode || null,
        city: address.city || address.town || address.municipality || address.village || address.county || '',
        state: address.state || String(address['ISO3166-2-lvl4'] || '').split('-').pop() || '',
      };
      if (geocoderResultMatchesExpected(found, expected)) return found;
    }
    return null;
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
    .replace(/(?:,\s*)?\bBrasil\b\s*$/i, '')
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

async function photonLookup(query, expected = null) {
  try {
    const url = new URL('https://photon.komoot.io/api/');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    const response = await fetch(url, {
      headers: { 'user-agent': 'BotGuincho/1.4 (+https://botguincho.vercel.app/)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    for (const feature of features) {
      const coords = feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const properties = feature?.properties || {};
      const countryCode = String(properties.countrycode || '').toUpperCase();
      if (countryCode && countryCode !== 'BR') continue;
      if (!validCoordinates(coords[1], coords[0])) continue;
      const found = {
        latitude: Number(coords[1]),
        longitude: Number(coords[0]),
        displayName: [properties.name, properties.street, properties.district, properties.city, properties.county, properties.state].filter(Boolean).join(', '),
        city: properties.city || properties.town || properties.county || properties.district || '',
        state: properties.state || '',
      };
      if (geocoderResultMatchesExpected(found, expected)) return found;
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
  const explicitState = detectBrazilState(query);
  if (explicitState && explicitState !== configuredServiceState) {
    logEvent('coverage', `Endereço fora da cobertura: ${query}`, { explicitState });
    return null;
  }
  const priorityCity = preferredRmbhCity(query);
  const expectedLocation = {
    state: explicitState || configuredServiceState,
    cities: uniqueQueries([
      priorityCity,
      ...(explicitState ? [parts.city, ...looseAddressCandidates(query).map((candidate) => candidate.city)] : []),
      ...(!explicitState && !priorityCity ? configuredPriorityCities : []),
    ]),
  };

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
        const found = await nominatimLookup({ q: variant }, { city: byCep.localidade, state: byCep.uf }).catch(() => null);
        if (found) return save(found, 'viacep-direct+nominatim');
      }
    }
  }

  if (parts.street && parts.city) {
    const structured = await nominatimLookup({
      street: [parts.number, parts.street].filter(Boolean).join(' '),
      city: parts.city,
      state: parts.state || configuredServiceState,
      postalcode: parts.cep || undefined,
      country: 'Brasil',
    }, expectedLocation).catch((error) => {
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
    const found = await nominatimLookup({ q: variant }, expectedLocation).catch((error) => {
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
    }, { city: cep.localidade, state: cep.uf }).catch(() => null);
    if (found) return save(found, 'viacep-address+nominatim');
  }

  for (const loose of looseAddressCandidates(query)) {
    const cepItem = await findCepByAddress({ street: loose.street, number: loose.number, district: '', city: loose.city, state: loose.state }).catch(() => null);
    if (!cepItem?.cep) continue;
    const variant = [cepItem.logradouro || loose.street, loose.number, cepItem.bairro, `${cepItem.localidade} - ${cepItem.uf}`, cepItem.cep, 'Brasil'].filter(Boolean).join(', ');
    const found = await nominatimLookup({ q: variant }, { city: cepItem.localidade || loose.city, state: cepItem.uf || loose.state }).catch(() => null);
    if (found) return save(found, 'viacep-loose+nominatim');
  }

  for (const variant of buildLookupVariants(query)) {
    const found = await photonLookup(variant, expectedLocation);
    if (found) return save(found, 'photon-fallback');
  }

  logEvent('warning', 'Endereco nao geocodificado apos todos os fallbacks.', { query, parts });
  return null;
}

function routeProviderCanTry(name) {
  const state = routeProviderState.get(name);
  return !state?.openUntil || Date.now() >= state.openUntil;
}

function routeProviderSuccess(name) {
  routeProviderState.set(name, { failures: 0, openUntil: 0, lastSuccessAt: new Date().toISOString() });
}

function routeProviderFailure(name) {
  const current = routeProviderState.get(name) || { failures: 0, openUntil: 0 };
  const failures = Number(current.failures || 0) + 1;
  const openUntil = failures >= 3 ? Date.now() + 2 * 60 * 1000 : 0;
  routeProviderState.set(name, { ...current, failures, openUntil, lastFailureAt: new Date().toISOString() });
  if (openUntil) logEvent('circuit-breaker', `Roteador ${name} suspenso por 2 minutos após ${failures} falhas.`);
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
    if (!routeProviderCanTry(provider.name)) {
      logEvent('route-fallback', `Roteador ${provider.name} temporariamente em circuit breaker; usando alternativa.`);
      continue;
    }
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
      routeProviderSuccess(provider.name);
      if (provider.name !== 'osrm-main') {
        logEvent('route-fallback', `Rota calculada pelo fallback ${provider.name}.`);
      }
      return {
        minutes: Math.max(1, Math.ceil(Number(route.duration) / 60)),
        distanceKm: Number.isFinite(Number(route.distance)) ? Math.round(Number(route.distance) / 100) / 10 : null,
      };
    } catch (error) {
      lastError = error;
      routeProviderFailure(provider.name);
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

async function computeEtaWithRetry(input = {}, options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts || 3)));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const eta = await computeEtaToClient(input);
      if (eta) {
        if (attempt > 1) logEvent('recovery', `ETA recuperado na tentativa ${attempt}.`);
        return eta;
      }
      lastError = new Error('ETA indisponível sem erro explícito.');
    } catch (error) {
      lastError = error;
      logEvent('warning', `Tentativa ${attempt}/${attempts} de ETA falhou.`, { error: String(error) });
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
  }
  if (lastError) logEvent('safety', 'ETA suspenso após tentativas; nenhum dado antigo será reutilizado.', { error: String(lastError) });
  return null;
}


async function computeFullServiceRoute({ originAddress = null, destinationAddress = null, originCoordinates = null, baseAddressOverride = '' } = {}) {
  const settings = await getSettings();
  const baseAddress = String(baseAddressOverride || settings.operationalBaseAddress || '').trim();
  if ((!originAddress && !originCoordinates) || !destinationAddress) return null;

  const reading = await getFreshTrackerReading();
  if (!reading) return null;
  const start = await trackerCoordinates(reading);
  if (!start) return null;
  const origin = originCoordinates && validCoordinates(originCoordinates.latitude, originCoordinates.longitude)
    ? { latitude: Number(originCoordinates.latitude), longitude: Number(originCoordinates.longitude), displayName: originAddress || 'Localização compartilhada' }
    : await geocodeAddress(originAddress);
  const destination = await geocodeAddress(destinationAddress);
  // Sem uma base configurada, fecha o circuito no ponto real de saída do
  // caminhão. Assim o cálculo continua completo e auditável, sem inventar um
  // endereço de retorno.
  const base = baseAddress ? await geocodeAddress(baseAddress) : { ...start, displayName: reading.address || 'Ponto de saída do caminhão' };
  if (!origin || !destination || !base) return null;

  const legToOrigin = await routeBetween(start, origin);
  const serviceLeg = await routeBetween(origin, destination);
  const returnToBase = await routeBetween(destination, base);
  if (!legToOrigin || !serviceLeg || !returnToBase) return null;
  const totalKm = Math.round((Number(legToOrigin.distanceKm || 0) + Number(serviceLeg.distanceKm || 0) + Number(returnToBase.distanceKm || 0)) * 10) / 10;
  const totalMinutes = Number(legToOrigin.minutes || 0) + Number(serviceLeg.minutes || 0) + Number(returnToBase.minutes || 0);
  return {
    capturedAt: new Date().toISOString(),
    basis: baseAddress ? 'truck_origin_destination_base' : 'truck_origin_destination_start',
    start: { address: reading.address || '', latitude: start.latitude, longitude: start.longitude },
    origin: { address: originAddress || origin.displayName || '', latitude: origin.latitude, longitude: origin.longitude },
    destination: { address: destinationAddress, latitude: destination.latitude, longitude: destination.longitude },
    base: { address: baseAddress || reading.address || 'Ponto de saída do caminhão', latitude: base.latitude, longitude: base.longitude },
    legToOrigin: { km: legToOrigin.distanceKm, minutes: legToOrigin.minutes },
    serviceLeg: { km: serviceLeg.distanceKm, minutes: serviceLeg.minutes },
    returnToBase: { km: returnToBase.distanceKm, minutes: returnToBase.minutes },
    totalKm,
    totalMinutes,
    routing: 'osrm_with_fallback',
  };
}

const TRACKER_ARRIVAL_RADIUS_KM = 0.25;
const TRACKER_EXIT_RADIUS_KM = 0.45;
const TRACKER_STOP_SPEED_KPH = 3;
const TRACKER_EXIT_SPEED_KPH = 5;
const TRACKER_ARRIVAL_READINGS = 2;

function distanceBetweenCoordinatesKm(a, b) {
  if (!validCoordinates(a?.latitude, a?.longitude) || !validCoordinates(b?.latitude, b?.longitude)) return null;
  const radians = (degrees) => Number(degrees) * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const deltaLat = radians(Number(b.latitude) - Number(a.latitude));
  const deltaLon = radians(Number(b.longitude) - Number(a.longitude));
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function trackerCallCommercial(call, knowledge, groupName, workedTime = null) {
  const resolution = commercialRulesForGroup(knowledge, groupName);
  const totalKm = call.billableKm ?? call.routeBreakdown?.totalKm ?? call.totalKm ?? call.estimatedTotalKm ?? null;
  const facts = {
    vehicleType: call.vehicleType || null,
    totalKm,
    extras: { dirtRoadKm: call.dirtRoadBillableKm ?? 0 },
  };
  let commercial = reconcileCommercial({ approvedRules: resolution.rules, facts, estimatedTotalKm: totalKm });
  if (workedTime) commercial = addWorkedTimeToCommercial(commercial, workedTime);
  return { ...commercial, ruleSource: resolution.source };
}

async function sendTrackerNotice(groupId, text) {
  if (!waClient || waStatus !== 'pronto' || !groupId || !text) return false;
  try {
    botReplyFingerprints.set(`${groupId}|${normalizeForIntent(text)}`, Date.now());
    await waClient.sendMessage(groupId, text);
    logEvent('tracker-notice', text, { groupId });
    return true;
  } catch (error) {
    logEvent('warning', 'Não foi possível enviar o aviso automático do rastreador.', { groupId, error: String(error) });
    return false;
  }
}

async function reconcileTrackerOperations(reading) {
  const truck = await trackerCoordinates(reading).catch(() => null);
  if (!truck) return;
  const state = await getManagement();
  const allActive = (state.calls || [])
    .filter((call) => isFlowActiveCall(call))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

  // A central de testes pode acumular simulações abertas. Somente a simulação
  // mais recente de cada grupo participa da automação do rastreador.
  const selected = [];
  const selectedTestGroups = new Set();
  for (const call of allActive) {
    if (isTestCall(call)) {
      if (selectedTestGroups.has(call.sourceGroupId)) continue;
      selectedTestGroups.add(call.sourceGroupId);
    }
    selected.push(call);
  }
  if (!selected.length) return;

  const now = new Date();
  const notices = [];
  let changed = false;
  for (const call of selected) {
    let origin = routePointCoordinates(call.originCoordinates) || routePointCoordinates(call.routeBreakdown?.origin);
    if (!origin && call.origin) origin = await geocodeAddress(call.origin).catch(() => null);
    if (!origin) continue;
    const distanceKm = distanceBetweenCoordinatesKm(truck, origin);
    if (!Number.isFinite(distanceKm)) continue;
    const speed = reading.speedKph === null || reading.speedKph === undefined ? null : Number(reading.speedKph);
    const stopped = Number.isFinite(speed) ? speed <= TRACKER_STOP_SPEED_KPH : reading.ignition === 'off';
    const next = { ...call, trackerLastDistanceToOriginKm: Math.round(distanceKm * 1000) / 1000, trackerLastReadingAt: reading.receivedAt || now.toISOString() };

    if (!call.arrivalConfirmedAt) {
      if (distanceKm <= TRACKER_ARRIVAL_RADIUS_KM && stopped) {
        const isNewReading = call.trackerArrivalCandidateLastReadingAt !== reading.receivedAt;
        next.trackerArrivalCandidateAt = call.trackerArrivalCandidateAt || now.toISOString();
        next.trackerArrivalCandidateReadings = Number(call.trackerArrivalCandidateReadings || 0) + (isNewReading ? 1 : 0);
        next.trackerArrivalCandidateLastReadingAt = reading.receivedAt || now.toISOString();
        if (next.trackerArrivalCandidateReadings >= TRACKER_ARRIVAL_READINGS) {
          const arrivedAt = now.toISOString();
          next.status = 'em_atendimento';
          next.operationalPhase = 'no_local_cliente';
          next.arrivalConfirmed = true;
          next.arrivalConfirmedAt = arrivedAt;
          next.arrivalSource = 'tracker_geofence';
          next.arrivalTrackerDistanceKm = next.trackerLastDistanceToOriginKm;
          next.onSiteGraceMinutes = ON_SITE_GRACE_MINUTES;
          next.onSiteGraceDeadlineAt = new Date(now.getTime() + ON_SITE_GRACE_MINUTES * 60_000).toISOString();
          next.trackerArrivalNoticePending = true;
          next.operationalTimeline = appendOperationalTimeline(call.operationalTimeline || [], {
            at: arrivedAt, type: 'chegada_automatica', fromStatus: call.status, toStatus: 'em_atendimento',
            text: 'Chegada detectada automaticamente pelo rastreador.',
            meta: { source: 'tracker_geofence', distanceKm: next.arrivalTrackerDistanceKm, graceMinutes: ON_SITE_GRACE_MINUTES },
          });
          logEvent('tracker-arrival', `${call.client || call.insurer}: chegada automática detectada.`, { callId: call.id, groupId: call.sourceGroupId, distanceKm });
        }
      } else {
        next.trackerArrivalCandidateAt = null;
        next.trackerArrivalCandidateReadings = 0;
        next.trackerArrivalCandidateLastReadingAt = null;
      }
    } else if (!call.onSiteFinishedAt) {
      const workedTime = evaluateWorkedTime({ arrivedAt: call.arrivalConfirmedAt, finishedAt: now });
      const previousHours = Number(call.workedTimeChargedHours || 0);
      next.onSiteElapsedMinutes = workedTime.elapsedMinutes;
      next.workedTimeChargeRequired = workedTime.chargeRequired;
      next.workedTimeChargedHours = workedTime.chargedHours;
      next.workedTimeHourlyRate = WORKED_HOUR_RATE;
      next.workedTimeAmount = workedTime.amount;
      const knowledge = await getGroupKnowledgeEntry(call.sourceGroupId);
      const commercial = trackerCallCommercial(next, knowledge, call.client || call.insurer || '', workedTime);
      if (commercial.calculatedAmount !== null && commercial.calculatedAmount !== undefined && Number.isFinite(Number(commercial.calculatedAmount))) {
        next.calculatedValue = commercial.calculatedAmount;
        next.commercialRuleSource = commercial.ruleSource;
      }
      if (workedTime.chargedHours > previousHours) next.trackerWorkedHourNoticePending = workedTime.chargedHours;

      if (distanceKm > TRACKER_EXIT_RADIUS_KM && Number.isFinite(speed) && speed >= TRACKER_EXIT_SPEED_KPH) {
        next.onSiteFinishedAt = now.toISOString();
        next.status = 'a_caminho';
        next.operationalPhase = 'em_deslocamento_destino';
        next.trackerDepartureNoticePending = true;
        next.operationalTimeline = appendOperationalTimeline(call.operationalTimeline || [], {
          at: now.toISOString(), type: 'saida_local_automatica', fromStatus: call.status, toStatus: 'a_caminho',
          text: 'Saída do local do cliente detectada automaticamente pelo rastreador.',
          meta: { elapsedMinutes: workedTime.elapsedMinutes, workedTimeAmount: workedTime.amount },
        });
      }
    }

    next.updatedAt = now.toISOString();
    state.calls = state.calls.map((item) => item.id === call.id ? next : item);
    changed = true;

    if (next.trackerArrivalNoticePending && !next.trackerArrivalNotifiedAt) {
      const deadline = new Date(next.onSiteGraceDeadlineAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
      notices.push({ callId: next.id, groupId: next.sourceGroupId, type: 'arrival', text: `Chegada detectada pelo localizador ✅\nOs 15 minutos de tolerância começaram agora, até ${deadline}. A partir do 16º minuto, será cobrada a primeira hora inteira de R$ 80,00.` });
    }
    if (Number(next.trackerWorkedHourNoticePending || 0) > Number(next.trackerWorkedHoursNotified || 0)) {
      const hours = Number(next.trackerWorkedHourNoticePending);
      const total = formatCurrency(next.calculatedValue);
      notices.push({ callId: next.id, groupId: next.sourceGroupId, type: 'worked', hours, text: `Tempo no local ultrapassou 15 minutos. Hora trabalhada registrada: ${hours} hora(s) iniciada(s) × R$ 80,00 = ${formatCurrency(hours * WORKED_HOUR_RATE)}.${total ? `\nValor atualizado do atendimento: ${total}.` : ''}` });
    }
    if (next.trackerDepartureNoticePending && !next.trackerDepartureNotifiedAt) {
      const total = formatCurrency(next.calculatedValue);
      notices.push({ callId: next.id, groupId: next.sourceGroupId, type: 'departure', text: `Saída do local do cliente detectada pelo localizador ✅\nTempo no local: ${next.onSiteElapsedMinutes || 0} min.${next.workedTimeAmount > 0 ? ` Hora trabalhada: ${formatCurrency(next.workedTimeAmount)}.` : ''}${total ? ` Valor atualizado: ${total}.` : ''}` });
    }
  }

  if (changed) await saveManagement(state);
  for (const notice of notices) {
    if (!(await sendTrackerNotice(notice.groupId, notice.text))) continue;
    const latest = await getManagement();
    latest.calls = latest.calls.map((call) => {
      if (call.id !== notice.callId) return call;
      if (notice.type === 'arrival') return { ...call, trackerArrivalNoticePending: false, trackerArrivalNotifiedAt: new Date().toISOString() };
      if (notice.type === 'worked') return { ...call, trackerWorkedHourNoticePending: null, trackerWorkedHoursNotified: notice.hours, trackerWorkedHourNotifiedAt: new Date().toISOString() };
      return { ...call, trackerDepartureNoticePending: false, trackerDepartureNotifiedAt: new Date().toISOString() };
    });
    await saveManagement(latest);
  }
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
  const knowledgeEntry = await getGroupKnowledgeEntry(groupId);
  const learnedContext = learningContextForGroup(groupName, knowledgeEntry);

  const memory = memoryOverride ?? groupMemory.get(groupId) ?? [];
  const context = memory
    .map((item) => `${item.role === 'assistant' ? 'Atendente' : 'Pessoa'}: ${item.text}`)
    .join('\n');
  const live = trackerContext ? `\n\nDADOS AO VIVO LIDOS DO APP GCONNECT NO ANDROID:\n${trackerContext}` : '';
  const content = [{
    type: 'input_text',
    text: `Grupo: ${groupName || groupId}\nAutor: ${author || 'participante'}\n\nCONHECIMENTO APRENDIDO DO GRUPO:\n${learnedContext}\n\nHistórico recente:\n${context || '(sem histórico)'}${live}\n\nMensagem atual:\n${text || '[mensagem sem texto]'}`,
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
  botReplyFingerprints.set(`${msg.from}|${normalizeForIntent(reply)}`, Date.now());
  await msg.reply(reply);
  remember(msg.from, 'user', incomingText);
  remember(msg.from, 'assistant', reply);
  logEvent('reply', `${groupName}: ${reply}`, { groupId: msg.from, ...meta });
}

function formatEtaReply(eta, withConfirmation = false) {
  const minutes = publicEtaMinutes(eta?.rawMinutes ?? eta?.minutes);
  if (!minutes) return withConfirmation ? 'Confirmado ✅\nGuincho em deslocamento.' : null;
  const etaLine = `Previsão de chegada: ${minutes} min.`;
  return withConfirmation ? `Confirmado ✅\nGuincho em deslocamento.\n${etaLine}` : etaLine;
}

async function notifyDriverOfConfirmedCall(call, { force = false } = {}) {
  if (!call?.id || isTestCall(call)) return { sent: false, reason: 'not_applicable' };
  const state = await getManagement();
  const saved = (state.calls || []).find((item) => item.id === call.id) || call;
  const truck = (state.fleet || []).find((item) => item.id === saved.driverFleetId) || primaryTruck(state) || {};
  const chatId = whatsappChatId(truck.driverPhone || truck.phone || '');
  const fingerprint = `${saved.protocol || 'sem-protocolo'}|${saved.origin || ''}|${saved.destination || ''}`;
  if (!force && saved.driverNotificationFingerprint === fingerprint && saved.driverNotifiedAt) {
    return { sent: false, reason: 'already_sent', at: saved.driverNotifiedAt };
  }

  const target = (state.calls || []).find((item) => item.id === saved.id);
  if (!chatId) {
    if (target) {
      target.driverNotificationStatus = 'aguardando_telefone';
      target.driverNotificationError = 'Cadastre o WhatsApp do motorista na tela Operação.';
      target.updatedAt = new Date().toISOString();
      await saveManagement(state);
    }
    return { sent: false, reason: 'driver_phone_missing' };
  }
  if (!waClient || waStatus !== 'pronto') return { sent: false, reason: 'whatsapp_not_ready' };

  try {
    await waClient.sendMessage(chatId, driverDispatchMessage(saved, truck));
    const sentAt = new Date().toISOString();
    if (target) {
      target.driverNotifiedAt = sentAt;
      target.driverNotificationStatus = 'enviado';
      target.driverNotificationError = '';
      target.driverNotificationFingerprint = fingerprint;
      target.driverPhone = String(truck.driverPhone || truck.phone || '');
      target.updatedAt = sentAt;
      await saveManagement(state);
    }
    logEvent('driver-dispatch', `${saved.insurer || saved.client || 'Transportadora'}: corrida enviada ao motorista.`, { callId: saved.id, protocol: saved.protocol || null });
    return { sent: true, at: sentAt };
  } catch (error) {
    if (target) {
      target.driverNotificationStatus = 'erro';
      target.driverNotificationError = String(error?.message || error).slice(0, 300);
      target.updatedAt = new Date().toISOString();
      await saveManagement(state);
    }
    logEvent('warning', 'Não foi possível enviar a corrida ao motorista.', { callId: saved.id, error: String(error) });
    return { sent: false, reason: 'send_failed', error: String(error) };
  }
}

async function handleDispatch(msg, groupName, readableText, location) {
  const originAddress = extractLabeledField(readableText, 'Origem');
  const destinationAddress = extractLabeledField(readableText, 'Destino');
  if (originAddress && isExplicitlyOutOfCoverage(originAddress)) {
    await replyAndRemember(msg, groupName, readableText, `Fora da área de atendimento. Atendemos somente ${configuredServiceState}.`, { intent: 'dispatch-out-of-coverage', originAddress });
    return;
  }
  const shared = await getRecentSharedLocation(msg.from);
  const originCoordinates = location || (!originAddress ? shared?.coordinates || null : null);
  const originMoment = originCoordinates && !originAddress && shared?.at
    ? new Date(shared.at).toISOString()
    : new Date().toISOString();
  const vehicle = extractLabeledField(readableText, 'Veículo') || extractLabeledField(readableText, 'Veiculo') || '';
  const service = extractLabeledField(readableText, 'Serviço') || extractLabeledField(readableText, 'Servico') || 'Reboque';

  const management = await getManagement();
  const arrival = await estimateSecondCallArrival({
    management,
    targetAddress: originAddress || null,
    targetCoordinates: originCoordinates || null,
  });
  if (!arrival.available) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: arrival.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    logEvent('capacity', `${groupName}: terceira corrida recusada; limite simultâneo atingido.`, { groupId: msg.from, activeCount: arrival.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const dispatchKey = dispatchFingerprint({ groupId: msg.from, vehicle, service, originAddress, destinationAddress });
  const previousState = await getDispatchState(msg.from);
  const dispatchId = previousState?.activeDispatchKey === dispatchKey && previousState?.activeDispatchId
    ? previousState.activeDispatchId
    : crypto.randomUUID();

  const state = await setDispatchState(msg.from, {
    activeDispatchId: dispatchId,
    activeDispatchKey: dispatchKey,
    activeDispatchStartedAt: previousState?.activeDispatchKey === dispatchKey ? previousState.activeDispatchStartedAt : new Date().toISOString(),
    originAddress: originAddress || null,
    originCoordinates: originCoordinates || null,
    destinationAddress: destinationAddress || null,
    originUpdatedAt: originMoment,
  });

  const eta = arrival.eta;
  if (eta) {
    await setDispatchState(msg.from, { lastEta: eta, lastEtaAt: new Date().toISOString() });
    logEvent('route', `${groupName}: ETA ${eta.cappedAtOneHour ? '1h (limite operacional)' : `${eta.minutes} min`}.`, { groupId: msg.from, queued: eta.queued === true, rawMinutes: eta.rawMinutes ?? eta.minutes });
  }

  await recordDispatchInManagement({
    groupId: msg.from,
    groupName,
    text: readableText,
    originAddress: state.originAddress,
    originCoordinates: state.originCoordinates,
    destinationAddress: state.destinationAddress,
    eta,
    status: 'aguardando_aprovacao',
    eventType: 'solicitacao_recebida',
    phase: 'aguardando_autorizacao',
  });

  const reply = eta
    ? `Disponível ✅\n${formatEtaReply(eta, false)}\nAguardando confirmação para seguir.`
    : 'Disponível ✅\nEstou atualizando a localização para calcular a previsão.\nAguardando confirmação para seguir.';
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: eta ? 'dispatch' : 'dispatch-safe-mode',
    etaMinutes: eta?.minutes ?? null,
    queued: eta?.queued === true,
    rawEtaMinutes: eta?.rawMinutes ?? eta?.minutes ?? null,
    dispatchId,
    dispatchKey,
  });
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
  const management = await getManagement().catch(() => ({ calls: [] }));
  const recentCall = recentManagementCall(management, groupId);
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
    targetAddress: explicitAddress || state?.originAddress || recentCall?.origin || null,
    targetCoordinates: explicitAddress ? null : (sharedIsNewer ? shared.coordinates : state?.originCoordinates || recentCall?.originCoordinates || null),
    source: inlineAddress
      ? 'inline-address'
      : quotedAddress
        ? 'quoted-address'
        : sharedIsNewer
          ? shared.source
          : state?.originAddress || state?.originCoordinates
            ? 'dispatch-state'
            : recentCall?.origin || recentCall?.originCoordinates
              ? 'management-call'
              : 'dispatch-state',
    recentCall,
  };
}

async function handleEtaQuestion(msg, groupName, readableText, quotedText = '', context = null) {
  const target = await resolveRouteQuestionTarget(msg.from, readableText, quotedText);
  if (!target.targetAddress && !target.targetCoordinates) {
    logEvent('ignored', `${groupName}: pergunta de ETA sem destino identificável ignorada.`, { groupId: msg.from });
    return;
  }
  if (!(await targetWithinServiceArea({ address: target.targetAddress, coordinates: target.targetCoordinates }))) {
    await replyAndRemember(msg, groupName, readableText, `Fora da área de atendimento. Atendemos somente ${configuredServiceState}.`, { intent: 'out-of-coverage', targetSource: target.source });
    return;
  }

  let eta = null;
  try {
    eta = await computeEtaWithRetry({
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
    await replyAndRemember(msg, groupName, readableText, 'Estou atualizando a localização para calcular a previsão. Tente novamente em alguns segundos.', { intent: 'eta-unavailable', targetSource: target.source });
    return;
  }

  await setDispatchState(msg.from, {
    lastEta: eta,
    lastEtaAt: new Date().toISOString(),
    ...(target.source === 'inline-address' || target.source === 'quoted-address'
      ? { originAddress: target.targetAddress, originCoordinates: null, originUpdatedAt: new Date().toISOString() }
      : {}),
  });
  const call = context?.recentCall || target.recentCall || null;
  if (call) {
    await recordDispatchInManagement({
      groupId: msg.from, groupName, text: readableText,
      originAddress: call.origin || target.targetAddress || null,
      originCoordinates: call.originCoordinates || target.targetCoordinates || null,
      destinationAddress: call.destination || null,
      eta, status: call.status || 'cotacao', facts: extractOperationalFacts(readableText),
      estimatedTotalKm: call.estimatedTotalKm ?? null,
      existingCallId: call.id, eventType: 'previsao_atualizada',
      phase: call.operationalPhase || 'consulta',
    });
  }
  const reply = formatEtaReply(eta, false);
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: 'eta',
    etaMinutes: eta.minutes,
    distanceKm: eta.distanceKm,
    targetSource: target.source,
    targetAddress: target.targetAddress,
  });
}

// Le um endereco escrito em texto livre, mesmo quando a mensagem tambem pergunta
// outra coisa ("Disponivel?", "Qual a previa?"). Escolhe a primeira linha que comeca
// com um logradouro, para nao levar a pergunta junto e sujar a geocodificacao.
function enderecoEmTextoLivre(text = '') {
  const bruto = String(text || '').replace(/\r/g, ' ').trim();
  if (!bruto) return null;
  const mapa = extractMapsUrl(bruto);
  if (mapa) return mapa;
  const coordenadas = coordinatesFromText(bruto);
  if (coordenadas) return `${coordenadas.latitude},${coordenadas.longitude}`;
  const linhas = bruto.split('\n').map((linha) => linha.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const linha of [...linhas, bruto.replace(/\s+/g, ' ').trim()]) {
    if (linha.length < 10) continue;
    const normalizada = normalizeForIntent(linha);
    if (!/^(?:rua|r\.?|avenida|av\.?|alameda|travessa|estrada|rodovia|rod\.?|praca|largo|via|marginal|fazenda|sitio|condominio|loteamento)\b/i.test(normalizada)) continue;
    return normalizeAddressForLookup(linha);
  }
  return null;
}

function extractStandaloneAddressTarget(text = '') {
  const raw = String(text || '').replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length < 5) return null;
  if (looksLikeDispatch(raw) || asksEta(raw) || asksDistance(raw) || asksAvailability(raw) || asksTrackerLocation(raw) || greetingReply(raw)) return null;

  const mapUrl = extractMapsUrl(raw);
  if (mapUrl) return mapUrl;
  const coordinates = coordinatesFromText(raw);
  if (coordinates) return `${coordinates.latitude},${coordinates.longitude}`;
  if (extractCep(raw) && raw.replace(/\D/g, '').length >= 8) return normalizeAddressForLookup(raw);

  const normalized = normalizeForIntent(raw);
  const startsLikeStreet = /^(?:rua|r\.?|avenida|av\.?|alameda|travessa|estrada|rodovia|rod\.?|praca|largo|via|marginal|fazenda|sitio|condominio|loteamento)\b/i.test(normalized);
  const roadCode = /\b(?:br|mg|lmg|sp|rj|pr|sc|rs|go|ba|es|pe|ce)-?\s*\d{2,4}\b/i.test(normalized);
  const hasNumber = /\b(?:n[º°]?\s*)?\d{1,6}[a-z]?\b/i.test(normalized) || /\bs\/?n\b/i.test(normalized) || /\bkm\s*\d+(?:[.,]\d+)?\b/i.test(normalized);
  const hasLocationContext = extractCep(raw)
    || new RegExp(`\\b(?:${[...BRAZIL_UFS].join('|')})\\b`, 'i').test(raw)
    || Object.keys(BRAZIL_STATE_BY_NAME).some((state) => normalized.includes(state));
  const commaCount = (raw.match(/,/g) || []).length;

  if (startsLikeStreet && (raw.length >= 10 || hasNumber || hasLocationContext)) return normalizeAddressForLookup(raw);
  if (roadCode && (hasNumber || hasLocationContext || commaCount >= 1)) return normalizeAddressForLookup(raw);
  if (hasNumber && hasLocationContext && commaCount >= 1) return normalizeAddressForLookup(raw);
  return null;
}

async function handleStandaloneAddress(msg, groupName, readableText) {
  const targetAddress = extractStandaloneAddressTarget(readableText);
  if (!targetAddress) return false;

  const areaSettings = await getSettings();
  const excludedArea = await resolveConfiguredExcludedAddress(targetAddress, 'origin', areaSettings);
  if (excludedArea) {
    await replyAndRemember(msg, groupName, readableText, outOfRouteReply(areaSettings), { intent: 'out-of-route', areaType: excludedArea.type, areaName: excludedArea.name, scope: 'origin' });
    logEvent('coverage', `${groupName}: endereço recusado por área fora de rota.`, { groupId: msg.from, areaType: excludedArea.type, areaName: excludedArea.name, scope: 'origin' });
    return true;
  }

  if (isExplicitlyOutOfCoverage(targetAddress)) {
    await replyAndRemember(msg, groupName, readableText, `Fora da área de atendimento. Atendemos somente ${configuredServiceState}.`, {
      intent: 'out-of-coverage',
      targetAddress,
    });
    return true;
  }

  const directCoordinates = coordinatesFromText(targetAddress) || (extractMapsUrl(targetAddress) ? await coordinatesFromMapsUrl(targetAddress) : null);
  if (directCoordinates && !(await targetWithinServiceArea({ coordinates: directCoordinates }))) {
    await replyAndRemember(msg, groupName, readableText, `Fora da área de atendimento. Atendemos somente ${configuredServiceState}.`, {
      intent: 'out-of-coverage-coordinates',
      targetAddress,
    });
    return true;
  }

  const tracker = await getFreshTrackerReading();
  let eta = null;
  try {
    eta = await computeEtaWithRetry({ targetAddress });
  } catch (error) {
    logEvent('warning', 'Não foi possível calcular ETA automático do endereço recebido.', {
      error: String(error),
      targetAddress,
    });
  }

  if (!eta) {
    const reply = tracker
      ? 'Recebi o endereço, mas não consegui calcular a rota com segurança agora. Pode confirmar a cidade/UF?'
      : 'Recebi o endereço. Estou atualizando a localização do guincho para calcular a previsão.';
    await replyAndRemember(msg, groupName, readableText, reply, {
      intent: 'standalone-address-unavailable',
      targetAddress,
    });
    return true;
  }

  await setDispatchState(msg.from, {
    originAddress: targetAddress,
    originCoordinates: null,
    originUpdatedAt: new Date().toISOString(),
    lastEta: eta,
    lastEtaAt: new Date().toISOString(),
  });

  const reply = `Previsão de chegada: ${eta.minutes} min.`;
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: 'standalone-address-eta',
    etaMinutes: eta.minutes,
    distanceKm: eta.distanceKm,
    targetAddress,
  });
  logEvent('route', `${groupName}: endereço recebido diretamente → ETA ${eta.minutes} min${eta.distanceKm ? ` · ${eta.distanceKm} km` : ''}.`, {
    groupId: msg.from,
    targetAddress,
  });
  return true;
}

async function handleDistanceQuestion(msg, groupName, readableText, quotedText = '') {
  const target = await resolveRouteQuestionTarget(msg.from, readableText, quotedText);
  if (!target.targetAddress && !target.targetCoordinates) {
    logEvent('ignored', `${groupName}: pergunta de distância sem destino identificável ignorada.`, { groupId: msg.from });
    return;
  }
  if (!(await targetWithinServiceArea({ address: target.targetAddress, coordinates: target.targetCoordinates }))) {
    await replyAndRemember(msg, groupName, readableText, `Fora da área de atendimento. Atendemos somente ${configuredServiceState}.`, { intent: 'out-of-coverage', targetSource: target.source });
    return;
  }

  let eta = null;
  try {
    eta = await computeEtaWithRetry({
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
    await replyAndRemember(msg, groupName, readableText, 'Estou atualizando a localização para calcular a rota. Tente novamente em alguns segundos.', { intent: 'distance-unavailable', targetSource: target.source });
    return;
  }

  await setDispatchState(msg.from, {
    lastEta: eta,
    lastEtaAt: new Date().toISOString(),
    ...(target.source === 'inline-address' || target.source === 'quoted-address'
      ? { originAddress: target.targetAddress, originCoordinates: null, originUpdatedAt: new Date().toISOString() }
      : {}),
  });
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


async function reverseGeocodeRegionForExclusion(coordinates) {
  if (!coordinates || !validCoordinates(coordinates.latitude, coordinates.longitude)) return null;
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(coordinates.latitude));
    url.searchParams.set('lon', String(coordinates.longitude));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    const response = await fetch(url, {
      headers: {
        'user-agent': 'BotGuincho/2.1 (areas-fora-de-rota; https://botguincho.vercel.app/)',
        'accept-language': 'pt-BR,pt;q=0.9',
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const address = data?.address || {};
    return {
      city: address.city || address.town || address.municipality || address.village || address.county || '',
      district: address.neighbourhood || address.suburb || address.city_district || address.quarter || address.hamlet || '',
      state: normalizeBrazilState(address.state || String(address['ISO3166-2-lvl4'] || '').split('-').pop() || ''),
      displayName: data?.display_name || '',
    };
  } catch (error) {
    logEvent('warning', 'Não foi possível identificar cidade/bairro para regra de fora de rota.', { error: String(error) });
    return null;
  }
}

function matchConfiguredExcludedAddress(address, scope, settings, region = null) {
  const areas = sanitizeExcludedAreas(settings?.excludedAreas || []);
  if (!areas.length) return null;
  const parsedAddress = address && !extractMapsUrl(address) && !coordinatesFromText(address)
    ? parseBrazilAddress(address)
    : null;
  return matchExcludedArea({ address, parsedAddress, region, areas, scope });
}

async function resolveConfiguredExcludedAddress(address, scope, settings) {
  if (!address) return null;
  const direct = matchConfiguredExcludedAddress(address, scope, settings);
  if (direct) return direct;

  let coordinates = coordinatesFromText(address);
  if (!coordinates && extractMapsUrl(address)) coordinates = await coordinatesFromMapsUrl(address).catch(() => null);
  if (!coordinates) return null;
  const region = await reverseGeocodeRegionForExclusion(coordinates);
  return region ? matchConfiguredExcludedAddress(address, scope, settings, region) : null;
}

async function findConfiguredExcludedArea({ groupId, readableText, facts = {}, incomingLocation = null, settings }) {
  const areas = sanitizeExcludedAreas(settings?.excludedAreas || []);
  if (!areas.length) return null;

  const originAddress = extractLabeledField(readableText, 'Origem') || facts.origin || enderecoEmTextoLivre(readableText) || null;
  const destinationAddress = extractLabeledField(readableText, 'Destino') || facts.destination || null;

  if (originAddress) {
    const originMatch = await resolveConfiguredExcludedAddress(originAddress, 'origin', settings);
    if (originMatch) return { ...originMatch, address: originAddress };
  }
  if (destinationAddress) {
    const destinationMatch = await resolveConfiguredExcludedAddress(destinationAddress, 'destination', settings);
    if (destinationMatch) return { ...destinationMatch, address: destinationAddress };
  }

  let originCoordinates = incomingLocation;
  if (!originAddress && !originCoordinates && groupId) {
    const shared = await getRecentSharedLocation(groupId).catch(() => null);
    if (shared?.coordinates && Number.isFinite(shared.at) && Date.now() - shared.at <= 15 * 60 * 1000) {
      originCoordinates = shared.coordinates;
    }
  }
  if (!originAddress && originCoordinates) {
    const region = await reverseGeocodeRegionForExclusion(originCoordinates);
    const locationMatch = region ? matchExcludedArea({ region, areas, scope: 'origin' }) : null;
    if (locationMatch) return { ...locationMatch, region };
  }

  return null;
}

function outOfRouteReply(settings) {
  return String(settings?.outOfRouteReply || 'Motorista fora de rota.').trim().slice(0, 300) || 'Motorista fora de rota.';
}

async function currentOperationalContext(groupId, groupName, text) {
  const management = await getManagement();
  const evidenceOrProtocol = /\[imagem recebida\]|\b(fotos?|checklist|v[ií]deo|evid[eê]ncias?|protocolo)\b/i.test(String(text || ''));
  const provisionalRecentCall = recentManagementCall(management, groupId)
    || (evidenceOrProtocol ? recentManagementRecord(management, groupId) : null);
  const knowledge = await getGroupKnowledgeEntry(groupId);
  const commercialResolution = commercialRulesForGroup(knowledge, groupName);
  const approvedRules = commercialResolution.rules;
  const billingProfile = ensureBillingProfile(management, groupId, groupName);
  const facts = extractOperationalFacts(text);
  const provisionalIntent = classifyRuntimeIntent(text, groupName, provisionalRecentCall);
  const recentCall = provisionalIntent === 'closure'
    ? (oldestActiveManagementCallForGroup(management, groupId) || provisionalRecentCall)
    : provisionalRecentCall;
  const intent = classifyRuntimeIntent(text, groupName, recentCall);
  return { management, recentCall, knowledge, approvedRules, commercialRuleSource: commercialResolution.source, billingProfile, facts, intent, profile: resolveGroupProfile(groupName) };
}

async function estimateQuoteRoute(groupId, text, facts, incomingLocation = null) {
  const originAddress = extractLabeledField(text, 'Origem') || facts.origin || enderecoEmTextoLivre(text) || null;
  const destinationAddress = extractLabeledField(text, 'Destino') || facts.destination || null;
  const shared = await getRecentSharedLocation(groupId);
  const originCoordinates = incomingLocation || (!originAddress ? shared?.coordinates || null : null);
  let eta = null;
  if (originAddress || originCoordinates) eta = await computeEtaWithRetry({ targetAddress: originAddress, targetCoordinates: originCoordinates });
  let secondLeg = null;
  if (originAddress && destinationAddress) {
    const [from, to] = await Promise.all([geocodeAddress(originAddress), geocodeAddress(destinationAddress)]);
    if (from && to) secondLeg = await routeBetween(from, to).catch(() => null);
  }
  const fullRoute = destinationAddress
    ? await computeFullServiceRoute({ originAddress, destinationAddress, originCoordinates }).catch(() => null)
    : null;
  const estimatedTotalKm = fullRoute?.totalKm ?? (eta?.distanceKm != null && secondLeg?.distanceKm != null
    ? Math.round((Number(eta.distanceKm) + Number(secondLeg.distanceKm)) * 10) / 10
    : null);
  return { originAddress, destinationAddress, originCoordinates, eta, secondLeg, fullRoute, estimatedTotalKm };
}

async function handleAvailabilityRuntime(msg, groupName, readableText, incomingLocation, context) {
  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const facts = context.facts;
  const hasOpportunityData = Boolean(facts.origin || facts.destination || facts.vehicle || facts.plate || facts.protocol || extractLabeledField(readableText, 'Origem') || enderecoEmTextoLivre(readableText));
  let route = null;
  if (hasOpportunityData) {
    route = await estimateQuoteRoute(msg.from, readableText, facts, incomingLocation).catch(() => ({ eta: null }));
    if (capacity.activeCount === 1 && (route.originAddress || route.originCoordinates)) {
      const queued = await estimateSecondCallArrival({
        management: context.management,
        targetAddress: route.originAddress,
        targetCoordinates: route.originCoordinates,
      });
      if (queued.eta) route.eta = queued.eta;
    }
    await setDispatchState(msg.from, {
      originAddress: route.originAddress || null,
      originCoordinates: route.originCoordinates || null,
      destinationAddress: route.destinationAddress || null,
      originUpdatedAt: new Date().toISOString(),
      lastEta: route.eta || null,
      lastEtaAt: route.eta ? new Date().toISOString() : null,
    });
    await recordDispatchInManagement({
      groupId: msg.from, groupName, text: readableText,
      originAddress: route.originAddress, originCoordinates: route.originCoordinates, destinationAddress: route.destinationAddress,
      eta: route.eta, status: 'cotacao', facts,
      estimatedTotalKm: route.estimatedTotalKm,
      evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
      eventType: 'consulta_disponibilidade', phase: 'aguardando_autorizacao',
    });
  }
  const lines = ['Disponível ✅'];
  if (route?.eta?.minutes) lines.push(formatEtaReply(route.eta, false));
  else if (hasOpportunityData) lines.push('Estou atualizando a localização para calcular a previsão.');
  await replyAndRemember(msg, groupName, readableText, lines.join('\n'), {
    intent: 'availability', activeCount: capacity.activeCount,
    slotsAfterAccept: Math.max(0, capacity.slotsAvailable - 1),
    etaMinutes: route?.eta?.minutes ?? null,
    estimatedTotalKm: route?.estimatedTotalKm ?? null,
  });
}

async function handleQuoteRuntime(msg, groupName, readableText, incomingLocation, context) {
  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const route = await estimateQuoteRoute(msg.from, readableText, context.facts, incomingLocation).catch((error) => {
    logEvent('warning', 'Falha ao estimar rota da cotação.', { error: String(error), groupId: msg.from });
    return { eta: null, secondLeg: null, estimatedTotalKm: null, originAddress: context.facts.origin || null, destinationAddress: context.facts.destination || null };
  });
  if (capacity.activeCount === 1 && (route.originAddress || route.originCoordinates)) {
    const queued = await estimateSecondCallArrival({
      management: context.management,
      targetAddress: route.originAddress,
      targetCoordinates: route.originCoordinates,
    });
    if (queued.eta) route.eta = queued.eta;
  }

  const pricingKm = context.billingProfile?.routeBasis === 'origin_destination'
    ? (route.secondLeg?.distanceKm ?? null)
    : context.billingProfile?.routeBasis === 'insurer_reported'
      ? (context.facts.totalKm ?? null)
      : context.billingProfile?.routeBasis === 'manual'
        ? null
        : route.estimatedTotalKm;
  const commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts: { ...context.facts, totalKm: pricingKm ?? context.facts.totalKm }, estimatedTotalKm: pricingKm });
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: route.originAddress, originCoordinates: route.originCoordinates || null, destinationAddress: route.destinationAddress,
    eta: route.eta, status: 'cotacao', facts: context.facts, commercial,
    estimatedTotalKm: route.estimatedTotalKm,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    eventType: 'cotacao', phase: 'cotacao',
  });

  const lines = [];
  if (asksAvailability(readableText)) lines.push('Disponível ✅');
  if (route.eta?.minutes) lines.push(formatEtaReply(route.eta, false));
  if (!route.eta?.queued && route.eta?.distanceKm != null) lines.push(`Distância até a origem: ${route.eta.distanceKm} km.`);
  if (route.estimatedTotalKm != null) lines.push(`Percurso estimado do atendimento: ${route.estimatedTotalKm} km.`);
  if (commercial.status === 'ok' && commercial.calculatedAmount != null) lines.push(`Valor estimado: R$ ${Number(commercial.calculatedAmount).toFixed(2).replace('.', ',')}.`);
  else if (/\b(valor|pre[cç]o|quanto fica)\b/i.test(readableText)) lines.push('Valor: em conferência pela tabela comercial.');
  if (!lines.length) lines.push('Cotação recebida ✅');
  await replyAndRemember(msg, groupName, readableText, lines.join('\n'), { intent: 'quote', etaMinutes: route.eta?.minutes ?? null, queued: route.eta?.queued === true, rawEtaMinutes: route.eta?.rawMinutes ?? route.eta?.minutes ?? null, estimatedTotalKm: route.estimatedTotalKm, commercialStatus: commercial.status });
}

async function handlePendingApprovalRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || context.facts.origin || null,
    destinationAddress: call?.destination || context.facts.destination || null,
    eta: call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: 'aguardando_aprovacao', facts: context.facts, existingCallId: call?.id || null,
    eventType: 'aguardando_autorizacao', phase: 'aguardando_autorizacao',
  });
  await replyAndRemember(msg, groupName, readableText, 'Certo, aguardando autorização.', { intent: 'pending_approval' });
}

function missingDispatchData(facts = {}) {
  const missing = [];
  if (!facts.origin) missing.push('origem completa ou localização');
  if (!facts.destination) missing.push('destino completo');
  if (!facts.vehicle && !facts.vehicleType) missing.push('veículo');
  return missing;
}

function pendingOpportunityCall(call = null) {
  return call && ['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(call.status) ? call : null;
}

async function handleIncompleteDispatchRuntime(msg, groupName, readableText, context) {
  const call = pendingOpportunityCall(context.recentCall);
  const combinedFacts = {
    ...context.facts,
    origin: context.facts.origin || call?.origin || '',
    destination: context.facts.destination || call?.destination || '',
    vehicle: context.facts.vehicle || call?.vehicle || '',
  };
  const missing = missingDispatchData(combinedFacts);

  // NAO_PEDE_O_QUE_JA_TEM: a classificacao de intencao as vezes manda uma ficha
  // completa para este caminho. Se origem, destino e veiculo estao todos presentes,
  // nao faz sentido pedi-los de novo: segue o fluxo normal de acionamento.
  // A marca evita ida e volta infinita entre os dois tratadores.
  if (!missing.length && !context.jaRedirecionadoDeIncompleto) {
    await handleDispatchDetailsRuntime(msg, groupName, readableText, null, {
      ...context,
      facts: combinedFacts,
      jaRedirecionadoDeIncompleto: true,
    });
    return;
  }

  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: combinedFacts.origin || null, destinationAddress: combinedFacts.destination || null,
    eta: null, status: 'aguardando_dados', facts: combinedFacts, existingCallId: call?.id || null,
    eventType: 'dados_incompletos', phase: 'aguardando_dados',
  });
  await replyAndRemember(msg, groupName, readableText, `Para prosseguir, informe: ${missing.length ? missing.join(', ') : 'origem, destino e veículo'}.`, { intent: 'incomplete_dispatch', missing });
}

async function handleDispatchDetailsRuntime(msg, groupName, readableText, incomingLocation, context) {
  const call = pendingOpportunityCall(context.recentCall);
  const route = await estimateQuoteRoute(msg.from, readableText, context.facts, incomingLocation).catch(() => ({
    eta: null, estimatedTotalKm: null, originAddress: context.facts.origin || call?.origin || null,
    destinationAddress: context.facts.destination || call?.destination || null, originCoordinates: incomingLocation || call?.originCoordinates || null,
  }));
  const combinedFacts = {
    ...context.facts,
    origin: route.originAddress || call?.origin || '',
    destination: route.destinationAddress || call?.destination || '',
    vehicle: context.facts.vehicle || call?.vehicle || '',
  };
  const missing = missingDispatchData(combinedFacts);
  if (missing.length) {
    await handleIncompleteDispatchRuntime(msg, groupName, readableText, { ...context, facts: combinedFacts });
    return;
  }
  const associationMissing = context.profile.associationRequired === true && !(combinedFacts.association || call?.association);
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: route.originAddress || call?.origin || null, originCoordinates: route.originCoordinates || call?.originCoordinates || null,
    destinationAddress: route.destinationAddress || call?.destination || null,
    eta: route.eta, status: 'aguardando_aprovacao', facts: combinedFacts,
    estimatedTotalKm: route.estimatedTotalKm, evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    existingCallId: call?.id || null, eventType: 'dados_do_atendimento', phase: 'aguardando_autorizacao',
  });
  const details = route.eta?.minutes ? ` Previsão até a origem: ${route.eta.minutes} min.` : '';
  const association = associationMissing ? ' Informe também a associação responsável.' : '';
  await replyAndRemember(msg, groupName, readableText, `Dados do atendimento recebidos ✅${details}${association} Aguardando autorização expressa para seguir.`, {
    intent: 'dispatch_details', authorizationRequired: true, associationMissing,
  });
}

async function handleProtocolRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  const status = call?.status || 'aguardando_aprovacao';
  const flowActive = isFlowActiveCall(call);
  const nextOrigin = context.facts.origin || call?.origin || null;
  const nextOriginCoordinates = context.facts.origin ? null : (call?.originCoordinates || null);
  const nextDestination = context.facts.destination || call?.destination || null;
  // PREVISAO_NO_PROTOCOLO: calcula a previsao sempre que houver origem, e nao so
  // quando ja existe atendimento em andamento. Ficha nova tambem merece previsao.
  const etaAnterior = call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null;
  const nextEta = nextOrigin
    ? (await computeEtaWithRetry({ targetAddress: nextOrigin, targetCoordinates: nextOriginCoordinates }).catch(() => null)) || etaAnterior
    : etaAnterior;
  const nextRouteSnapshot = flowActive && nextOrigin && nextDestination
    ? await computeFullServiceRoute({
        originAddress: nextOrigin, originCoordinates: nextOriginCoordinates,
        destinationAddress: nextDestination, baseAddressOverride: context.billingProfile?.baseAddress || '',
      }).catch(() => null)
    : null;
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: nextOrigin,
    originCoordinates: nextOriginCoordinates,
    destinationAddress: nextDestination,
    eta: nextEta,
    routeSnapshotOverride: nextRouteSnapshot,
    status, facts: context.facts, existingCallId: call?.id || null,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    eventType: call ? 'protocolo_atualizado' : 'protocolo_recebido',
    phase: call?.operationalPhase || 'aguardando_autorizacao',
  });
  const km = formatKm(saved?.billableKm ?? saved?.routeBreakdown?.totalKm ?? saved?.estimatedTotalKm);
  const amount = formatCurrency(saved?.calculatedValue);
  const calculation = flowActive && (km || amount)
    ? `\n${km ? `Quilometragem total: ${km} km.` : ''}${km && amount ? ' ' : ''}${amount ? `Valor estimado: ${amount}.` : ''}`
    : '';
  const reply = flowActive
    ? `Protocolo vinculado ao atendimento em andamento ✅${calculation}`
    : call?.status === 'concluido'
      ? 'Protocolo vinculado ao atendimento concluído ✅'
      : `Protocolo recebido e registrado ✅${nextEta?.minutes ? ` Previsão até a origem: ${nextEta.minutes} min.` : ''} Aguardando autorização expressa para seguir.`;
  if (saved && flowActive && saved.protocol) await notifyDriverOfConfirmedCall(saved, { force: saved.protocol !== call?.protocol });
  await replyAndRemember(msg, groupName, readableText, reply, { intent: context.intent, authorizationRequired: !call || (!flowActive && call?.status !== 'concluido'), callId: saved?.id || call?.id || null, billableKm: saved?.billableKm ?? null, calculatedValue: saved?.calculatedValue ?? null });
}

async function handleAuthorizationRuntime(msg, groupName, readableText, incomingLocation, context) {
  const call = context.recentCall;

  // Uma autorização repetida do mesmo chamado não consome uma nova vaga.
  if (call && isFlowActiveCall(call)) {
    const repeated = await recordDispatchInManagement({
      groupId: msg.from, groupName, text: readableText, originAddress: call.origin || null,
      destinationAddress: call.destination || null, eta: null, status: call.status, facts: context.facts,
      existingCallId: call.id, eventType: 'autorizacao_repetida', phase: call.operationalPhase || 'autorizado',
    });
    if (repeated) await notifyDriverOfConfirmedCall(repeated);
    await replyAndRemember(msg, groupName, readableText, 'Autorização já registrada neste atendimento ✅', { intent: 'authorization-repeat', callId: call.id });
    return;
  }

  if (!call) {
    await replyAndRemember(msg, groupName, readableText, 'Recebi a autorização, mas ainda faltam os dados do atendimento. Envie origem, destino e veículo para vincular corretamente.', { intent: 'authorization-without-call' });
    return;
  }

  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const targetAddress = call?.origin || context.facts.origin || null;
  const targetCoordinates = call?.originCoordinates || incomingLocation || null;
  const arrival = await estimateSecondCallArrival({
    management: context.management,
    targetAddress,
    targetCoordinates,
  });
  if (!arrival.available) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: arrival.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }
  const eta = arrival.eta;
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: targetAddress, originCoordinates: targetCoordinates, destinationAddress: call?.destination || context.facts.destination || null,
    eta, status: 'autorizado', facts: context.facts,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null,
    eventType: 'autorizacao', phase: eta?.queued ? 'autorizado_em_fila' : 'autorizado',
  });
  if (saved && eta?.queued) {
    saved.queued = true;
    saved.precedingCallId = eta.precedingCallId || null;
  }
  const driverNotification = saved ? await notifyDriverOfConfirmedCall(saved) : { sent: false, reason: 'call_not_saved' };
  const km = formatKm(saved?.billableKm ?? saved?.routeBreakdown?.totalKm ?? saved?.estimatedTotalKm);
  const amount = formatCurrency(saved?.calculatedValue);
  const calculationLines = [km ? `Quilometragem total calculada: ${km} km.` : null, amount ? `Valor estimado: ${amount}.` : null].filter(Boolean);
  const confirmation = eta ? formatEtaReply(eta, true) : 'Confirmado ✅\nGuincho em deslocamento.';
  await replyAndRemember(msg, groupName, readableText, [confirmation, ...calculationLines].join('\n'), { intent: 'authorization', etaMinutes: eta?.minutes ?? null, queued: eta?.queued === true, rawEtaMinutes: eta?.rawMinutes ?? eta?.minutes ?? null, precedingCallId: eta?.precedingCallId ?? null, callId: saved?.id || null, billableKm: saved?.billableKm ?? null, calculatedValue: saved?.calculatedValue ?? null, driverNotification: driverNotification.sent ? 'sent' : driverNotification.reason });
}

async function handleScheduledRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: context.facts.origin || call?.origin || null,
    destinationAddress: context.facts.destination || call?.destination || null,
    eta: null, status: 'agendado', facts: context.facts,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null,
    eventType: 'agendamento', phase: 'agendado',
  });
  await replyAndRemember(msg, groupName, readableText, 'Agendamento registrado ✅', { intent: 'scheduled_dispatch', scheduledAt: context.facts.scheduledAt });
}

async function handleDepartureRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call?.origin || null,
    destinationAddress: call?.destination || null, eta: null, status: 'a_caminho', facts: context.facts,
    existingCallId: call?.id || null, eventType: 'saida', phase: 'em_deslocamento',
  });
  await replyAndRemember(msg, groupName, readableText, 'Saída registrada ✅', { intent: 'departure', callId: call?.id || null });
}

async function handleWaitingCustomerRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  const waitMinutes = context.profile.absentCustomerWaitMinutes || ON_SITE_GRACE_MINUTES;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call?.origin || null,
    destinationAddress: call?.destination || null, eta: null, status: 'em_atendimento', facts: context.facts,
    existingCallId: call?.id || null, eventType: 'cliente_ausente', phase: 'aguardando_cliente',
  });
  const groupRule = context.profile.absentCustomerWaitMinutes
    ? `A regra deste grupo prevê aguardar ${waitMinutes} minutos; eventual retorno ou cobrança ficará registrado para conferência.`
    : `A tolerância operacional no local é de ${waitMinutes} minutos. A partir do 16º minuto começa a primeira hora trabalhada integral de R$ 80,00.`;
  await replyAndRemember(msg, groupName, readableText, `Cliente ausente registrado ✅ ${groupRule}`, { intent: 'waiting_customer', waitMinutes });
}

async function handleLoadedRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call?.origin || null,
    destinationAddress: call?.destination || null, eta: null, status: 'em_atendimento', facts: context.facts,
    existingCallId: call?.id || null, eventType: 'veiculo_embarcado', phase: 'veiculo_embarcado', towPerformed: true,
  });
  await replyAndRemember(msg, groupName, readableText, 'Embarque do veículo registrado ✅', { intent: 'loaded', towPerformed: true });
}

async function handleDestinationArrivalRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call?.origin || null,
    destinationAddress: call?.destination || null, eta: null, status: 'em_atendimento', facts: context.facts,
    existingCallId: call?.id || null, eventType: 'chegada_destino', phase: 'no_destino', towPerformed: call?.towPerformed ?? true,
  });
  await replyAndRemember(msg, groupName, readableText, 'Chegada ao destino registrada ✅ Envie as evidências finais exigidas e, depois, o fechamento.', { intent: 'destination_arrival' });
}

async function handleEvidenceRuntime(msg, groupName, readableText, context, hasMedia = false) {
  const call = context.recentCall;
  const baseChecklist = Array.isArray(call?.evidenceChecklist) && call.evidenceChecklist.length
    ? call.evidenceChecklist
    : buildEvidenceChecklist(groupName, readableText);
  const checklist = markEvidenceChecklist(baseChecklist, readableText, hasMedia);
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call?.origin || null,
    destinationAddress: call?.destination || null, eta: null, status: call?.status || 'em_atendimento', facts: context.facts,
    existingCallId: call?.id || null, evidenceChecklist: checklist,
    eventType: 'evidencia_recebida', phase: call?.status === 'concluido' ? 'concluido' : 'evidencias',
  });
  const pending = checklist.filter((item) => item?.done !== true).map((item) => item.label);
  const reply = pending.length
    ? `Evidência registrada ✅ Ainda pendente: ${pending.join('; ')}.`
    : 'Evidências obrigatórias concluídas ✅';
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'evidence', evidenceComplete: pending.length === 0, pendingEvidence: pending });
}

async function handleAddressUpdateRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  const destination = extractLabeledField(readableText, 'Destino') || context.facts.destination;
  if (!destination) {
    await replyAndRemember(msg, groupName, readableText, 'Informe o novo destino completo para atualizar a corrida.', { intent: 'address_update_missing_destination' });
    return;
  }
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call?.origin || null,
    destinationAddress: destination, eta: null, status: call?.status || 'autorizado', facts: context.facts,
    existingCallId: call?.id || null, eventType: 'destino_alterado', phase: call?.operationalPhase || 'rota_alterada',
  });
  await replyAndRemember(msg, groupName, readableText, 'Novo destino registrado no atendimento ✅ A rota e o fechamento devem considerar este endereço.', { intent: 'address_update', destination });
}

async function handleCancellationRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  if (!call) {
    await replyAndRemember(msg, groupName, readableText, 'Não encontrei atendimento ativo para cancelar. Informe o protocolo ou os dados da corrida.', { intent: 'cancellation-without-call' });
    return;
  }
  const cancelledAt = new Date().toISOString();
  const fullRouteKm = call?.routeBreakdown?.totalKm ?? call?.estimatedTotalKm ?? call?.totalKm ?? call?.billableKm ?? null;
  const cancellation = evaluateCancellationPolicy({
    authorizedAt: call?.authorizedAt || null,
    cancelledAt,
    billableKm: fullRouteKm,
  });
  let commercial = null;
  if (cancellation.chargeRequired) {
    const cancellationFacts = {
      ...context.facts,
      vehicleType: context.facts.vehicleType || call?.vehicleType || null,
      totalKm: cancellation.billableKm,
    };
    commercial = enforceFullCancellationCommercial(reconcileCommercial({
      approvedRules: context.approvedRules,
      facts: cancellationFacts,
      estimatedTotalKm: cancellation.billableKm,
    }));
  }
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || null, destinationAddress: call?.destination || null,
    eta: null, status: 'cancelado', facts: context.facts, commercial,
    estimatedTotalKm: cancellation.chargeRequired ? cancellation.billableKm : (call?.estimatedTotalKm ?? null),
    existingCallId: call?.id || null, cancellation, eventType: 'cancelamento', phase: 'cancelado',
  });
  logEvent('cancellation-policy', `${groupName}: cancelamento ${cancellation.chargeRequired ? 'após' : 'dentro do'} prazo de 15 minutos.`, {
    callId: saved?.id || call?.id || null,
    authorizedAt: cancellation.authorizedAt,
    cancelledAt: cancellation.cancelledAt,
    deadlineAt: cancellation.deadlineAt,
    elapsedMinutes: cancellation.elapsedMinutes,
    chargeRequired: cancellation.chargeRequired,
    chargeBasis: cancellation.chargeBasis,
    billableKm: cancellation.billableKm,
    calculatedAmount: saved?.value || commercial?.calculatedAmount || null,
    reportedAmountRejected: commercial?.reportedAmountRejected === true,
    partialPaymentAllowed: false,
  });
  await replyAndRemember(msg, groupName, readableText, cancellationReply(cancellation, saved?.value || commercial?.calculatedAmount || null), {
    intent: 'cancellation',
    cancellationChargeRequired: cancellation.chargeRequired,
    cancellationBillableKm: cancellation.billableKm,
    cancellationDeadlineAt: cancellation.deadlineAt,
    partialPaymentAllowed: false,
  });
}

async function handleArrivalWithoutTowRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  const arrivedAt = new Date().toISOString();
  const displacementKm = Number(call?.routeBreakdown?.legToOrigin?.km ?? call?.distanceKm ?? 0);
  const facts = {
    ...context.facts,
    extras: { ...(context.facts.extras || {}), dirtRoadKm: context.facts.extras?.dirtRoadKm ?? call?.dirtRoadBillableKm ?? 0 },
    vehicleType: context.facts.vehicleType || call?.vehicleType || null,
    totalKm: displacementKm,
  };
  const workedTime = evaluateWorkedTime({ arrivedAt: call?.arrivalConfirmedAt || arrivedAt, finishedAt: arrivedAt, reportedMinutes: context.facts.onSiteMinutes });
  const commercial = addWorkedTimeToCommercial(enforceFullCancellationCommercial(reconcileCommercial({
    approvedRules: context.approvedRules,
    facts,
    estimatedTotalKm: displacementKm,
  })), workedTime);
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || null, destinationAddress: call?.destination || null,
    eta: null, status: 'concluido', facts, commercial, estimatedTotalKm: displacementKm,
    existingCallId: call?.id || null,
    serviceOutcome: { type: 'deslocamento_sem_reboque', arrivedAt: call?.arrivalConfirmedAt || arrivedAt, billableKm: displacementKm }, workedTime,
    eventType: 'finalizado_sem_reboque', phase: 'concluido_sem_reboque', towPerformed: false,
  });
  logEvent('arrival-without-tow', `${groupName}: chegada confirmada, sem reboque e com deslocamento cobrável.`, {
    callId: saved?.id || call?.id || null, arrivedAt, billableKm: displacementKm,
    calculatedAmount: saved?.value || commercial?.calculatedAmount || null, partialPaymentAllowed: false,
  });
  const amount = Number(saved?.value || commercial?.calculatedAmount || 0);
  const details = [displacementKm > 0 ? `${displacementKm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : null, amount > 0 ? amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null].filter(Boolean);
  const workedTimeText = workedTime.chargeRequired ? ` Também foram cobradas ${workedTime.chargedHours} hora(s) trabalhada(s), no total de ${workedTime.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` : '';
  await replyAndRemember(msg, groupName, readableText, `Atendimento registrado. Como o guincho já chegou ao local, a saída e o deslocamento serão cobrados integralmente${details.length ? ` (${details.join(' · ')})` : ''}, mesmo sem o reboque do veículo.${workedTimeText} Não é aplicável pagamento parcial.`, {
    intent: 'arrival_without_tow', serviceOutcome: 'deslocamento_sem_reboque', displacementChargeRequired: true,
    displacementBillableKm: displacementKm, towPerformed: false, partialPaymentAllowed: false,
  });
}

async function handleArrivalRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  const arrivedAt = call?.arrivalConfirmedAt || new Date().toISOString();
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || null, destinationAddress: call?.destination || null,
    eta: null, status: 'em_atendimento', facts: context.facts,
    existingCallId: call?.id || null, arrival: { arrivedAt }, eventType: 'chegada_origem', phase: 'no_local_cliente',
  });
  await replyAndRemember(msg, groupName, readableText, `Chegada registrada ✅ Há ${ON_SITE_GRACE_MINUTES} minutos de tolerância no local. A partir do 16º minuto, será cobrada a primeira hora trabalhada de R$ 80,00; cada nova hora iniciada acrescenta R$ 80,00.`, {
    intent: 'arrival', arrivedAt, onSiteGraceMinutes: ON_SITE_GRACE_MINUTES, workedHourRate: WORKED_HOUR_RATE,
  });
}

async function handleDirtRoadStartRuntime(msg, groupName, readableText, incomingLocation, context) {
  const call = context.recentCall;
  const shared = await getRecentSharedLocation(msg.from);
  const startCoordinates = incomingLocation || shared?.coordinates || null;
  if (!startCoordinates) {
    await setDispatchState(msg.from, { pendingLocationPurpose: 'dirt_road_start', pendingLocationRequestedAt: new Date().toISOString() });
    await replyAndRemember(msg, groupName, readableText, 'Envie a localização exata do ponto onde começa a estrada de terra. A partir desse ponto, calcularei ida e volta a R$ 3,80 por km.', { intent: 'dirt_road_location_required' });
    return;
  }
  await setDispatchState(msg.from, { pendingLocationPurpose: null, pendingLocationRequestedAt: null });
  const clientCoordinates = call?.originCoordinates || (call?.origin ? await geocodeAddress(call.origin).catch(() => null) : null);
  if (!clientCoordinates) {
    await replyAndRemember(msg, groupName, readableText, 'Localização do início da estrada de terra recebida. Não consegui localizar o endereço do cliente para calcular o trecho; informe também os quilômetros de terra.', { intent: 'dirt_road_distance_required' });
    return;
  }
  const route = await routeBetween(startCoordinates, clientCoordinates).catch(() => null);
  if (!route?.distanceKm) {
    await replyAndRemember(msg, groupName, readableText, 'Não consegui calcular o trecho de terra. Informe quantos quilômetros existem entre o início da terra e o cliente.', { intent: 'dirt_road_distance_required' });
    return;
  }
  const oneWayKm = Math.round(Number(route.distanceKm) * 10) / 10;
  const billableKm = Math.round(oneWayKm * 2 * 10) / 10;
  const capturedAt = new Date().toISOString();
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call?.origin || null,
    destinationAddress: call?.destination || null, eta: null, status: call?.status || 'em_atendimento', facts: context.facts,
    existingCallId: call?.id || null, dirtRoad: { startCoordinates, capturedAt, oneWayKm, billableKm },
    eventType: 'inicio_estrada_terra', phase: 'trecho_terra',
  });
  await replyAndRemember(msg, groupName, readableText, `Trecho de terra registrado ✅ ${oneWayKm.toLocaleString('pt-BR')} km até o cliente; ${billableKm.toLocaleString('pt-BR')} km considerando ida e volta, cobrados a R$ 3,80/km. Nesse trecho, a tarifa de terra substitui a tarifa normal.`, {
    intent: 'dirt_road_start', dirtRoadOneWayKm: oneWayKm, dirtRoadBillableKm: billableKm, dirtRoadRatePerKm: 3.8,
  });
}

async function handleDirtRoadEndRuntime(msg, groupName, readableText, incomingLocation, context) {
  const call = context.recentCall;
  if (!call?.dirtRoadStartCoordinates) {
    await replyAndRemember(msg, groupName, readableText, 'Não encontrei o início do trecho de terra desta corrida. Envie a localização do ponto inicial ou informe os quilômetros de terra.', { intent: 'dirt_road_start_missing' });
    return;
  }
  const shared = await getRecentSharedLocation(msg.from);
  const dirtStartedAt = new Date(call.dirtRoadCapturedAt || 0).getTime();
  const sharedIsAfterStart = shared?.coordinates && Number.isFinite(shared.at) && shared.at > dirtStartedAt;
  const endCoordinates = incomingLocation || (sharedIsAfterStart ? shared.coordinates : null);
  if (!endCoordinates) {
    await setDispatchState(msg.from, { pendingLocationPurpose: 'dirt_road_end', pendingLocationRequestedAt: new Date().toISOString() });
    await replyAndRemember(msg, groupName, readableText, 'Envie a localização exata do ponto onde saiu da estrada de terra.', { intent: 'dirt_road_end_location_required' });
    return;
  }
  await setDispatchState(msg.from, { pendingLocationPurpose: null, pendingLocationRequestedAt: null });
  const endedAt = new Date().toISOString();
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call.origin || null,
    destinationAddress: call.destination || null, eta: null, status: call.status || 'em_atendimento', facts: context.facts,
    existingCallId: call.id, dirtRoadEnd: { endCoordinates, endedAt },
    eventType: 'fim_estrada_terra', phase: 'trecho_terra_concluido',
  });
  const km = Number(call.dirtRoadBillableKm || 0);
  const amount = Number(call.dirtRoadChargeAmount || (km * 3.8));
  const details = km > 0 ? ` ${km.toLocaleString('pt-BR')} km de ida e volta, total de ${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` : '';
  await replyAndRemember(msg, groupName, readableText, `Saída da estrada de terra registrada ✅${details} A tarifa de R$ 3,80/km substitui a tarifa de asfalto somente nesse trecho.`, { intent: 'dirt_road_end', dirtRoadBillableKm: km, dirtRoadAmount: amount });
}

async function handleValueSummaryRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  if (!call || !isFlowActiveCall(call)) {
    await replyAndRemember(msg, groupName, readableText, 'Não encontrei atendimento autorizado para calcular. Envie o protocolo da corrida.', { intent: 'value-summary-without-call' });
    return;
  }

  const routeSnapshot = call.routeBreakdown || await computeFullServiceRoute({
    originAddress: call.origin || null,
    originCoordinates: call.originCoordinates || null,
    destinationAddress: call.destination || null,
    baseAddressOverride: context.billingProfile?.baseAddress || '',
  }).catch(() => null);
  const pricingKm = context.billingProfile?.routeBasis === 'origin_destination'
    ? (routeSnapshot?.serviceLeg?.km ?? call.billableKm ?? call.totalKm ?? null)
    : context.billingProfile?.routeBasis === 'insurer_reported'
      ? (call.totalKm ?? call.billableKm ?? null)
      : context.billingProfile?.routeBasis === 'manual' && !isTestGroupName(groupName)
        ? (call.billableKm ?? call.totalKm ?? null)
        : (routeSnapshot?.totalKm ?? call.billableKm ?? call.totalKm ?? call.estimatedTotalKm ?? null);
  const facts = {
    ...context.facts,
    vehicleType: context.facts.vehicleType || call.vehicleType || null,
    totalKm: pricingKm,
    extras: {
      ...(context.facts.extras || {}),
      dirtRoadKm: context.facts.extras?.dirtRoadKm ?? call.dirtRoadBillableKm ?? 0,
    },
  };
  let commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts, estimatedTotalKm: pricingKm });
  const workedTime = call.arrivalConfirmedAt && !call.onSiteFinishedAt
    ? evaluateWorkedTime({ arrivedAt: call.arrivalConfirmedAt, finishedAt: new Date() })
    : {
        chargeRequired: call.workedTimeChargeRequired === true,
        chargedHours: Number(call.workedTimeChargedHours || 0),
        hourlyRate: WORKED_HOUR_RATE,
        amount: Number(call.workedTimeAmount || 0),
      };
  commercial = addWorkedTimeToCommercial(commercial, workedTime);
  commercial.ruleSource = context.commercialRuleSource;

  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call.origin || null, originCoordinates: call.originCoordinates || null,
    destinationAddress: call.destination || null,
    eta: call.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: call.status, facts, commercial, estimatedTotalKm: pricingKm,
    routeSnapshotOverride: routeSnapshot,
    existingCallId: call.id, eventType: 'consulta_valor', phase: call.operationalPhase || 'autorizado',
  });

  const km = formatKm(saved?.billableKm ?? routeSnapshot?.totalKm ?? pricingKm);
  const amount = formatCurrency(saved?.calculatedValue ?? commercial.calculatedAmount);
  const lines = [];
  if (km) lines.push(`Quilometragem total: ${km} km.`);
  if (amount) lines.push(`Valor calculado do atendimento: ${amount}.`);
  if (workedTime.chargeRequired) lines.push(`Hora trabalhada: ${workedTime.chargedHours} hora(s) iniciada(s) × R$ 80,00 = ${formatCurrency(workedTime.amount)}.`);
  if (!amount) lines.push('A tabela comercial desta transportadora ainda precisa ser configurada para informar o valor com segurança.');
  await replyAndRemember(msg, groupName, readableText, lines.join('\n'), {
    intent: 'value_summary', callId: call.id, billableKm: saved?.billableKm ?? pricingKm,
    calculatedValue: saved?.calculatedValue ?? commercial.calculatedAmount, commercialStatus: commercial.status,
  });
}

async function handleClosureRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  if (!call) {
    await replyAndRemember(msg, groupName, readableText, 'Não encontrei atendimento ativo para finalizar. Informe o protocolo da corrida.', { intent: 'closure-without-call' });
    return;
  }
  const reportedTotalKm = context.facts.totalKm ?? null;
  const automaticKm = call?.billableKm ?? call?.routeBreakdown?.totalKm ?? null;
  const facts = {
    ...context.facts,
    extras: { ...(context.facts.extras || {}), dirtRoadKm: context.facts.extras?.dirtRoadKm ?? call?.dirtRoadBillableKm ?? 0 },
    vehicleType: context.facts.vehicleType || call?.vehicleType || null,
    reportedTotalKm,
    totalKm: automaticKm ?? reportedTotalKm ?? call?.totalKm ?? null,
  };
  const workedTime = evaluateWorkedTime({ arrivedAt: call?.arrivalConfirmedAt || null, finishedAt: new Date(), reportedMinutes: context.facts.onSiteMinutes });
  const commercial = addWorkedTimeToCommercial(reconcileCommercial({ approvedRules: context.approvedRules, facts, estimatedTotalKm: automaticKm }), workedTime);
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || facts.origin || null,
    destinationAddress: call?.destination || facts.destination || null,
    eta: call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: 'concluido', facts, commercial,
    estimatedTotalKm: automaticKm,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null, workedTime,
    eventType: 'fechamento', phase: 'concluido',
  });
  if (commercial.reviewRequired) {
    logEvent('finance-review', `${groupName}: fechamento exige conferência financeira.`, { callId: saved?.id, calculated: commercial.calculatedAmount, reported: commercial.reportedAmount, delta: commercial.delta });
  }
  let reply = closureReply({
    totalKm: automaticKm ?? facts.totalKm,
    amount: saved?.value || commercial.calculatedAmount,
    reviewRequired: commercial.reviewRequired || !(Number(saved?.value || commercial.calculatedAmount) > 0),
  });
  if (workedTime.chargeRequired) reply += ` Hora trabalhada: ${workedTime.chargedHours} hora(s) iniciada(s) × R$ 80,00 = ${workedTime.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`;
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'closure', financeReviewRequired: commercial.reviewRequired, commercialStatus: commercial.status, billableKm: automaticKm ?? facts.totalKm ?? null });
}

async function processIncomingMessage(msg) {
  try {
    const messageId = msg?.id?._serialized || '';
    if (messageId) {
      const seenAt = processedMessageIds.get(messageId);
      if (seenAt && Date.now() - seenAt < 6 * 60 * 60 * 1000) {
        logEvent('dedupe', 'Mensagem repetida do WhatsApp ignorada.', { messageId });
        return;
      }
      processedMessageIds.set(messageId, Date.now());
      if (processedMessageIds.size > 1000) {
        const cutoff = Date.now() - 6 * 60 * 60 * 1000;
        for (const [id, at] of processedMessageIds) if (at < cutoff) processedMessageIds.delete(id);
      }
    }
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
    lastInboundByGroup.set(msg.from, { text: readableText, at: Date.now() });
    void learningStore.append({ groupId: msg.from, groupName, direction: 'incoming', source: 'live', text: readableText, intent: inferLearningIntent(readableText) });

    if (settings.humanTakeover) return;

    if (text.toLowerCase() === '!ping') {
      await msg.reply('PONG — Bot Guincho funcionando no grupo autorizado!');
      logEvent('reply', `Teste respondido em ${groupName}.`);
      return;
    }

    const operationalContext = await currentOperationalContext(msg.from, groupName, readableText);
    const runtimeIntent = operationalContext.intent;

    // Comunicados internos nunca devem receber resposta automática, inclusive
    // fora do expediente. Eles continuam registrados no histórico de aprendizado.
    if (shouldStaySilent(runtimeIntent, groupName)) {
      logEvent('ignored', `${groupName}: comunicado administrativo aprendido sem resposta.`, { groupId: msg.from, intent: runtimeIntent });
      return;
    }

    const operating = evaluateOperatingHours(settings);
    const activeFlowIntents = new Set([
      'cancellation', 'arrival_without_tow', 'arrival', 'departure', 'waiting_customer', 'loaded',
      'destination_arrival', 'evidence', 'address_update', 'dirt_road_start', 'dirt_road_end',
      'closure', 'value_summary', 'protocol_update',
    ]);
    const pendingLocationState = location && !text ? await getDispatchState(msg.from) : null;
    const completingPendingLocation = ['dirt_road_start','dirt_road_end'].includes(pendingLocationState?.pendingLocationPurpose);
    if (!operating.open && !activeFlowIntents.has(runtimeIntent) && !completingPendingLocation) {
      const reply = String(settings.outOfHoursReply || 'Motorista fora de rota.').trim().slice(0,300) || 'Motorista fora de rota.';
      await replyAndRemember(msg, groupName, readableText, reply, { intent: 'out-of-hours', day: operating.dayKey, localTime: operating.localTime, reason: operating.reason });
      logEvent('coverage', `${groupName}: mensagem recusada fora do horário de funcionamento.`, { groupId: msg.from, day: operating.dayKey, localTime: operating.localTime, reason: operating.reason });
      return;
    }

    const availabilityDependentIntents = new Set([
      'availability', 'quote', 'dispatch', 'dispatch_details', 'incomplete_dispatch',
      'authorization', 'formal_dispatch', 'scheduled_dispatch',
    ]);
    if (settings.simpleMode !== false && availabilityDependentIntents.has(runtimeIntent)) {
      const operationalAvailability = truckAvailability(operationalContext.management);
      if (!operationalAvailability.available) {
        await replyAndRemember(msg, groupName, readableText, operationalAvailability.reply, {
          intent: 'truck-unavailable',
          truckStatus: operationalAvailability.truck?.status || null,
          unavailableUntil: operationalAvailability.until || null,
        });
        return;
      }
    }

    if (location && !text) {
      const dispatchState = await getDispatchState(msg.from);
      if (dispatchState?.pendingLocationPurpose === 'dirt_road_start' || dispatchState?.pendingLocationPurpose === 'dirt_road_end') {
        const locationContext = await currentOperationalContext(msg.from, groupName, dispatchState.pendingLocationPurpose === 'dirt_road_start' ? 'Início da estrada de terra' : 'Fim da estrada de terra');
        if (dispatchState.pendingLocationPurpose === 'dirt_road_start') {
          await handleDirtRoadStartRuntime(msg, groupName, readableText, location, locationContext);
        } else {
          await handleDirtRoadEndRuntime(msg, groupName, readableText, location, locationContext);
        }
        return;
      }
      logEvent('system', `${groupName}: localizacao do WhatsApp armazenada; aguardando pergunta/acionamento.`, { groupId: msg.from });
      return;
    }

    const canBeRejectedByArea = ['availability','quote','dispatch_details','incomplete_dispatch','protocol_received','authorization','formal_dispatch','scheduled_dispatch'].includes(runtimeIntent);
    if (canBeRejectedByArea) {
      const excludedArea = await findConfiguredExcludedArea({
        groupId: msg.from, readableText, facts: operationalContext.facts, incomingLocation, settings,
      });
      if (excludedArea) {
        await replyAndRemember(msg, groupName, readableText, outOfRouteReply(settings), {
          intent: 'out-of-route', areaType: excludedArea.type, areaName: excludedArea.name, scope: excludedArea.scope,
        });
        logEvent('coverage', `${groupName}: atendimento recusado por área fora de rota.`, {
          groupId: msg.from, areaType: excludedArea.type, areaName: excludedArea.name, scope: excludedArea.scope,
        });
        return;
      }
    }

    if (runtimeIntent === 'quote') {
      await handleQuoteRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'availability') {
      await handleAvailabilityRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'pending_approval') {
      await handlePendingApprovalRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'incomplete_dispatch') {
      await handleIncompleteDispatchRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'dispatch_details') {
      await handleDispatchDetailsRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'protocol_received' || runtimeIntent === 'protocol_update') {
      await handleProtocolRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'scheduled_dispatch') {
      await handleScheduledRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'cancellation') {
      await handleCancellationRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'arrival_without_tow') {
      await handleArrivalWithoutTowRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'arrival') {
      await handleArrivalRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'departure') {
      await handleDepartureRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'waiting_customer') {
      await handleWaitingCustomerRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'loaded') {
      await handleLoadedRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'destination_arrival') {
      await handleDestinationArrivalRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'evidence') {
      await handleEvidenceRuntime(msg, groupName, readableText, operationalContext, Boolean(imageDataUrl));
      return;
    }
    if (runtimeIntent === 'address_update') {
      await handleAddressUpdateRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'dirt_road_start') {
      await handleDirtRoadStartRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'dirt_road_end') {
      await handleDirtRoadEndRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'closure') {
      await handleClosureRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'value_summary') {
      await handleValueSummaryRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'authorization' || runtimeIntent === 'formal_dispatch') {
      await handleAuthorizationRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'dispatch' && looksLikeDispatch(readableText)) {
      await handleDispatch(msg, groupName, readableText, incomingLocation);
      return;
    }

    if (asksEta(readableText)) {
      await handleEtaQuestion(msg, groupName, readableText, quotedText, operationalContext);
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

    const greeting = greetingReply(readableText);
    if (greeting) {
      await replyAndRemember(msg, groupName, readableText, greeting, { intent: 'greeting' });
      return;
    }

    if (await handleStandaloneAddress(msg, groupName, readableText)) {
      return;
    }

    if (!isOperationalMessage(readableText)) {
      logEvent('ignored', `${groupName}: mensagem não operacional ignorada.`, { groupId: msg.from });
      return;
    }

    if (settings.simpleMode !== false) {
      logEvent('ignored', `${groupName}: mensagem fora do fluxo simples ignorada sem usar IA.`, { groupId: msg.from, intent: runtimeIntent });
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

function scheduleWhatsAppRecovery(reason = 'unknown') {
  if (whatsappRecoveryTimer) return;
  const sinceLast = Date.now() - lastWhatsappRecoveryAt;
  const delay = Math.max(15000, 60000 - sinceLast);
  logEvent('recovery', `Recuperação do WhatsApp agendada em ${Math.ceil(delay / 1000)}s.`, { reason });
  whatsappRecoveryTimer = setTimeout(async () => {
    whatsappRecoveryTimer = null;
    lastWhatsappRecoveryAt = Date.now();
    try {
      const current = waClient;
      waClient = null;
      if (current) await current.destroy().catch(() => undefined);
      waStatus = 'iniciando';
      await startWhatsApp();
      logEvent('recovery', 'Rotina de reconexão do WhatsApp iniciada.', { reason });
    } catch (error) {
      logEvent('error', 'Falha na recuperação automática do WhatsApp.', { error: String(error), reason });
      scheduleWhatsAppRecovery('retry-after-failure');
    }
  }, delay);
}

async function startWhatsApp() {
  if (waClient) return;
  waStatus = 'iniciando';
  lastError = null;

  // LIMPA_TRAVA: o Chromium grava SingletonLock/Cookie/Socket dentro do perfil,
  // marcados com o hostname do container. Como o hostname muda a cada recriacao,
  // ele acha que "outro computador" esta usando o perfil e se recusa a abrir.
  // Nenhum processo esta realmente usando: sao arquivos orfaos. Removemos antes de subir.
  try {
    const perfil = path.join(sessionDir, 'session-' + clientId);
    let removidos = 0;
    for (const nome of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const arquivo = path.join(perfil, nome);
      try {
        await fs.lstat(arquivo);
        await fs.rm(arquivo, { force: true, recursive: true });
        removidos += 1;
      } catch {}
    }
    if (removidos) logEvent('system', removidos + ' trava(s) orfa(s) do Chromium removida(s) antes de iniciar.');
  } catch (error) {
    logEvent('warning', 'Nao consegui limpar as travas do Chromium.', { error: String(error) });
  }

  chromium.setGraphicsMode = false;
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath();
  const browserArgs = [...new Set([
    ...browserBaseArgs(),
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
  ])];

  logEvent('system', `Chromium serverless: ${executablePath}`);

  waClient = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: sessionDir }),
    // O WhatsApp Web pode levar mais de 2 minutos para injetar a sessão em Chromium
    // serverless. Mantemos um timeout finito, porém mais tolerante, sem apagar LocalAuth.
    authTimeoutMs: 300000,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 5000,
    puppeteer: {
      executablePath,
      headless: true,
      args: [...new Set([...browserArgs, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])],
      protocolTimeout: 300000,
    },
  });

  waClient.on('loading_screen', (percent, message) => {
    logEvent('whatsapp-loading', `WhatsApp carregando: ${percent ?? '?'}% ${message || ''}`.trim());
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
    const settings = await getSettings();
    if (settings.simpleMode === false && await simulatorAutoConnectEnabled()) scheduleSimulatorRecovery('primary-ready', 8000);
  });

  waClient.on('message_create', async (created) => {
    try {
      if (!created?.fromMe) return;
      const chat = await created.getChat().catch(() => null);
      const groupId = chat?.id?._serialized || created?.to || '';
      if (!groupId.endsWith('@g.us')) return;
      const allowed = await getAllowedGroupIds();
      if (!allowed.has(groupId)) return;
      const body = String(created.body || '').trim();
      if (!body) return;
      const fingerprint = `${groupId}|${normalizeForIntent(body)}`;
      const botAt = botReplyFingerprints.get(fingerprint);
      if (botAt && Date.now() - botAt < 90000) { botReplyFingerprints.delete(fingerprint); return; }
      const inbound = lastInboundByGroup.get(groupId);
      const triggerText = inbound && Date.now() - inbound.at < 900000 ? inbound.text : '';
      await learningStore.addHumanExample({ groupId, groupName: chat?.name || 'Grupo do WhatsApp', triggerText, replyText: body });
      logEvent('learning', `${chat?.name || groupId}: resposta humana aprendida.`, { groupId, intent: inferLearningIntent(triggerText) });
    } catch (error) {
      logEvent('warning', 'Falha ao registrar resposta humana para aprendizado.', { error: String(error) });
    }
  });

  waClient.on('auth_failure', (message) => {
    waStatus = 'erro';
    lastError = String(message);
    logEvent('error', 'Falha de autenticação do WhatsApp.', { error: lastError });
    scheduleWhatsAppRecovery('auth_failure');
  });

  waClient.on('disconnected', (reason) => {
    waStatus = 'desconectado';
    lastError = String(reason);
    logEvent('warning', 'WhatsApp desconectado.', { reason: lastError });
    scheduleWhatsAppRecovery('disconnected');
  });

  waClient.on('message', processIncomingMessage);

  waClient.initialize().catch((error) => {
    waStatus = 'erro';
    lastError = error instanceof Error ? error.message : String(error);
    logEvent('error', 'Falha ao iniciar WhatsApp.', { error: lastError });
    scheduleWhatsAppRecovery('initialize_failure');
  });
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function readTestCenterState() { try { return await readJson(testCenterFile, { history: [] }); } catch { return { history: [] }; } }
async function persistTestRun(run) { const state = await readTestCenterState(); await writeJson(testCenterFile, { history: [run, ...(state.history || []).filter((item) => item.id !== run.id)].slice(0, 20) }); }
async function selectedTestGroup() {
  const groups = await discoverGroups();
  const wanted = TEST_GROUP_NAME.toLocaleLowerCase('pt-BR');
  const group = groups.find((item) => item.selected && String(item.name || '').trim().toLocaleLowerCase('pt-BR') === wanted);
  if (!group) throw new Error(`Selecione e autorize exatamente o grupo “${TEST_GROUP_NAME}”.`);
  return group;
}

async function simulatorAutoConnectEnabled() {
  try { return (await readJson(simulatorAutoConnectFile, {}))?.enabled === true; } catch { return false; }
}

async function setSimulatorAutoConnect(enabled) {
  if (enabled) await writeJson(simulatorAutoConnectFile, { enabled: true, updatedAt: new Date().toISOString() });
  else await fs.rm(simulatorAutoConnectFile, { force: true }).catch(() => undefined);
}

async function clearSimulatorChromiumLocks() {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) await fs.rm(path.join(simulatorSessionRoot, name), { force: true, recursive: true }).catch(() => undefined);
}

function clearSimulatorTimers() {
  if (simulatorWatchdog) clearTimeout(simulatorWatchdog);
  if (simulatorRecoveryTimer) clearTimeout(simulatorRecoveryTimer);
  simulatorWatchdog = null; simulatorRecoveryTimer = null;
}

async function resetTestSimulator(status = 'desconectado', error = null) {
  clearSimulatorTimers();
  const current = simulatorClient; simulatorClient = null; simulatorStartedAt = 0;
  if (current) await Promise.race([current.destroy().catch(() => undefined), delay(8000)]);
  await clearSimulatorChromiumLocks();
  simulatorStatus = status; simulatorLastError = error; simulatorQrDataUrl = null;
}

function scheduleSimulatorRecovery(reason = 'unknown', delayMs = 15000) {
  if (simulatorRecoveryTimer || gracefulShutdownStarted) return;
  simulatorRecoveryTimer = setTimeout(async () => {
    simulatorRecoveryTimer = null;
    if (waStatus !== 'pronto' || !(await simulatorAutoConnectEnabled())) return;
    logEvent('test', 'Reconectando automaticamente o segundo WhatsApp.', { reason });
    await startTestSimulator({ force: true }).catch((error) => {
      simulatorLastError = error instanceof Error ? error.message : String(error);
      scheduleSimulatorRecovery('retry-after-failure', 20000);
    });
  }, delayMs);
}

async function startTestSimulator({ force = false } = {}) {
  const stuck = simulatorClient && simulatorStatus === 'iniciando' && Date.now() - simulatorStartedAt > 45000;
  if (simulatorClient && (force || stuck)) await resetTestSimulator('reiniciando');
  if (simulatorClient) return;
  if (waStatus !== 'pronto') throw new Error('Aguarde o WhatsApp principal ficar pronto antes de conectar o segundo número.');
  await clearSimulatorChromiumLocks();
  simulatorStatus = 'iniciando'; simulatorLastError = null; chromium.setGraphicsMode = false;
  simulatorStartedAt = Date.now();
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath();
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `${clientId}-simulator`, dataPath: simulatorSessionDir }), authTimeoutMs: 300000,
    puppeteer: { executablePath, headless: true, args: [...new Set([...browserBaseArgs(), '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])], protocolTimeout: 300000 },
  });
  simulatorClient = client;
  client.on('qr', async (qr) => { if (simulatorClient !== client) return; simulatorStatus = 'qr'; simulatorQrDataUrl = await QRCode.toDataURL(qr, { width: 420, margin: 1 }); });
  client.on('authenticated', () => { if (simulatorClient !== client) return; simulatorStatus = 'autenticado'; simulatorQrDataUrl = null; });
  client.on('ready', () => { if (simulatorClient !== client) return; if (simulatorWatchdog) clearTimeout(simulatorWatchdog); simulatorWatchdog = null; simulatorStatus = 'pronto'; simulatorStartedAt = 0; simulatorQrDataUrl = null; logEvent('test', 'Segundo WhatsApp conectado à Central de Testes.'); });
  client.on('message', async (message) => {
    const chat = await message.getChat().catch(() => null); const groupId = chat?.id?._serialized || message?.from || '';
    if (!message?.fromMe && testCenterRuntime.currentRun?.status === 'running' && groupId === testCenterRuntime.targetGroupId) {
      testCenterRuntime.inbound.push({ at: Date.now(), text: String(message.body || ''), from: message.author || message.from || '' });
      if (testCenterRuntime.inbound.length > 100) testCenterRuntime.inbound.shift();
    }
  });
  client.on('auth_failure', (reason) => { if (simulatorClient !== client) return; void resetTestSimulator('erro', String(reason)).then(() => scheduleSimulatorRecovery('auth-failure')); });
  client.on('disconnected', (reason) => { if (simulatorClient !== client) return; void resetTestSimulator('reconectando', String(reason)).then(() => scheduleSimulatorRecovery('disconnected')); });
  simulatorWatchdog = setTimeout(() => {
    if (simulatorClient !== client || !['iniciando','autenticado'].includes(simulatorStatus)) return;
    void resetTestSimulator('erro', 'A inicialização do segundo WhatsApp excedeu 75 segundos. Tentando novamente automaticamente.').then(() => scheduleSimulatorRecovery('startup-timeout', 5000));
  }, 75000);
  client.initialize().catch((error) => { if (simulatorClient !== client) return; void resetTestSimulator('erro', error instanceof Error ? error.message : String(error)).then(() => scheduleSimulatorRecovery('initialize-failure')); });
}

function engineScenario(id) {
  const iso = '2026-08-20T12:00:00.000Z';
  if (id === 'cancel_15_boundary' || id === 'cancel_after_15') {
    const actual = evaluateCancellationPolicy({ authorizedAt: iso, cancelledAt: new Date(Date.parse(iso) + (id === 'cancel_15_boundary' ? 900 : 901) * 1000), billableKm: 72 });
    const passed = id === 'cancel_15_boundary' ? !actual.chargeRequired && actual.billableKm === 0 : actual.chargeRequired && actual.billableKm === 72 && actual.partialPaymentAllowed === false;
    return { passed, expected: id === 'cancel_15_boundary' ? 'Sem cobrança aos 15:00' : 'Cobrança integral aos 15:01', actual };
  }
  if (id === 'reject_half_payment') { const actual = enforceFullCancellationCommercial({ calculatedAmount: 200, reportedAmount: 100 }); return { passed: actual.reportedAmountRejected === true && actual.calculatedAmount === 200 && actual.partialPaymentAllowed === false, expected: 'R$ 200 integrais; R$ 100 rejeitados', actual }; }
  if (['worked_15_boundary','worked_first_hour','worked_second_hour'].includes(id)) { const minutes = id === 'worked_15_boundary' ? 15 : id === 'worked_first_hour' ? 16 : 76; const expectedAmount = id === 'worked_15_boundary' ? 0 : id === 'worked_first_hour' ? 80 : 160; const actual = evaluateWorkedTime({ reportedMinutes: minutes }); return { passed: actual.amount === expectedAmount, expected: `R$ ${expectedAmount}`, actual }; }
  if (id === 'dirt_round_trip') { const actual = calculateApprovedCommercial({ approvedRules: { services: { passeio: { basePrice: 130, includedKm: 50, pricePerKm: 3 } } }, vehicleType: 'passeio', totalKm: 100, reportedExtras: { dirtRoadKm: 20 } }); return { passed: actual.amount === 296 && actual.dirtRoadKm === 20 && actual.excessKm === 30, expected: 'R$ 296; 20 km de terra substituem o asfalto', actual }; }
  if (['driver_50','driver_excess','driver_worked_hour'].includes(id)) { const km = id === 'driver_50' ? 50 : 80; const actual = driverPayForCall({ status: 'concluido', billableKm: km, workedTimeChargeRequired: id === 'driver_worked_hour', workedTimeAmount: id === 'driver_worked_hour' ? 80 : 0 }); const expected = id === 'driver_50' ? 40 : id === 'driver_excess' ? 61 : 141; return { passed: actual?.totalAmount === expected, expected: `R$ ${expected}`, actual }; }
  if (id === 'driver_period') { const first = driverPayrollPeriodFor('2026-08-20T12:00:00Z'); const second = driverPayrollPeriodFor('2026-08-21T12:00:00Z'); return { passed: first.periodStart === '2026-07-20' && first.periodEnd === '2026-08-20' && second.periodStart === '2026-08-20' && second.periodEnd === '2026-09-20', expected: '20/07–20/08 e 20/08–20/09', actual: { first, second } }; }
  return { passed: false, expected: 'Cenário conhecido', actual: null };
}

async function waitForTestResponse(after, timeoutMs, expectSilence = false) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const found = testCenterRuntime.inbound.find((item) => item.at >= after); if (found) return { passed: !expectSilence, response: found.text }; await delay(500); }
  return { passed: expectSilence, response: '' };
}

async function resetTestScenarioOperationalState(groupId) {
  const state = await getManagement();
  const removedIds = new Set((state.calls || [])
    .filter((call) => call.sourceGroupId === groupId && isTestCall(call))
    .map((call) => call.id));
  state.calls = (state.calls || []).filter((call) => !removedIds.has(call.id));
  state.finance = (state.finance || []).filter((item) => !removedIds.has(item.sourceCallId));
  syncDriverPayrolls(state);
  await saveManagement(state);
  const dispatchStates = await getDispatchStates();
  delete dispatchStates[groupId];
  await writeJson(dispatchStateFile, dispatchStates, 0o600);
  groupMemory.delete(groupId);
  sharedLocations.delete(groupId);
  testCenterRuntime.inbound = [];
}

async function executeTestRun(run) {
  run.status = 'running'; run.startedAt = new Date().toISOString(); testCenterRuntime.currentRun = run; testCenterRuntime.inbound = [];
  try {
    if (run.results.some((item) => item.mode === 'whatsapp')) { if (!simulatorClient || simulatorStatus !== 'pronto') throw new Error('Conecte o segundo WhatsApp antes de executar conversas.'); testCenterRuntime.targetGroupId = (await selectedTestGroup()).id; }
    for (const result of run.results) {
      if (run.stopRequested) { result.status = 'skipped'; continue; }
      result.status = 'running'; result.startedAt = new Date().toISOString(); run.totals = summarizeTestRun(run);
      const scenario = TEST_SCENARIOS.find((item) => item.id === result.scenarioId);
      try {
        if (scenario.mode === 'engine') { const check = engineScenario(scenario.id); result.steps.push(check); result.status = check.passed ? 'passed' : 'failed'; }
        else {
          await resetTestScenarioOperationalState(testCenterRuntime.targetGroupId);
          let passedAll = true;
          for (const step of scenario.steps.slice(0, 20)) {
            if (run.stopRequested) break;
            const sentAt = Date.now(); await simulatorClient.sendMessage(testCenterRuntime.targetGroupId, step.send);
            const observed = await waitForTestResponse(sentAt, step.expectSilence ? 12000 : TEST_RESPONSE_TIMEOUT_MS, step.expectSilence === true);
            const passed = step.expectSilence ? observed.passed : observed.passed && responseMatches(observed.response, step.expect || [], step.forbid || [], step.expectAll === true);
            result.steps.push({ sent: step.send, response: observed.response, expected: step.expectSilence ? 'Nenhuma resposta' : step.expect, forbidden: step.forbid || [], passed }); if (!passed) passedAll = false; await delay(TEST_MESSAGE_INTERVAL_MS);
          }
          result.status = run.stopRequested ? 'skipped' : passedAll ? 'passed' : 'failed';
        }
      } catch (error) { result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error); }
      result.finishedAt = new Date().toISOString(); run.totals = summarizeTestRun(run); await persistTestRun(run);
    }
    run.status = run.stopRequested ? 'stopped' : 'completed';
  } catch (error) { run.status = 'failed'; run.error = error instanceof Error ? error.message : String(error); for (const result of run.results.filter((item) => item.status === 'queued')) result.status = 'skipped'; }
  finally { run.finishedAt = new Date().toISOString(); run.totals = summarizeTestRun(run); await persistTestRun(run); testCenterRuntime.targetGroupId = null; }
}

app.get('/api/test-center', async (_req, res) => { const saved = await readTestCenterState(); res.json({ ok: true, suiteVersion: TEST_SUITE_VERSION, targetGroupName: TEST_GROUP_NAME, simulator: { status: simulatorStatus, qrDataUrl: simulatorQrDataUrl, error: simulatorLastError }, scenarios: TEST_SCENARIOS, currentRun: testCenterRuntime.currentRun?.suiteVersion === TEST_SUITE_VERSION ? testCenterRuntime.currentRun : null, history: currentTestHistory(saved.history) }); });
app.post('/api/test-center', async (req, res) => {
  try {
    const action = String(req.body?.action || '');
    if (action === 'connect') { await setSimulatorAutoConnect(true); await startTestSimulator({ force: simulatorStatus === 'erro' || simulatorStatus === 'reiniciando' || (simulatorStatus === 'iniciando' && Date.now() - simulatorStartedAt > 45000) }); return res.json({ ok: true, status: simulatorStatus }); }
    if (action === 'stop') { if (testCenterRuntime.currentRun?.status === 'running') testCenterRuntime.currentRun.stopRequested = true; return res.json({ ok: true }); }
    if (action === 'disconnect') { await setSimulatorAutoConnect(false); await resetTestSimulator('desconectado'); return res.json({ ok: true }); }
    if (action === 'run' || action === 'run_all') { if (testCenterRuntime.currentRun?.status === 'running') return res.status(409).json({ ok: false, error: 'Já existe uma bateria de testes em execução.' }); const requested = action === 'run_all' ? TEST_SCENARIOS.map((item) => item.id) : (Array.isArray(req.body?.scenarioIds) ? req.body.scenarioIds.filter((id) => TEST_SCENARIOS.some((item) => item.id === id)) : []); if (!requested.length) return res.status(400).json({ ok: false, error: 'Selecione pelo menos um cenário.' }); const run = createTestRun(requested); testCenterRuntime.currentRun = run; await persistTestRun(run); void executeTestRun(run); return res.json({ ok: true, run }); }
    return res.status(400).json({ ok: false, error: 'Ação inválida.' });
  } catch (error) { return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
});

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

async function buildOperationalHealth() {
  const reading = await getTrackerReading();
  const ageSeconds = reading?.receivedAt ? Math.max(0, Math.round((Date.now() - new Date(reading.receivedAt).getTime()) / 1000)) : null;
  const trackerFresh = Number.isFinite(ageSeconds) && ageSeconds <= 120;
  const settings = await getSettings();
  const recentErrors = activity.filter((item) => ['error','warning','safety'].includes(item.type)).slice(0, 8);
  const routeProviders = Object.fromEntries(['osrm-main','osrm-osmde'].map((name) => {
    const state = routeProviderState.get(name) || { failures: 0, openUntil: 0 };
    return [name, {
      status: state.openUntil && state.openUntil > Date.now() ? 'degraded' : 'ok',
      failures: state.failures || 0,
      openUntil: state.openUntil ? new Date(state.openUntil).toISOString() : null,
      lastSuccessAt: state.lastSuccessAt || null,
      lastFailureAt: state.lastFailureAt || null,
    }];
  }));
  const checks = {
    whatsapp: { ok: waStatus === 'pronto', status: waStatus },
    tracker: { ok: trackerFresh, required: settings.simpleMode === false, status: trackerFresh ? 'online' : 'stale', ageSeconds, plate: reading?.plate || null, address: reading?.address || null },
    ai: { ok: Boolean(aiCredential) && settings.aiEnabled !== false, status: aiCredential ? (settings.aiEnabled === false ? 'disabled' : 'online') : 'not_configured' },
    routes: { ok: Object.values(routeProviders).some((item) => item.status === 'ok'), providers: routeProviders },
  };
  const criticalOk = checks.whatsapp.ok && checks.routes.ok && (settings.simpleMode !== false || checks.tracker.ok);
  return {
    ok: criticalOk,
    status: criticalOk ? 'operational' : 'attention',
    checkedAt: new Date().toISOString(),
    checks,
    groupsSelected: (await getAllowedGroupIds()).size,
    recentErrors,
    serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities, label: serviceAreaLabel() },
  };
}

app.get('/api/capacity', async (_req, res) => {
  try {
    const state = await getManagement();
    const capacity = capacitySnapshot(state);
    return res.json({
      ok: true,
      feature: 'simple-dispatch-v1',
      maxConcurrentCalls: MAX_CONCURRENT_CALLS,
      activeCount: capacity.activeCount,
      slotsAvailable: capacity.slotsAvailable,
      canAccept: capacity.canAccept,
      activeCalls: capacity.activeCalls.map((call) => ({
        id: call.id,
        groupId: call.sourceGroupId || null,
        insurer: call.insurer || call.client || null,
        status: call.status,
        origin: call.origin || null,
        destination: call.destination || null,
        authorizedAt: call.authorizedAt || null,
      })),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    return res.json(await buildOperationalHealth());
  } catch (error) {
    return res.status(500).json({ ok: false, status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/audit', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
    let raw = '';
    try { raw = await fs.readFile(auditFile, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const entries = raw.split('\\n').filter(Boolean).slice(-limit).reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    return res.json({ ok: true, entries });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/management', async (_req, res) => {
  try {
    const data = await getManagement();
    return res.json({ ok: true, data: { ...data, calls: (data.calls || []).filter((item) => !isTestCall(item)) } });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/management', async (req, res) => {
  try {
    const data = await applyManagementAction(req.body || {});
    logEvent('management', `Gestão atualizada: ${String(req.body?.action || 'update')} ${String(req.body?.collection || '')}`.trim());
    return res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(message.includes('invalid') ? 400 : 500).json({ ok: false, error: message });
  }
});

async function importLearningHistory(groupId, requestedLimit = 500) {
  if (!waClient || waStatus !== 'pronto') throw new Error('whatsapp_not_ready');
  if (!groupId?.endsWith('@g.us')) throw new Error('group_invalid');
  const allowed = await getAllowedGroupIds();
  if (!allowed.has(groupId)) throw new Error('group_not_authorized');
  const chat = await waClient.getChatById(groupId);
  const groupName = chat?.name || 'Grupo do WhatsApp';
  await learningStore.syncGroup({ groupId, name: groupName, description: chat?.description || chat?.groupMetadata?.desc || '' });
  const limit = Math.max(20, Math.min(2000, Number(requestedLimit || 500)));
  const messages = await chat.fetchMessages({ limit });
  const index = await learningStore.getIndex();
  let imported = 0;
  const intentCounts = {};
  for (const msg of messages || []) {
    const body = String(msg?.body || '').trim();
    if (!body) continue;
    const id = msg?.id?._serialized || crypto.createHash('sha1').update(`${msg?.timestamp || ''}|${body}`).digest('hex');
    if (index[id]) continue;
    const intent = inferLearningIntent(body);
    await learningStore.append({ id, at: msg?.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(), groupId, groupName, direction: msg?.fromMe ? 'outgoing' : 'incoming', source: 'history-import', text: body, intent });
    index[id] = new Date().toISOString();
    intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    imported += 1;
  }
  await learningStore.saveIndex(index);
  logEvent('learning', `${groupName}: ${imported} mensagens históricas importadas.`, { groupId, intentCounts });
  return { groupId, groupName, available: messages?.length || 0, imported, intentCounts };
}

app.get('/api/group-knowledge', async (_req, res) => {
  try { return res.json({ ok: true, groups: Object.values(await learningStore.getAll()) }); }
  catch (error) { return res.status(500).json({ ok: false, error: String(error) }); }
});

app.post('/api/group-knowledge', async (req, res) => {
  try {
    const groupId = String(req.body?.groupId || '');
    const action = String(req.body?.action || 'refresh');
    const allowed = await getAllowedGroupIds();
    if (!allowed.has(groupId)) return res.status(403).json({ ok: false, error: 'group_not_authorized' });
    if (action === 'set-commercial') {
      const entrada = req.body?.rules || {};
      const num = (v) => {
        if (v === null || v === undefined || v === '') return null;
        let n;
        if (typeof v === 'number') n = v;
        else {
          const t = String(v).trim().replace(/[^0-9.,-]/g, '');
          if (!t) return null;
          n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
        }
        return Number.isFinite(n) && n >= 0 ? n : null;
      };
      const services = {};
      for (const chave of ['leve', 'moto', 'utilitario', 'pesado']) {
        const s = entrada.services?.[chave];
        if (!s) continue;
        const basePrice = num(s.basePrice);
        if (!(basePrice > 0)) continue;
        services[chave] = {
          basePrice,
          includedKm: num(s.includedKm) ?? 0,
          pricePerKm: num(s.pricePerKm) ?? 0,
          dirtRoadPricePerKm: num(s.dirtRoadPricePerKm),
        };
      }
      if (!Object.keys(services).length) {
        return res.status(400).json({ ok: false, error: 'Informe ao menos um tipo de veiculo com valor de saida maior que zero.' });
      }
      const regras = {
        raw: 'Tabela configurada no painel.',
        source: 'panel',
        services,
        workedHour: num(entrada.workedHour),
        stoppedHour: num(entrada.stoppedHour),
        invoiceFee: num(entrada.invoiceFee),
        tollAllowed: entrada.tollAllowed === true,
        noSkates: entrada.noSkates === true,
        detected: true,
      };
      const agora = new Date().toISOString();
      const todos = await readJson(groupKnowledgeFile, {});
      const anterior = todos[groupId] || {};
      const versoes = Array.isArray(anterior.commercialVersions) ? anterior.commercialVersions.slice(-29) : [];
      versoes.push({ descriptionHash: 'painel-' + agora, rules: regras, status: 'approved', observedAt: agora, approvedAt: agora });
      todos[groupId] = {
        ...anterior,
        groupId,
        name: anterior.name || '',
        approvedCommercialRules: regras,
        draftCommercialRules: anterior.draftCommercialRules?.detected ? anterior.draftCommercialRules : regras,
        commercialVersions: versoes,
        commercialStatus: 'approved',
        commercialApprovedAt: agora,
        updatedAt: agora,
      };
      await writeJson(groupKnowledgeFile, todos);
      logEvent('learning', 'Tabela comercial configurada pelo painel.', { groupId, servicos: Object.keys(services) });
      return res.json({ ok: true, group: todos[groupId] });
    }
    if (action === 'approve-commercial') return res.json({ ok: true, group: await learningStore.approveCommercial(groupId) });
    const chat = await waClient?.getChatById(groupId).catch(() => null);
    const group = await learningStore.syncGroup({ groupId, name: chat?.name || '', description: chat?.description || chat?.groupMetadata?.desc || '' });
    return res.json({ ok: true, group });
  } catch (error) { return res.status(400).json({ ok: false, error: String(error?.message || error) }); }
});

app.post('/api/learning/import-history', async (req, res) => {
  try { return res.json({ ok: true, ...(await importLearningHistory(String(req.body?.groupId || ''), req.body?.limit || 500)) }); }
  catch (error) { return res.status(400).json({ ok: false, error: String(error?.message || error) }); }
});

app.get('/api/status', async (_req, res) => {
  const settings = await getSettings();
  const allowed = await getAllowedGroupIds();
  const reading = await getTrackerReading();
  const pairCode = await getPairCode();
  const management = await getManagement();
  const capacity = capacitySnapshot(management);
  const availability = truckAvailability(management);

  res.json({
    clientId,
    whatsapp: { status: waStatus, qrDataUrl, lastError },
    ai: { configured: Boolean(aiCredential), enabled: settings.aiEnabled, model: settings.aiModel },
    tracker: trackerSummary(reading, pairCode),
    groupsSelected: allowed.size,
    serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities },
    operatingHours: evaluateOperatingHours(settings),
    simpleMode: settings.simpleMode !== false,
    operation: { available: availability.available, reason: availability.reason || null, until: availability.until || null, truck: availability.truck || null },
    capacity: { feature: 'simple-dispatch-v1', maxConcurrentCalls: MAX_CONCURRENT_CALLS, activeCount: capacity.activeCount, slotsAvailable: capacity.slotsAvailable, canAccept: capacity.canAccept },
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
    simpleMode: typeof req.body?.simpleMode === 'boolean' ? req.body.simpleMode : undefined,
    aiEnabled: typeof req.body?.aiEnabled === 'boolean' ? req.body.aiEnabled : undefined,
    aiModel: typeof req.body?.aiModel === 'string' ? req.body.aiModel.slice(0, 80) : undefined,
    aiInstructions: typeof req.body?.aiInstructions === 'string' ? req.body.aiInstructions.slice(0, 8000) : undefined,
    replyEveryMessage: typeof req.body?.replyEveryMessage === 'boolean' ? req.body.replyEveryMessage : undefined,
    humanTakeover: typeof req.body?.humanTakeover === 'boolean' ? req.body.humanTakeover : undefined,
    serviceState: typeof req.body?.serviceState === 'string' ? normalizeBrazilState(req.body.serviceState) || configuredServiceState : undefined,
    priorityCities: Array.isArray(req.body?.priorityCities) ? req.body.priorityCities.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 80) : undefined,
    excludedAreas: Array.isArray(req.body?.excludedAreas) ? sanitizeExcludedAreas(req.body.excludedAreas) : undefined,
    outOfRouteReply: typeof req.body?.outOfRouteReply === 'string' ? req.body.outOfRouteReply.trim().slice(0, 300) || 'Motorista fora de rota.' : undefined,
    operatingHoursEnabled: typeof req.body?.operatingHoursEnabled === 'boolean' ? req.body.operatingHoursEnabled : undefined,
    operatingTimezone: typeof req.body?.operatingTimezone === 'string' ? req.body.operatingTimezone.trim().slice(0,80) || 'America/Sao_Paulo' : undefined,
    weeklySchedule: req.body?.weeklySchedule && typeof req.body.weeklySchedule === 'object' ? sanitizeWeeklySchedule(req.body.weeklySchedule) : undefined,
    outOfHoursReply: typeof req.body?.outOfHoursReply === 'string' ? req.body.outOfHoursReply.trim().slice(0,300) || 'Motorista fora de rota.' : undefined,
    operationalBaseAddress: typeof req.body?.operationalBaseAddress === 'string' ? req.body.operationalBaseAddress.trim().slice(0,600) : undefined,
  };
  Object.keys(patch).forEach((key) => patch[key] === undefined && delete patch[key]);
  const settings = await saveSettings(patch);
  await refreshServiceArea();
  res.json({ ok: true, settings, serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities } });
});


app.get('/api/billing', async (_req, res) => {
  try {
    const state = await getManagement();
    const groups = await discoverGroups().catch(() => []);
    for (const group of groups) ensureBillingProfile(state, group.id, group.name || 'Grupo do WhatsApp');
    state.billingBatches = updateBatchTemporalStatuses(state.billingBatches || []);
    syncDriverPayrolls(state);
    const saved = await saveManagement(state);
    const allowed = await getAllowedGroupIds();
    const visible = selectedGroupBillingView({
      profiles: saved.billingProfiles,
      batches: saved.billingBatches,
      finance: saved.finance,
      calls: saved.calls,
      historicalImports: saved.historicalImports,
    }, allowed);
    const settings = await getSettings();
    return res.json({
      ok: true,
      profiles: visible.profiles,
      batches: visible.batches,
      finance: visible.finance || [],
      insurerSummaries: buildInsurerSummaries(visible),
      driverPayrolls: saved.driverPayrolls || [],
      historicalImports: visible.historicalImports,
      driverRules: { paymentDay: 20, baseKmLimit: 50, basePay: 40, excessKmRate: 0.70, workedTimeBelongsToDriver: true },
      baseAddress: settings.operationalBaseAddress || '',
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
});

app.post('/api/billing', async (req, res) => {
  try {
    const state = await getManagement();
    const action = String(req.body?.action || 'save_profile');
    if (action === 'save_profile' || action === 'approve_profile') {
      const incoming = sanitizeBillingProfile({ ...(req.body?.profile || {}), status: action === 'approve_profile' ? 'approved' : (req.body?.profile?.status || 'needs_review') });
      if (!incoming.groupId) throw new Error('group_required');
      const idx = (state.billingProfiles || []).findIndex((x) => x.groupId === incoming.groupId);
      if (idx >= 0) state.billingProfiles[idx] = incoming; else state.billingProfiles.push(incoming);
      if (incoming.status === 'approved') {
        for (const call of (state.calls || []).filter((x) => x.sourceGroupId === incoming.groupId && (isConfirmedCall(x) || x.cancellationChargeRequired === true))) {
          if (isConfirmedCall(call)) ensureConfirmedFinanceTracking(state, call, { finalized: call.status === 'concluido' });
          else maybeCreateFinanceFromBillableCall(state, call);
        }
        syncDriverPayrolls(state);
      }
      const saved = await saveManagement(state);
      return res.json({ ok: true, profile: saved.billingProfiles.find((x) => x.groupId === incoming.groupId), data: saved });
    }
    if (['statement_sent','invoice_sent','received'].includes(action)) {
      const batch = (state.billingBatches || []).find((x) => x.id === String(req.body?.batchId || ''));
      if (!batch) throw new Error('batch_not_found');
      const now = new Date().toISOString();
      if (action === 'statement_sent') { batch.statementSentAt = now; batch.status = 'statement_sent'; }
      if (action === 'invoice_sent') { batch.invoiceSentAt = now; batch.status = 'awaiting_payment'; }
      if (action === 'received') {
        batch.receivedAt = now; batch.receivedAmount = Number(req.body?.amount || batch.totalAmount || 0); batch.status = 'received';
        state.finance = (state.finance || []).map((entry) => entry.billingBatchId === batch.id ? { ...entry, status: 'pago', paidAt: now, updatedAt: now } : entry);
      }
      const saved = await saveManagement(state);
      return res.json({ ok: true, batch: saved.billingBatches.find((x) => x.id === batch.id), data: saved });
    }
    if (action === 'driver_paid') {
      const payroll = markDriverPayrollPaid(state, String(req.body?.payrollId || ''), req.body?.amount == null ? null : Number(req.body.amount));
      if (!payroll) throw new Error('driver_payroll_not_found');
      const saved = await saveManagement(state);
      return res.json({ ok: true, payroll: saved.driverPayrolls.find((item) => item.id === payroll.id), data: saved });
    }
    if (action === 'import_history') {
      const result = importHistoricalRecords(state, req.body || {});
      syncDriverPayrolls(state);
      const saved = await saveManagement(state);
      return res.json({ ok: true, result, data: saved });
    }
    throw new Error('action_invalid');
  } catch (error) {
    return res.status(400).json({ ok: false, error: String(error?.message || error) });
  }
});

app.get('/api/billing/export', async (req, res) => {
  try {
    const state = await getManagement();
    const batch = (state.billingBatches || []).find((x) => x.id === String(req.query.batchId || ''));
    if (!batch) return res.status(404).send('Lote não encontrado');
    const calls = (state.calls || []).filter((x) => (batch.callIds || []).includes(x.id));
    const cols = ['Data','Tipo de cobrança','Transportadora/Grupo','Protocolo','Veículo','Placa','Origem','Destino','KM até origem','KM serviço','KM retorno base','KM total','Valor'];
    const quote = (value) => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const rows = calls.map((call) => [
      call.completedAt || call.cancelledAt || call.updatedAt || '', call.cancellationChargeRequired ? 'Cancelamento após 15 min — saída/deslocamento integral' : 'Serviço concluído', call.insurer || call.client || '', call.protocol || '', call.vehicle || '', call.plate || '', call.origin || '', call.destination || '',
      call.routeBreakdown?.legToOrigin?.km ?? '', call.routeBreakdown?.serviceLeg?.km ?? '', call.routeBreakdown?.returnToBase?.km ?? '', call.billableKm ?? call.totalKm ?? '', call.value || 0,
    ].map(quote).join(';'));
    const csv = '\uFEFF' + [cols.map(quote).join(';'), ...rows].join('\r\n');
    res.setHeader('content-type','text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="fechamento-${String(batch.groupName || 'grupo').replace(/[^a-z0-9]+/gi,'-').slice(0,40)}-${batch.periodEnd || 'periodo'}.csv"`);
    return res.send(csv);
  } catch (error) { return res.status(500).send(String(error?.message || error)); }
});

app.get('/api/billing/driver-export', async (req, res) => {
  try {
    const state = await getManagement();
    syncDriverPayrolls(state);
    const payroll = (state.driverPayrolls || []).find((item) => item.id === String(req.query.payrollId || ''));
    if (!payroll) return res.status(404).send('Folha do motorista não encontrada');
    const calls = (state.calls || []).filter((call) => (payroll.callIds || []).includes(call.id));
    const cols = ['Data','Motorista','Seguradora','Protocolo','Veículo','KM da corrida','Até 50 km','KM excedentes','Valor corrida','Hora trabalhada','Total motorista'];
    const quote = (value) => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const rows = calls.map((call) => {
      const km = Number(call.serviceOutcome === 'deslocamento_sem_reboque' ? (call.displacementBillableKm ?? call.billableKm ?? 0) : call.cancellationChargeRequired ? (call.cancellationBillableKm ?? call.billableKm ?? 0) : (call.billableKm ?? call.totalKm ?? 0));
      const excess = Math.max(0, km - 50);
      const routeAmount = Math.round((40 + excess * 0.70) * 100) / 100;
      const worked = Number(call.workedTimeChargeRequired ? call.workedTimeAmount : 0);
      return [call.completedAt || call.cancelledAt || call.updatedAt || '', call.driverName || payroll.driverName, call.insurer || call.client || '', call.protocol || '', call.vehicle || '', km, Math.min(km, 50), excess, routeAmount, worked, routeAmount + worked].map(quote).join(';');
    });
    const csv = '\uFEFF' + [cols.map(quote).join(';'), ...rows].join('\r\n');
    res.setHeader('content-type','text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="motorista-${payroll.periodEnd || 'periodo'}.csv"`);
    return res.send(csv);
  } catch (error) { return res.status(500).send(String(error?.message || error)); }
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
    const settings = await getSettings();
    if (settings.simpleMode === false) {
      await reconcileTrackerOperations(reading).catch((error) => {
        logEvent('warning', 'Falha ao reconciliar o atendimento com a localização do caminhão.', { error: String(error) });
      });
    }

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

let gracefulShutdownStarted = false;
async function gracefulShutdown(signal = 'shutdown') {
  if (gracefulShutdownStarted) return;
  gracefulShutdownStarted = true;
  logEvent('system', `Encerramento gracioso iniciado (${signal}).`);
  const current = waClient;
  const currentSimulator = simulatorClient;
  waClient = null;
  simulatorClient = null;
  if (current) {
    await Promise.race([
      current.destroy().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
  }
  if (currentSimulator) await Promise.race([currentSimulator.destroy().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))]);
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.exit(0);
}
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

await ensureDir();
await getPairCode();
await refreshServiceArea();

app.listen(port, '0.0.0.0', () => console.log(`[worker:${clientId}] listening on ${port}`));
await startWhatsApp();
