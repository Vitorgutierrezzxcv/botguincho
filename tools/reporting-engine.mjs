import XLSX from 'xlsx';
import { buildQuoteFunnel, isOwnerFinalizedCall, isTrackedQuote, quoteOutcome } from './business-orchestration.mjs';
import { driverPayForCall } from './driver-payroll.mjs';
import { isTestCall } from './test-center.mjs';

function dateOnly(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}
function money(value) { return Math.round(Number(value || 0) * 100) / 100; }
function inPeriod(item = {}, { from = '', to = '' } = {}) {
  const raw = item.ownerClosedAt || item.completedAt || item.cancelledAt || item.authorizedAt || item.quoteRequestedAt || item.createdAt || item.updatedAt;
  const time = new Date(raw || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return false;
  if (from) {
    const start = new Date(`${from}T00:00:00-03:00`).getTime();
    if (Number.isFinite(start) && time < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999-03:00`).getTime();
    if (Number.isFinite(end) && time > end) return false;
  }
  return true;
}
function applyFilters(item = {}, filters = {}) {
  if (!inPeriod(item, filters)) return false;
  if (filters.groupId && item.sourceGroupId !== filters.groupId && item.groupId !== filters.groupId) return false;
  if (filters.insurerId && item.insurerId !== filters.insurerId) return false;
  return true;
}
function finalCalls(state = {}, filters = {}) {
  return (state.calls || []).filter((call) => !isTestCall(call) && isOwnerFinalizedCall(call) && applyFilters(call, filters));
}
function quoteCalls(state = {}, filters = {}) {
  return (state.calls || []).filter((call) => !isTestCall(call) && isTrackedQuote(call) && applyFilters(call, filters));
}
function financialEntries(state = {}, filters = {}) {
  const callById = new Map((state.calls || []).map((call) => [call.id, call]));
  return (state.finance || [])
    .map((entry) => {
      const call = callById.get(entry.sourceCallId);
      return call ? {
        ...entry,
        insurerId: call.insurerId,
        sourceGroupId: call.sourceGroupId,
        groupName: entry.groupName || call.groupName || '',
        ownerClosedAt: call.ownerClosedAt || null,
        completedAt: call.completedAt || null,
        authorizedAt: call.authorizedAt || null,
      } : entry;
    })
    .filter((entry) => applyFilters(entry, filters));
}
function groupTotals(calls = [], keyFn, nameFn) {
  const map = new Map();
  for (const call of calls) {
    const key = keyFn(call) || 'sem-chave';
    if (!map.has(key)) map.set(key, { Nome: nameFn(call), Corridas: 0, KM: 0, Valor: 0, 'Motorista': 0 });
    const item = map.get(key);
    item.Corridas += 1;
    item.KM = Math.round((item.KM + Number(call.billableKm ?? call.totalKm ?? 0)) * 10) / 10;
    item.Valor = money(item.Valor + Number(call.value || 0));
    item.Motorista = money(item.Motorista + Number(driverPayForCall(call)?.totalAmount || 0));
  }
  return [...map.values()].sort((a, b) => b.Valor - a.Valor || a.Nome.localeCompare(b.Nome, 'pt-BR'));
}
function addSheet(workbook, name, rows) {
  const safeRows = rows.length ? rows : [{ Informação: 'Sem dados no período selecionado.' }];
  const sheet = XLSX.utils.json_to_sheet(safeRows);
  const widths = Object.keys(safeRows[0] || {}).map((key) => ({ wch: Math.min(42, Math.max(12, key.length + 2)) }));
  sheet['!cols'] = widths;
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

export function buildPeriodReport(state = {}, filters = {}) {
  const calls = finalCalls(state, filters);
  const quotes = quoteCalls(state, filters);
  const funnel = buildQuoteFunnel(state.calls || [], state.insurers || [], filters);
  const finance = financialEntries(state, filters);
  const revenue = finance.filter((entry) => entry.type === 'receita' && entry.isFinal === true).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const received = finance.filter((entry) => entry.type === 'receita' && entry.isFinal === true && entry.status === 'pago').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const driver = calls.reduce((sum, call) => sum + Number(driverPayForCall(call)?.totalAmount || 0), 0);
  return {
    filters,
    quotes: funnel.overall,
    finalCalls: calls.length,
    totalKm: Math.round(calls.reduce((sum, call) => sum + Number(call.billableKm ?? call.totalKm ?? 0), 0) * 10) / 10,
    revenue: money(revenue),
    received: money(received),
    receivable: money(revenue - received),
    driverPay: money(driver),
    byInsurer: groupTotals(calls, (call) => call.insurerId || call.insurer, (call) => call.insurerName || call.insurer || call.client || 'Seguradora'),
    byGroup: groupTotals(calls, (call) => call.sourceGroupId || call.groupName, (call) => call.groupName || call.insurer || call.client || 'Grupo'),
  };
}

export function buildPeriodWorkbook(state = {}, filters = {}) {
  const report = buildPeriodReport(state, filters);
  const calls = finalCalls(state, filters);
  const quotes = quoteCalls(state, filters);
  const finance = financialEntries(state, filters);
  const workbook = XLSX.utils.book_new();

  addSheet(workbook, 'Resumo', [
    { Indicador: 'Período inicial', Valor: filters.from || 'Todo histórico' },
    { Indicador: 'Período final', Valor: filters.to || 'Hoje' },
    { Indicador: 'Cotações solicitadas', Valor: report.quotes.requested },
    { Indicador: 'Cotações ganhas', Valor: report.quotes.won },
    { Indicador: 'Cotações perdidas', Valor: report.quotes.lost },
    { Indicador: 'Cotações em aberto', Valor: report.quotes.open },
    { Indicador: 'Conversão (%)', Valor: report.quotes.conversionRate },
    { Indicador: 'Corridas fechadas', Valor: report.finalCalls },
    { Indicador: 'KM fechados', Valor: report.totalKm },
    { Indicador: 'Receita fechada', Valor: report.revenue },
    { Indicador: 'Recebido', Valor: report.received },
    { Indicador: 'A receber', Valor: report.receivable },
    { Indicador: 'Repasse definitivo motorista', Valor: report.driverPay },
  ]);

  addSheet(workbook, 'Corridas', calls.map((call) => {
    const driver = driverPayForCall(call) || {};
    return {
      Data: dateOnly(call.ownerClosedAt || call.completedAt || call.cancelledAt),
      Seguradora: call.insurerName || call.insurer || call.client || '',
      Grupo: call.groupName || '',
      Protocolo: call.protocol || '',
      Veículo: call.vehicle || '',
      Placa: call.plate || '',
      Associação: call.association || '',
      Origem: call.origin || '',
      Destino: call.destination || '',
      'KM até origem': call.routeBreakdown?.legToOrigin?.km ?? '',
      'KM serviço': call.routeBreakdown?.serviceLeg?.km ?? '',
      'KM retorno': call.routeBreakdown?.returnToBase?.km ?? '',
      'KM total': call.billableKm ?? call.totalKm ?? '',
      'Hora trabalhada': call.workedTimeAmount || 0,
      'KM terra': call.dirtRoadBillableKm || 0,
      'Valor terra': call.dirtRoadChargeAmount || 0,
      Pedágio: call.finalTollAmount ?? call.reportedTollAmount ?? 0,
      'Outros adicionais': call.finalOtherExtras ?? 0,
      'Valor final': call.value || 0,
      Motorista: call.driverName || '',
      'Repasse motorista': driver.totalAmount || 0,
      Status: call.status || '',
      'Fechado por': call.ownerClosedBy || '',
      Observações: call.ownerClosingNotes || '',
    };
  }));

  addSheet(workbook, 'Cotações', quotes.map((call) => ({
    Data: dateOnly(call.quoteRequestedAt || call.createdAt),
    Seguradora: call.insurerName || call.insurer || call.client || '',
    Grupo: call.groupName || '',
    Protocolo: call.protocol || '',
    Veículo: call.vehicle || '',
    Placa: call.plate || '',
    Origem: call.origin || '',
    Destino: call.destination || '',
    'KM estimados': call.quoteEstimatedKm ?? call.estimatedTotalKm ?? '',
    'Valor cotado': call.quoteCalculatedValue ?? call.calculatedValue ?? '',
    Resultado: quoteOutcome(call) === 'won' ? 'Ganha' : quoteOutcome(call) === 'lost' ? 'Perdida' : 'Em aberto',
    'Aceita em': dateOnly(call.quoteAcceptedAt || call.authorizedAt),
  })));

  addSheet(workbook, 'Por seguradora', report.byInsurer);
  addSheet(workbook, 'Por grupo', report.byGroup);
  addSheet(workbook, 'Financeiro', finance.map((entry) => ({
    Data: dateOnly(entry.ownerClosedAt || entry.updatedAt || entry.createdAt),
    Vencimento: entry.dueDate || entry.paymentDue || '',
    Descrição: entry.description || '',
    Categoria: entry.category || '',
    Tipo: entry.type || '',
    Etapa: entry.financialStage || '',
    Definitivo: entry.isFinal === true ? 'Sim' : 'Não',
    Valor: entry.amount || 0,
    Status: entry.status || '',
    Seguradora: entry.insurer || entry.client || '',
    Grupo: entry.groupName || '',
    'KM cobrados': entry.billableKm || 0,
  })));

  const driverRows = calls.map((call) => {
    const driver = driverPayForCall(call) || {};
    return {
      Data: dateOnly(call.ownerClosedAt || call.completedAt || call.cancelledAt),
      Motorista: call.driverName || 'Mauro',
      Seguradora: call.insurerName || call.insurer || call.client || '',
      Grupo: call.groupName || '',
      Protocolo: call.protocol || '',
      'KM corrida': driver.billableKm || 0,
      'KM excedente': driver.excessKm || 0,
      'Valor rota': driver.routeAmount || 0,
      'Hora trabalhada': driver.workedTimeAmount || 0,
      'Total motorista': driver.totalAmount || 0,
    };
  });
  addSheet(workbook, 'Motoristas', driverRows);

  return {
    report,
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }),
  };
}
