import crypto from 'node:crypto';

const KNOWN_INSURERS = {
  solucao: 'Solução Assistência',
  'top-brasil': 'Top Brasil',
  saturno: 'Saturno',
  plus: 'Plus Assistência',
  'company-truck': 'Company Truck',
  horizonte: 'Horizonte',
  socorre: 'Socorre Assistência',
  premium: 'Premium Assistência',
  'assistencia-segura': 'Assistência Segura',
  power: 'Power',
};

function norm(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function clean(value = '', max = 500) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function clampDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(31, Math.max(1, n)) : null;
}
function unique(values = []) { return [...new Set(values.map((v) => clean(v, 240)).filter(Boolean))]; }
function money(value) { return Math.round(Number(value || 0) * 100) / 100; }

export function insurerNameFromGroup(groupName = '', profileKey = '') {
  if (KNOWN_INSURERS[profileKey]) return KNOWN_INSURERS[profileKey];
  const name = clean(groupName, 200);
  return name || 'Seguradora';
}

export function sanitizeInsurer(raw = {}) {
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const groupIds = unique([...(Array.isArray(raw.groupIds) ? raw.groupIds : []), ...groups.map((g) => g?.id)]).filter((id) => id.endsWith('@g.us'));
  const groupNames = unique([...(Array.isArray(raw.groupNames) ? raw.groupNames : []), ...groups.map((g) => g?.name)]);
  const paymentModes = new Set(['monthly','semimonthly','per_call','dynamic_per_call','manual']);
  return {
    id: clean(raw.id || `ins-${crypto.randomUUID()}`, 120),
    name: clean(raw.name || 'Seguradora', 200),
    canonicalKey: clean(raw.canonicalKey || '', 80),
    status: raw.status === 'inactive' ? 'inactive' : 'active',
    groupIds,
    groupNames,
    paymentMode: paymentModes.has(raw.paymentMode) ? raw.paymentMode : 'manual',
    statementDay: clampDay(raw.statementDay),
    submitWindowStartDay: clampDay(raw.submitWindowStartDay),
    submitWindowEndDay: clampDay(raw.submitWindowEndDay),
    invoiceDeadlineDay: clampDay(raw.invoiceDeadlineDay),
    paymentDay: clampDay(raw.paymentDay),
    paymentMonthOffset: Math.min(3, Math.max(0, Number(raw.paymentMonthOffset) || 0)),
    baseAddress: clean(raw.baseAddress, 700),
    contactName: clean(raw.contactName, 160),
    contactEmail: clean(raw.contactEmail, 240),
    contactPhone: clean(raw.contactPhone, 80),
    notes: clean(raw.notes, 1500),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function ensureInsurerForGroup(state = {}, { groupId = '', groupName = '', profileKey = '' } = {}) {
  if (!Array.isArray(state.insurers)) state.insurers = [];
  const id = clean(groupId, 200);
  const key = clean(profileKey, 80);
  let insurer = state.insurers.find((item) => Array.isArray(item.groupIds) && item.groupIds.includes(id));
  if (!insurer && key && key !== 'generic') insurer = state.insurers.find((item) => item.canonicalKey === key);
  if (!insurer) {
    const stable = key && key !== 'generic'
      ? key
      : crypto.createHash('sha1').update(norm(groupName || groupId || crypto.randomUUID())).digest('hex').slice(0, 12);
    insurer = sanitizeInsurer({
      id: `insurer-${stable}`,
      name: insurerNameFromGroup(groupName, key),
      canonicalKey: key && key !== 'generic' ? key : '',
      groupIds: id ? [id] : [],
      groupNames: groupName ? [groupName] : [],
    });
    state.insurers.push(insurer);
  } else {
    insurer = sanitizeInsurer({
      ...insurer,
      groupIds: unique([...(insurer.groupIds || []), id]).filter((value) => value.endsWith('@g.us')),
      groupNames: unique([...(insurer.groupNames || []), groupName]),
    });
    state.insurers = state.insurers.map((item) => item.id === insurer.id ? insurer : item);
  }
  return insurer;
}

export function upsertInsurer(state = {}, raw = {}) {
  if (!Array.isArray(state.insurers)) state.insurers = [];
  const item = sanitizeInsurer(raw);
  const index = state.insurers.findIndex((current) => current.id === item.id);
  if (index >= 0) state.insurers[index] = { ...state.insurers[index], ...item, createdAt: state.insurers[index].createdAt || item.createdAt };
  else state.insurers.unshift(item);
  return state.insurers.find((current) => current.id === item.id);
}

const QUOTE_TIMELINE_TYPES = new Set([
  'consulta_registrada','consulta_disponibilidade','cotacao','solicitacao_recebida',
  'dados_incompletos','dados_do_atendimento','aguardando_autorizacao',
]);
const WON_STATUSES = new Set(['autorizado','a_caminho','em_atendimento','aguardando_fechamento','concluido']);

export function isTrackedQuote(call = {}) {
  if (call.quoteTracked === true || call.manualQuote === true) return true;
  if (['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(String(call.status || ''))) return true;
  return (Array.isArray(call.operationalTimeline) ? call.operationalTimeline : []).some((event) => QUOTE_TIMELINE_TYPES.has(event?.type));
}

export function quoteOutcome(call = {}) {
  if (!isTrackedQuote(call)) return null;
  if (call.quoteOutcome === 'won' || call.quoteOutcome === 'lost' || call.quoteOutcome === 'open') return call.quoteOutcome;
  if (call.authorizedAt || WON_STATUSES.has(String(call.status || ''))) return 'won';
  if (call.status === 'cancelado' && call.cancellationChargeRequired !== true) return 'lost';
  return 'open';
}

export function quoteTrackingPatch(existing = {}, { status = '', eventType = '', at = new Date().toISOString(), calculatedValue = null, estimatedKm = null } = {}) {
  const quoteSignal = existing.quoteTracked === true
    || ['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(status)
    || QUOTE_TIMELINE_TYPES.has(eventType);
  const tracked = quoteSignal || Boolean(existing.quoteRequestedAt);
  let outcome = existing.quoteOutcome || (tracked ? 'open' : null);
  if (tracked && (status === 'autorizado' || WON_STATUSES.has(status))) outcome = 'won';
  if (tracked && status === 'cancelado' && !existing.authorizedAt) outcome = 'lost';
  return {
    quoteTracked: tracked,
    quoteRequestedAt: tracked ? (existing.quoteRequestedAt || at) : (existing.quoteRequestedAt || null),
    quoteOutcome: outcome,
    quoteAcceptedAt: outcome === 'won' ? (existing.quoteAcceptedAt || at) : (existing.quoteAcceptedAt || null),
    quoteLostAt: outcome === 'lost' ? (existing.quoteLostAt || at) : (existing.quoteLostAt || null),
    quoteCalculatedValue: Number.isFinite(Number(calculatedValue)) && Number(calculatedValue) > 0 ? money(calculatedValue) : (existing.quoteCalculatedValue ?? null),
    quoteEstimatedKm: Number.isFinite(Number(estimatedKm)) && Number(estimatedKm) >= 0 ? Math.round(Number(estimatedKm) * 10) / 10 : (existing.quoteEstimatedKm ?? null),
  };
}

export function isOwnerFinalizedCall(call = {}) {
  if (!call || call.testMode === true) return false;
  if (call.ownerClosedAt) return true;
  // Compatibilidade com corridas antigas concluídas antes de existir o fechamento do dono.
  return call.status === 'concluido' && call.ownerCloseRequired !== true;
}

function inPeriod(call = {}, { from = '', to = '' } = {}) {
  const raw = call.quoteRequestedAt || call.createdAt || call.updatedAt;
  const time = new Date(raw || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return false;
  if (from) {
    const start = new Date(`${from}T00:00:00-03:00`).getTime();
    if (Number.isFinite(start) && time < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999-03:00`).getTime();
    if (Number.isFinite(end) && time > end) return false;
  }
  return true;
}

function finalizeBucket(bucket) {
  const decided = bucket.won + bucket.lost;
  return {
    ...bucket,
    quotedAmount: money(bucket.quotedAmount),
    finalAmount: money(bucket.finalAmount),
    conversionRate: decided ? Math.round((bucket.won / decided) * 10000) / 100 : 0,
  };
}

export function buildQuoteFunnel(calls = [], insurers = [], filters = {}) {
  const byInsurer = new Map();
  const byGroup = new Map();
  const insurerMap = new Map((Array.isArray(insurers) ? insurers : []).map((item) => [item.id, item]));
  const base = () => ({ requested: 0, won: 0, lost: 0, open: 0, quotedAmount: 0, finalAmount: 0 });
  const overall = base();

  for (const call of Array.isArray(calls) ? calls : []) {
    if (call.testMode === true || !isTrackedQuote(call) || !inPeriod(call, filters)) continue;
    if (filters.groupId && call.sourceGroupId !== filters.groupId) continue;
    if (filters.insurerId && call.insurerId !== filters.insurerId) continue;
    const outcome = quoteOutcome(call) || 'open';
    const insurer = insurerMap.get(call.insurerId) || {};
    const insurerId = call.insurerId || `name:${norm(call.insurer || call.client || 'Seguradora')}`;
    const insurerName = insurer.name || call.insurerName || call.insurer || call.client || 'Seguradora';
    const groupId = call.sourceGroupId || `name:${norm(call.groupName || call.insurer || call.client || 'Grupo')}`;
    const groupName = call.groupName || call.insurer || call.client || 'Grupo';
    if (!byInsurer.has(insurerId)) byInsurer.set(insurerId, { insurerId, insurerName, ...base() });
    if (!byGroup.has(groupId)) byGroup.set(groupId, { groupId, groupName, insurerId, insurerName, ...base() });
    const buckets = [overall, byInsurer.get(insurerId), byGroup.get(groupId)];
    for (const bucket of buckets) {
      bucket.requested += 1;
      bucket[outcome] += 1;
      bucket.quotedAmount += Number(call.quoteCalculatedValue || call.calculatedValue || 0);
      if (isOwnerFinalizedCall(call)) bucket.finalAmount += Number(call.value || 0);
    }
  }

  return {
    overall: finalizeBucket(overall),
    byInsurer: [...byInsurer.values()].map(finalizeBucket).sort((a, b) => b.requested - a.requested || a.insurerName.localeCompare(b.insurerName, 'pt-BR')),
    byGroup: [...byGroup.values()].map(finalizeBucket).sort((a, b) => b.requested - a.requested || a.groupName.localeCompare(b.groupName, 'pt-BR')),
  };
}
