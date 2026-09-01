export const SCHEDULE_SLOT_MINUTES = 60;

function ts(value) {
  const n = new Date(value || 0).getTime();
  return Number.isFinite(n) ? n : 0;
}

export function isFutureScheduledCall(value, now = new Date(), leadMinutes = 60) {
  const target = ts(value);
  const current = ts(now);
  return Boolean(target && current && target > current + Math.max(0, Number(leadMinutes) || 0) * 60000);
}

export function scheduledCapacitySnapshot(calls = [], scheduledAt, { maxConcurrentCalls = 2, excludeCallId = '', slotMinutes = SCHEDULE_SLOT_MINUTES } = {}) {
  const target = ts(scheduledAt);
  if (!target) return { maxConcurrentCalls, activeCount: 0, slotsAvailable: maxConcurrentCalls, canAccept: false, reason: 'invalid_schedule', scheduledCalls: [] };
  const windowMs = Math.max(15, Number(slotMinutes) || SCHEDULE_SLOT_MINUTES) * 60000;
  const scheduledCalls = (Array.isArray(calls) ? calls : [])
    .filter((call) => call && call.id !== excludeCallId && String(call.status || '') === 'agendado' && ts(call.scheduledAt))
    .filter((call) => Math.abs(ts(call.scheduledAt) - target) < windowMs)
    .sort((a, b) => ts(a.scheduledAt) - ts(b.scheduledAt));
  return {
    maxConcurrentCalls,
    activeCount: scheduledCalls.length,
    slotsAvailable: Math.max(0, maxConcurrentCalls - scheduledCalls.length),
    canAccept: scheduledCalls.length < maxConcurrentCalls,
    reason: scheduledCalls.length < maxConcurrentCalls ? 'available' : 'schedule_full',
    scheduledCalls,
  };
}

export function formatScheduledAtBr(value, timeZone = 'America/Sao_Paulo') {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
