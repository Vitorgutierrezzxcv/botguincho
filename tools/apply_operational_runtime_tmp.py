from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

old="import { createLearningStore, inferLearningIntent } from './learning-engine.mjs';"
new=old+"\nimport { classifyRuntimeIntent, resolveGroupProfile, extractOperationalFacts, buildEvidenceChecklist, reconcileCommercial, learningContextForGroup, shouldStaySilent } from './operational-knowledge.mjs';"
if new not in s:
    if old not in s: raise SystemExit('import marker missing')
    s=s.replace(old,new,1)

start=s.index('async function recordDispatchInManagement(')
end=s.index('function maybeCreateFinanceFromCompletedCall', start)
block=r'''async function getGroupKnowledgeEntry(groupId) {
  const all = await learningStore.getAll();
  return all[groupId] || null;
}

function recentManagementCall(state, groupId, maxAgeMs = 48 * 60 * 60 * 1000) {
  const now = Date.now();
  return (state.calls || []).find((call) => {
    if (call.sourceGroupId !== groupId) return false;
    const age = now - new Date(call.updatedAt || call.createdAt || 0).getTime();
    return age >= 0 && age < maxAgeMs && !['concluido','cancelado'].includes(call.status);
  }) || null;
}

async function recordDispatchInManagement({ groupId, groupName, text, originAddress, destinationAddress, eta, status = 'autorizado', facts = null, commercial = null, estimatedTotalKm = null, evidenceChecklist = null }) {
  try {
    const state = await getManagement();
    const parsed = facts || extractOperationalFacts(text);
    const vehicle = parsed.vehicle || extractLabeledField(text, 'Veículo') || extractLabeledField(text, 'Veiculo') || '';
    const service = parsed.service || extractLabeledField(text, 'Serviço') || extractLabeledField(text, 'Servico') || 'Reboque';
    const now = Date.now();
    const dispatchKey = dispatchFingerprint({ groupId, vehicle, service, originAddress, destinationAddress });
    const exact = state.calls.find((call) => {
      const age = now - new Date(call.createdAt || 0).getTime();
      if (call.dispatchKey && call.dispatchKey === dispatchKey && age < 6 * 60 * 60 * 1000) return true;
      return call.sourceGroupId === groupId && age < 30 * 60 * 1000 && call.origin === (originAddress || '') && call.destination === (destinationAddress || '') && !['concluido','cancelado'].includes(call.status);
    });
    const transitionCanAttach = ['aguardando_aprovacao','autorizado','agendado','cancelado','concluido'].includes(status);
    const existing = exact || (transitionCanAttach ? recentManagementCall(state, groupId) : null);
    const knowledge = await getGroupKnowledgeEntry(groupId);
    const checklist = Array.isArray(evidenceChecklist) ? evidenceChecklist : buildEvidenceChecklist(groupName, text);
    const previousChecklist = Array.isArray(existing?.evidenceChecklist) ? existing.evidenceChecklist : [];
    const mergedChecklist = [...previousChecklist];
    for (const item of checklist) {
      if (!mergedChecklist.some((x) => x.label === item.label)) mergedChecklist.push(item);
    }

    let value = Number(existing?.value || 0);
    if (status === 'concluido' && commercial?.status === 'ok' && Number(commercial.calculatedAmount) > 0) value = Number(commercial.calculatedAmount);
    if (status === 'concluido' && commercial?.reviewRequired) value = 0;

    const patch = {
      id: existing?.id || crypto.randomUUID(),
      dispatchKey: existing?.dispatchKey || dispatchKey,
      vehicle: vehicle || existing?.vehicle || 'Veículo não informado',
      vehicleType: parsed.vehicleType || existing?.vehicleType || '',
      plate: parsed.plate || existing?.plate || '',
      service: service || existing?.service || 'Reboque',
      client: groupName || existing?.client || 'Seguradora',
      insurer: groupName || existing?.insurer || '',
      association: parsed.association || existing?.association || '',
      protocol: parsed.protocol || existing?.protocol || '',
      origin: originAddress || parsed.origin || existing?.origin || '',
      destination: destinationAddress || parsed.destination || existing?.destination || '',
      status,
      value,
      source: 'whatsapp',
      sourceGroupId: groupId,
      etaMinutes: eta?.minutes ?? existing?.etaMinutes ?? null,
      distanceKm: eta?.distanceKm ?? existing?.distanceKm ?? null,
      totalKm: parsed.totalKm ?? existing?.totalKm ?? null,
      estimatedTotalKm: estimatedTotalKm ?? existing?.estimatedTotalKm ?? null,
      reportedValue: parsed.centralReportedValue ?? existing?.reportedValue ?? null,
      calculatedValue: commercial?.calculatedAmount ?? existing?.calculatedValue ?? null,
      commercialRuleStatus: knowledge?.commercialStatus || existing?.commercialRuleStatus || 'none',
      financeReviewRequired: commercial?.reviewRequired ?? existing?.financeReviewRequired ?? false,
      financeReviewReason: commercial?.reviewRequired ? `Valor informado diverge do cálculo aprovado em ${commercial.delta ?? 'valor não calculável'}.` : (existing?.financeReviewReason || ''),
      evidenceChecklist: mergedChecklist,
      scheduledAt: parsed.scheduledAt || existing?.scheduledAt || null,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existing) state.calls = state.calls.map((x) => x.id === existing.id ? { ...x, ...patch } : x);
    else state.calls.unshift(patch);
    if (status === 'concluido') maybeCreateFinanceFromCompletedCall(state, patch);
    await saveManagement(state);
    logEvent('management', `${groupName}: chamado ${existing ? 'atualizado' : 'criado'} → ${status}.`, { callId: patch.id, commercialStatus: patch.commercialRuleStatus, financeReviewRequired: patch.financeReviewRequired });
    return patch;
  } catch (error) {
    logEvent('warning', 'Não foi possível registrar o estado operacional na gestão.', { error: String(error) });
    return null;
  }
}

'''
s=s[:start]+block+s[end:]

