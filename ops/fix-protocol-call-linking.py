from pathlib import Path

worker = Path('tools/vercel-whatsapp-worker.mjs')
text = worker.read_text()

module = r'''function norm(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normPlate(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function tokens(value = '') {
  const ignored = new Set(['rua','r','avenida','av','numero','n','bairro','cidade','estado','mg','brasil','ref','referencia','de','da','do','das','dos']);
  return new Set(norm(value).split(' ').filter((token) => token.length >= 2 && !ignored.has(token)));
}

function similarity(a = '', b = '') {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return null;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.min(aa.size, bb.size);
}

function sameAddress(a = '', b = '') {
  const score = similarity(a, b);
  return score !== null && score >= 0.55;
}

function sameVehicle(a = '', b = '') {
  const score = similarity(a, b);
  return score !== null && score >= 0.45;
}

export function protocolHasStrongIdentity(identity = {}) {
  return Boolean(
    normPlate(identity.plate)
    || (norm(identity.origin) && norm(identity.destination))
    || (norm(identity.protocol) && (norm(identity.origin) || norm(identity.destination)))
  );
}

export function protocolIdentityMatchesCall(call = {}, identity = {}) {
  if (!call || call.deletedAt) return false;

  const incomingProtocol = norm(identity.protocol);
  const callProtocol = norm(call.protocol);
  if (incomingProtocol && callProtocol) {
    if (incomingProtocol === callProtocol) return true;
    return false;
  }

  const incomingPlate = normPlate(identity.plate);
  const callPlate = normPlate(call.plate);
  // Placa e o identificador mais forte: se ambas existem, decide sozinha.
  if (incomingPlate && callPlate) return incomingPlate === callPlate;

  const originComparable = Boolean(norm(identity.origin) && norm(call.origin));
  const destinationComparable = Boolean(norm(identity.destination) && norm(call.destination));
  const originMatch = originComparable ? sameAddress(identity.origin, call.origin) : false;
  const destinationMatch = destinationComparable ? sameAddress(identity.destination, call.destination) : false;

  // Se temos os dois enderecos dos dois lados, os dois precisam apontar para o mesmo atendimento.
  if (originComparable && destinationComparable) return originMatch && destinationMatch;

  // Um endereco coincidente + veiculo coincidente e evidencia suficiente quando a outra ponta ainda nao existia.
  const vehicleComparable = Boolean(norm(identity.vehicle) && norm(call.vehicle));
  const vehicleMatch = vehicleComparable ? sameVehicle(identity.vehicle, call.vehicle) : false;
  if ((originMatch || destinationMatch) && vehicleMatch) return true;

  return false;
}

export function selectProtocolTargetCall({ calls = [], groupId = '', identity = {}, fallbackCall = null } = {}) {
  if (!protocolHasStrongIdentity(identity)) return fallbackCall || null;

  const candidates = (Array.isArray(calls) ? calls : [])
    .filter((call) => call && !call.deletedAt && call.sourceGroupId === groupId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

  return candidates.find((call) => protocolIdentityMatchesCall(call, identity)) || null;
}
'''
Path('tools/protocol-call-matching.mjs').write_text(module)

test = r'''import assert from 'node:assert/strict';
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

console.log('protocol-call-matching regression: ok');
'''
Path('tools/test-protocol-call-matching.mjs').write_text(test)

import_marker = "import { MAX_CONCURRENT_CALLS, isCapacityActiveCall, activeCallsForCapacity, capacitySnapshot, plannedRemainingMinutes, capSecondCallEta } from './dispatch-capacity.mjs';"
import_line = import_marker + "\nimport { protocolHasStrongIdentity, selectProtocolTargetCall } from './protocol-call-matching.mjs';"
if "from './protocol-call-matching.mjs'" not in text:
    if import_marker not in text:
        raise SystemExit('dispatch import marker missing')
    text = text.replace(import_marker, import_line, 1)

old = """async function handleProtocolRuntime(msg, groupName, readableText, context) {\n  const call = context.recentCall;\n  const status = call?.status || 'aguardando_aprovacao';\n  const flowActive = isFlowActiveCall(call);"""
new = """async function handleProtocolRuntime(msg, groupName, readableText, context) {\n  const protocolIdentity = {\n    protocol: context.facts?.protocol || readableText.match(/\\bprotocolo\\s*[:#-]?\\s*([A-Z0-9.-]+)/i)?.[1] || '',\n    plate: context.facts?.plate || readableText.match(/\\bplaca\\s*[:#-]?\\s*([A-Z]{3}[0-9A-Z]{4})/i)?.[1] || '',\n    vehicle: context.facts?.vehicle || readableText.match(/(?:modelo\\s*\\/\\s*montadora|modelo|ve[ií]culo)\\s*:\\s*([^\\n]+)/i)?.[1] || '',\n    origin: extractLabeledAddressBlock(readableText, 'Origem') || context.facts?.origin || '',\n    destination: extractLabeledAddressBlock(readableText, 'Destino') || context.facts?.destination || '',\n  };\n  const call = selectProtocolTargetCall({\n    calls: context.management?.calls || [],\n    groupId: msg.from,\n    identity: protocolIdentity,\n    fallbackCall: context.recentCall,\n  });\n  const protocolIsNewRequest = protocolHasStrongIdentity(protocolIdentity) && !call;\n  if (protocolIsNewRequest) {\n    const capacity = capacitySnapshot(context.management);\n    if (!capacity.canAccept) {\n      await replyAndRemember(msg, groupName, readableText, 'Motorista fora de rota.', {\n        intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS, protocolNewRequest: true,\n      });\n      logEvent('capacity', `${groupName}: novo protocolo recusado; nao corresponde às corridas ativas e limite simultaneo foi atingido.`, {\n        groupId: msg.from, activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS, protocol: protocolIdentity.protocol || null, plate: protocolIdentity.plate || null,\n      });\n      return;\n    }\n    logEvent('protocol', `${groupName}: protocolo tratado como nova solicitacao; dados nao correspondem ao atendimento em andamento.`, {\n      groupId: msg.from, protocol: protocolIdentity.protocol || null, plate: protocolIdentity.plate || null,\n    });\n  }\n  const status = call?.status || 'aguardando_aprovacao';\n  const flowActive = isFlowActiveCall(call);"""
if new not in text:
    if old not in text:
        raise SystemExit('handleProtocolRuntime marker missing')
    text = text.replace(old, new, 1)

worker.write_text(text)
