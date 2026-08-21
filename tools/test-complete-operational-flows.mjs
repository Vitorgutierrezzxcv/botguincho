import assert from 'node:assert/strict';
import {
  appendOperationalTimeline,
  buildEvidenceChecklist,
  callStatusForIntent,
  classifyRuntimeIntent,
  extractOperationalFacts,
  markEvidenceChecklist,
  resolveGroupProfile,
} from './operational-knowledge.mjs';
import { evaluateCancellationPolicy } from './cancellation-policy.mjs';
import { evaluateWorkedTime } from './worked-time-policy.mjs';
import { driverPayForCall, driverPayrollPeriodFor } from './driver-payroll.mjs';

const active = { status: 'autorizado' };
const arrived = { status: 'em_atendimento', arrivalConfirmed: true };

const intentCases = [
  // Consultas nunca autorizam por acidente.
  ['PROTOCOLO: 1\nORIGEM: Rua A\nDESTINO: Rua B\nVEÍCULO: Uno\nDisponível?', 'Solução Assistência', null, 'availability'],
  ['Disponível? Valor e prévia? Quantos kms totais?', 'Company Truck', null, 'quote'],
  ['SOLICITAÇÃO DE COTAÇÃO - REBOQUE Tipo: Visão', 'Company Truck', null, 'quote'],
  ['Origem: Rua A, 10. Destino: Rua B, 20. Veículo: Fiat Uno.', 'Solução Assistência', null, 'dispatch_details'],
  ['O carro está parado no centro, consegue buscar?', 'Solução Assistência', null, 'incomplete_dispatch'],

  // Autorizações e protocolos dependem do estado e do grupo.
  ['P O D E  S E G U I R', 'Saturno', { status: 'aguardando_aprovacao' }, 'authorization'],
  ['PROTOCOLO: 2\nORIGEM: Rua A\nDESTINO: Rua B\nVEÍCULO: Uno', 'Solução Assistência', { status: 'cotacao' }, 'protocol_received'],
  ['PROTOCOLO: 2\nORIGEM: Rua A\nDESTINO: Rua B\nVEÍCULO: Uno', 'Horizonte', { status: 'cotacao' }, 'formal_dispatch'],
  ['Protocolo definitivo: 8821', 'Solução Assistência', active, 'protocol_update'],
  ['Aguarda, vou passar ao administrativo; por enquanto não siga', 'Power', { status: 'cotacao' }, 'pending_approval'],

  // Execução completa e ocorrências no local.
  ['Saindo agora para o atendimento', 'Solução Assistência', active, 'departure'],
  ['O guincho chegou no local do cliente', 'Solução Assistência', { status: 'a_caminho' }, 'arrival'],
  ['Aguardando o cliente, ele não apareceu', 'Horizonte', arrived, 'waiting_customer'],
  ['O carro voltou a funcionar e o cliente não quer levar', 'Solução Assistência', arrived, 'arrival_without_tow'],
  ['O veículo está na prancha', 'Saturno', arrived, 'loaded'],
  ['Chegamos ao destino e entregamos na oficina', 'Saturno', arrived, 'destination_arrival'],
  ['Fotos enviadas e checklist concluído', 'Saturno', arrived, 'evidence'],
  ['Novo destino: Rua Nova, 900', 'Horizonte', active, 'address_update'],
  ['Começou agora a estrada de terra', 'Solução Assistência', active, 'dirt_road_start'],
  ['Saímos da estrada de terra', 'Solução Assistência', active, 'dirt_road_end'],
  ['Finalizado com 66 km. Valor total: R$ 233,00', 'Plus Assistência', arrived, 'closure'],
  ['Cancelado, pode desconsiderar', 'Socorre Assistência', active, 'cancellation'],

  // Segurança: não responder a administração e não confundir horário com corrida.
  ['Pessoal, comunicado interno: reunião amanhã às 9h', 'Assistência Segura', null, 'administrative_notice'],
  ['AGENDAMENTO DE REBOQUE PARA AMANHÃ ÀS 7:30. VEÍCULO: UNO', 'Premium Assistência', null, 'scheduled_dispatch'],
];

for (const [text, group, call, expected] of intentCases) {
  assert.equal(classifyRuntimeIntent(text, group, call), expected, `${group}: ${text}`);
}

