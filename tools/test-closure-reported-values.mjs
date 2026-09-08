import assert from 'node:assert/strict';
import { classifyRuntimeIntent, extractOperationalFacts } from './operational-knowledge.mjs';

const groupName = 'América Betim e Região SOLUÇÃO ASSISTÊNCIA';
const activeCall = { status: 'autorizado' };

const cases = [
  ['R$ 235,00 (75KM) Finalizado pessoal', 75, 235],
  ['R$ 235,00 (75 KM) Finalizado', 75, 235],
  ['R$ 235,00 (75kms) finalizado', 75, 235],
  ['Finalizado em 75 km. Valor total: R$ 235,00', 75, 235],
];

for (const [text, expectedKm, expectedValue] of cases) {
  const facts = extractOperationalFacts(text);
  assert.equal(facts.totalKm, expectedKm, `KM incorreto para: ${text}`);
  assert.equal(facts.centralReportedValue, expectedValue, `Valor incorreto para: ${text}`);
  assert.equal(classifyRuntimeIntent(text, groupName, activeCall), 'closure', `Intent incorreta para: ${text}`);
}

console.log('[test-closure-reported-values] OK');
