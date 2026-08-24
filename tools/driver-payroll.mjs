import crypto from 'node:crypto';
import { isTestCall } from './test-center.mjs';
import { isConfirmedCall } from './simple-operation.mjs';

export const DRIVER_CLOSING_DAY = 20;
export const DRIVER_BASE_KM_LIMIT = 50;
export const DRIVER_BASE_PAY = 40;
export const DRIVER_EXCESS_KM_RATE = 0.70;

function money(value) { return Math.round(Number(value || 0) * 100) / 100; }
function dateOnly(value = new Date()) { return new Date(value).toISOString().slice(0, 10); }
function daysInMonth(year, monthIndex) { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }
function atClosingDay(year, monthIndex) { return new Date(Date.UTC(year, monthIndex, Math.min(DRIVER_CLOSING_DAY, daysInMonth(year, monthIndex)), 12, 0, 0)); }

function billableCall(call = {}) {
  if (isTestCall(call)) return false;
  return isConfirmedCall(call) || (call.status === 'cancelado' && call.cancellationChargeRequired === true);
}

export function driverPayForCall(call = {}) {
  if (!billableCall(call)) return null;
  const billableKm = Math.max(0, Number(
    call.serviceOutcome === 'deslocamento_sem_reboque'
      ? (call.displacementBillableKm ?? call.billableKm ?? 0)
      : call.cancellationChargeRequired
        ? (call.cancellationBillableKm ?? call.billableKm ?? call.totalKm ?? 0)
        : (call.billableKm ?? call.totalKm ?? 0)
  ));
  const excessKm = Math.max(0, billableKm - DRIVER_BASE_KM_LIMIT);
  const routeAmount = money(DRIVER_BASE_PAY + excessKm * DRIVER_EXCESS_KM_RATE);
  const workedTimeAmount = money(call.workedTimeChargeRequired ? call.workedTimeAmount : 0);
  return {
    billableKm,
    baseAmount: DRIVER_BASE_PAY,
    excessKm: money(excessKm),
    excessKmRate: DRIVER_EXCESS_KM_RATE,
    routeAmount,
    workedTimeAmount,
    totalAmount: money(routeAmount + workedTimeAmount),
  };
}

export function driverPayrollPeriodFor(value = new Date()) {
  const date = new Date(value);
  const end = date.getUTCDate() <= DRIVER_CLOSING_DAY
    ? atClosingDay(date.getUTCFullYear(), date.getUTCMonth())
    : atClosingDay(date.getUTCFullYear(), date.getUTCMonth() + 1);
  const start = atClosingDay(end.getUTCFullYear(), end.getUTCMonth() - 1);
  return { periodStart: dateOnly(start), periodEnd: dateOnly(end), paymentDue: dateOnly(end) };
}

function driverForCall(state, call) {
  const fleet = Array.isArray(state.fleet) ? state.fleet : [];
  const vehicle = fleet.find((item) => item.id === call.driverFleetId)
    || fleet.find((item) => item.driver && item.driver === call.driverName)
    || fleet.find((item) => item.driver)
    || fleet[0]
    || {};
  return {
    driverId: String(call.driverId || vehicle.driverId || vehicle.id || 'driver-primary'),
    driverName: String(call.driverName || vehicle.driver || 'Motorista principal'),
  };
}

export function syncDriverPayrolls(state, now = new Date()) {
  const previous = new Map((Array.isArray(state.driverPayrolls) ? state.driverPayrolls : []).map((item) => [item.key, item]));
  const grouped = new Map();
  for (const call of Array.isArray(state.calls) ? state.calls : []) {
    const calculation = driverPayForCall(call);
    if (!calculation) continue;
    const settledAt = call.completedAt || call.cancelledAt || call.updatedAt || call.createdAt;
    if (!settledAt) continue;
    const period = driverPayrollPeriodFor(settledAt);
    const driver = driverForCall(state, call);
    const key = `${driver.driverId}|${period.periodStart}|${period.periodEnd}`;
    if (!grouped.has(key)) grouped.set(key, { key, ...driver, ...period, calls: [] });
    grouped.get(key).calls.push({ call, calculation });
  }

  const today = dateOnly(now);
  state.driverPayrolls = [...grouped.values()].map((group) => {
    const old = previous.get(group.key) || {};
    const callIds = group.calls.map(({ call }) => call.id);
    const totalKm = money(group.calls.reduce((sum, item) => sum + item.calculation.billableKm, 0));
    const routeAmount = money(group.calls.reduce((sum, item) => sum + item.calculation.routeAmount, 0));
    const workedTimeAmount = money(group.calls.reduce((sum, item) => sum + item.calculation.workedTimeAmount, 0));
    const totalAmount = money(routeAmount + workedTimeAmount);
    const status = old.paidAt ? 'paid' : today > group.paymentDue ? 'overdue' : today >= group.paymentDue ? 'due' : 'accumulating';
    return {
      id: old.id || crypto.randomUUID(), key: group.key,
      driverId: group.driverId, driverName: group.driverName,
      periodStart: group.periodStart, periodEnd: group.periodEnd, paymentDue: group.paymentDue,
      callIds, callCount: callIds.length, totalKm, routeAmount, workedTimeAmount, totalAmount,
      status, paidAt: old.paidAt || null, paidAmount: old.paidAmount ?? null,
      createdAt: old.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }).sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)));

  if (!Array.isArray(state.finance)) state.finance = [];
  for (const payroll of state.driverPayrolls) {
    let entry = state.finance.find((item) => item.driverPayrollId === payroll.id);
    const patch = {
      description: `Pagamento motorista · ${payroll.driverName} · ${payroll.periodStart} a ${payroll.periodEnd}`,
      category: 'Pagamento do motorista', amount: payroll.totalAmount, type: 'despesa',
      status: payroll.paidAt ? 'pago' : (payroll.status === 'overdue' ? 'atrasado' : 'pendente'),
      dueDate: payroll.paymentDue, driverPayrollId: payroll.id, driverId: payroll.driverId,
      paidAt: payroll.paidAt || null, source: 'driver_payroll', updatedAt: new Date().toISOString(),
    };
    if (entry) Object.assign(entry, patch);
    else state.finance.unshift({ id: crypto.randomUUID(), ...patch, createdAt: new Date().toISOString() });
  }
  return state.driverPayrolls;
}

export function markDriverPayrollPaid(state, payrollId, amount = null, paidAt = new Date()) {
  syncDriverPayrolls(state, paidAt);
  const payroll = state.driverPayrolls.find((item) => item.id === payrollId);
  if (!payroll) return null;
  payroll.paidAt = new Date(paidAt).toISOString();
  payroll.paidAmount = money(amount == null ? payroll.totalAmount : amount);
  payroll.status = 'paid';
  const entry = state.finance.find((item) => item.driverPayrollId === payroll.id);
  if (entry) Object.assign(entry, { status: 'pago', paidAt: payroll.paidAt, amount: payroll.paidAmount, updatedAt: payroll.paidAt });
  return payroll;
}
