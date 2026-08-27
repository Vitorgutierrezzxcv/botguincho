// 12,6% das mensagens das centrais chegam em pedaco: o destino numa mensagem,
// o veiculo em outra. O pedaco solto precisa herdar o que ja foi recebido.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const fonte = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');

// pendingRouteContext devolve a ficha em montagem, e nada quando o chamado ja saiu
// da fase de coleta - um atendimento em andamento nao pode reaproveitar endereco.
const trecho = fonte.slice(fonte.indexOf('function pendingRouteContext('), fonte.indexOf('async function handleIncompleteDispatchRuntime('));
const { pendingRouteContext } = new Function(`${trecho}\nreturn { pendingRouteContext };`)();

const emColeta = { status: 'aguardando_aprovacao', origin: 'Rua Iacaiaca, 450, Santa Luzia - MG', destination: 'Rua Maria de Araujo, 699, Betim - MG', originCoordinates: null };
assert.equal(pendingRouteContext(emColeta)?.origin, 'Rua Iacaiaca, 450, Santa Luzia - MG');
assert.equal(pendingRouteContext(emColeta)?.destination, 'Rua Maria de Araujo, 699, Betim - MG');
assert.equal(pendingRouteContext(null), null);
for (const status of ['autorizado', 'a_caminho', 'em_atendimento', 'concluido', 'cancelado']) {
  assert.equal(pendingRouteContext({ ...emColeta, status }), null, `${status} nao pode herdar endereco`);
}
for (const status of ['cotacao', 'aguardando_dados', 'aguardando_aprovacao', 'agendado']) {
  assert.ok(pendingRouteContext({ ...emColeta, status }), `${status} deveria herdar endereco`);
}

// A ficha em montagem vem antes da localizacao antiga do grupo. Sem isso, um
// pedaco sem endereco calculava a previsao ate um pin de ate 20 minutos atras
// e devolvia um numero diferente do ja informado.
const assinatura = fonte.slice(fonte.indexOf('async function estimateQuoteRoute('), fonte.indexOf('let eta = null;', fonte.indexOf('async function estimateQuoteRoute(')));
assert.ok(/pending\?\.origin/.test(assinatura), 'origem deveria herdar da ficha pendente');
assert.ok(/pending\?\.destination/.test(assinatura), 'destino deveria herdar da ficha pendente');
assert.ok(
  assinatura.indexOf('pending?.originCoordinates') < assinatura.indexOf('shared?.coordinates'),
  'a ficha pendente tem que vir antes da localizacao antiga do grupo',
);

// Os tres caminhos que calculam rota passam a ficha pendente.
assert.equal((fonte.match(/estimateQuoteRoute\(msg\.from, readableText, [^)]*?, incomingLocation, pendingRouteContext\(context\.recentCall\)\)/g) || []).length, 3,
  'disponibilidade, cotacao e dados do atendimento precisam passar a ficha pendente');

console.log('OK: ficha picada herda o que ja foi recebido.');
