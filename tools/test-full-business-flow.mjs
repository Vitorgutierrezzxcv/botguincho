import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx';
import {
  ensureInsurerForGroup,
  sanitizeInsurer,
  quoteTrackingPatch,
  quoteOutcome,
  isTrackedQuote,
  buildQuoteFunnel,
  isOwnerFinalizedCall,
  releaseNextQueuedCall,
} from './business-orchestration.mjs';
import { buildPeriodReport, buildPeriodWorkbook } from './reporting-engine.mjs';
import { capacitySnapshot, capSecondCallEta, plannedRemainingMinutes } from './dispatch-capacity.mjs';
import { driverPayForCall, driverPayrollPeriodFor, syncDriverPayrolls } from './driver-payroll.mjs';
import { evaluateCancellationPolicy } from './cancellation-policy.mjs';
import { evaluateWorkedTime } from './worked-time-policy.mjs';
import { sanitizeBillingProfile, settlementForCall } from './financial-engine.mjs';
import { calculateApprovedCommercial, classifyRuntimeIntent, extractOperationalFacts } from './operational-knowledge.mjs';
import { publicEtaMinutes, driverDispatchMessage, truckAvailability } from './simple-operation.mjs';
import { TEST_SCENARIOS, isTestCall } from './test-center.mjs';

let checks = 0;
function check(name, fn) {
  try {
    fn();
    checks += 1;
    console.log(`OK ${String(checks).padStart(2, '0')} · ${name}`);
  } catch (error) {
    console.error(`FAIL · ${name}`);
    throw error;
  }
}

const g1 = '120363001@g.us';
const g2 = '120363002@g.us';
const g3 = '120363003@g.us';
const baseState = { insurers: [], calls: [], finance: [], fleet: [{ id: 'truck-1', driver: 'Mauro' }], driverPayrolls: [] };
const insurer1 = ensureInsurerForGroup(baseState, { groupId: g1, groupName: 'Horizonte Operação 1', profileKey: 'horizonte' });
const insurer2 = ensureInsurerForGroup(baseState, { groupId: g2, groupName: 'Horizonte Operação 2', profileKey: 'horizonte' });

check('grupos da mesma seguradora compartilham o cadastro', () => {
  assert.equal(insurer1.id, insurer2.id);
  assert.deepEqual(new Set(insurer2.groupIds), new Set([g1, g2]));
});

check('cadastro de seguradora limita dias válidos e preserva calendário', () => {
  const item = sanitizeInsurer({ name: 'X', groupIds: [g1], statementDay: 40, paymentDay: 0, submitWindowStartDay: 7 });
  assert.equal(item.statementDay, 31);
  assert.equal(item.paymentDay, 1);
  assert.equal(item.submitWindowStartDay, 7);
});

const quoteOpen = {
  id: 'q-open', insurerId: insurer1.id, insurerName: insurer1.name, insurer: insurer1.name,
  sourceGroupId: g1, groupName: 'Horizonte Operação 1', createdAt: '2026-08-10T12:00:00.000Z', status: 'cotacao', testMode: false,
  ...quoteTrackingPatch({}, { status: 'cotacao', eventType: 'consulta_disponibilidade', at: '2026-08-10T12:00:00.000Z', calculatedValue: 150, estimatedKm: 40 }),
};
const quoteWon = {
  ...quoteOpen, id: 'q-won', sourceGroupId: g2, groupName: 'Horizonte Operação 2', status: 'autorizado',
  authorizedAt: '2026-08-11T12:05:00.000Z', quoteOutcome: 'won', quoteAcceptedAt: '2026-08-11T12:05:00.000Z', createdAt: '2026-08-11T12:00:00.000Z', quoteRequestedAt: '2026-08-11T12:00:00.000Z',
};
const quoteLost = {
  ...quoteOpen, id: 'q-lost', sourceGroupId: g1, status: 'cancelado', quoteOutcome: 'lost', createdAt: '2026-08-12T12:00:00.000Z', quoteRequestedAt: '2026-08-12T12:00:00.000Z',
};
const quoteLegacyAccepted = {
  ...quoteOpen, id: 'q-legacy', sourceGroupId: g2, status: 'autorizado', authorizedAt: '2026-08-13T12:03:00.000Z', quoteOutcome: 'open', createdAt: '2026-08-13T12:00:00.000Z', quoteRequestedAt: '2026-08-13T12:00:00.000Z',
};

