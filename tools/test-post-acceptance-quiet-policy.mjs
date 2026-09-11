import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');

function section(start, end) {
  const a = worker.indexOf(start);
  assert.ok(a >= 0, `início não encontrado: ${start}`);
  const b = worker.indexOf(end, a);
  assert.ok(b > a, `fim não encontrado: ${end}`);
  return worker.slice(a, b);
}

const protocol = section(
  'async function handleProtocolRuntime',
  'async function handleAuthorizationRuntime',
);
assert.match(protocol, /protocolAckFingerprint/);
assert.match(protocol, /protocolOnlyAck: true/);
assert.match(protocol, /recebido e vinculado ao atendimento/);
assert.doesNotMatch(protocol, /Quilometragem total:/);
assert.doesNotMatch(protocol, /Valor estimado:/);
assert.doesNotMatch(protocol, /PREVISAO_NO_PROTOCOLO/);
assert.doesNotMatch(protocol, /Se o protocolo corresponde a uma oportunidade ainda nao autorizada/);

const evidence = section(
  'async function handleEvidenceRuntime',
  'async function handleAddressUpdateRuntime',
);
assert.match(evidence, /evidenceAckSentAt/);
assert.match(evidence, /Fotos recebidas e vinculadas ao atendimento/);
assert.match(evidence, /evidência adicional registrada sem repetir confirmação/);
assert.doesNotMatch(evidence, /Ainda pendente:/);
assert.doesNotMatch(evidence, /Evidências obrigatórias concluídas/);

const incoming = section(
  'async function processIncomingMessage',
  'function scheduleWhatsAppRecovery',
);
assert.match(incoming, /FOTO_NAO_REABRE_COTACAO/);
assert.match(incoming, /POS_ACEITE_SEM_REPETICAO/);
assert.match(incoming, /postAcceptanceNoiseIntents/);
assert.match(incoming, /looksLikeDistinctNewServiceRequest/);
assert.match(incoming, /handleEvidenceRuntime\(msg, groupName, readableText, operationalContext, true\)/);

assert.match(worker, /Depois que uma corrida estiver autorizada, nunca reapresente valor, quilometragem ou previsão sem pergunta explícita/);

console.log('POST_ACCEPTANCE_QUIET_POLICY_OK');
