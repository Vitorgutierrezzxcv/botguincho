import { isTestCall, isTestGroupName } from './test-center.mjs';

export const MAX_CONCURRENT_CALLS = 2;
export const ACTIVE_CAPACITY_STATUSES = new Set(['autorizado', 'a_caminho', 'em_atendimento']);
const TEST_SANDBOX_TIMEZONE = 'America/Sao_Paulo';

function timestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function brazilDayKey(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TEST_SANDBOX_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

function isAutomatedTestCenterCall(call = {}) {
  return call?.testMode === true && Boolean(String(call?.testRunId || '').trim());
}

function isCurrentManualTestCall(call = {}, now = new Date()) {
  const groupName = call?.groupName || call?.insurer || call?.client || '';
  if (!isTestGroupName(groupName) || isAutomatedTestCenterCall(call)) return false;
  const referenceAt = call?.authorizedAt || call?.routeCapturedAt || call?.createdAt;
  const callDay = brazilDayKey(referenceAt);
  return Boolean(callDay) && callDay === brazilDayKey(now);
}

export function isCapacityActiveCall(call = {}, now = new Date()) {
  // A Central de Testes automatizada nao pode consumir vagas da operacao.
  if (isAutomatedTestCenterCall(call)) return false;

  // Mensagens enviadas manualmente no grupo "Tests guincho" precisam obedecer
  // exatamente as mesmas regras de capacidade da producao. Como esse grupo e um
  // sandbox persistente, testes manuais de dias anteriores nao podem bloquear o
  // teste atual. O sandbox manual reinicia a capacidade a cada dia em Sao Paulo.
  if (isTestCall(call) && !isCurrentManualTestCall(call, now)) return false;

  return ACTIVE_CAPACITY_STATUSES.has(String(call?.status || '').toLowerCase());
}

export function activeCallsForCapacity(state = {}, excludeCallId = '', now = new Date()) {
  return (Array.isArray(state?.calls) ? state.calls : [])
    .filter((call) => isCapacityActiveCall(call, now) && (!excludeCallId || call.id !== excludeCallId))
    .sort((a, b) => timestamp(a.authorizedAt || a.routeCapturedAt || a.createdAt) - timestamp(b.authorizedAt || b.routeCapturedAt || b.createdAt));
}

export function capacitySnapshot(state = {}, excludeCallId = '', now = new Date()) {
  const activeCalls = activeCallsForCapacity(state, excludeCallId, now);
  return {
    maxConcurrentCalls: MAX_CONCURRENT_CALLS,
    activeCount: activeCalls.length,
    slotsAvailable: Math.max(0, MAX_CONCURRENT_CALLS - activeCalls.length),
    canAccept: activeCalls.length < MAX_CONCURRENT_CALLS,
    activeCalls,
  };
}

export function plannedRemainingMinutes(call = {}, now = new Date()) {
  const firstLeg = Number(call?.routeBreakdown?.legToOrigin?.minutes || 0);
  const serviceLeg = Number(call?.routeBreakdown?.serviceLeg?.minutes || 0);
  const plannedToFinish = Math.max(0, firstLeg + serviceLeg);
  if (!(plannedToFinish > 0)) return null;

  const startedAt = timestamp(call?.authorizedAt || call?.routeCapturedAt || call?.updatedAt || call?.createdAt);
  const nowAt = timestamp(now);
  if (!startedAt || !nowAt || nowAt < startedAt) return plannedToFinish;
  const elapsedMinutes = Math.max(0, (nowAt - startedAt) / 60000);
  return Math.max(0, Math.ceil(plannedToFinish - elapsedMinutes));
}

export function capSecondCallEta(rawMinutes, fallbackMinutes = 60) {
  const parsed = Number(rawMinutes);
  const safeRaw = Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : Math.max(1, Number(fallbackMinutes) || 60);
  return {
    rawMinutes: safeRaw,
    minutes: Math.min(60, safeRaw),
    cappedAtOneHour: safeRaw >= 60,
  };
}
