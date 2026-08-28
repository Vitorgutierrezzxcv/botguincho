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

const fridayBeforeOpen = evaluateOperatingHours(settings, new Date('2026-08-21T10:59:00Z'));
assert.equal(fridayBeforeOpen.localTime, '07:59');
assert.equal(fridayBeforeOpen.open, false);
assert.equal(fridayBeforeOpen.reason, 'outside_intervals');

const fridayAtOpen = evaluateOperatingHours(settings, new Date('2026-08-21T11:00:00Z'));
assert.equal(fridayAtOpen.localTime, '08:00');
assert.equal(fridayAtOpen.open, true);

const fridayAtClose = evaluateOperatingHours(settings, new Date('2026-08-21T21:00:00Z'));
assert.equal(fridayAtClose.localTime, '18:00');
assert.equal(fridayAtClose.open, false);
assert.equal(fridayAtClose.reason, 'outside_intervals');

const overnightSchedule = sanitizeWeeklySchedule({
  mon: { enabled: true, intervals: [{ start: '20:00', end: '02:00' }] },
  tue: { enabled: false, intervals: [] },
  wed: { enabled: false, intervals: [] },
  thu: { enabled: false, intervals: [] },
  fri: { enabled: false, intervals: [] },
  sat: { enabled: false, intervals: [] },
  sun: { enabled: false, intervals: [] },
});
const overnightSettings = { operatingHoursEnabled: true, operatingTimezone: 'America/Sao_Paulo', weeklySchedule: overnightSchedule };
const mondayNight = evaluateOperatingHours(overnightSettings, new Date('2026-08-24T23:30:00Z'));
assert.equal(mondayNight.dayKey, 'mon');
assert.equal(mondayNight.localTime, '20:30');
assert.equal(mondayNight.open, true);
assert.equal(mondayNight.reason, 'within_interval');

const tuesdayCarry = evaluateOperatingHours(overnightSettings, new Date('2026-08-25T04:00:00Z'));
assert.equal(tuesdayCarry.dayKey, 'tue');
assert.equal(tuesdayCarry.localTime, '01:00');
assert.equal(tuesdayCarry.open, true);
assert.equal(tuesdayCarry.reason, 'within_previous_overnight_interval');
assert.equal(tuesdayCarry.matchedDayKey, 'mon');

const tuesdayAfterCarry = evaluateOperatingHours(overnightSettings, new Date('2026-08-25T05:00:00Z'));
assert.equal(tuesdayAfterCarry.localTime, '02:00');
assert.equal(tuesdayAfterCarry.open, false);
assert.equal(tuesdayAfterCarry.reason, 'day_closed');

const invalidTimezone = evaluateOperatingHours({ ...settings, operatingTimezone: 'America/Timezone-Inexistente' }, new Date('2026-08-21T12:00:00Z'));
assert.equal(invalidTimezone.open, false);
assert.equal(invalidTimezone.reason, 'invalid_timezone_fail_closed');

const disabled = evaluateOperatingHours({ ...settings, operatingHoursEnabled: false }, new Date('2026-08-21T02:00:00Z'));
assert.equal(disabled.open, true);
assert.equal(disabled.reason, 'disabled');

console.log('OPERATING_HOURS_OK');
