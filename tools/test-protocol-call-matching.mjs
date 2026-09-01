import assert from 'node:assert/strict';
import { protocolHasStrongIdentity, protocolIdentityMatchesCall, selectProtocolTargetCall } from './protocol-call-matching.mjs';

const groupId = 'tests@g.us';
const active = {
  id: 'old-call', sourceGroupId: groupId, status: 'autorizado',
  vehicle: 'FIAT UNO 2015', plate: 'PXX1A23',
  origin: 'Rua Madeira 75, Sao Cristovao, Betim - MG',
  destination: 'Rua Marte 297, Jardim Riacho das Pedras, Contagem - MG',
  updatedAt: '2026-09-01T18:50:00.000Z',
};
const second = {
  id: 'second-call', sourceGroupId: groupId, status: 'autorizado',
  vehicle: 'CHEVROLET ONIX 2020', plate: 'QWE2B34',
  origin: 'Avenida Joao Cesar de Oliveira, 1275, Eldorado, Contagem - MG',
  destination: 'Praca Milton Campos, 55, Centro, Betim - MG',
  updatedAt: '2026-09-01T18:51:00.000Z',
};

const proterlink = {
  protocol: '2026018344', plate: 'HMJ7J14',
  vehicle: 'FIAT / STRADA 1.4 MPI FIRE FLEX 8V CS',
  origin: 'Rua Wilson Gramiscelli, nº 117, Arvoredo, CONTAGEM - MG',
  destination: 'Avenida das Americas, nº 402, Centro, BETIM - MG',
};
assert.equal(protocolHasStrongIdentity(proterlink), true);
assert.equal(protocolIdentityMatchesCall(active, proterlink), false, 'placa/endereco diferentes nunca podem anexar');
assert.equal(selectProtocolTargetCall({ calls: [active, second], groupId, identity: proterlink, fallbackCall: second }), null, 'protocolo novo deve virar nova solicitacao');

const sameSecond = {
  protocol: '999', plate: 'QWE2B34', vehicle: 'Onix',
  origin: 'Av Joao Cesar de Oliveira 1275, Eldorado, Contagem MG',
  destination: 'Praca Milton Campos 55, Centro, Betim MG',
};
assert.equal(selectProtocolTargetCall({ calls: [active, second], groupId, identity: sameSecond, fallbackCall: active })?.id, 'second-call');

const addressOnly = {
  origin: 'Rua Madeira 75, Sao Cristovao, Betim MG',
  destination: 'Rua Marte 297, Jardim Riacho das Pedras, Contagem MG',
};
assert.equal(selectProtocolTargetCall({ calls: [active, second], groupId, identity: addressOnly, fallbackCall: second })?.id, 'old-call');

const sparse = { protocol: '12345' };
assert.equal(protocolHasStrongIdentity(sparse), false);
assert.equal(selectProtocolTargetCall({ calls: [active, second], groupId, identity: sparse, fallbackCall: second })?.id, 'second-call', 'protocolo sem dados continua usando contexto recente');

const concludedSamePlateDifferentProtocol = {
  ...second,
  id: 'concluded-old',
  status: 'concluido',
  protocol: 'PROTO-ANTIGO',
  updatedAt: '2026-09-01T18:59:00.000Z',
};
const newServiceSamePlate = {
  protocol: 'PROTO-NOVO', plate: 'QWE2B34',
  origin: 'Rua Nova 10, Betim MG', destination: 'Rua Outra 20, Contagem MG',
};
assert.equal(
  selectProtocolTargetCall({ calls: [concludedSamePlateDifferentProtocol], groupId, identity: newServiceSamePlate, fallbackCall: concludedSamePlateDifferentProtocol }),
  null,
  'corrida concluida nao pode capturar novo protocolo apenas pela mesma placa',
);

const lateSameProtocol = { protocol: 'PROTO-ANTIGO', plate: 'QWE2B34', origin: concludedSamePlateDifferentProtocol.origin, destination: concludedSamePlateDifferentProtocol.destination };
assert.equal(
  selectProtocolTargetCall({ calls: [concludedSamePlateDifferentProtocol], groupId, identity: lateSameProtocol, fallbackCall: null })?.id,
  'concluded-old',
  'mesmo numero de protocolo ainda pode atualizar registro concluido',
);

console.log('protocol-call-matching regression: ok');
