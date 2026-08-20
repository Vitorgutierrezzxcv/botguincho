import assert from 'node:assert/strict';
import { importHistoricalRecords, normalizeHistoricalSheet } from './historical-spreadsheet-import.mjs';

const rows = [
  ['SOLUÇÃO FECHAMENTO'],
  ['DATA','PROTOCOLO','PLACA','VALOR DE SAÍDA','VALOR KM EXCEDENTE','KM TOTAL','PEDÁGIO','PATINS','VALOR TOTAL','OBSERVAÇÃO (HP, HT, DIÁRIA)'],
  [46230,'2026015570_B1','5YF4A54',130,3,'56KM','NÃO','NÃO',258,'80 HR TRABALHADA'],
  [null,null,null,null,null,null,null,null,null,null],
];
const parsed = normalizeHistoricalSheet({ fileName: 'planilha.xlsx', sheetName: 'SOLUÇÃO', rows });
assert.equal(parsed.detectedTransporter, 'SOLUÇÃO');
assert.equal(parsed.records.length, 1);
assert.equal(parsed.records[0].date, '2026-07-27');
assert.equal(parsed.records[0].totalKm, 56);
assert.equal(parsed.records[0].workedTimeAmount, 80);
const model = normalizeHistoricalSheet({ fileName: 'modelo.xlsx', sheetName: 'MODELO', rows: [[null,'ASSISTÊNCIA SEGURA'],[null,'BEM PROTEGE | BP SEGURADORA'],[null,'BASE:'],[null,'DATA','PROTOCOLO','PLACA','KM','VALOR TOTAL'],[null,46201,'ASE001922/1','PUB4B15','68 KM',219]] });
assert.equal(model.detectedTransporter, 'ASSISTÊNCIA SEGURA');
assert.equal(model.records.length, 1);

const state = { calls: [], finance: [], billingBatches: [], historicalImports: [] };
const result = importHistoricalRecords(state, { groupId: 'g1', groupName: 'Solução', fileName: 'planilha.xlsx', records: parsed.records, receiptStatus: 'received' });
assert.equal(result.imported, 1);
assert.equal(state.calls[0].historicalImport, true);
assert.equal(state.billingBatches[0].statementRecipientType, 'transportadora');
assert.equal(state.billingBatches[0].status, 'received');
assert.equal(state.finance[0].status, 'pago');
const duplicate = importHistoricalRecords(state, { groupId: 'g1', groupName: 'Solução', fileName: 'planilha.xlsx', records: parsed.records });
assert.equal(duplicate.imported, 0);
assert.equal(duplicate.duplicates, 1);
console.log('HISTORICAL_SPREADSHEET_IMPORT_OK');
