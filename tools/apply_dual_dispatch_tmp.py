from pathlib import Path

WORKER = Path('tools/vercel-whatsapp-worker.mjs')
RELOAD = Path('api/worker/reload.js')

text = WORKER.read_text()

old_import = "import { sanitizeBillingProfile, ensureBillingProfile, settlementForCall, upsertBillingBatch, financeEntryFromCall, sanitizeBillingBatch, updateBatchTemporalStatuses, closureReply } from './financial-engine.mjs';\n"
new_import = old_import + "import { MAX_CONCURRENT_CALLS, isCapacityActiveCall, activeCallsForCapacity, capacitySnapshot, plannedRemainingMinutes, capSecondCallEta } from './dispatch-capacity.mjs';\n"
if "./dispatch-capacity.mjs" not in text:
    if old_import not in text:
        raise SystemExit('financial import marker not found')
    text = text.replace(old_import, new_import, 1)

marker = "async function recordDispatchInManagement({"
if "async function estimateSecondCallArrival" not in text:
    pos = text.find(marker)
    if pos < 0:
        raise SystemExit('recordDispatch marker not found')
    helpers = r'''function oldestActiveManagementCallForGroup(state, groupId) {
  return activeCallsForCapacity(state).find((call) => call.sourceGroupId === groupId) || null;
}

function routePointCoordinates(point) {
  if (!point || !validCoordinates(point.latitude, point.longitude)) return null;
  return { latitude: Number(point.latitude), longitude: Number(point.longitude) };
}

async function estimateSecondCallArrival({ management, targetAddress = null, targetCoordinates = null, excludeCallId = '' } = {}) {
  const capacity = capacitySnapshot(management, excludeCallId);
  if (!capacity.canAccept) {
    return { available: false, activeCount: capacity.activeCount, slotsAvailable: 0, eta: null };
  }

  if (capacity.activeCount === 0) {
    const direct = (targetAddress || targetCoordinates)
      ? await computeEtaWithRetry({ targetAddress, targetCoordinates }).catch(() => null)
      : null;
    return { available: true, activeCount: 0, slotsAvailable: capacity.slotsAvailable, eta: direct, queued: false };
  }

  // Há exatamente uma corrida ativa. A segunda pode ser aceita e entra na fila operacional.
  const current = capacity.activeCalls[0];
  let nextOrigin = targetCoordinates && validCoordinates(targetCoordinates.latitude, targetCoordinates.longitude)
    ? { latitude: Number(targetCoordinates.latitude), longitude: Number(targetCoordinates.longitude) }
    : null;
  if (!nextOrigin && targetAddress) nextOrigin = await geocodeAddress(targetAddress).catch(() => null);

  let activeDestination = routePointCoordinates(current?.routeBreakdown?.destination);
  if (!activeDestination && current?.destination) activeDestination = await geocodeAddress(current.destination).catch(() => null);

  const plannedRemaining = plannedRemainingMinutes(current);
  let liveRemaining = null;
  const reading = await getFreshTrackerReading().catch(() => null);
  const liveTruck = reading ? await trackerCoordinates(reading).catch(() => null) : null;
  if (liveTruck && activeDestination) {
    const liveRoute = await routeBetween(liveTruck, activeDestination).catch(() => null);
    liveRemaining = liveRoute?.minutes ?? null;
  }

  const remainingCandidates = [plannedRemaining, liveRemaining]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  let remainingToFinish = remainingCandidates.length ? Math.max(...remainingCandidates) : null;

  let handoff = null;
  if (activeDestination && nextOrigin) handoff = await routeBetween(activeDestination, nextOrigin).catch(() => null);

  const rawMinutes = Number.isFinite(Number(remainingToFinish)) && Number.isFinite(Number(handoff?.minutes))
    ? Number(remainingToFinish) + Number(handoff.minutes)
    : null;
  const capped = capSecondCallEta(rawMinutes, 60);
  const eta = {
    minutes: capped.minutes,
    rawMinutes: capped.rawMinutes,
    cappedAtOneHour: capped.cappedAtOneHour,
    queued: true,
    distanceKm: handoff?.distanceKm ?? null,
    precedingCallId: current?.id || null,
    precedingGroupId: current?.sourceGroupId || null,
    remainingPreviousMinutes: remainingToFinish,
    handoffMinutes: handoff?.minutes ?? null,
  };
  return {
    available: true,
    activeCount: 1,
    slotsAvailable: capacity.slotsAvailable,
    queued: true,
    eta,
    precedingCall: current,
  };
}

'''
    text = text[:pos] + helpers + text[pos:]

