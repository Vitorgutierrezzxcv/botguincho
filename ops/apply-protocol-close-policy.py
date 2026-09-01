from pathlib import Path
import re

worker_path = Path('tools/vercel-whatsapp-worker.mjs')
worker = worker_path.read_text(encoding='utf-8')

new_final_message = r'''function finalGroupMessage(call = {}) {
  const lines = ['Corrida finalizada ✅'];
  const protocol = String(call.protocol || '').trim();
  const vehicle = String(call.vehicle || '').trim();
  const plate = String(call.plate || '').trim();
  const origin = String(call.origin || '').trim();
  const destination = String(call.destination || '').trim();
  const finalKm = Number(call.billableKm);
  const finalValue = Number(call.value || 0);
  const workedAmount = Math.max(0, Number(call.workedTimeAmount || 0));
  const dirtAmount = Math.max(0, Number(call.dirtRoadChargeAmount || 0));
  const tollAmount = Math.max(0, Number(call.finalTollAmount || 0));
  const otherAmount = Math.max(0, Number(call.finalOtherExtras || 0));
  const extrasTotal = workedAmount + dirtAmount + tollAmount + otherAmount;
  const serviceValue = finalValue > 0 ? Math.max(0, Math.round((finalValue - extrasTotal) * 100) / 100) : 0;

  if (protocol) lines.push(`Protocolo: ${protocol}`);
  if (vehicle || plate) lines.push(`Veículo: ${vehicle || 'Não informado'}${plate ? ` · Placa: ${plate}` : ''}`);
  if (origin) lines.push(`Origem: ${origin}`);
  if (destination) lines.push(`Destino: ${destination}`);
  if (Number.isFinite(finalKm) && finalKm >= 0) lines.push(`Quilometragem total: ${finalKm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km.`);
  if (serviceValue > 0) lines.push(`Valor do serviço: ${formatCurrency(serviceValue)}.`);

  const extras = [];
  if (workedAmount > 0) {
    const hours = Number(call.workedTimeChargedHours || 0);
    extras.push(`Hora trabalhada${hours > 0 ? ` (${hours}h)` : ''}: ${formatCurrency(workedAmount)}`);
  }
  if (dirtAmount > 0) {
    const dirtKm = Number(call.dirtRoadBillableKm || 0);
    extras.push(`Estrada de terra${dirtKm > 0 ? ` (${dirtKm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km)` : ''}: ${formatCurrency(dirtAmount)}`);
  }
  if (tollAmount > 0) extras.push(`Pedágio: ${formatCurrency(tollAmount)}`);
  if (otherAmount > 0) extras.push(`Outros adicionais: ${formatCurrency(otherAmount)}`);
  if (extras.length) {
    lines.push('Adicionais confirmados:');
    for (const extra of extras) lines.push(`• ${extra}`);
  } else {
    lines.push('Adicionais confirmados: nenhum.');
  }

  if (finalValue > 0) lines.push(`Valor final: ${formatCurrency(finalValue)}.`);
  const notes = String(call.ownerClosingNotes || '').trim();
  if (notes) lines.push(`Observação de fechamento: ${notes}`);
  return lines.join('\n');
}'''

worker, count = re.subn(
    r"function finalGroupMessage\(call = \{\}\) \{.*?\n\}\n\nasync function closeCallFromOwner",
    lambda _match: new_final_message + "\n\nasync function closeCallFromOwner",
    worker,
    count=1,
    flags=re.S,
)
assert count == 1, 'finalGroupMessage block not found exactly once'

old_protocol_tail = """    logEvent('protocol', `${groupName}: protocolo tratado como nova solicitacao; dados nao correspondem ao atendimento em andamento.`, {
      groupId: msg.from, protocol: protocolIdentity.protocol || null, plate: protocolIdentity.plate || null,
    });
  }
  const status = call?.status || 'aguardando_aprovacao';
"""
new_protocol_tail = """    logEvent('protocol', `${groupName}: protocolo tratado como nova solicitacao; dados nao correspondem ao atendimento em andamento.`, {
      groupId: msg.from, protocol: protocolIdentity.protocol || null, plate: protocolIdentity.plate || null,
    });
    // Protocolo formal sem correspondencia nao autoriza nada sozinho: vira cotacao
    // e recebe a mesma previa de ETA, km e valor de qualquer nova oportunidade.
    await handleQuoteRuntime(msg, groupName, readableText, null, {
      ...context,
      recentCall: null,
      intent: 'quote',
    });
    return;
  }
  // Se o protocolo corresponde a uma oportunidade ainda nao autorizada, atualiza
  // aquela mesma cotacao e devolve a previa completa. Nunca transforma protocolo em autorizacao.
  if (call && ['cotacao','aguardando_dados','aguardando_aprovacao'].includes(call.status)) {
    await handleQuoteRuntime(msg, groupName, readableText, null, {
      ...context,
      recentCall: call,
      intent: 'quote',
    });
    return;
  }
  const status = call?.status || 'aguardando_aprovacao';
"""
assert old_protocol_tail in worker, 'protocol new-request tail not found'
worker = worker.replace(old_protocol_tail, new_protocol_tail, 1)
worker_path.write_text(worker, encoding='utf-8')