const inline = extractOperationalFacts('Origem: Rua A, 10. Destino: Rua B, 20. Veículo: Fiat Uno. Placa: ABC1D23.');
assert.equal(inline.origin, 'Rua A, 10');
assert.equal(inline.destination, 'Rua B, 20');
assert.equal(inline.vehicle, 'Fiat Uno');
assert.equal(inline.plate, 'ABC1D23');
assert.equal(inline.vehicleType, 'leve');
assert.equal(extractOperationalFacts('Veículo: VW Saveiro').vehicleType, 'utilitario');

assert.equal(resolveGroupProfile('Prestador X Socorre Assistência').associationRequired, true);
assert.equal(resolveGroupProfile('Horizonte').formalProtocolCanAuthorize, true);
assert.equal(resolveGroupProfile('Horizonte').absentCustomerWaitMinutes, 10);
assert.equal(resolveGroupProfile('Saturno').stoppedHourRequiresReview, true);

let checklist = buildEvidenceChecklist('Saturno', 'Protocolo exige fotos, checklist e vídeo');
checklist = markEvidenceChecklist(checklist, 'Fotos enviadas e checklist concluído');
assert.equal(checklist.some((item) => /foto|frente|traseira|latera|prancha/i.test(item.label) && !item.done), false);
assert.equal(checklist.some((item) => /checklist/i.test(item.label) && !item.done), false);
assert.equal(checklist.some((item) => /vídeo|video/i.test(item.label) && item.done), false);
checklist = markEvidenceChecklist(checklist, 'Vídeo 360 enviado');
assert.equal(checklist.every((item) => item.done), true);

let timeline = appendOperationalTimeline([], { at: '2026-08-21T10:00:00.000Z', type: 'consulta', toStatus: 'cotacao', text: 'Disponível?' });
timeline = appendOperationalTimeline(timeline, { at: '2026-08-21T10:02:00.000Z', type: 'autorizacao', fromStatus: 'cotacao', toStatus: 'autorizado', text: 'Pode seguir' });
timeline = appendOperationalTimeline(timeline, { at: '2026-08-21T10:30:00.000Z', type: 'chegada', fromStatus: 'a_caminho', toStatus: 'em_atendimento', text: 'Cheguei' });
assert.deepEqual(timeline.map((item) => item.type), ['consulta', 'autorizacao', 'chegada']);
assert.equal(callStatusForIntent('dispatch_details'), 'aguardando_aprovacao');
assert.equal(callStatusForIntent('departure'), 'a_caminho');

const authorizedAt = new Date('2026-08-21T10:00:00.000Z');
const exact15 = evaluateCancellationPolicy({ authorizedAt, cancelledAt: new Date('2026-08-21T10:15:00.000Z'), billableKm: 80 });
const after15 = evaluateCancellationPolicy({ authorizedAt, cancelledAt: new Date('2026-08-21T10:15:01.000Z'), billableKm: 80 });
assert.equal(exact15.chargeRequired, false);
assert.equal(after15.chargeRequired, true);
assert.equal(after15.billableKm, 80);
assert.equal(after15.partialPaymentAllowed, false);

assert.deepEqual([15, 16, 75, 76].map((minutes) => evaluateWorkedTime({ reportedMinutes: minutes }).amount), [0, 80, 80, 160]);

const driver = driverPayForCall({ status: 'concluido', billableKm: 80, workedTimeChargeRequired: true, workedTimeAmount: 160 });
assert.equal(driver.routeAmount, 61);
assert.equal(driver.workedTimeAmount, 160);
assert.equal(driver.totalAmount, 221);
assert.deepEqual(driverPayrollPeriodFor('2026-08-20T12:00:00.000Z'), { periodStart: '2026-07-20', periodEnd: '2026-08-20', paymentDue: '2026-08-20' });
assert.deepEqual(driverPayrollPeriodFor('2026-08-21T12:00:00.000Z'), { periodStart: '2026-08-20', periodEnd: '2026-09-20', paymentDue: '2026-09-20' });

console.log(`COMPLETE_OPERATIONAL_FLOWS_OK (${intentCases.length} intenções + regras financeiras e cronológicas)`);
