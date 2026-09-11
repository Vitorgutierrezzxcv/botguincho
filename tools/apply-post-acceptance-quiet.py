from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = ROOT / 'tools/vercel-whatsapp-worker.mjs'

w = worker.read_text(encoding='utf-8')


def insert_after_once(text, anchor, addition, label):
    if addition.strip() in text:
        return text
    if anchor not in text:
        raise SystemExit(f'{label} anchor not found')
    return text.replace(anchor, anchor + addition, 1)


def replace_between(text, start_anchor, end_anchor, replacement, label):
    start = text.find(start_anchor)
    if start < 0:
        raise SystemExit(f'{label} start anchor not found')
    end = text.find(end_anchor, start)
    if end < 0:
        raise SystemExit(f'{label} end anchor not found')
    return text[:start] + replacement + text[end:]


# 1) Estado pós-aceite: só uma solicitação realmente nova pode reabrir cotação/acionamento.
flow_anchor = """function isFlowActiveCall(call = {}) {\n  return FLOW_ACTIVE_STATUSES.has(String(call?.status || '').toLowerCase());\n}\n"""
flow_helpers = """

function isAcceptedOperationalCall(call = {}) {
  return ['autorizado', 'a_caminho', 'em_atendimento', 'aguardando_fechamento'].includes(String(call?.status || '').toLowerCase());
}

function looksLikeDistinctNewServiceRequest(text = '', activeCall = null) {
  const value = normalizeForIntent(text);
  if (/\\b(?:novo|nova|outro|outra)\\s+(?:atendimento|corrida|chamado|acionamento|cotacao|solicitacao)\\b/.test(value)) return true;

  const facts = extractOperationalFacts(text);
  const hasCompleteRequest = Boolean(facts?.origin && facts?.destination && (facts?.vehicle || facts?.vehicleType || facts?.plate));
  if (!hasCompleteRequest || !activeCall) return false;

  const compact = (item = '') => normalizeForIntent(String(item || '')).replace(/[^a-z0-9]+/g, ' ').trim();
  const token = (item = '') => String(item || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const incomingProtocol = token(facts.protocol);
  const activeProtocol = token(activeCall.protocol);
  const incomingPlate = token(facts.plate);
  const activePlate = token(activeCall.plate);

  if (incomingProtocol && activeProtocol && incomingProtocol !== activeProtocol) return true;
  if (incomingPlate && activePlate && incomingPlate !== activePlate) return true;
  if (activeCall.origin && compact(facts.origin) !== compact(activeCall.origin)) return true;
  if (activeCall.destination && compact(facts.destination) !== compact(activeCall.destination)) return true;
  return false;
}
"""
w = insert_after_once(w, flow_anchor, flow_helpers, 'accepted-flow helpers')

# 2) Marcadores persistentes de comunicação. Evitam repetir ACK após múltiplas fotos,
#    protocolo repetido, webhook duplicado ou recuperação da sessão do WhatsApp.
reply_anchor = """async function replyAndRemember(msg, groupName, incomingText, reply, meta = {}) {\n  botReplyFingerprints.set(`${msg.from}|${normalizeForIntent(reply)}`, Date.now());\n  await msg.reply(reply);\n  remember(msg.from, 'user', incomingText);\n  remember(msg.from, 'assistant', reply);\n  logEvent('reply', `${groupName}: ${reply}`, { groupId: msg.from, ...meta });\n}\n"""
marker_helper = """

async function persistCallReplyMarker(callId, patch = {}) {
  if (!callId || !patch || typeof patch !== 'object') return null;
  const state = await getManagement();
  const call = (state.calls || []).find((item) => item.id === callId && !item?.deletedAt);
  if (!call) return null;
  Object.assign(call, patch, { updatedAt: new Date().toISOString() });
  await saveManagement(state);
  return call;
}
"""
w = insert_after_once(w, reply_anchor, marker_helper, 'reply marker helper')

# 3) Protocolo de uma corrida já conhecida é somente vínculo/ACK.
#    Não recalcula ETA, KM ou valor e não volta para handleQuoteRuntime quando a
#    oportunidade já existe, mesmo que o painel ainda esteja em aguardando_aprovacao.
protocol_function_start = "async function handleProtocolRuntime(msg, groupName, readableText, context) {"
protocol_function_end = "\n}\n\nasync function handleAuthorizationRuntime"
protocol_old = w[w.find(protocol_function_start):w.find(protocol_function_end, w.find(protocol_function_start)) + 2]
if not protocol_old:
    raise SystemExit('protocol function not found')