knowledge_path = Path('tools/operational-knowledge.mjs')
knowledge = knowledge_path.read_text(encoding='utf-8')
old_protocol_context = "  if (evidenceContext && /\\bprotocolo\\b/.test(value)) return 'protocol_update';"
new_protocol_context = "  if (evidenceContext && /\\bprotocolo\\b/.test(value) && !hasQuoteSignals(text)) return 'protocol_update';"
assert old_protocol_context in knowledge, 'protocol_update classifier line not found'
knowledge = knowledge.replace(old_protocol_context, new_protocol_context, 1)

old_formal = """  if (hasFormalProtocol(text)) {
    if (activeService) return 'protocol_update';
    if (profile.formalProtocolCanAuthorize && ['cotacao','aguardando_aprovacao','novo','disponibilidade'].includes(recentCall?.status)) return 'formal_dispatch';
    return 'protocol_received';
  }
"""
new_formal = """  if (hasFormalProtocol(text)) {
    if (activeService) return 'protocol_update';
    // Protocolo, ficha ou WebPrestador nunca autorizam sozinhos. Mesmo quando uma
    // central historicamente manda ficha formal, a execucao exige autorizacao expressa.
    return 'protocol_received';
  }
"""
assert old_formal in knowledge, 'formal protocol classifier block not found'
knowledge = knowledge.replace(old_formal, new_formal, 1)
knowledge_path.write_text(knowledge, encoding='utf-8')

test_path = Path('tools/test-operational-knowledge.mjs')
test = test_path.read_text(encoding='utf-8')
old_horizonte = "assert.equal(classifyRuntimeIntent('PROTOCOLO: HZ-22\\nSERVIÇO: REBOQUE LEVE\\nORIGEM: Rua A, 10\\nDESTINO: Rua B, 20', 'Horizonte', { status: 'cotacao' }), 'formal_dispatch', 'Excecao formal da Horizonte deve continuar autorizando');"
new_horizonte = "assert.equal(classifyRuntimeIntent('PROTOCOLO: HZ-22\\nSERVIÇO: REBOQUE LEVE\\nORIGEM: Rua A, 10\\nDESTINO: Rua B, 20', 'Horizonte', { status: 'cotacao' }), 'protocol_received', 'Protocolo formal sem autorizacao expressa nao pode autorizar corrida');"
assert old_horizonte in test, 'old Horizonte protocol expectation not found'
test = test.replace(old_horizonte, new_horizonte, 1)
anchor = "assert.equal(classifyRuntimeIntent('Protocolo definitivo: 8821', 'Tests guincho', { status: 'autorizado' }), 'protocol_update', 'Protocolo isolado continua atualizando a corrida ativa');\n"
assert anchor in test, 'protocol test anchor not found'
extra = anchor + "assert.equal(classifyRuntimeIntent('COTAÇÃO\\nPROTOCOLO: COT-998\\nPLACA: ABC1D23\\nORIGEM: Rua Nova, 10, Betim - MG\\nDESTINO: Rua Outra, 20, Contagem - MG', 'Tests guincho', { status: 'autorizado' }), 'quote', 'Protocolo explicitamente enviado como cotacao precisa continuar no fluxo de previa');\n"
test = test.replace(anchor, extra, 1)
test_path.write_text(test, encoding='utf-8')

source_test = Path('tools/test-close-summary-and-protocol-policy.mjs')
source_test.write_text("""import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /Veículo: \\${vehicle/);
assert.match(worker, /Origem: \\${origin}/);
assert.match(worker, /Destino: \\${destination}/);
assert.match(worker, /Valor do serviço:/);
assert.match(worker, /Adicionais confirmados:/);
assert.match(worker, /Valor final:/);
assert.match(worker, /protocolo formal sem correspondencia nao autoriza nada sozinho/i);
assert.match(worker, /await handleQuoteRuntime\\(msg, groupName, readableText, null/);
console.log('CLOSE_SUMMARY_PROTOCOL_POLICY_OK');
""", encoding='utf-8')

print('patch applied')