text = text.replace(
"async function recordDispatchInManagement({ groupId, groupName, text, originAddress, destinationAddress, originCoordinates = null, eta, status = 'autorizado', facts = null, commercial = null, estimatedTotalKm = null, evidenceChecklist = null }) {",
"async function recordDispatchInManagement({ groupId, groupName, text, originAddress, destinationAddress, originCoordinates = null, eta, status = 'autorizado', facts = null, commercial = null, estimatedTotalKm = null, evidenceChecklist = null, existingCallId = null }) {",
1)

old_existing = """    const transitionCanAttach = ['aguardando_aprovacao','autorizado','agendado','cancelado','concluido'].includes(status);\n    const existing = exact || (transitionCanAttach ? recentManagementCall(state, groupId) : null);\n"""
new_existing = """    const transitionCanAttach = ['aguardando_aprovacao','autorizado','agendado','cancelado','concluido'].includes(status);\n    const explicitExisting = existingCallId ? state.calls.find((call) => call.id === existingCallId) || null : null;\n    const recent = recentManagementCall(state, groupId);\n    const recentCanAttach = transitionCanAttach && recent && !(status === 'autorizado' && isCapacityActiveCall(recent));\n    const existing = explicitExisting || exact || (recentCanAttach ? recent : null);\n"""
if old_existing not in text:
    raise SystemExit('existing selection marker not found')
text = text.replace(old_existing, new_existing, 1)

old_completed = "      completedAt: status === 'concluido' ? new Date().toISOString() : (existing?.completedAt || null),\n      createdAt: existing?.createdAt || new Date().toISOString(),"
new_completed = "      completedAt: status === 'concluido' ? new Date().toISOString() : (existing?.completedAt || null),\n      authorizedAt: status === 'autorizado' ? (existing?.authorizedAt || new Date().toISOString()) : (existing?.authorizedAt || null),\n      createdAt: existing?.createdAt || new Date().toISOString(),"
if old_completed not in text:
    raise SystemExit('completedAt marker not found')
text = text.replace(old_completed, new_completed, 1)

old_context = """async function currentOperationalContext(groupId, groupName, text) {\n  const management = await getManagement();\n  const recentCall = recentManagementCall(management, groupId);\n  const knowledge = await getGroupKnowledgeEntry(groupId);\n  const approvedRules = knowledge?.commercialStatus === 'approved' ? knowledge.approvedCommercialRules : null;\n  const billingProfile = ensureBillingProfile(management, groupId, groupName);\n  const facts = extractOperationalFacts(text);\n  const intent = classifyRuntimeIntent(text, groupName, recentCall);\n  return { management, recentCall, knowledge, approvedRules, billingProfile, facts, intent, profile: resolveGroupProfile(groupName) };\n}\n"""
new_context = """async function currentOperationalContext(groupId, groupName, text) {\n  const management = await getManagement();\n  const provisionalRecentCall = recentManagementCall(management, groupId);\n  const knowledge = await getGroupKnowledgeEntry(groupId);\n  const approvedRules = knowledge?.commercialStatus === 'approved' ? knowledge.approvedCommercialRules : null;\n  const billingProfile = ensureBillingProfile(management, groupId, groupName);\n  const facts = extractOperationalFacts(text);\n  const provisionalIntent = classifyRuntimeIntent(text, groupName, provisionalRecentCall);\n  const recentCall = provisionalIntent === 'closure'\n    ? (oldestActiveManagementCallForGroup(management, groupId) || provisionalRecentCall)\n    : provisionalRecentCall;\n  const intent = classifyRuntimeIntent(text, groupName, recentCall);\n  return { management, recentCall, knowledge, approvedRules, billingProfile, facts, intent, profile: resolveGroupProfile(groupName) };\n}\n"""
if old_context not in text:
    raise SystemExit('context marker not found')
