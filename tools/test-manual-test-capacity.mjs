import assert from 'node:assert/strict';
import { capacitySnapshot, isCapacityActiveCall } from './dispatch-capacity.mjs';

const now = new Date('2026-08-29T03:30:00.000Z'); // 00:30 em America/Sao_Paulo

const currentManual = {
  id: 'current-manual',
  status: 'autorizado',
  groupName: 'Tests guincho',
  testMode: true,
  testRunId: null,
  authorizedAt: '2026-08-29T03:23:58.635Z',
};

const previousDayManual = {
  id: 'previous-day-manual',
  status: 'em_atendimento',
  groupName: 'Tests guincho',
  testMode: true,
  testRunId: null,
  authorizedAt: '2026-08-28T22:29:57.967Z',
};

const automatedTestCenter = {
  id: 'automated-test-center',
  status: 'autorizado',
  groupName: 'Tests guincho',
  testMode: true,
  testRunId: 'run-123',
  authorizedAt: '2026-08-29T03:25:00.000Z',
};

const productionCall = {
  id: 'production',
  status: 'a_caminho',
  groupName: 'Horizonte',
  testMode: false,
  authorizedAt: '2026-08-29T03:20:00.000Z',
};

assert.equal(isCapacityActiveCall(currentManual, now), true, 'teste manual do dia deve consumir capacidade');
assert.equal(isCapacityActiveCall(previousDayManual, now), false, 'teste manual de dia anterior nao deve contaminar o sandbox');
assert.equal(isCapacityActiveCall(automatedTestCenter, now), false, 'Central de Testes automatizada nao deve consumir capacidade');
assert.equal(isCapacityActiveCall(productionCall, now), true, 'producao continua consumindo capacidade normalmente');

const oneActive = capacitySnapshot({ calls: [previousDayManual, automatedTestCenter, currentManual] }, '', now);
assert.equal(oneActive.activeCount, 1, 'deve reconhecer exatamente a corrida manual atual');
assert.equal(oneActive.canAccept, true, 'com uma ativa a segunda corrida deve ser aceita');

const secondManual = {
  ...currentManual,
  id: 'second-manual',
  status: 'a_caminho',
  authorizedAt: '2026-08-29T03:28:00.000Z',
};
const twoActive = capacitySnapshot({ calls: [previousDayManual, automatedTestCenter, currentManual, secondManual] }, '', now);
assert.equal(twoActive.activeCount, 2, 'duas corridas manuais atuais devem ocupar as duas vagas');
assert.equal(twoActive.canAccept, false, 'terceira corrida deve ser bloqueada');

console.log('manual test capacity: OK');
