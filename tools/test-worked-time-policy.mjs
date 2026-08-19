import assert from 'node:assert/strict';
import { addWorkedTimeToCommercial, evaluateWorkedTime } from './worked-time-policy.mjs';

const free = evaluateWorkedTime({ reportedMinutes: 15 });
assert.equal(free.chargeRequired, false);
assert.equal(free.amount, 0);
const first = evaluateWorkedTime({ reportedMinutes: 16 });
assert.equal(first.chargedHours, 1);
assert.equal(first.amount, 80);
const stillFirst = evaluateWorkedTime({ reportedMinutes: 75 });
assert.equal(stillFirst.chargedHours, 1);
const second = evaluateWorkedTime({ reportedMinutes: 76 });
assert.equal(second.chargedHours, 2);
assert.equal(second.amount, 160);
assert.equal(addWorkedTimeToCommercial({ status: 'ok', calculatedAmount: 200 }, second).calculatedAmount, 360);
console.log('WORKED_TIME_POLICY_OK');