text = text.replace(old_context, new_context, 1)

old_format = """function formatEtaReply(eta, withConfirmation = false) {\n  if (!eta?.minutes) return withConfirmation ? 'Confirmado ✅' : null;\n  const etaLine = `Previsão de chegada: ${eta.minutes} min.`;\n  return withConfirmation ? `Confirmado ✅\\n${etaLine}` : etaLine;\n}\n"""
new_format = """function formatEtaReply(eta, withConfirmation = false) {\n  if (!eta?.minutes) return withConfirmation ? 'Confirmado ✅' : null;\n  const etaLine = eta.cappedAtOneHour\n    ? 'Previsão de chegada: 1h.'\n    : `Previsão de chegada: ${eta.minutes} min.`;\n  return withConfirmation ? `Confirmado ✅\\n${etaLine}` : etaLine;\n}\n"""
if old_format not in text:
    raise SystemExit('formatEtaReply marker not found')
text = text.replace(old_format, new_format, 1)

# Replace a function by boundaries.
def replace_function(source, start_marker, next_marker, replacement):
    start = source.find(start_marker)
    if start < 0:
        raise SystemExit(f'start marker not found: {start_marker}')
    end = source.find(next_marker, start)
    if end < 0:
        raise SystemExit(f'next marker not found: {next_marker}')
    return source[:start] + replacement.rstrip() + '\n\n' + source[end:]

new_dispatch = r'''async function handleDispatch(msg, groupName, readableText, location) {
  const originAddress = extractLabeledField(readableText, 'Origem');
  const destinationAddress = extractLabeledField(readableText, 'Destino');
  if (originAddress && isExplicitlyOutOfCoverage(originAddress)) {
    await replyAndRemember(msg, groupName, readableText, `Fora da área de atendimento. Atendemos somente ${configuredServiceState}.`, { intent: 'dispatch-out-of-coverage', originAddress });
    return;
  }
  const shared = await getRecentSharedLocation(msg.from);
  const originCoordinates = location || (!originAddress ? shared?.coordinates || null : null);
  const originMoment = originCoordinates && !originAddress && shared?.at
    ? new Date(shared.at).toISOString()
    : new Date().toISOString();
  const vehicle = extractLabeledField(readableText, 'Veículo') || extractLabeledField(readableText, 'Veiculo') || '';
  const service = extractLabeledField(readableText, 'Serviço') || extractLabeledField(readableText, 'Servico') || 'Reboque';

  const management = await getManagement();
  const arrival = await estimateSecondCallArrival({
    management,
    targetAddress: originAddress || null,
    targetCoordinates: originCoordinates || null,
  });
  if (!arrival.available) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: arrival.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    logEvent('capacity', `${groupName}: terceira corrida recusada; limite simultâneo atingido.`, { groupId: msg.from, activeCount: arrival.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const dispatchKey = dispatchFingerprint({ groupId: msg.from, vehicle, service, originAddress, destinationAddress });
  const previousState = await getDispatchState(msg.from);
  const dispatchId = previousState?.activeDispatchKey === dispatchKey && previousState?.activeDispatchId
    ? previousState.activeDispatchId
    : crypto.randomUUID();

  const state = await setDispatchState(msg.from, {
    activeDispatchId: dispatchId,
    activeDispatchKey: dispatchKey,
    activeDispatchStartedAt: previousState?.activeDispatchKey === dispatchKey ? previousState.activeDispatchStartedAt : new Date().toISOString(),
    originAddress: originAddress || null,
    originCoordinates: originCoordinates || null,
    destinationAddress: destinationAddress || null,
    originUpdatedAt: originMoment,
  });

  const eta = arrival.eta;
  if (eta) {
    await setDispatchState(msg.from, { lastEta: eta, lastEtaAt: new Date().toISOString() });
    logEvent('route', `${groupName}: ETA ${eta.cappedAtOneHour ? '1h (limite operacional)' : `${eta.minutes} min`}.`, { groupId: msg.from, queued: eta.queued === true, rawMinutes: eta.rawMinutes ?? eta.minutes });
  }

  await recordDispatchInManagement({
    groupId: msg.from,
    groupName,
    text: readableText,
    originAddress: state.originAddress,
    originCoordinates: state.originCoordinates,
    destinationAddress: state.destinationAddress,
    eta,
  });

  const reply = eta
    ? formatEtaReply(eta, true)
    : 'Confirmado ✅\nEstou atualizando a localização para calcular a previsão.';
  await replyAndRemember(msg, groupName, readableText, reply, {
    intent: eta ? 'dispatch' : 'dispatch-safe-mode',
    etaMinutes: eta?.minutes ?? null,
    queued: eta?.queued === true,
    rawEtaMinutes: eta?.rawMinutes ?? eta?.minutes ?? null,
    dispatchId,
    dispatchKey,
  });
}'''
text = replace_function(text, 'async function handleDispatch(', 'function looksLikeAddressCandidate(', new_dispatch)