pending_reroute = """  // Se o protocolo corresponde a uma oportunidade ainda nao autorizada, atualiza\n  // aquela mesma cotacao e devolve a previa completa. Nunca transforma protocolo em autorizacao.\n  if (call && ['cotacao','aguardando_dados','aguardando_aprovacao'].includes(call.status)) {\n    await handleQuoteRuntime(msg, groupName, readableText, null, {\n      ...context,\n      recentCall: call,\n      intent: 'quote',\n    });\n    return;\n  }\n"""
if pending_reroute in protocol_old:
    protocol_old = protocol_old.replace(pending_reroute, '', 1)

protocol_tail_start = "  const status = call?.status || 'aguardando_aprovacao';"
protocol_tail_pos = protocol_old.find(protocol_tail_start)
if protocol_tail_pos < 0:
    raise SystemExit('protocol tail anchor not found')
protocol_head = protocol_old[:protocol_tail_pos]
protocol_tail = """  const status = call?.status || 'aguardando_aprovacao';
  const flowActive = isFlowActiveCall(call);
  const nextOrigin = context.facts.origin || call?.origin || null;
  const nextOriginCoordinates = context.facts.origin ? null : (call?.originCoordinates || null);
  const nextDestination = context.facts.destination || call?.destination || null;

  // PROTOCOLO_E_SOMENTE_VINCULO: uma corrida já conhecida conserva a cotação,
  // a rota e a previsão existentes. Receber/anexar protocolo não é um novo pedido
  // de preço e não autoriza reexibir ETA, km ou valor.
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: nextOrigin,
    originCoordinates: nextOriginCoordinates,
    destinationAddress: nextDestination,
    eta: null,
    status, facts: context.facts, existingCallId: call?.id || null,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    eventType: call ? 'protocolo_atualizado' : 'protocolo_recebido',
    phase: call?.operationalPhase || 'aguardando_autorizacao',
  });

  if (saved && flowActive && saved.protocol) {
    await notifyDriverOfConfirmedCall(saved, { force: saved.protocol !== call?.protocol });
  }

  const protocolValue = String(protocolIdentity.protocol || saved?.protocol || '').trim();
  const protocolFingerprint = normalizeForIntent(protocolValue || readableText);
  const alreadyAcknowledged = Boolean(
    call?.protocolAckFingerprint
    && protocolFingerprint
    && call.protocolAckFingerprint === protocolFingerprint
  );
  if (alreadyAcknowledged) {
    logEvent('dedupe', `${groupName}: protocolo já confirmado; ACK repetido suprimido.`, {
      groupId: msg.from, callId: saved?.id || call?.id || null, protocol: protocolValue || null,
    });
    return;
  }

  const reply = call
    ? `${protocolValue ? `Protocolo ${protocolValue} ` : 'Protocolo '}recebido e vinculado ao atendimento ✅`
    : `${protocolValue ? `Protocolo ${protocolValue} ` : 'Protocolo '}recebido e registrado ✅`;
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: context.intent,
    authorizationRequired: !call || (!flowActive && call?.status !== 'concluido'),
    callId: saved?.id || call?.id || null,
    protocolOnlyAck: true,
  });
  if (saved?.id) {
    await persistCallReplyMarker(saved.id, {
      protocolAckFingerprint: protocolFingerprint,
      protocolAckSentAt: new Date().toISOString(),
    });
  }
}"""
protocol_new = protocol_head + protocol_tail
w = w.replace(w[w.find(protocol_function_start):w.find(protocol_function_end, w.find(protocol_function_start)) + 2], protocol_new, 1)

