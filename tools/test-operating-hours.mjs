import assert from 'node:assert/strict';
import { evaluateOperatingHours, sanitizeWeeklySchedule } from './operating-hours.mjs';

const weeklySchedule = sanitizeWeeklySchedule({
  mon: { enabled: false, intervals: [] },
  tue: { enabled: false, intervals: [] },
  wed: { enabled: false, intervals: [] },
  thu: { enabled: true, intervals: [{ start: '08:00', end: '00:00' }] },
  fri: { enabled: true, intervals: [{ start: '08:00', end: '18:00' }] },
  sat: { enabled: false, intervals: [] },
  sun: { enabled: false, intervals: [] },
});
const settings = { operatingHoursEnabled: true, operatingTimezone: 'America/Sao_Paulo', weeklySchedule };

const thursdayNight = evaluateOperatingHours(settings, new Date('2026-08-21T02:00:00Z'));
assert.equal(thursdayNight.dayKey, 'thu');
assert.equal(thursdayNight.localTime, '23:00');
assert.equal(thursdayNight.open, true);
assert.equal(thursdayNight.reason, 'within_interval');

const fridayMidnight = evaluateOperatingHours(settings, new Date('2026-08-21T03:00:00Z'));
assert.equal(fridayMidnight.dayKey, 'fri');
assert.equal(fridayMidnight.localTime, '00:00');
assert.equal(fridayMidnight.open, false);

assert.equal(evaluateOperatingHours({ ...settings, operatingHoursEnabled: false }, new Date('2026-08-21T02:00:00Z')).open, true);

console.log('OPERATING_HOURS_OK');
