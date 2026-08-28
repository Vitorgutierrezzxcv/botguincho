from pathlib import Path

worker = Path('tools/vercel-whatsapp-worker.mjs')
s = worker.read_text()

old = "import { classifyRuntimeIntent, resolveGroupProfile, extractOperationalFacts, buildEvidenceChecklist, markEvidenceChecklist, appendOperationalTimeline, calculateApprovedCommercial, reconcileCommercial, learningContextForGroup, shouldStaySilent } from './operational-knowledge.mjs';"
new = "import { classifyRuntimeIntent, resolveGroupProfile, extractOperationalFacts, inferVehicleType, buildEvidenceChecklist, markEvidenceChecklist, appendOperationalTimeline, calculateApprovedCommercial, reconcileCommercial, learningContextForGroup, shouldStaySilent } from './operational-knowledge.mjs';"
if s.count(old) != 1:
    raise SystemExit(f'import operational-knowledge: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """function pendingOpportunityCall(call = null) {
  return call && ['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(call.status) ? call : null;
}
"""
new = """function pendingOpportunityCall(call = null) {
  return call && ['cotacao','aguardando_dados','aguardando_aprovacao','agendado'].includes(call.status) ? call : null;
}

function normalizedOpportunityRoute(value = '') {
  return normalizeForIntent(value).replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim();
}

function pendingForIncomingFacts(call = null, facts = {}) {
  const pending = pendingOpportunityCall(call);
  if (!pending) return null;
  const incomingOrigin = normalizedOpportunityRoute(facts?.origin || '');
  const incomingDestination = normalizedOpportunityRoute(facts?.destination || '');
  const pendingOrigin = normalizedOpportunityRoute(pending?.origin || '');
  const pendingDestination = normalizedOpportunityRoute(pending?.destination || '');
  // Uma nova rota completa no mesmo grupo e uma nova cotacao. Nao reaproveita
  // KM/valor da oportunidade anterior, evitando contaminar a previa seguinte.
  if (incomingOrigin && incomingDestination && pendingOrigin && pendingDestination) {
    if (incomingOrigin != pendingOrigin || incomingDestination != pendingDestination) return null;
  }
  return pending;
}

function usefulVehicleName(value = '') {
  const text = String(value || '').trim();
  return /^ve[ií]culo n[aã]o informado$/i.test(text) ? '' : text;
}

function mergedOpportunityFacts(facts = {}, call = null, route = null, readableText = '') {
  const vehicle = usefulVehicleName(facts?.vehicle) || usefulVehicleName(call?.vehicle) || '';
  const service = facts?.service || call?.service || '';
  return {
    ...facts,
    origin: route?.originAddress || facts?.origin || call?.origin || '',
    destination: route?.destinationAddress || facts?.destination || call?.destination || '',
    vehicle,
    vehicleType: facts?.vehicleType || call?.vehicleType || inferVehicleType(`${vehicle} ${service} ${readableText}`) || '',
    service,
  };
}
"""
if s.count(old) != 1:
    raise SystemExit(f'pendingOpportunityCall: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """  const facts = context.facts;
  const pending = pendingOpportunityCall(context.recentCall);
  const hasOpportunityData = Boolean(facts.origin || facts.destination || facts.vehicle || facts.plate || facts.protocol || extractLabeledField(readableText, 'Origem') || enderecoEmTextoLivre(readableText));
  let route = null;
  if (hasOpportunityData) {
    route = await estimateQuoteRoute(msg.from, readableText, facts, incomingLocation, pendingRouteContext(context.recentCall), { fast: true }).catch(() => ({ eta: null }));
"""
new = """  const facts = context.facts;
  const pending = pendingForIncomingFacts(context.recentCall, facts);
  const hasOpportunityData = Boolean(facts.origin || facts.destination || facts.vehicle || facts.vehicleType || facts.plate || facts.protocol || extractLabeledField(readableText, 'Origem') || enderecoEmTextoLivre(readableText));
  const preliminaryFacts = mergedOpportunityFacts(facts, pending, null, readableText);
  const completeOpportunity = missingDispatchData(preliminaryFacts).length === 0;
  let route = null;
  if (hasOpportunityData) {
    // Com dados completos calcula a rota inteira: ETA + distancia + KM total + valor.
    // Em consulta ainda incompleta continua no caminho rapido para nao atrasar o grupo.
    route = await estimateQuoteRoute(msg.from, readableText, preliminaryFacts, incomingLocation, pendingRouteContext(pending), { fast: !completeOpportunity }).catch(() => ({ eta: null }));
"""
if s.count(old) != 1:
    raise SystemExit(f'availability inicio: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: route?.originAddress || pending?.origin || null,
    originCoordinates: route?.originCoordinates || pending?.originCoordinates || null,
    destinationAddress: route?.destinationAddress || pending?.destination || null,
    eta: route?.eta || null, status: 'cotacao', facts,
    estimatedTotalKm: route?.estimatedTotalKm ?? pending?.estimatedTotalKm ?? null,
    evidenceChecklist: hasOpportunityData ? buildEvidenceChecklist(groupName, readableText) : [],
    existingCallId: hasOpportunityData ? (pending?.id || null) : null,
    eventType: 'consulta_disponibilidade', phase: 'cotacao',
  });
  const lines = ['Disponível ✅'];
  const etaReply = route?.eta ? formatEtaReply(route.eta, false) : null;
  if (etaReply) lines.push(etaReply);
  else if (hasOpportunityData) lines.push('Previsão temporariamente indisponível. A cotação foi registrada e o sistema continuará tentando atualizar a rota.');
  await replyAndRemember(msg, groupName, readableText, lines.join('\\n'), {
    intent: 'availability', activeCount: capacity.activeCount,
    slotsAfterAccept: Math.max(0, capacity.slotsAvailable - 1),
    etaMinutes: route?.eta?.minutes ?? null, estimatedTotalKm: route?.estimatedTotalKm ?? null,
  });
"""
new = """  const combinedFacts = mergedOpportunityFacts(facts, pending, route, readableText);
  const completePreview = missingDispatchData(combinedFacts).length === 0;
  const pricingKm = context.billingProfile?.routeBasis === 'origin_destination'
    ? (route?.secondLeg?.distanceKm ?? null)
    : context.billingProfile?.routeBasis === 'insurer_reported'
      ? (combinedFacts.totalKm ?? null)
      : context.billingProfile?.routeBasis === 'manual' ? null : route?.estimatedTotalKm;
  const commercial = completePreview
    ? reconcileCommercial({ approvedRules: context.approvedRules, facts: { ...combinedFacts, totalKm: pricingKm ?? combinedFacts.totalKm }, estimatedTotalKm: pricingKm })
    : { status: 'incomplete_preview', calculatedAmount: null };

  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: route?.originAddress || pending?.origin || null,
    originCoordinates: route?.originCoordinates || pending?.originCoordinates || null,
    destinationAddress: route?.destinationAddress || pending?.destination || null,
    eta: route?.eta || null, status: 'cotacao', facts: combinedFacts, commercial,
    estimatedTotalKm: route?.estimatedTotalKm ?? pending?.estimatedTotalKm ?? null,
    evidenceChecklist: hasOpportunityData ? buildEvidenceChecklist(groupName, readableText) : [],
    existingCallId: hasOpportunityData ? (pending?.id || null) : null,
    eventType: 'consulta_disponibilidade', phase: 'cotacao',
  });
  const lines = ['Disponível ✅'];
  const etaReply = route?.eta ? formatEtaReply(route.eta, false) : null;
  if (etaReply) lines.push(etaReply);
  else if (hasOpportunityData) lines.push('Previsão temporariamente indisponível. A cotação foi registrada e o sistema continuará tentando atualizar a rota.');
  if (!route?.eta?.queued && route?.eta?.distanceKm != null) lines.push(`Distância até a origem: ${route.eta.distanceKm} km.`);
  if (route?.estimatedTotalKm != null) lines.push(`Percurso estimado do atendimento: ${route.estimatedTotalKm} km.`);
  if (completePreview && commercial.status === 'ok' && commercial.calculatedAmount != null) {
    lines.push(`Valor estimado: ${formatCurrency(commercial.calculatedAmount)}.`);
    lines.push('O valor poderá ter acréscimos conforme a execução, como hora trabalhada após 15 min, pedágio e estrada de terra, quando aplicáveis.');
  } else if (completePreview) {
    lines.push('Valor aguardando tabela comercial aprovada no aplicativo.');
  }
  await replyAndRemember(msg, groupName, readableText, lines.join('\\n'), {
    intent: 'availability', activeCount: capacity.activeCount,
    slotsAfterAccept: Math.max(0, capacity.slotsAvailable - 1),
    etaMinutes: route?.eta?.minutes ?? null, estimatedTotalKm: route?.estimatedTotalKm ?? null,
    commercialStatus: commercial.status,
  });
"""
if s.count(old) != 1:
    raise SystemExit(f'availability resposta: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """async function handleQuoteRuntime(msg, groupName, readableText, incomingLocation, context) {
  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const route = await estimateQuoteRoute(msg.from, readableText, context.facts, incomingLocation, pendingRouteContext(context.recentCall)).catch((error) => {
"""
new = """async function handleQuoteRuntime(msg, groupName, readableText, incomingLocation, context) {
  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const pending = pendingForIncomingFacts(context.recentCall, context.facts);
  const route = await estimateQuoteRoute(msg.from, readableText, context.facts, incomingLocation, pendingRouteContext(pending)).catch((error) => {
"""
if s.count(old) != 1:
    raise SystemExit(f'quote pending inicio: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = "existingCallId: pendingOpportunityCall(context.recentCall)?.id || null,"
new = "existingCallId: pending?.id || null,"
if s.count(old) != 1:
    raise SystemExit(f'quote existingCallId: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """  const combinedFacts = {
    ...context.facts,
    origin: context.facts.origin || extractLabeledField(readableText, 'Origem') || enderecoEmTextoLivre(readableText) || call?.origin || '',
    destination: context.facts.destination || extractLabeledField(readableText, 'Destino') || call?.destination || '',
    vehicle: context.facts.vehicle || call?.vehicle || '',
  };
"""
new = """  const combinedFacts = mergedOpportunityFacts({
    ...context.facts,
    origin: context.facts.origin || extractLabeledField(readableText, 'Origem') || enderecoEmTextoLivre(readableText) || call?.origin || '',
    destination: context.facts.destination || extractLabeledField(readableText, 'Destino') || call?.destination || '',
  }, call, null, readableText);
"""
if s.count(old) != 1:
    raise SystemExit(f'incomplete combinedFacts: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """  const combinedFacts = {
    ...context.facts,
    origin: route.originAddress || call?.origin || '', destination: route.destinationAddress || call?.destination || '',
    vehicle: context.facts.vehicle || call?.vehicle || '',
  };
"""
new = """  const combinedFacts = mergedOpportunityFacts(context.facts, call, route, readableText);
"""
if s.count(old) != 1:
    raise SystemExit(f'dispatch combinedFacts: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

old = """  const lines = ['Dados do atendimento recebidos ✅'];
  if (route.eta && publicEtaMinutes(route.eta.rawMinutes ?? route.eta.minutes)) lines.push(`Previsão até a origem: ${publicEtaMinutes(route.eta.rawMinutes ?? route.eta.minutes)} min.`);
  if (route.estimatedTotalKm != null) lines.push(`Percurso estimado do atendimento: ${route.estimatedTotalKm} km.`);
"""
new = """  const lines = ['Dados do atendimento recebidos ✅'];
  if (route.eta && publicEtaMinutes(route.eta.rawMinutes ?? route.eta.minutes)) lines.push(`Previsão até a origem: ${publicEtaMinutes(route.eta.rawMinutes ?? route.eta.minutes)} min.`);
  if (!route.eta?.queued && route.eta?.distanceKm != null) lines.push(`Distância até a origem: ${route.eta.distanceKm} km.`);
  if (route.estimatedTotalKm != null) lines.push(`Percurso estimado do atendimento: ${route.estimatedTotalKm} km.`);
"""
if s.count(old) != 1:
    raise SystemExit(f'dispatch linhas: esperado 1, encontrado {s.count(old)}')
s = s.replace(old, new, 1)

worker.write_text(s)

knowledge = Path('tools/operational-knowledge.mjs')
t = knowledge.read_text()
old = "  const vehicle = labeled(raw, ['VE[IÍ]CULO', 'MODELO']);"
new = """  const looseVehicleMatch = raw.match(/(?:^|\\n)\\s*(?:VE[IÍ]CULO|CARRO|MODELO)\\s+([^:\\n][^\\n]{0,119})/im);
  const looseVehicle = looseVehicleMatch?.[1]?.trim().replace(/[.;,]+$/, '') || '';
  const vehicle = labeled(raw, ['VE[IÍ]CULO', 'MODELO']) || looseVehicle;"""
if t.count(old) != 1:
    raise SystemExit(f'loose vehicle: esperado 1, encontrado {t.count(old)}')
t = t.replace(old, new, 1)
knowledge.write_text(t)

Path('tools/test-preview-consistency.mjs').write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractOperationalFacts } from './operational-knowledge.mjs';

const compactVehicle = extractOperationalFacts('Veículo Gol');
assert.equal(compactVehicle.vehicle, 'Gol');
assert.equal(compactVehicle.vehicleType, 'leve');

const compactCar = extractOperationalFacts('Carro Uno');
assert.equal(compactCar.vehicle, 'Uno');
assert.equal(compactCar.vehicleType, 'leve');

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /pendingForIncomingFacts/);
assert.match(worker, /mergedOpportunityFacts/);
assert.match(worker, /vehicleType:\s*facts\?\.vehicleType\s*\|\|\s*call\?\.vehicleType/);
assert.match(worker, /fast:\s*!completeOpportunity/);
assert.match(worker, /Distância até a origem:/);
assert.match(worker, /Percurso estimado do atendimento:/);
assert.match(worker, /Valor estimado:/);
assert.match(worker, /commercialStatus:\s*commercial\.status/);
console.log('PREVIEW_CONSISTENCY_OK');
''')