# 4) Evidências/fotos: registra todas, mas responde no máximo uma vez por corrida.
evidence_start = "async function handleEvidenceRuntime(msg, groupName, readableText, context, hasMedia = false) {"
evidence_end = "\n\nasync function handleAddressUpdateRuntime"
evidence_new = """async function handleEvidenceRuntime(msg, groupName, readableText, context, hasMedia = false) {
  const call = context.recentCall;
  const alreadyAcknowledged = Boolean(call?.evidenceAckSentAt);
  const baseChecklist = Array.isArray(call?.evidenceChecklist) && call.evidenceChecklist.length
    ? call.evidenceChecklist
    : buildEvidenceChecklist(groupName, readableText);
  const checklist = markEvidenceChecklist(baseChecklist, readableText, hasMedia);
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText, originAddress: call?.origin || null,
    destinationAddress: call?.destination || null, eta: null, status: call?.status || 'em_atendimento', facts: context.facts,
    existingCallId: call?.id || null, evidenceChecklist: checklist,
    eventType: 'evidencia_recebida', phase: call?.status === 'concluido' ? 'concluido' : 'evidencias',
  });

  // Todas as mídias continuam sendo anexadas ao atendimento. Só o texto de
  // confirmação é idempotente para não responder a cada uma das quatro fotos.
  if (alreadyAcknowledged) {
    logEvent('dedupe', `${groupName}: evidência adicional registrada sem repetir confirmação.`, {
      groupId: msg.from, callId: saved?.id || call?.id || null, hasMedia,
    });
    return;
  }

  const reply = hasMedia
    ? 'Fotos recebidas e vinculadas ao atendimento ✅'
    : 'Evidências recebidas e vinculadas ao atendimento ✅';
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: 'evidence', callId: saved?.id || call?.id || null, evidenceOnlyAck: true,
  });
  if (saved?.id) {
    await persistCallReplyMarker(saved.id, {
      evidenceAckSentAt: new Date().toISOString(),
    });
  }
}"""
w = replace_between(w, evidence_start, evidence_end, evidence_new, 'evidence handler')

# 5) Guarda central: depois do aceite, mídia entra como evidência e mensagens da
#    própria corrida que forem classificadas erroneamente como cotação/acionamento
#    não podem reapresentar ETA/KM/valor. Uma nova corrida claramente distinta passa.
dispatch_anchor = """    const operationalContext = await currentOperationalContext(msg.from, groupName, readableText);\n    const runtimeIntent = operationalContext.intent;\n"""
quiet_guard = """

    const acceptedContextCall = isAcceptedOperationalCall(operationalContext.recentCall)
      ? operationalContext.recentCall
      : null;

    // FOTO_NAO_REABRE_COTACAO: fotos chegam em mensagens separadas e podem ter
    // legenda/quoted message suficiente para confundir o classificador. Depois do
    // aceite elas são evidência, salvo quando a legenda é uma pergunta operacional
    // explícita que precisa de resposta.
    const mediaQuestionIntent = new Set([
      'eta', 'value_summary', 'closure', 'cancellation', 'address_update',
      'dirt_road_start', 'dirt_road_end', 'arrival_without_tow',
    ]);
    if (imageDataUrl && acceptedContextCall && !mediaQuestionIntent.has(runtimeIntent)) {
      await handleEvidenceRuntime(msg, groupName, readableText, operationalContext, true);
      return;
    }

    // POS_ACEITE_SEM_REPETICAO: após autorização, atualizações da mesma corrida
    // não podem voltar aos handlers que anunciam cotação, ETA, km e valor. Só
    // liberamos esse caminho quando o texto identifica claramente uma nova corrida.
    const postAcceptanceNoiseIntents = new Set([
      'quote', 'dispatch', 'dispatch_details', 'incomplete_dispatch', 'formal_dispatch',
    ]);
    if (acceptedContextCall
      && postAcceptanceNoiseIntents.has(runtimeIntent)
      && !looksLikeDistinctNewServiceRequest(readableText, acceptedContextCall)) {
      logEvent('ignored', `${groupName}: atualização pós-aceite não reabriu cotação nem repetiu ETA/KM/valor.`, {
        groupId: msg.from, callId: acceptedContextCall.id, intent: runtimeIntent,
      });
      return;
    }
"""
w = insert_after_once(w, dispatch_anchor, quiet_guard, 'post-acceptance guard')

# 6) Reforço para o fallback de IA em modo completo.
ai_rule_anchor = """- Consulta, cotação, dados recebidos, aguardando autorização, autorização, saída, chegada, ocorrência, evidência e fechamento são estados diferentes. Nunca reinicie o fluxo por causa de uma atualização.\n"""
ai_rule_extra = """- Depois que uma corrida estiver autorizada, nunca reapresente valor, quilometragem ou previsão sem pergunta explícita. Protocolo e fotos/evidências são apenas anexos da corrida existente.\n"""
w = insert_after_once(w, ai_rule_anchor, ai_rule_extra, 'AI post-acceptance rule')

worker.write_text(w, encoding='utf-8')
print('Post-acceptance quiet/protocol/evidence patch applied.')
