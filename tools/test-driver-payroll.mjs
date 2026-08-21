import assert from 'node:assert/strict';
import { driverPayForCall, driverPayrollPeriodFor, markDriverPayrollPaid, syncDriverPayrolls } from './driver-payroll.mjs';
import { buildInsurerSummaries } from './financial-engine.mjs';

assert.deepEqual(driverPayrollPeriodFor('2026-08-20T23:00:00Z'), { periodStart: '2026-07-20', periodEnd: '2026-08-20', paymentDue: '2026-08-20' });
assert.deepEqual(driverPayrollPeriodFor('2026-08-21T00:00:00Z'), { periodStart: '2026-08-20', periodEnd: '2026-09-20', paymentDue: '2026-09-20' });

const short = driverPayForCall({ status: 'concluido', billableKm: 50 });
assert.equal(driverPayForCall({ status: 'concluido', billableKm: 50, testMode: true }), null);
assert.equal(driverPayForCall({ status: 'concluido', billableKm: 50, insurer: 'Tests guincho' }), null);
assert.equal(short.routeAmount, 40);
assert.equal(short.totalAmount, 40);
const long = driverPayForCall({ status: 'concluido', billableKm: 60, workedTimeChargeRequired: true, workedTimeAmount: 80 });
assert.equal(long.excessKm, 10);
assert.equal(long.routeAmount, 47);
assert.equal(long.totalAmount, 127);
assert.equal(driverPayForCall({ status: 'cancelado', cancellationChargeRequired: false, billableKm: 40 }), null);

const state = {
  calls: [
    { id: 'c1', status: 'concluido', billableKm: 50, completedAt: '2026-08-10T10:00:00Z', insurer: 'Seguradora A', sourceGroupId: 'g1' },
    { id: 'c2', status: 'concluido', billableKm: 60, workedTimeChargeRequired: true, workedTimeAmount: 80, completedAt: '2026-08-20T10:00:00Z', insurer: 'Seguradora A', sourceGroupId: 'g1' },
  ],
  fleet: [{ id: 'f1', driver: 'João' }], finance: [], driverPayrolls: [],
};
syncDriverPayrolls(state, new Date('2026-08-20T18:00:00Z'));
assert.equal(state.driverPayrolls.length, 1);
assert.equal(state.driverPayrolls[0].periodStart, '2026-07-20');
assert.equal(state.driverPayrolls[0].callCount, 2);
assert.equal(state.driverPayrolls[0].routeAmount, 87);
assert.equal(state.driverPayrolls[0].workedTimeAmount, 80);
assert.equal(state.driverPayrolls[0].totalAmount, 167);
assert.equal(state.driverPayrolls[0].status, 'due');
assert.equal(state.finance[0].category, 'Pagamento do motorista');
markDriverPayrollPaid(state, state.driverPayrolls[0].id, 167, new Date('2026-08-20T19:00:00Z'));
assert.equal(state.driverPayrolls[0].status, 'paid');
assert.equal(state.finance[0].status, 'pago');

const summaries = buildInsurerSummaries({
  profiles: [{ groupId: 'g1', groupName: 'Seguradora A', status: 'approved', paymentMode: 'monthly' }],
  batches: [{ groupId: 'g1', groupName: 'Seguradora A', status: 'statement_due', statementDue: '2026-08-20', invoiceDue: '2026-08-22', paymentDue: '2026-09-10' }],
  finance: [{ type: 'receita', groupId: 'g1', insurer: 'Seguradora A', status: 'pendente', amount: 500, dueDate: '2026-09-10' }],
  calls: state.calls,
});
assert.equal(summaries.length, 1);
assert.equal(summaries[0].callCount, 2);
assert.equal(summaries[0].receivable, 500);
assert.equal(summaries[0].nextStatementDue, '2026-08-20');

console.log('DRIVER_PAYROLL_OK');
