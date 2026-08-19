import assert from 'node:assert/strict';
import {
  classifyRuntimeIntent,
  resolveGroupProfile,
  extractOperationalFacts,
  calculateApprovedCommercial,
  reconcileCommercial,
  callStatusForIntent,
} from './operational-knowledge.mjs';

const cases = [
  ['Disponível? Valor e prévia? Quantos kms totais?', 'Company Truck', 'quote'],
  ['SOLICITAÇÃO DE COTAÇÃO – REBOQUE Tipo: Visão', 'Company Truck', 'quote'],
  ['Cotação Visão é apenas estimativa (não aprovada)', 'Company Truck', 'quote'],
  ['Aguarda um momento, vou passar para o administrativo; por enquanto não siga', 'POWER - BETIM', 'pending_approval'],
  ['Pode seguir', 'Saturno', 'authorization'],
  ['AGENDAMENTO PARA AMANHÃ AS 7:30', 'Premium Assistência', 'scheduled_dispatch'],
  ['Cancelado sem saída', 'Socorre Assistência', 'cancellation'],
  ['Finalizado', 'Plus Assistência', 'closure'],
  ['Sr. prestador, evitem o envio de mensagens informando disponibilidade neste grupo', 'Assistência Segura', 'administrative_notice'],
  ['Bom dia, disponível? Origem: Rua X, 100 - Betim - MG', 'Solução Assistência', 'availability'],
];

for (const [text, group, expected] of cases) {
  assert.equal(classifyRuntimeIntent(text, group), expected, `${group}: ${text}`);
}

assert.equal(classifyRuntimeIntent('O guincho chegou no local, o carro funcionou e o motorista não quer levar', 'Assistência', { status: 'em_atendimento' }), 'arrival_without_tow');
assert.equal(classifyRuntimeIntent('Guincho chegou e o motorista n quer rebocar', 'Assistência', { status: 'autorizado' }), 'arrival_without_tow');
assert.equal(classifyRuntimeIntent('O carro funcionou', 'Assistência', { status: 'autorizado' }), 'other');

assert.equal(resolveGroupProfile('PREST. AMERICA GUINCHOS X POWER - BETIM').key, 'power');
assert.equal(resolveGroupProfile('America Guincho Contagem Betim MG X Company Truck').key, 'company-truck');
assert.equal(callStatusForIntent('pending_approval'), 'aguardando_aprovacao');

const facts = extractOperationalFacts('KM TOTAL: 66\nVALOR TOTAL: R$ 233,00\nVEÍCULO: CARRO LEVE\nPEDÁGIO: R$ 12,80');
assert.equal(facts.totalKm, 66);
assert.equal(facts.centralReportedValue, 233);
assert.equal(facts.vehicleType, 'leve');
assert.equal(facts.extras.toll, 12.8);

const rules = {
  services: {
    leve: { basePrice: 135, includedKm: 40, pricePerKm: 3 },
    utilitario: { basePrice: 160, includedKm: 40, pricePerKm: 3.2 },
  },
};

assert.equal(calculateApprovedCommercial({ approvedRules: rules, vehicleType: 'leve', totalKm: 66 }).amount, 213);
assert.equal(calculateApprovedCommercial({ approvedRules: rules, vehicleType: 'utilitario', totalKm: 125 }).amount, 432);

const ok = reconcileCommercial({ approvedRules: rules, facts: { vehicleType: 'leve', totalKm: 60, centralReportedValue: 195, extras: {} } });
assert.equal(ok.status, 'ok');
assert.equal(ok.calculatedAmount, 195);

const divergence = reconcileCommercial({ approvedRules: rules, facts: { vehicleType: 'leve', totalKm: 60, centralReportedValue: 210, extras: {} } });
assert.equal(divergence.status, 'divergence');
assert.equal(divergence.reviewRequired, true);

console.log('OPERATIONAL_KNOWLEDGE_REGRESSION_OK');
