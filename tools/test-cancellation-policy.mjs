import assert from 'node:assert/strict';
import {
  FREE_CANCELLATION_WINDOW_MINUTES,
  cancellationDeadlineFor,
  cancellationReply,
  enforceFullCancellationCommercial,
  evaluateCancellationPolicy,
} from './cancellation-policy.mjs';
import { financeEntryFromCall, settlementForCall, suggestBillingProfile, upsertBillingBatch } from './financial-engine.mjs';

const authorizedAt = '2026-08-19T12:00:00.000Z';
assert.equal(FREE_CANCELLATION_WINDOW_MINUTES, 15);
assert.equal(cancellationDeadlineFor(authorizedAt), '2026-08-19T12:15:00.000Z');

const exactBoundary = evaluateCancellationPolicy({
  authorizedAt,
  cancelledAt: '2026-08-19T12:15:00.000Z',
  billableKm: 83,
});
assert.equal(exactBoundary.chargeRequired, false);
assert.equal(exactBoundary.confirmationFound, true);
assert.equal(exactBoundary.withinFreeWindow, true);
assert.equal(exactBoundary.billableKm, 0);

const late = evaluateCancellationPolicy({
  authorizedAt,
  cancelledAt: '2026-08-19T12:15:00.001Z',
  billableKm: 83,
});
assert.equal(late.chargeRequired, true);
assert.equal(late.chargeBasis, 'quilometragem_total');
assert.equal(late.billableKm, 83);
assert.equal(late.partialPaymentAllowed, false);

const notConfirmed = evaluateCancellationPolicy({
  authorizedAt: null,
  cancelledAt: '2026-08-19T12:30:00.000Z',
  billableKm: 83,
});
assert.equal(notConfirmed.confirmationFound, false);
assert.equal(notConfirmed.chargeRequired, false);
assert.equal(notConfirmed.withinFreeWindow, false);
assert.equal(notConfirmed.billableKm, 0);

const fullCommercial = enforceFullCancellationCommercial({
  status: 'divergence',
  calculatedAmount: 259,
  reportedAmount: 129.5,
  reviewRequired: true,
});
assert.equal(fullCommercial.status, 'ok');
assert.equal(fullCommercial.calculatedAmount, 259);
assert.equal(fullCommercial.reportedAmountRejected, true);
assert.equal(fullCommercial.partialPaymentAllowed, false);
assert.equal(fullCommercial.reviewRequired, false);

const pendingRate = enforceFullCancellationCommercial({ calculatedAmount: null, reportedAmount: 100 });
assert.equal(pendingRate.reviewRequired, true);
assert.equal(pendingRate.reportedAmountRejected, true);

assert.match(cancellationReply(late, 259), /83 km/);
assert.match(cancellationReply(late, 259), /R\$\s*259,00/);
assert.match(cancellationReply(late, 259), /cobrança parcial/);
assert.match(cancellationReply(exactBoundary), /sem cobrança/);
assert.equal(cancellationReply(notConfirmed), 'Cancelamento registrado sem cobrança.');

const profile = {
  ...suggestBillingProfile('group-1', 'Company Truck'),
  status: 'approved',
};
const billableCall = {
  id: 'call-1',
  sourceGroupId: 'group-1',
  insurer: 'Company Truck',
  vehicle: 'Carro leve',
  status: 'cancelado',
  cancellationChargeRequired: true,
  cancellationBillableKm: 83,
  billableKm: 83,
  value: 259,
  cancelledAt: '2026-08-19T12:16:00.000Z',
};
const settlement = settlementForCall(profile, billableCall, billableCall.cancelledAt);
assert.equal(settlement.status, 'ok');
const state = { calls: [billableCall], billingBatches: [] };
const batch = upsertBillingBatch(state, billableCall, profile, settlement);
const entry = financeEntryFromCall(billableCall, settlement, batch);
assert.equal(entry.amount, 259);
assert.equal(entry.category, 'Cancelamento cobrável');
assert.equal(entry.billableKm, 83);
assert.equal(entry.partialPaymentAllowed, false);
assert.match(entry.description, /saída e deslocamento integral/);

const noTowCall = { ...billableCall, id: 'call-2', status: 'concluido', cancellationChargeRequired: false, serviceOutcome: 'deslocamento_sem_reboque', displacementChargeRequired: true, displacementBillableKm: 18, value: 135 };
const noTowEntry = financeEntryFromCall(noTowCall, settlement, null);
assert.equal(noTowEntry.category, 'Deslocamento sem reboque');
assert.equal(noTowEntry.billableKm, 18);
assert.equal(noTowEntry.towPerformed, false);
assert.equal(noTowEntry.partialPaymentAllowed, false);

const workedEntry = financeEntryFromCall({ ...noTowCall, workedTimeChargeRequired: true, workedTimeChargedHours: 1, workedTimeHourlyRate: 80, workedTimeAmount: 80, value: 215 }, settlement, null);
assert.equal(workedEntry.workedTimeAmount, 80);
assert.match(workedEntry.description, /1h trabalhada/);

console.log('CANCELLATION_POLICY_OK');