needle="  const amount = Number(item.value || 0);\n  if (!(amount > 0)) return;"
replace="  const amount = Number(item.value || 0);\n  if (item.financeReviewRequired === true) return;\n  if (!(amount > 0)) return;"
if needle not in s: raise SystemExit('finance guard marker missing')
s=s.replace(needle,replace,1)

needle2="      const savedCall = idx >= 0 ? state[collection][idx] : state[collection][0];\n      maybeCreateFinanceFromCompletedCall(state, savedCall);"
replace2="      const savedCall = idx >= 0 ? state[collection][idx] : state[collection][0];\n      if (body.item?.status === 'concluido' && Number(body.item?.value || 0) > 0) {\n        savedCall.financeReviewRequired = false;\n        savedCall.financeReviewReason = '';\n        savedCall.financeReviewResolvedAt = new Date().toISOString();\n        savedCall.valueSource = 'manual';\n      }\n      maybeCreateFinanceFromCompletedCall(state, savedCall);"
if needle2 not in s: raise SystemExit('manual finance marker missing')
s=s.replace(needle2,replace2,1)

needle3="  const settings = await getSettings();\n  const openai = getAiClient();\n  if (!openai) throw new Error('Credencial OIDC da IA ainda não sincronizada.');"
replace3="  const settings = await getSettings();\n  const openai = getAiClient();\n  if (!openai) throw new Error('Credencial OIDC da IA ainda não sincronizada.');\n  const knowledgeEntry = await getGroupKnowledgeEntry(groupId);\n  const learnedContext = learningContextForGroup(groupName, knowledgeEntry);"
if needle3 not in s: raise SystemExit('ai marker missing')
s=s.replace(needle3,replace3,1)

needle4="    text: `Grupo: ${groupName || groupId}\\nAutor: ${author || 'participante'}\\nHistórico recente:\\n${context || '(sem histórico)'}${live}\\n\\nMensagem atual:\\n${text || '[mensagem sem texto]'}`,"
replace4="    text: `Grupo: ${groupName || groupId}\\nAutor: ${author || 'participante'}\\n\\nCONHECIMENTO APRENDIDO DO GRUPO:\\n${learnedContext}\\n\\nHistórico recente:\\n${context || '(sem histórico)'}${live}\\n\\nMensagem atual:\\n${text || '[mensagem sem texto]'}`,"
if needle4 not in s: raise SystemExit('ai content marker missing')
s=s.replace(needle4,replace4,1)

