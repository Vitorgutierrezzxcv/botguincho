import assert from 'node:assert/strict';
import {
  driverDispatchMessage,
  isConfirmedCall,
  publicEtaMinutes,
  truckAvailability,
  whatsappChatId,
} from './simple-operation.mjs';

assert.equal(publicEtaMinutes(17.1), 18);
assert.equal(publicEtaMinutes(61), 60);
assert.equal(publicEtaMinutes(104), 60);
assert.equal(publicEtaMinutes(null), null);

assert.equal(isConfirmedCall({ status: 'autorizado' }), true);
assert.equal(isConfirmedCall({ status: 'aguardando_aprovacao' }), false);

const available = truckAvailability({ fleet: [{ status: 'disponivel' }] }, '2026-08-24T12:00:00Z');
assert.equal(available.available, true);

const broken = truckAvailability({
  fleet: [{
    status: 'manutencao',
    unavailabilityReason: 'Caminhão em manutenção.',
    unavailableUntil: '2026-08-25T15:00:00Z',
  }],
}, '2026-08-24T12:00:00Z');
assert.equal(broken.available, false);
assert.match(broken.reply, /Caminhão em manutenção/);
assert.match(broken.reply, /Previsão de retorno/);

const resumed = truckAvailability({
  fleet: [{ status: 'manutencao', unavailableUntil: '2026-08-23T15:00:00Z' }],
}, '2026-08-24T12:00:00Z');
assert.equal(resumed.available, true);

assert.equal(whatsappChatId('(31) 99999-1234'), '5531999991234@c.us');
assert.equal(whatsappChatId('123'), '');

const message = driverDispatchMessage({
  insurer: 'Transportadora Teste',
  protocol: 'ABC123',
  vehicle: 'Fiat Uno',
  origin: 'Rua A, 10',
  destination: 'Rua B, 20',
  etaMinutes: 104,
}, { plate: 'GSW0H17' });
assert.match(message, /ABC123/);
assert.match(message, /Previsão informada: 60 min/);
assert.match(message, /GSW0H17/);

console.log('SIMPLE_OPERATION_OK');
