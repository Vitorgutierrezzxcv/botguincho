import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
const ops = fs.readFileSync(new URL('./operational-knowledge.mjs', import.meta.url), 'utf8');

function section(source, start, end) {
  const a = source.indexOf(start);
  assert.ok(a >= 0, `início não encontrado: ${start}`);
  const b = source.indexOf(end, a);
  assert.ok(b > a, `fim não encontrado: ${end}`);
  return source.slice(a, b);
}

const eta = section(
  worker,
  'async function handleEtaQuestion',
  'function enderecoEmTextoLivre',
);
assert.match(eta, /PREVIA_RESILIENTE_V2/);
assert.match(eta, /Última previsão calculada:/);
assert.match(eta, /intent: 'eta-fallback'/);
assert.match(eta, /fallbackCall\?\.etaMinutes/);
assert.match(eta, /target\.state\?\.lastEta\?\.minutes/);

const authorization = section(
  worker,
  'async function handleAuthorizationRuntime',
  'async function handleScheduledRuntime',
);
assert.match(authorization, /ACEITE_CURTO_V2/);
assert.match(authorization, /shortConfirmation: true/);
assert.match(authorization, /Corrida em fila após o atendimento atual/);
assert.match(authorization, /A previsão será atualizada conforme o andamento da corrida anterior/);
assert.doesNotMatch(authorization, /Quilometragem total calculada:/);
assert.doesNotMatch(authorization, /Valor estimado:/);
assert.doesNotMatch(authorization, /O valor poderá ter acréscimos conforme a execução/);
assert.doesNotMatch(authorization, /Cancelamento sem custo em até 15 minutos após a confirmação/);
assert.doesNotMatch(authorization, /Previsão informada:/);

const distance = section(
  worker,
  'async function handleDistanceQuestion',
  'async function handleTrackerLocationQuestion',
);
// É válido usar context.recentCall para responder um "km?" curto com o valor já salvo.
// O bug real era usar context.recentCall para decidir o estado da rota recalculada,
// em vez da corrida resolvida pelo próprio alvo da pergunta.
assert.match(distance, /const activeCall = target\.recentCall/);
assert.doesNotMatch(distance, /const activeCall = context\?\.recentCall/);

assert.match(ops, /pode\\s\+deixar/);
assert.match(ops, /atendimento\\s\+\(\?:foi\\s\+\)\?cancelad\[oa\]/);
assert.match(worker, /runtimeIntent === 'cancellation'/);
assert.match(worker, /handleCancellationRuntime\(msg, groupName, readableText, operationalContext\)/);

console.log('AUTHORIZATION_ETA_CANCEL_HOTFIX_OK');
