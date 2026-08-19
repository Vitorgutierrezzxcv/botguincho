export const MAX_CONCURRENT_CALLS = 2;
export const ACTIVE_CAPACITY_STATUSES = new Set(['autorizado', 'a_caminho', 'em_atendimento']);

function timestamp(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function isCapacityActiveCall(call = {}) {
  return ACTIVE_CAPACITY_STATUSES.has(String(call?.status || '').toLowerCase());
}

export function activeCallsForCapacity(state = {}, excludeCallId = '') {
  return (Array.isArray(state?.calls) ? state.calls : [])
    .filter((call) => isCapacityActiveCall(call) && (!excludeCallId || call.id !== excludeCallId))
    .sort((a, b) => timestamp(a.authorizedAt || a.routeCapturedAt || a.createdAt) - timestamp(b.authorizedAt || b.routeCapturedAt || b.createdAt));
}

export function capacitySnapshot(state = {}, excludeCallId = '') {
  const activeCalls = activeCallsForCapacity(state, excludeCallId);
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
