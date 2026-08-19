const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
const DAY_ALIASES = {
  sun: 'sun', domingo: 'sun', dom: 'sun',
  mon: 'mon', segunda: 'mon', seg: 'mon',
  tue: 'tue', terca: 'tue', 'terça': 'tue', ter: 'tue',
  wed: 'wed', quarta: 'wed', qua: 'wed',
  thu: 'thu', quinta: 'thu', qui: 'thu',
  fri: 'fri', sexta: 'fri', sex: 'fri',
  sat: 'sat', sabado: 'sat', 'sábado': 'sat', sab: 'sat',
};

export const DEFAULT_WEEKLY_SCHEDULE = {
  mon: { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  tue: { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  wed: { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  thu: { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  fri: { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  sat: { enabled: true, intervals: [{ start: '08:00', end: '12:00' }] },
  sun: { enabled: false, intervals: [] },
};

function cleanTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function minutes(value) {
  const [h,m] = String(value).split(':').map(Number);
  return h * 60 + m;
}

export function sanitizeDaySchedule(value = {}) {
  const enabled = value?.enabled === true;
  const intervals = [];
  for (const raw of Array.isArray(value?.intervals) ? value.intervals.slice(0, 8) : []) {
    const start = cleanTime(raw?.start);
    const end = cleanTime(raw?.end);
    if (!start || !end || start === end) continue;
    intervals.push({ start, end });
  }
  intervals.sort((a,b) => minutes(a.start) - minutes(b.start));
  return { enabled: enabled && intervals.length > 0, intervals };
}

export function sanitizeWeeklySchedule(input = {}) {
  const out = {};
  for (const key of ['mon','tue','wed','thu','fri','sat','sun']) {
    let raw = input?.[key];
    if (!raw && input && typeof input === 'object') {
      const alternate = Object.keys(input).find((candidate) => DAY_ALIASES[String(candidate).toLowerCase()] === key);
      if (alternate) raw = input[alternate];
    }
    out[key] = sanitizeDaySchedule(raw || DEFAULT_WEEKLY_SCHEDULE[key]);
  }
  return out;
}

function localParts(now, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((item) => [item.type, item.value]));
  const dayKey = DAY_ALIASES[String(parts.weekday || '').slice(0,3).toLowerCase()] || DAY_KEYS[now.getDay()];
  const minuteOfDay = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  return { dayKey, minuteOfDay, localTime: `${String(parts.hour || '00').padStart(2,'0')}:${String(parts.minute || '00').padStart(2,'0')}` };
}

function intervalContains(interval, minuteOfDay) {
  const start = minutes(interval.start);
  const end = minutes(interval.end);
  if (start < end) return minuteOfDay >= start && minuteOfDay < end;
  // Intervalo atravessa meia-noite, por exemplo 20:00-02:00.
  return minuteOfDay >= start || minuteOfDay < end;
}

export function evaluateOperatingHours(settings = {}, now = new Date()) {
  const enabled = settings?.operatingHoursEnabled === true;
  const timeZone = String(settings?.operatingTimezone || 'America/Sao_Paulo').trim() || 'America/Sao_Paulo';
  if (!enabled) return { open: true, enabled: false, reason: 'disabled', timeZone };

  let schedule;
  let local;
  try {
    schedule = sanitizeWeeklySchedule(settings?.weeklySchedule || DEFAULT_WEEKLY_SCHEDULE);
    local = localParts(now, timeZone);
  } catch {
    return { open: true, enabled: true, reason: 'invalid_timezone_fail_open', timeZone };
  }

  const day = schedule[local.dayKey] || { enabled: false, intervals: [] };
  if (!day.enabled || !day.intervals.length) {
    return { open: false, enabled: true, reason: 'day_closed', timeZone, ...local, day };
  }
  const matched = day.intervals.find((interval) => intervalContains(interval, local.minuteOfDay)) || null;
  return {
    open: Boolean(matched),
    enabled: true,
    reason: matched ? 'within_interval' : 'outside_intervals',
    timeZone,
    ...local,
    day,
    matchedInterval: matched,
  };
}

export function sanitizeOperatingSettings(input = {}) {
  return {
    operatingHoursEnabled: input?.operatingHoursEnabled === true,
    operatingTimezone: String(input?.operatingTimezone || 'America/Sao_Paulo').trim().slice(0,80) || 'America/Sao_Paulo',
    weeklySchedule: sanitizeWeeklySchedule(input?.weeklySchedule || DEFAULT_WEEKLY_SCHEDULE),
    outOfHoursReply: String(input?.outOfHoursReply || 'Motorista fora de rota.').trim().slice(0,300) || 'Motorista fora de rota.',
  };
}