check('consulta de disponibilidade com dados é rastreada como cotação', () => assert.equal(isTrackedQuote(quoteOpen), true));
check('cotação autorizada é ganha', () => assert.equal(quoteOutcome(quoteWon), 'won'));
check('dado legado open + authorizedAt é corrigido para ganha', () => assert.equal(quoteOutcome(quoteLegacyAccepted), 'won'));
check('cotação cancelada antes da autorização é perdida', () => assert.equal(quoteOutcome(quoteLost), 'lost'));

check('funil usa todas as solicitações como denominador da conversão', () => {
  const funnel = buildQuoteFunnel([quoteOpen, quoteWon, quoteLost, quoteLegacyAccepted], baseState.insurers, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(funnel.overall.requested, 4);
  assert.equal(funnel.overall.won, 2);
  assert.equal(funnel.overall.lost, 1);
  assert.equal(funnel.overall.open, 1);
  assert.equal(funnel.overall.conversionRate, 50);
  assert.equal(funnel.byInsurer.length, 1);
  assert.equal(funnel.byGroup.length, 2);
});

check('cotações de teste não contaminam o funil', () => {
  const funnel = buildQuoteFunnel([{ ...quoteOpen, id: 'test', testMode: true }], baseState.insurers, {});
  assert.equal(funnel.overall.requested, 0);
});

check('apenas duas corridas reais ocupam capacidade', () => {
  const state = { calls: [
    { id: 'a', status: 'autorizado', authorizedAt: '2026-08-10T10:00:00Z' },
    { id: 'b', status: 'a_caminho', authorizedAt: '2026-08-10T10:05:00Z' },
  ] };
  const cap = capacitySnapshot(state);
  assert.equal(cap.activeCount, 2);
  assert.equal(cap.canAccept, false);
});

check('corrida de teste nunca consome vaga real', () => {
  const cap = capacitySnapshot({ calls: [{ id: 'test', status: 'autorizado', testMode: true }] });
  assert.equal(cap.activeCount, 0);
  assert.equal(cap.canAccept, true);
});

check('aguardando fechamento não bloqueia o motorista para a próxima corrida', () => {
  const cap = capacitySnapshot({ calls: [{ id: 'done', status: 'aguardando_fechamento', ownerCloseRequired: true }] });
  assert.equal(cap.activeCount, 0);
});

check('prévia da segunda corrida é limitada a 60 minutos', () => {
  assert.deepEqual(capSecondCallEta(95), { rawMinutes: 95, minutes: 60, cappedAtOneHour: true });
  assert.equal(publicEtaMinutes(95), 60);
});

check('prévia menor que 60 minutos é preservada', () => assert.equal(capSecondCallEta(43).minutes, 43));

check('tempo restante planejado diminui com o andamento da primeira corrida', () => {
  const remaining = plannedRemainingMinutes({
    authorizedAt: '2026-08-10T10:00:00Z',
    routeBreakdown: { legToOrigin: { minutes: 20 }, serviceLeg: { minutes: 40 } },
  }, new Date('2026-08-10T10:15:00Z'));
  assert.equal(remaining, 45);
});

check('fila é liberada quando a corrida anterior termina', () => {
  const state = { calls: [
    { id: 'first', status: 'aguardando_fechamento' },
    { id: 'second', status: 'autorizado', queued: true, queuedBehindCallId: 'first', authorizedAt: '2026-08-10T10:05:00Z' },
  ] };
  const released = releaseNextQueuedCall(state, 'first', new Date('2026-08-10T11:00:00Z'));
  assert.equal(released.id, 'second');
  assert.equal(released.queued, false);
  assert.equal(released.queuedBehindCallId, null);
  assert.equal(released.operationalPhase, 'autorizado');
});

check('fechamento do dono é obrigatório para corrida nova ficar definitiva', () => {
  assert.equal(isOwnerFinalizedCall({ status: 'aguardando_fechamento', ownerCloseRequired: true }), false);
  assert.equal(isOwnerFinalizedCall({ status: 'concluido', ownerCloseRequired: true }), false);
  assert.equal(isOwnerFinalizedCall({ status: 'concluido', ownerCloseRequired: true, ownerClosedAt: '2026-08-10T12:00:00Z' }), true);
});

check('compatibilidade de corrida antiga concluída é preservada', () => assert.equal(isOwnerFinalizedCall({ status: 'concluido' }), true));

check('repasse do motorista até 50 km é R$ 40', () => assert.equal(driverPayForCall({ status: 'autorizado', billableKm: 50 }).totalAmount, 40));
check('repasse acima de 50 km aplica R$ 0,70 por km excedente', () => assert.equal(driverPayForCall({ status: 'autorizado', billableKm: 80 }).totalAmount, 61));
check('hora trabalhada vai integralmente para o motorista', () => assert.equal(driverPayForCall({ status: 'autorizado', billableKm: 80, workedTimeChargeRequired: true, workedTimeAmount: 160 }).totalAmount, 221));

check('repasse fica previsto antes do fechamento e definitivo depois', () => {
  const state = { calls: [{ id: 'c1', status: 'autorizado', authorizedAt: '2026-08-21T12:00:00Z', billableKm: 80, driverId: 'mauro', driverName: 'Mauro' }], fleet: [], driverPayrolls: [], finance: [] };
  syncDriverPayrolls(state, new Date('2026-08-22T12:00:00Z'));
  assert.equal(state.driverPayrolls[0].totalAmount, 0);
  assert.equal(state.driverPayrolls[0].projectedAmount, 61);
  state.calls[0].ownerClosedAt = '2026-08-21T13:00:00Z';
  state.calls[0].status = 'concluido';
  state.calls[0].ownerCloseRequired = true;
  syncDriverPayrolls(state, new Date('2026-08-22T12:00:00Z'));
  assert.equal(state.driverPayrolls[0].totalAmount, 61);
  assert.equal(state.driverPayrolls[0].projectedAmount, 0);
});

check('período do motorista respeita 20 a 20', () => {
  assert.deepEqual(driverPayrollPeriodFor('2026-08-20T12:00:00Z'), { periodStart: '2026-07-20', periodEnd: '2026-08-20', paymentDue: '2026-08-20' });
  assert.deepEqual(driverPayrollPeriodFor('2026-08-21T12:00:00Z'), { periodStart: '2026-08-20', periodEnd: '2026-09-20', paymentDue: '2026-09-20' });
});

check('cancelamento exatamente aos 15 minutos não cobra', () => {
  const p = evaluateCancellationPolicy({ authorizedAt: '2026-08-10T10:00:00Z', cancelledAt: '2026-08-10T10:15:00Z', billableKm: 70 });
  assert.equal(p.chargeRequired, false);
  assert.equal(p.billableKm, 0);
});

check('cancelamento após 15 minutos cobra deslocamento integral', () => {
  const p = evaluateCancellationPolicy({ authorizedAt: '2026-08-10T10:00:00Z', cancelledAt: '2026-08-10T10:15:01Z', billableKm: 70 });
  assert.equal(p.chargeRequired, true);
  assert.equal(p.billableKm, 70);
  assert.equal(p.partialPaymentAllowed, false);
});

check('hora trabalhada começa no 16º minuto', () => assert.deepEqual([15,16,75,76].map((m) => evaluateWorkedTime({ reportedMinutes: m }).amount), [0,80,80,160]));

check('tabela comercial calcula base, excedente e terra', () => {
  const result = calculateApprovedCommercial({
    approvedRules: { services: { passeio: { basePrice: 130, includedKm: 50, pricePerKm: 3 } } },
    vehicleType: 'passeio', totalKm: 100, reportedExtras: { dirtRoadKm: 20 },
  });
  assert.equal(result.amount, 296);
  assert.equal(result.dirtRoadKm, 20);
});

check('perfil financeiro não aprovado não cria vencimento automático', () => {
  const profile = sanitizeBillingProfile({ groupId: g1, groupName: 'Horizonte', status: 'needs_review', paymentMode: 'monthly', cycles: [{ statementDay: 30, paymentDay: 15, paymentMonthOffset: 1 }] });
  assert.equal(settlementForCall(profile, {}, '2026-08-10T12:00:00Z').status, 'profile_not_approved');
});

check('perfil aprovado calcula vencimento mensal', () => {
  const profile = sanitizeBillingProfile({ groupId: g1, groupName: 'Premium Assistência', status: 'approved', paymentMode: 'monthly', cycles: [{ id: 'm', statementDay: 30, paymentDay: 15, paymentMonthOffset: 1 }] });
  const settlement = settlementForCall(profile, {}, '2026-08-10T12:00:00Z');
  assert.equal(settlement.status, 'ok');
  assert.equal(settlement.batch.statementDue, '2026-08-30');
  assert.equal(settlement.dueDate, '2026-09-15');
});

const finalCall = {
  ...quoteWon, id: 'final-1', quoteTracked: true, quoteOutcome: 'won', status: 'concluido', ownerCloseRequired: true,
  ownerClosedAt: '2026-08-20T13:00:00Z', ownerClosedBy: 'Thiago', billableKm: 55, value: 180, driverName: 'Mauro',
};
const projectedCall = {
  ...quoteOpen, id: 'projected-1', quoteTracked: true, quoteOutcome: 'won', status: 'autorizado', authorizedAt: '2026-08-21T10:00:00Z', billableKm: 30, calculatedValue: 140,
};
const reportState = {
  insurers: baseState.insurers,
  calls: [finalCall, projectedCall, { ...finalCall, id: 'test-final', testMode: true, value: 999 }],
  finance: [
    { id: 'f-final', type: 'receita', isFinal: true, status: 'pago', amount: 180, sourceCallId: finalCall.id, createdAt: '2026-08-10T12:00:00Z', updatedAt: finalCall.ownerClosedAt },
    { id: 'f-proj', type: 'receita', isFinal: false, status: 'pago', amount: 140, sourceCallId: projectedCall.id, createdAt: projectedCall.authorizedAt },
  ],
  fleet: [{ id: 'truck-1', driver: 'Mauro' }], driverPayrolls: [],
};

check('relatório só fatura corrida fechada pelo dono', () => {
  const report = buildPeriodReport(reportState, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(report.finalCalls, 1);
  assert.equal(report.revenue, 180);
  assert.equal(report.received, 180);
});

check('relatório usa data de fechamento para financeiro definitivo', () => {
  const state = structuredClone(reportState);
  state.calls[0].ownerClosedAt = '2026-09-02T13:00:00Z';
  state.finance[0].createdAt = '2026-08-10T12:00:00Z';
  const aug = buildPeriodReport(state, { from: '2026-08-01', to: '2026-08-31' });
  const sep = buildPeriodReport(state, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(aug.revenue, 0);
  assert.equal(sep.revenue, 180);
});

check('planilha XLSX possui todas as abas operacionais', () => {
  const out = buildPeriodWorkbook(reportState, { from: '2026-08-01', to: '2026-08-31' });
  const workbook = XLSX.read(out.buffer, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Resumo','Corridas','Cotações','Por seguradora','Por grupo','Financeiro','Motoristas']);
});

check('protocolo, origem, destino, veículo e placa são extraídos', () => {
  const facts = extractOperationalFacts('PROTOCOLO: ABC-123\nORIGEM: Rua A, 10\nDESTINO: Rua B, 20\nVEÍCULO: Fiat Uno\nPLACA: ABC1D23');
  assert.equal(facts.protocol, 'ABC-123');
  assert.equal(facts.origin, 'Rua A, 10');
  assert.equal(facts.destination, 'Rua B, 20');
  assert.equal(facts.vehicle, 'Fiat Uno');
  assert.equal(facts.plate, 'ABC1D23');
});

check('mensagem de cotação por KM/local não é confundida com autorização', () => {
  assert.equal(classifyRuntimeIntent('Origem: Rua A, 10. Destino: Rua B, 20. Veículo: Fiat Uno. Qual valor para 60 km?', 'Horizonte', null), 'quote');
});

check('pode seguir é reconhecido como autorização quando existe oportunidade', () => {
  assert.equal(classifyRuntimeIntent('Pode seguir', 'Horizonte', { status: 'aguardando_aprovacao' }), 'authorization');
});

check('mensagem administrativa permanece silenciosa', () => {
  assert.equal(classifyRuntimeIntent('Pessoal, reunião amanhã às 9h', 'Horizonte', null), 'administrative_notice');
});

check('indisponibilidade cadastrada do caminhão bloqueia atendimento', () => {
  const result = truckAvailability({ fleet: [{ id: '1', status: 'manutencao', unavailabilityReason: 'Manutenção preventiva' }] }, new Date('2026-08-10T10:00:00Z'));
  assert.equal(result.available, false);
  assert.match(result.reply, /indisponível/i);
});

check('mensagem ao motorista informa quando a segunda corrida está em fila', () => {
  const text = driverDispatchMessage({ insurer: 'Horizonte', protocol: 'P1', origin: 'Rua A', destination: 'Rua B', queued: true, etaMinutes: 60 }, {});
  assert.match(text, /corrida em fila/i);
  assert.match(text, /60 min/i);
});

check('grupo Tests guincho é reconhecido como teste e isolado', () => assert.equal(isTestCall({ groupName: 'Tests guincho' }), true));

const scenarioIds = new Set(TEST_SCENARIOS.map((item) => item.id));
for (const id of ['availability','complete_dispatch','maps_link','protocol_requires_authorization','authorized_protocol_and_value','repeated_authorization','full_lifecycle','capacity_two_calls','capacity_eta_cap','quote_funnel','owner_close_required','driver_projection','report_final_only','insurer_multi_group','billing_calendar','workbook_export']) {
  check(`Central de Testes contém cenário ${id}`, () => assert.equal(scenarioIds.has(id), true));
}

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
const owner = fs.readFileSync(new URL('../owner-dashboard.js', import.meta.url), 'utf8');
const ownerPublic = fs.readFileSync(new URL('../public/owner-dashboard.js', import.meta.url), 'utf8');
const apiProxy = fs.readFileSync(new URL('../api/worker/[...path].js', import.meta.url), 'utf8');
const dockerfile = fs.readFileSync(new URL('../Dockerfile.vps', import.meta.url), 'utf8');

check('runtime continua em modo simples sem IA paga', () => {
  assert.match(worker, /simpleMode:\s*true/);
  assert.match(worker, /aiEnabled:\s*false/);
  assert.match(apiProxy, /simpleMode:\s*true,\s*aiEnabled:\s*false/);
});

check('produção só responde grupos explicitamente autorizados', () => assert.match(worker, /if \(!allowed\.has\(msg\.from\)\) return;/));
check('tabela aprovada pode ser herdada entre grupos da mesma seguradora', () => assert.match(worker, /approved_insurer/));
check('status comercial herdado é marcado como aprovado', () => assert.match(worker, /resolvedRules\.source\.startsWith\('approved'\)/));
check('autorização informa regra dos 15 minutos', () => assert.match(worker, /Cancelamento sem custo em até 15 minutos/));
check('fechamento do WhatsApp fica aguardando Thiago', () => assert.match(worker, /status: 'aguardando_fechamento'/));
check('edição genérica não pode concluir sem fechamento do dono', () => assert.match(worker, /manual_conclusion_redirected_to_owner_close/));
check('finalização libera automaticamente a próxima corrida da fila', () => assert.match(worker, /promoteQueuedCallAfter/));
check('painel mostra aguardando fechamento entre corridas aceitas', () => {
  assert.match(owner, /acceptedStatuses = new Set\([^\n]*aguardando_fechamento/);
  assert.match(ownerPublic, /acceptedStatuses = new Set\([^\n]*aguardando_fechamento/);
});
check('painel calcula conversão sobre cotações solicitadas', () => {
  assert.match(owner, /won\.length\s*\/\s*quotes\.length/);
  assert.match(ownerPublic, /won\.length\s*\/\s*quotes\.length/);
});
check('imagem Docker leva base de treinamento para a VPS', () => assert.match(dockerfile, /COPY training \.\/training/));

console.log(`FULL_BUSINESS_FLOW_AUDIT_OK · ${checks} verificações`);