new_availability = r'''async function handleAvailabilityRuntime(msg, groupName, readableText, incomingLocation, context) {
  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const facts = context.facts;
  const hasOpportunityData = Boolean(facts.origin || facts.destination || facts.vehicle || facts.plate || facts.protocol || extractLabeledField(readableText, 'Origem'));
  if (hasOpportunityData) {
    const route = await estimateQuoteRoute(msg.from, readableText, facts, incomingLocation).catch(() => ({ eta: null }));
    if (capacity.activeCount === 1 && (route.originAddress || route.originCoordinates)) {
      const queued = await estimateSecondCallArrival({
        management: context.management,
        targetAddress: route.originAddress,
        targetCoordinates: route.originCoordinates,
      });
      if (queued.eta) route.eta = queued.eta;
    }
    await recordDispatchInManagement({
      groupId: msg.from, groupName, text: readableText,
      originAddress: route.originAddress, originCoordinates: route.originCoordinates, destinationAddress: route.destinationAddress,
      eta: route.eta, status: 'cotacao', facts,
      estimatedTotalKm: route.estimatedTotalKm,
      evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    });
  }
  await replyAndRemember(msg, groupName, readableText, 'Disponível ✅', { intent: 'availability', activeCount: capacity.activeCount, slotsAfterAccept: Math.max(0, capacity.slotsAvailable - 1) });
}'''
text = replace_function(text, 'async function handleAvailabilityRuntime(', 'async function handleQuoteRuntime(', new_availability)

new_quote = r'''async function handleQuoteRuntime(msg, groupName, readableText, incomingLocation, context) {
  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const route = await estimateQuoteRoute(msg.from, readableText, context.facts, incomingLocation).catch((error) => {
    logEvent('warning', 'Falha ao estimar rota da cotação.', { error: String(error), groupId: msg.from });
    return { eta: null, secondLeg: null, estimatedTotalKm: null, originAddress: context.facts.origin || null, destinationAddress: context.facts.destination || null };
  });
  if (capacity.activeCount === 1 && (route.originAddress || route.originCoordinates)) {
    const queued = await estimateSecondCallArrival({
      management: context.management,
      targetAddress: route.originAddress,
      targetCoordinates: route.originCoordinates,
    });
    if (queued.eta) route.eta = queued.eta;
  }

  const pricingKm = context.billingProfile?.routeBasis === 'origin_destination'
    ? (route.secondLeg?.distanceKm ?? null)
    : context.billingProfile?.routeBasis === 'insurer_reported'
      ? (context.facts.totalKm ?? null)
      : context.billingProfile?.routeBasis === 'manual'
        ? null
        : route.estimatedTotalKm;
  const commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts: { ...context.facts, totalKm: pricingKm ?? context.facts.totalKm }, estimatedTotalKm: pricingKm });
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: route.originAddress, originCoordinates: route.originCoordinates || null, destinationAddress: route.destinationAddress,
    eta: route.eta, status: 'cotacao', facts: context.facts, commercial,
    estimatedTotalKm: route.estimatedTotalKm,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
  });

  const lines = [];
  if (asksAvailability(readableText)) lines.push('Disponível ✅');
  if (route.eta?.minutes) lines.push(formatEtaReply(route.eta, false));
  if (!route.eta?.queued && route.eta?.distanceKm != null) lines.push(`Distância até a origem: ${route.eta.distanceKm} km.`);
  if (route.estimatedTotalKm != null) lines.push(`Percurso estimado do atendimento: ${route.estimatedTotalKm} km.`);
  if (commercial.status === 'ok' && commercial.calculatedAmount != null) lines.push(`Valor estimado: R$ ${Number(commercial.calculatedAmount).toFixed(2).replace('.', ',')}.`);
  else if (/\b(valor|pre[cç]o|quanto fica)\b/i.test(readableText)) lines.push('Valor: em conferência pela tabela comercial.');
  if (!lines.length) lines.push('Cotação recebida ✅');
  await replyAndRemember(msg, groupName, readableText, lines.join('\n'), { intent: 'quote', etaMinutes: route.eta?.minutes ?? null, queued: route.eta?.queued === true, rawEtaMinutes: route.eta?.rawMinutes ?? route.eta?.minutes ?? null, estimatedTotalKm: route.estimatedTotalKm, commercialStatus: commercial.status });
}'''
text = replace_function(text, 'async function handleQuoteRuntime(', 'async function handlePendingApprovalRuntime(', new_quote)