insert_marker='async function processIncomingMessage(msg) {'
idx=s.index(insert_marker)
handlers=r'''async function currentOperationalContext(groupId, groupName, text) {
  const management = await getManagement();
  const recentCall = recentManagementCall(management, groupId);
  const knowledge = await getGroupKnowledgeEntry(groupId);
  const approvedRules = knowledge?.commercialStatus === 'approved' ? knowledge.approvedCommercialRules : null;
  const facts = extractOperationalFacts(text);
  const intent = classifyRuntimeIntent(text, groupName, recentCall);
  return { management, recentCall, knowledge, approvedRules, facts, intent, profile: resolveGroupProfile(groupName) };
}

async function estimateQuoteRoute(groupId, text, facts, incomingLocation = null) {
  const originAddress = extractLabeledField(text, 'Origem') || facts.origin || null;
  const destinationAddress = extractLabeledField(text, 'Destino') || facts.destination || null;
  const shared = await getRecentSharedLocation(groupId);
  const originCoordinates = incomingLocation || (!originAddress ? shared?.coordinates || null : null);
  let eta = null;
  if (originAddress || originCoordinates) eta = await computeEtaWithRetry({ targetAddress: originAddress, targetCoordinates: originCoordinates });
  let secondLeg = null;
  if (originAddress && destinationAddress) {
    const [from, to] = await Promise.all([geocodeAddress(originAddress), geocodeAddress(destinationAddress)]);
    if (from && to) secondLeg = await routeBetween(from, to).catch(() => null);
  }
  const estimatedTotalKm = eta?.distanceKm != null && secondLeg?.distanceKm != null
    ? Math.round((Number(eta.distanceKm) + Number(secondLeg.distanceKm)) * 10) / 10
    : null;
  return { originAddress, destinationAddress, originCoordinates, eta, secondLeg, estimatedTotalKm };
}

async function handleAvailabilityRuntime(msg, groupName, readableText, incomingLocation, context) {
  const facts = context.facts;
  const hasOpportunityData = Boolean(facts.origin || facts.destination || facts.vehicle || facts.plate || facts.protocol || extractLabeledField(readableText, 'Origem'));
  if (hasOpportunityData) {
    const route = await estimateQuoteRoute(msg.from, readableText, facts, incomingLocation).catch(() => ({ eta: null }));
    await recordDispatchInManagement({
      groupId: msg.from, groupName, text: readableText,
      originAddress: route.originAddress, destinationAddress: route.destinationAddress,
      eta: route.eta, status: 'cotacao', facts,
      estimatedTotalKm: route.estimatedTotalKm,
      evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    });
  }
  await replyAndRemember(msg, groupName, readableText, 'Disponível ✅', { intent: 'availability' });
}

async function handleQuoteRuntime(msg, groupName, readableText, incomingLocation, context) {
  const route = await estimateQuoteRoute(msg.from, readableText, context.facts, incomingLocation).catch((error) => {
    logEvent('warning', 'Falha ao estimar rota da cotação.', { error: String(error), groupId: msg.from });
    return { eta: null, secondLeg: null, estimatedTotalKm: null, originAddress: context.facts.origin || null, destinationAddress: context.facts.destination || null };
  });
  const commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts: context.facts, estimatedTotalKm: route.estimatedTotalKm });
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: route.originAddress, destinationAddress: route.destinationAddress,
    eta: route.eta, status: 'cotacao', facts: context.facts, commercial,
    estimatedTotalKm: route.estimatedTotalKm,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
  });

  const lines = [];
  if (asksAvailability(readableText)) lines.push('Disponível ✅');
  if (route.eta?.minutes) lines.push(`Previsão de chegada: ${route.eta.minutes} min.`);
  if (route.eta?.distanceKm != null) lines.push(`Distância até a origem: ${route.eta.distanceKm} km.`);
  if (route.estimatedTotalKm != null) lines.push(`Percurso estimado do atendimento: ${route.estimatedTotalKm} km.`);
  if (commercial.status === 'ok' && commercial.calculatedAmount != null) lines.push(`Valor estimado: R$ ${Number(commercial.calculatedAmount).toFixed(2).replace('.', ',')}.`);
  else if (/\b(valor|pre[cç]o|quanto fica)\b/i.test(readableText)) lines.push('Valor: em conferência pela tabela comercial.');
  if (!lines.length) lines.push('Cotação recebida ✅');
  await replyAndRemember(msg, groupName, readableText, lines.join('\n'), { intent: 'quote', etaMinutes: route.eta?.minutes ?? null, estimatedTotalKm: route.estimatedTotalKm, commercialStatus: commercial.status });
}

async function handlePendingApprovalRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || context.facts.origin || null,
    destinationAddress: call?.destination || context.facts.destination || null,
    eta: call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: 'aguardando_aprovacao', facts: context.facts,
  });
  await replyAndRemember(msg, groupName, readableText, 'Certo, aguardando autorização.', { intent: 'pending_approval' });
}

async function handleAuthorizationRuntime(msg, groupName, readableText, incomingLocation, context) {
  if (context.intent === 'formal_dispatch' || looksLikeDispatch(readableText)) {
    await handleDispatch(msg, groupName, readableText, incomingLocation);
    return;
  }
  const call = context.recentCall;
  let eta = null;
  if (call?.origin) eta = await computeEtaWithRetry({ targetAddress: call.origin }).catch(() => null);
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || null, destinationAddress: call?.destination || null,
    eta, status: 'autorizado', facts: context.facts,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
  });
  await replyAndRemember(msg, groupName, readableText, eta ? formatEtaReply(eta, true) : 'Confirmado ✅', { intent: 'authorization', etaMinutes: eta?.minutes ?? null });
}

async function handleScheduledRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: context.facts.origin || call?.origin || null,
    destinationAddress: context.facts.destination || call?.destination || null,
    eta: null, status: 'agendado', facts: context.facts,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
  });
  await replyAndRemember(msg, groupName, readableText, 'Agendamento registrado ✅', { intent: 'scheduled_dispatch', scheduledAt: context.facts.scheduledAt });
}

async function handleCancellationRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || null, destinationAddress: call?.destination || null,
    eta: null, status: 'cancelado', facts: context.facts,
  });
  await replyAndRemember(msg, groupName, readableText, 'Entendido.', { intent: 'cancellation' });
}

async function handleClosureRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  const facts = {
    ...context.facts,
    vehicleType: context.facts.vehicleType || call?.vehicleType || null,
    totalKm: context.facts.totalKm ?? call?.totalKm ?? null,
  };
  const commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts });
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || facts.origin || null,
    destinationAddress: call?.destination || facts.destination || null,
    eta: call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: 'concluido', facts, commercial,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
  });
  if (commercial.reviewRequired) {
    logEvent('finance-review', `${groupName}: fechamento exige conferência financeira.`, { callId: saved?.id, calculated: commercial.calculatedAmount, reported: commercial.reportedAmount, delta: commercial.delta });
  }
  await replyAndRemember(msg, groupName, readableText, 'Recebido ✅', { intent: 'closure', financeReviewRequired: commercial.reviewRequired, commercialStatus: commercial.status });
}

'''
s=s[:idx]+handlers+s[idx:]

