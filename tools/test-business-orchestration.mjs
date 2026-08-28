import assert from 'node:assert/strict';
import { ensureInsurerForGroup, quoteTrackingPatch, buildQuoteFunnel, isOwnerFinalizedCall, upsertInsurer } from './business-orchestration.mjs';
import { buildPeriodReport, buildPeriodWorkbook } from './reporting-engine.mjs';

const state = { insurers: [], calls: [], finance: [], fleet: [{ id: 'truck-1', driver: 'Mauro' }] };
const insurer = ensureInsurerForGroup(state, { groupId: '120363001@g.us', groupName: 'América Guincho / Horizonte', profileKey: 'horizonte' });
assert.equal(insurer.name, 'Horizonte');
assert.deepEqual(insurer.groupIds, ['120363001@g.us']);

const same = ensureInsurerForGroup(state, { groupId: '120363002@g.us', groupName: 'Horizonte - Região 2', profileKey: 'horizonte' });
assert.equal(same.id, insurer.id);
assert.equal(same.groupIds.length, 2);

const edited = upsertInsurer(state, { ...same, name: 'Horizonte Assistência', paymentDay: 15, statementDay: 5, groupIds: same.groupIds });
assert.equal(edited.paymentDay, 15);
assert.equal(edited.name, 'Horizonte Assistência');

const quoteBase = {
  id: 'q1', insurerId: edited.id, insurerName: edited.name, insurer: edited.name,
  sourceGroupId: '120363001@g.us', groupName: 'América Guincho / Horizonte',
  createdAt: '2026-08-10T12:00:00.000Z', status: 'cotacao', testMode: false,
};
const openPatch = quoteTrackingPatch({}, { status: 'cotacao', eventType: 'cotacao', at: quoteBase.createdAt, calculatedValue: 180, estimatedKm: 55 });
const openQuote = { ...quoteBase, ...openPatch };
assert.equal(openQuote.quoteOutcome, 'open');

const wonPatch = quoteTrackingPatch(openQuote, { status: 'autorizado', eventType: 'autorizacao', at: '2026-08-10T12:05:00.000Z', calculatedValue: 180, estimatedKm: 55 });
const wonQuote = { ...openQuote, ...wonPatch, status: 'autorizado', authorizedAt: '2026-08-10T12:05:00.000Z', value: 180 };
assert.equal(wonQuote.quoteOutcome, 'won');
assert.equal(isOwnerFinalizedCall(wonQuote), false);

const lostQuote = {
  id: 'q2', insurerId: edited.id, insurerName: edited.name, insurer: edited.name,
  sourceGroupId: '120363002@g.us', groupName: 'Horizonte - Região 2', quoteTracked: true,
  quoteRequestedAt: '2026-08-11T12:00:00.000Z', quoteOutcome: 'lost', status: 'cancelado', value: 0, testMode: false,
};
const finalCall = {
  ...wonQuote, status: 'concluido', ownerCloseRequired: true, ownerClosedAt: '2026-08-10T13:30:00.000Z', ownerClosedBy: 'Thiago',
  billableKm: 55, value: 180, driverName: 'Mauro', workedTimeChargeRequired: false,
};
assert.equal(isOwnerFinalizedCall(finalCall), true);

state.calls = [finalCall, lostQuote];
state.finance = [{
  id: 'fin1', type: 'receita', isFinal: true, financialStage: 'faturado', amount: 180, status: 'pendente',
  sourceCallId: finalCall.id, insurerId: edited.id, groupId: finalCall.sourceGroupId, insurer: edited.name,
  createdAt: finalCall.ownerClosedAt,
}];

const funnel = buildQuoteFunnel(state.calls, state.insurers, { from: '2026-08-01', to: '2026-08-31' });
assert.equal(funnel.overall.requested, 2);
assert.equal(funnel.overall.won, 1);
assert.equal(funnel.overall.lost, 1);
assert.equal(funnel.overall.conversionRate, 50);
assert.equal(funnel.byInsurer[0].requested, 2);
assert.equal(funnel.byGroup.length, 2);

const report = buildPeriodReport(state, { from: '2026-08-01', to: '2026-08-31' });
assert.equal(report.finalCalls, 1);
assert.equal(report.revenue, 180);
assert.equal(report.quotes.requested, 2);
assert.equal(report.driverPay, 43.5); // R$40 + 5 km excedentes × R$0,70

const workbook = buildPeriodWorkbook(state, { from: '2026-08-01', to: '2026-08-31' });
assert.ok(Buffer.isBuffer(workbook.buffer));
assert.ok(workbook.buffer.length > 1000);

console.log('BUSINESS_ORCHESTRATION_OK');