# Add existingCallId to transition handlers via exact small replacements.
text = text.replace(
"    status: 'aguardando_aprovacao', facts: context.facts,\n  });",
"    status: 'aguardando_aprovacao', facts: context.facts, existingCallId: call?.id || null,\n  });",
1)

new_authorization = r'''async function handleAuthorizationRuntime(msg, groupName, readableText, incomingLocation, context) {
  if (context.intent === 'formal_dispatch' || looksLikeDispatch(readableText)) {
    await handleDispatch(msg, groupName, readableText, incomingLocation);
    return;
  }
  const call = context.recentCall;

  // Uma autorização repetida do mesmo chamado não consome uma nova vaga.
  if (call && isCapacityActiveCall(call)) {
    const eta = call.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm, queued: call.queued === true } : null;
    await replyAndRemember(msg, groupName, readableText, eta ? formatEtaReply(eta, true) : 'Confirmado ✅', { intent: 'authorization-repeat', callId: call.id });
    return;
  }

  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const targetAddress = call?.origin || context.facts.origin || null;
  const targetCoordinates = call?.originCoordinates || incomingLocation || null;
  const arrival = await estimateSecondCallArrival({
    management: context.management,
    targetAddress,
    targetCoordinates,
  });
  if (!arrival.available) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: arrival.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }
  const eta = arrival.eta;
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: targetAddress, originCoordinates: targetCoordinates, destinationAddress: call?.destination || context.facts.destination || null,
    eta, status: 'autorizado', facts: context.facts,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null,
  });
  if (saved && eta?.queued) {
    saved.queued = true;
    saved.precedingCallId = eta.precedingCallId || null;
  }
  await replyAndRemember(msg, groupName, readableText, eta ? formatEtaReply(eta, true) : 'Confirmado ✅', { intent: 'authorization', etaMinutes: eta?.minutes ?? null, queued: eta?.queued === true, rawEtaMinutes: eta?.rawMinutes ?? eta?.minutes ?? null, precedingCallId: eta?.precedingCallId ?? null });
}'''
text = replace_function(text, 'async function handleAuthorizationRuntime(', 'async function handleScheduledRuntime(', new_authorization)

text = text.replace(
"    eta: null, status: 'agendado', facts: context.facts,\n    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),\n  });",
"    eta: null, status: 'agendado', facts: context.facts,\n    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null,\n  });",
1)
text = text.replace(
"    eta: null, status: 'cancelado', facts: context.facts,\n  });",
"    eta: null, status: 'cancelado', facts: context.facts, existingCallId: call?.id || null,\n  });",
1)
text = text.replace(
"    estimatedTotalKm: automaticKm,\n    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),\n  });",
"    estimatedTotalKm: automaticKm,\n    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null,\n  });",
1)

WORKER.write_text(text)

reload = RELOAD.read_text()
if "'tools/dispatch-capacity.mjs'" not in reload:
    marker = "  'tools/financial-engine.mjs',\n"
    if marker not in reload:
        raise SystemExit('reload runtime marker not found')
    reload = reload.replace(marker, marker + "  'tools/dispatch-capacity.mjs',\n", 1)
RELOAD.write_text(reload)

print('DUAL_DISPATCH_PATCHED')
