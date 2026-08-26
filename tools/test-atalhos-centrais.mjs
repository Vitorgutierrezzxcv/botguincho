// Formas curtas reais das centrais, extraidas de 4.828 pares pergunta/resposta
// de 9 grupos (jan-ago/2026). Antes deste conjunto todas caiam em silencio.
import assert from 'node:assert/strict';
import { classifyRuntimeIntent } from './operational-knowledge.mjs';

const ATIVO = { status: 'em_atendimento', arrivalConfirmed: false };
const G = 'América Guincho X Plus Assistência';

const casos = [
  // "60?" logo apos a oportunidade = "chega em 60 minutos?" (49 ocorrencias)
  ['60?', null, 'eta'],
  ['60 ?', null, 'eta'],
  ['60??', null, 'eta'],
  ['90?', null, 'eta'],
  ['120?', null, 'eta'],
  // valores comerciais nao sao multiplos de 5 nessa faixa: seguem fora
  ['118?', null, 'other'],
  ['229?', null, 'other'],
  // perguntas de status
  ['chegando ?', ATIVO, 'eta'],
  ['CHEGOU?', ATIVO, 'eta'],
  ['achou ?', ATIVO, 'eta'],
  ['proximo???', null, 'eta'],
  // saida e km
  ['saida ?', null, 'quote'],
  ['Saida amigo?', null, 'quote'],
  ['kms ?', ATIVO, 'value_summary'],
  ['KMS ??', ATIVO, 'value_summary'],
  ['fechou em quantos kms ?', ATIVO, 'value_summary'],
  // oferta de servico
  ['Consegue?', null, 'availability'],
  ['consegue fazer esse ?', null, 'availability'],
  ['consegue atender?', null, 'availability'],
  // desistencia
  ['Pode cancelar amigos', ATIVO, 'cancellation'],
  ['vai precisar mais nao', ATIVO, 'cancellation'],
  ['esse nao sera necessario pessoal', ATIVO, 'cancellation'],
];

for (const [texto, chamado, esperado] of casos) {
  assert.equal(classifyRuntimeIntent(texto, G, chamado), esperado, `${texto} -> esperado ${esperado}`);
}

// Nao pode virar disponibilidade um pedido vago sem origem/destino/veiculo:
// pedir os dados que faltam continua sendo a resposta certa.
assert.equal(classifyRuntimeIntent('O carro está parado no centro, consegue buscar?', G, null), 'incomplete_dispatch');
// Verbos de contato nao sao pergunta de disponibilidade.
assert.notEqual(classifyRuntimeIntent('Consegue chamar o associado para ele auxiliar?', G, ATIVO), 'availability');
// Assunto administrativo com "nao sera necessario" nao cancela atendimento.
assert.notEqual(classifyRuntimeIntent('Nao sera necessario encaminhar a nota fiscal agora', G, ATIVO), 'cancellation');
// Cortesia continua sem intencao operacional.
for (const t of ['obrigada', 'bom dia', 'beleza', 'ok']) {
  assert.equal(classifyRuntimeIntent(t, G, null), 'other', `${t} deveria seguir sem intencao`);
}

console.log(`OK: ${casos.length + 7} casos de atalhos reconhecidos.`);