start2=s.index('    // Em grupos de assistência é comum enviarem todos os dados do serviço')
end2=s.index('    if (asksEta(readableText))', start2)
newflow=r'''    const operationalContext = await currentOperationalContext(msg.from, groupName, readableText);
    const runtimeIntent = operationalContext.intent;

    if (shouldStaySilent(runtimeIntent, groupName)) {
      logEvent('ignored', `${groupName}: comunicado administrativo aprendido sem resposta.`, { groupId: msg.from, intent: runtimeIntent });
      return;
    }

    if (runtimeIntent === 'quote') {
      await handleQuoteRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'availability') {
      await handleAvailabilityRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'pending_approval') {
      await handlePendingApprovalRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'scheduled_dispatch') {
      await handleScheduledRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'cancellation') {
      await handleCancellationRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'closure') {
      await handleClosureRuntime(msg, groupName, readableText, operationalContext);
      return;
    }
    if (runtimeIntent === 'authorization' || runtimeIntent === 'formal_dispatch') {
      await handleAuthorizationRuntime(msg, groupName, readableText, incomingLocation, operationalContext);
      return;
    }
    if (runtimeIntent === 'dispatch' && looksLikeDispatch(readableText)) {
      await handleDispatch(msg, groupName, readableText, incomingLocation);
      return;
    }

'''
s=s[:start2]+newflow+s[end2:]

p.write_text(s)
print('OPERATIONAL_RUNTIME_PATCH_OK')
