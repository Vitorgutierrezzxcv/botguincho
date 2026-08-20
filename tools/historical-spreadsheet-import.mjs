import crypto from 'node:crypto';

const clean = (value = '', max = 500) => String(value ?? '').trim().slice(0, max);
const number = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = clean(value).replace(/\s+/g, '').replace(/R\$/gi, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const norm = (value = '') => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export function excelDateToIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const text = clean(value);
  const br = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (br) {
    const year = Number(br[3]) < 100 ? 2000 + Number(br[3]) : Number(br[3]);
    return `${year}-${String(br[2]).padStart(2, '0')}-${String(br[1]).padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function headerIndex(rows = []) {
  return rows.findIndex((row) => {
    const cells = (Array.isArray(row) ? row : []).map(norm);
    return cells.some((cell) => cell === 'DATA') && cells.some((cell) => cell.includes('PROTOCOLO')) && cells.some((cell) => cell.includes('VALOR'));
  });
}

function columnMap(header = []) {
  const cols = {};
  header.map(norm).forEach((name, index) => {
    if (name === 'DATA') cols.date = index;
    else if (name.includes('PROTOCOLO')) cols.protocol = index;
    else if (name.includes('PLACA')) cols.plate = index;
    else if (name === 'KM' || name.includes('KM TOTAL')) cols.km = index;
    else if (name.includes('VALOR DE SAIDA')) cols.departureAmount = index;
    else if (name.includes('VALOR KM EXCEDENTE')) cols.excessKmRate = index;
    else if (name.includes('PEDAG')) cols.toll = index;
    else if (name.includes('PATINS')) cols.skates = index;
    else if (name.includes('VALOR TOTAL')) cols.totalAmount = index;
    else if (name.includes('OBSERV')) cols.notes = index;
  });
  return cols;
}

function detectedTransporter(sheetName, rows, headerRow) {
  const titleCells = rows.slice(0, Math.max(0, headerRow)).flat().map((value) => clean(value)).filter(Boolean);
  const title = titleCells.find((value) => /FECHAMENTO|PROTECAO|SEGURADORA|ASSISTENCIA/i.test(norm(value))) || titleCells[0] || sheetName;
  return clean(title.replace(/FECHAMENTOS?/gi, '').replace(/\|.+$/, '').trim() || sheetName, 120);
}

function workedTimeFromNotes(notes = '') {
  const text = norm(notes);
  if (!/(HORA|HR|HT)\s*(TRABALHADA)?/.test(text)) return 0;
  const parsed = number(text);
  return parsed && parsed > 0 ? money(parsed) : 80;
}

export function normalizeHistoricalSheet({ fileName = '', sheetName = '', rows = [] } = {}) {
  const headerRow = headerIndex(rows);
  if (headerRow < 0) return { fileName, sheetName, detectedTransporter: sheetName || fileName, headerRow: null, records: [], warnings: ['Cabeçalho de corridas não encontrado.'] };
  const cols = columnMap(rows[headerRow]);
  const warnings = [];
  if (cols.date == null || cols.protocol == null || cols.totalAmount == null) warnings.push('A planilha precisa ter DATA, PROTOCOLO e VALOR TOTAL.');
  const records = [];
  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    const date = excelDateToIso(row[cols.date]);
    const protocol = clean(row[cols.protocol], 180);
    const totalAmount = money(number(row[cols.totalAmount]));
    if (!date || !protocol || !(totalAmount > 0)) continue;
    const notes = clean(row[cols.notes], 1000);
    const km = Math.max(0, number(row[cols.km]) || 0);
    records.push({
      rowNumber: index + 1,
      date,
      protocol,
      plate: clean(row[cols.plate], 20).replace(/\s+/g, '').toUpperCase(),
      departureAmount: money(number(row[cols.departureAmount])),
      excessKmRate: money(number(row[cols.excessKmRate])),
      totalKm: money(km),
      toll: clean(row[cols.toll], 100),
      skates: clean(row[cols.skates], 100),
      totalAmount,
      notes,
      workedTimeAmount: workedTimeFromNotes(notes),
    });
  }
  if (!records.length && !warnings.length) warnings.push('Nenhuma corrida válida encontrada.');
  return {
    fileName: clean(fileName, 180),
    sheetName: clean(sheetName, 120),
    detectedTransporter: detectedTransporter(sheetName, rows, headerRow),
    headerRow: headerRow + 1,
    records,
    totals: {
      calls: records.length,
      km: money(records.reduce((sum, item) => sum + item.totalKm, 0)),
      amount: money(records.reduce((sum, item) => sum + item.totalAmount, 0)),
      workedTime: money(records.reduce((sum, item) => sum + item.workedTimeAmount, 0)),
    },
    periodStart: records.map((item) => item.date).sort()[0] || null,
    periodEnd: records.map((item) => item.date).sort().at(-1) || null,
    warnings,
  };
}

export function historicalRecordKey(groupId, record = {}) {
  return crypto.createHash('sha256').update([groupId, record.date, record.protocol, record.plate, record.totalAmount].join('|')).digest('hex');
}

export function importHistoricalRecords(state, input = {}) {
  if (!state || !Array.isArray(state.calls)) throw new Error('management_state_invalid');
  const groupId = clean(input.groupId, 180);
  const groupName = clean(input.groupName, 180);
  const records = Array.isArray(input.records) ? input.records.slice(0, 1000) : [];
  if (!groupId || !groupName) throw new Error('transporter_group_required');
  if (!records.length) throw new Error('historical_records_required');
  if (!Array.isArray(state.billingBatches)) state.billingBatches = [];
  if (!Array.isArray(state.finance)) state.finance = [];
  if (!Array.isArray(state.historicalImports)) state.historicalImports = [];
  const existingKeys = new Set(state.calls.map((call) => call.historicalRecordKey).filter(Boolean));
  const importedAt = new Date().toISOString();
  const importedCalls = [];
  let duplicates = 0;
  for (const raw of records) {
    const record = {
      date: excelDateToIso(raw.date), protocol: clean(raw.protocol, 180), plate: clean(raw.plate, 20),
      totalKm: Math.max(0, money(raw.totalKm)), totalAmount: Math.max(0, money(raw.totalAmount)),
      departureAmount: Math.max(0, money(raw.departureAmount)), excessKmRate: Math.max(0, money(raw.excessKmRate)),
      toll: clean(raw.toll, 100), skates: clean(raw.skates, 100), notes: clean(raw.notes, 1000),
      workedTimeAmount: Math.max(0, money(raw.workedTimeAmount)),
    };
    if (!record.date || !record.protocol || !(record.totalAmount > 0)) continue;
    const key = historicalRecordKey(groupId, record);
    if (existingKeys.has(key)) { duplicates += 1; continue; }
    existingKeys.add(key);
    const completedAt = `${record.date}T12:00:00.000Z`;
    importedCalls.push({
      id: crypto.randomUUID(), historicalRecordKey: key, historicalImport: true,
      historicalSourceFile: clean(input.fileName, 180), historicalImportedAt: importedAt,
      source: 'historical_spreadsheet', sourceGroupId: groupId, insurer: groupName, client: groupName,
      status: 'concluido', completedAt, createdAt: completedAt, updatedAt: importedAt,
      protocol: record.protocol, plate: record.plate, vehicle: record.plate ? `Veículo ${record.plate}` : 'Veículo não informado',
      totalKm: record.totalKm, billableKm: record.totalKm, value: record.totalAmount,
      reportedValue: record.totalAmount, calculatedValue: record.totalAmount, valueSource: 'historical_spreadsheet',
      departureAmount: record.departureAmount, historicalExcessKmRate: record.excessKmRate,
      historicalToll: record.toll, historicalSkates: record.skates, notes: record.notes,
      workedTimeChargeRequired: record.workedTimeAmount > 0, workedTimeAmount: record.workedTimeAmount,
      workedTimeHourlyRate: record.workedTimeAmount > 0 ? 80 : 0,
      financeReviewRequired: false,
    });
  }
  if (!importedCalls.length) return { imported: 0, duplicates, importId: null };
  state.calls.unshift(...importedCalls);
  const dates = importedCalls.map((call) => call.completedAt.slice(0, 10)).sort();
  const totalKm = money(importedCalls.reduce((sum, call) => sum + call.billableKm, 0));
  const totalAmount = money(importedCalls.reduce((sum, call) => sum + call.value, 0));
  const importId = crypto.randomUUID();
  const alreadyReceived = input.receiptStatus === 'received';
  const batch = {
    id: crypto.randomUUID(), key: `historical|${importId}`, groupId, groupName,
    cycleId: 'historical-import', periodStart: dates[0], periodEnd: dates.at(-1),
    callIds: importedCalls.map((call) => call.id), callCount: importedCalls.length, totalKm, totalAmount,
    statementDue: dates.at(-1), statementSentAt: importedAt, invoiceDue: null, invoiceSentAt: input.invoiceSent === true ? importedAt : null,
    paymentDue: clean(input.paymentDue, 10) || dates.at(-1), receivedAt: alreadyReceived ? importedAt : null,
    receivedAmount: alreadyReceived ? totalAmount : null, status: alreadyReceived ? 'received' : 'statement_sent',
    historicalImport: true, historicalImportId: importId, sourceFileName: clean(input.fileName, 180),
    statementRecipientType: 'transportadora', statementRecipientName: groupName,
    createdAt: importedAt, updatedAt: importedAt,
  };
  state.billingBatches.unshift(batch);
  state.finance.unshift({
    id: crypto.randomUUID(), description: `Fechamento histórico · ${groupName} · ${batch.periodStart} a ${batch.periodEnd}`,
    category: 'Fechamento histórico importado', amount: totalAmount, type: 'receita',
    status: alreadyReceived ? 'pago' : 'pendente', dueDate: batch.paymentDue,
    paidAt: alreadyReceived ? importedAt : null, client: groupName, insurer: groupName, groupId,
    billingBatchId: batch.id, historicalImportId: importId, source: 'historical_spreadsheet', createdAt: importedAt, updatedAt: importedAt,
  });
  state.historicalImports.unshift({
    id: importId, fileName: clean(input.fileName, 180), groupId, groupName,
    periodStart: batch.periodStart, periodEnd: batch.periodEnd, callCount: importedCalls.length,
    totalKm, totalAmount, duplicates, receiptStatus: alreadyReceived ? 'received' : 'receivable', importedAt,
  });
  return { imported: importedCalls.length, duplicates, importId, batch };
}
