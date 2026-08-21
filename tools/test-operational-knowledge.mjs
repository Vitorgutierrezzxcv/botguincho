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
  ['Qual a prévia?', 'Tests guincho', 'eta'],
];

for (const [text, group, expected] of cases) {
  assert.equal(classifyRuntimeIntent(text, group), expected, `${group}: ${text}`);
}

assert.equal(classifyRuntimeIntent('O guincho chegou no local, o carro funcionou e o motorista não quer levar', 'Assistência', { status: 'em_atendimento' }), 'arrival_without_tow');
assert.equal(classifyRuntimeIntent('Guincho chegou e o motorista n quer rebocar', 'Assistência', { status: 'autorizado' }), 'arrival_without_tow');
assert.equal(classifyRuntimeIntent('O carro funcionou', 'Assistência', { status: 'autorizado' }), 'cancellation');
assert.equal(classifyRuntimeIntent('O guincho chegou no local', 'Assistência', { status: 'a_caminho' }), 'arrival');
assert.equal(classifyRuntimeIntent('Aqui começa a estrada de terra', 'Assistência', { status: 'a_caminho' }), 'dirt_road_start');
assert.equal(classifyRuntimeIntent('Fecha em quantos quilômetros? Envie os quilômetros totais e o valor.', 'Tests guincho', { status: 'autorizado' }), 'value_summary');
assert.equal(classifyRuntimeIntent('Qual o valor total e os km?', 'Tests guincho', { status: 'em_atendimento' }), 'value_summary');

assert.equal(resolveGroupProfile('PREST. AMERICA GUINCHOS X POWER - BETIM').key, 'power');
assert.equal(resolveGroupProfile('America Guincho Contagem Betim MG X Company Truck').key, 'company-truck');
assert.equal(callStatusForIntent('pending_approval'), 'aguardando_aprovacao');

const facts = extractOperationalFacts('KM TOTAL: 66\nVALOR TOTAL: R$ 233,00\nVEÍCULO: CARRO LEVE\nPEDÁGIO: R$ 12,80');
assert.equal(facts.totalKm, 66);
assert.equal(facts.centralReportedValue, 233);
assert.equal(facts.vehicleType, 'leve');
assert.equal(facts.extras.toll, 12.8);
assert.equal(extractOperationalFacts('Ficou 35 minutos no local').onSiteMinutes, 35);
assert.equal(extractOperationalFacts('Terra: 12,5 km').extras.dirtRoadKm, 12.5);
const protocolFacts = extractOperationalFacts('PROTOCOLO: ABC-123\nASSOCIADO: Maria\nTELEFONE: 31999990000\nPLACA: ABC1D23\nMODELO: Fiat Palio\nMOTIVO: pane elétrica\nSERVIÇO: reboque leve\nORIGEM: Rua A, 10, Betim - MG\nDESTINO: Rua B, 20, Betim - MG\nACOMPANHANTES: 1');
assert.equal(protocolFacts.protocol, 'ABC-123');
assert.equal(protocolFacts.associatedName, 'Maria');
assert.equal(protocolFacts.contactPhone, '31999990000');
assert.equal(protocolFacts.serviceReason, 'pane elétrica');
assert.equal(protocolFacts.companions, 1);
assert.equal(protocolFacts.vehicleType, 'leve');

const rules = {
  services: {
    leve: { basePrice: 135, includedKm: 40, pricePerKm: 3 },
    utilitario: { basePrice: 160, includedKm: 40, pricePerKm: 3.2 },
  },
};

assert.equal(calculateApprovedCommercial({ approvedRules: rules, vehicleType: 'leve', totalKm: 66 }).amount, 213);
assert.equal(calculateApprovedCommercial({ approvedRules: rules, vehicleType: 'utilitario', totalKm: 125 }).amount, 432);
const dirt = calculateApprovedCommercial({ approvedRules: rules, vehicleType: 'leve', totalKm: 60, reportedExtras: { dirtRoadKm: 10 } });
assert.equal(dirt.amount, 203);
assert.equal(dirt.dirtRoadRatePerKm, 3.8);

const ok = reconcileCommercial({ approvedRules: rules, facts: { vehicleType: 'leve', totalKm: 60, centralReportedValue: 195, extras: {} } });
assert.equal(ok.status, 'ok');
assert.equal(ok.calculatedAmount, 195);

const divergence = reconcileCommercial({ approvedRules: rules, facts: { vehicleType: 'leve', totalKm: 60, centralReportedValue: 210, extras: {} } });
assert.equal(divergence.status, 'divergence');
assert.equal(divergence.reviewRequired, true);

console.log('OPERATIONAL_KNOWLEDGE_REGRESSION_OK');
