from pathlib import Path

ROOT = Path('.')

def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'PATTERN_NOT_FOUND {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

def append_once(path, marker, payload):
    p = ROOT / path
    text = p.read_text()
    if marker in text:
        return
    p.write_text(text.rstrip() + '\n\n' + payload.strip() + '\n')

worker = 'tools/vercel-whatsapp-worker.mjs'

replace_once(worker,
"import { sanitizeExcludedAreas, matchExcludedArea } from './excluded-areas.mjs';",
"import { sanitizeExcludedAreas, matchExcludedArea } from './excluded-areas.mjs';\nimport { DEFAULT_WEEKLY_SCHEDULE, sanitizeWeeklySchedule, evaluateOperatingHours } from './operating-hours.mjs';\nimport { sanitizeBillingProfile, ensureBillingProfile, settlementForCall, upsertBillingBatch, financeEntryFromCall, sanitizeBillingBatch, updateBatchTemporalStatuses, closureReply } from './financial-engine.mjs';")

replace_once(worker,
"  excludedAreas: [],\n  outOfRouteReply: 'Motorista fora de rota.',",
"  excludedAreas: [],\n  outOfRouteReply: 'Motorista fora de rota.',\n  operatingHoursEnabled: false,\n  operatingTimezone: 'America/Sao_Paulo',\n  weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,\n  outOfHoursReply: 'Motorista fora de rota.',\n  operationalBaseAddress: '',")

replace_once(worker,
"  finance: [],\n  fleet: [{ id: 'fleet-gsw0h17'",
"  finance: [],\n  billingProfiles: [],\n  billingBatches: [],\n  fleet: [{ id: 'fleet-gsw0h17'")

replace_once(worker,
"    finance: Array.isArray(data.finance) ? data.finance : [],\n    fleet: Array.isArray(data.fleet) ? data.fleet : DEFAULT_MANAGEMENT.fleet,",
"    finance: Array.isArray(data.finance) ? data.finance : [],\n    billingProfiles: Array.isArray(data.billingProfiles) ? data.billingProfiles.map(sanitizeBillingProfile) : [],\n    billingBatches: updateBatchTemporalStatuses(Array.isArray(data.billingBatches) ? data.billingBatches : []),\n    fleet: Array.isArray(data.fleet) ? data.fleet : DEFAULT_MANAGEMENT.fleet,")

replace_once(worker,
"    const parsed = facts || extractOperationalFacts(text);\n    const vehicle = parsed.vehicle || extractLabeledField(text, 'Veículo') || extractLabeledField(text, 'Veiculo') || '';",
"    const parsed = facts || extractOperationalFacts(text);\n    const routeOrigin = originAddress || parsed.origin || '';\n    const routeDestination = destinationAddress || parsed.destination || '';\n    let routeSnapshot = null;\n    if (status === 'autorizado' && routeOrigin && routeDestination) {\n      routeSnapshot = await computeFullServiceRoute({ originAddress: routeOrigin, destinationAddress: routeDestination }).catch((error) => {\n        logEvent('warning', 'Não foi possível congelar a rota completa do atendimento autorizado.', { error: String(error), groupId });\n        return null;\n      });\n    }\n    const vehicle = parsed.vehicle || extractLabeledField(text, 'Veículo') || extractLabeledField(text, 'Veiculo') || '';")

replace_once(worker,
"      totalKm: parsed.totalKm ?? existing?.totalKm ?? null,\n      estimatedTotalKm: estimatedTotalKm ?? existing?.estimatedTotalKm ?? null,",
"      totalKm: parsed.totalKm ?? routeSnapshot?.totalKm ?? existing?.totalKm ?? null,\n      billableKm: routeSnapshot?.totalKm ?? existing?.billableKm ?? estimatedTotalKm ?? null,\n      routeBreakdown: routeSnapshot || existing?.routeBreakdown || null,\n      routeCapturedAt: routeSnapshot?.capturedAt || existing?.routeCapturedAt || null,\n      estimatedTotalKm: estimatedTotalKm ?? routeSnapshot?.totalKm ?? existing?.estimatedTotalKm ?? null,")

replace_once(worker,
"      scheduledAt: parsed.scheduledAt || existing?.scheduledAt || null,\n      createdAt: existing?.createdAt || new Date().toISOString(),",
"      scheduledAt: parsed.scheduledAt || existing?.scheduledAt || null,\n      lastOperationalText: String(text || '').slice(0, 4000),\n      completedAt: status === 'concluido' ? new Date().toISOString() : (existing?.completedAt || null),\n      createdAt: existing?.createdAt || new Date().toISOString(),")

old_finance = '''function maybeCreateFinanceFromCompletedCall(state, item) {
  if (!item || item.status !== 'concluido' || !managementAutomationEnabled(state, 'auto-finance')) return;
  if ((state.finance || []).some((entry) => entry.sourceCallId === item.id)) return;
  const amount = Number(item.value || 0);
  if (item.financeReviewRequired === true) return;
  if (!(amount > 0)) return;
  state.finance.unshift({
    id: crypto.randomUUID(),
    description: `Chamado concluído · ${item.vehicle || 'Guincho'}`,
    category: 'Serviço de guincho',
    amount,
    type: 'receita',
    status: 'pendente',
    dueDate: new Date().toISOString().slice(0, 10),
    client: item.client || item.insurer || '',
    sourceCallId: item.id,
    source: 'automation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}'''
new_finance = '''function maybeCreateFinanceFromCompletedCall(state, item) {
  if (!item || item.status !== 'concluido' || !managementAutomationEnabled(state, 'auto-finance')) return;
  if ((state.finance || []).some((entry) => entry.sourceCallId === item.id)) return;
  if (item.financeReviewRequired === true || !(Number(item.value) > 0)) return;

  const profile = ensureBillingProfile(state, item.sourceGroupId || '', item.insurer || item.client || '');
  const settlement = settlementForCall(profile, item, item.completedAt || item.updatedAt || new Date());
  if (settlement.status !== 'ok') {
    const call = (state.calls || []).find((x) => x.id === item.id);
    if (call) {
      call.paymentRuleStatus = settlement.status;
      call.paymentDue = settlement.dueDate || null;
    }
    return;
  }

  const batch = upsertBillingBatch(state, item, profile, settlement);
  const entry = financeEntryFromCall(item, settlement, batch);
  if (!entry) return;
  state.finance.unshift(entry);
  const call = (state.calls || []).find((x) => x.id === item.id);
  if (call) {
    call.billingProfileId = profile.id;
    call.billingBatchId = batch?.id || null;
    call.paymentRuleStatus = 'ok';
    call.paymentDue = settlement.dueDate || null;
    call.billingPeriodStart = settlement.batch?.periodStart || null;
    call.billingPeriodEnd = settlement.batch?.periodEnd || null;
  }
}'''
replace_once(worker, old_finance, new_finance)

helper_marker = 'async function computeFullServiceRoute('
helper = r'''
async function computeFullServiceRoute({ originAddress = null, destinationAddress = null, originCoordinates = null, baseAddressOverride = '' } = {}) {
  const settings = await getSettings();
  const baseAddress = String(baseAddressOverride || settings.operationalBaseAddress || '').trim();
  if ((!originAddress && !originCoordinates) || !destinationAddress || !baseAddress) return null;

  const reading = await getFreshTrackerReading();
  if (!reading) return null;
  const start = await trackerCoordinates(reading);
  if (!start) return null;
  const origin = originCoordinates && validCoordinates(originCoordinates.latitude, originCoordinates.longitude)
    ? { latitude: Number(originCoordinates.latitude), longitude: Number(originCoordinates.longitude), displayName: originAddress || 'Localização compartilhada' }
    : await geocodeAddress(originAddress);
  const destination = await geocodeAddress(destinationAddress);
  const base = await geocodeAddress(baseAddress);
  if (!origin || !destination || !base) return null;

  const legToOrigin = await routeBetween(start, origin);
  const serviceLeg = await routeBetween(origin, destination);
  const returnToBase = await routeBetween(destination, base);
  if (!legToOrigin || !serviceLeg || !returnToBase) return null;
  const totalKm = Math.round((Number(legToOrigin.distanceKm || 0) + Number(serviceLeg.distanceKm || 0) + Number(returnToBase.distanceKm || 0)) * 10) / 10;
  const totalMinutes = Number(legToOrigin.minutes || 0) + Number(serviceLeg.minutes || 0) + Number(returnToBase.minutes || 0);
  return {
    capturedAt: new Date().toISOString(),
    basis: 'truck_origin_destination_base',
    start: { address: reading.address || '', latitude: start.latitude, longitude: start.longitude },
    origin: { address: originAddress || origin.displayName || '', latitude: origin.latitude, longitude: origin.longitude },
    destination: { address: destinationAddress, latitude: destination.latitude, longitude: destination.longitude },
    base: { address: baseAddress, latitude: base.latitude, longitude: base.longitude },
    legToOrigin: { km: legToOrigin.distanceKm, minutes: legToOrigin.minutes },
    serviceLeg: { km: serviceLeg.distanceKm, minutes: serviceLeg.minutes },
    returnToBase: { km: returnToBase.distanceKm, minutes: returnToBase.minutes },
    totalKm,
    totalMinutes,
    routing: 'osrm_with_fallback',
  };
}
'''
p = ROOT / worker
text = p.read_text()
if helper_marker not in text:
    needle = 'function trackerContextText(location) {'
    if needle not in text: raise SystemExit('TRACKER_CONTEXT_MARKER_NOT_FOUND')
    p.write_text(text.replace(needle, helper + '\n' + needle, 1))

old_estimate = '''async function estimateQuoteRoute(groupId, text, facts, incomingLocation = null) {
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
}'''
new_estimate = '''async function estimateQuoteRoute(groupId, text, facts, incomingLocation = null) {
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
  const fullRoute = destinationAddress
    ? await computeFullServiceRoute({ originAddress, destinationAddress, originCoordinates }).catch(() => null)
    : null;
  const estimatedTotalKm = fullRoute?.totalKm ?? (eta?.distanceKm != null && secondLeg?.distanceKm != null
    ? Math.round((Number(eta.distanceKm) + Number(secondLeg.distanceKm)) * 10) / 10
    : null);
  return { originAddress, destinationAddress, originCoordinates, eta, secondLeg, fullRoute, estimatedTotalKm };
}'''
replace_once(worker, old_estimate, new_estimate)

old_closure = '''async function handleClosureRuntime(msg, groupName, readableText, context) {
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
}'''
new_closure = '''async function handleClosureRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  const reportedTotalKm = context.facts.totalKm ?? null;
  const automaticKm = call?.billableKm ?? call?.routeBreakdown?.totalKm ?? null;
  const facts = {
    ...context.facts,
    vehicleType: context.facts.vehicleType || call?.vehicleType || null,
    reportedTotalKm,
    totalKm: automaticKm ?? reportedTotalKm ?? call?.totalKm ?? null,
  };
  const commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts, estimatedTotalKm: automaticKm });
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || facts.origin || null,
    destinationAddress: call?.destination || facts.destination || null,
    eta: call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: 'concluido', facts, commercial,
    estimatedTotalKm: automaticKm,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
  });
  if (commercial.reviewRequired) {
    logEvent('finance-review', `${groupName}: fechamento exige conferência financeira.`, { callId: saved?.id, calculated: commercial.calculatedAmount, reported: commercial.reportedAmount, delta: commercial.delta });
  }
  const reply = closureReply({
    totalKm: automaticKm ?? facts.totalKm,
    amount: saved?.value || commercial.calculatedAmount,
    reviewRequired: commercial.reviewRequired || !(Number(saved?.value || commercial.calculatedAmount) > 0),
  });
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'closure', financeReviewRequired: commercial.reviewRequired, commercialStatus: commercial.status, billableKm: automaticKm ?? facts.totalKm ?? null });
}'''
replace_once(worker, old_closure, new_closure)

# Horário: !ping continua sendo diagnóstico; toda outra mensagem autorizada fora do horário recebe a recusa.
needle_hours = '''    if (text.toLowerCase() === '!ping') {
      await msg.reply('PONG — Bot Guincho funcionando no grupo autorizado!');
      logEvent('reply', `Teste respondido em ${groupName}.`);
      return;
    }

    if (location && !text) {'''
new_hours = '''    if (text.toLowerCase() === '!ping') {
      await msg.reply('PONG — Bot Guincho funcionando no grupo autorizado!');
      logEvent('reply', `Teste respondido em ${groupName}.`);
      return;
    }

    const operating = evaluateOperatingHours(settings);
    if (!operating.open) {
      const reply = String(settings.outOfHoursReply || 'Motorista fora de rota.').trim().slice(0,300) || 'Motorista fora de rota.';
      await replyAndRemember(msg, groupName, readableText, reply, { intent: 'out-of-hours', day: operating.dayKey, localTime: operating.localTime, reason: operating.reason });
      logEvent('coverage', `${groupName}: mensagem recusada fora do horário de funcionamento.`, { groupId: msg.from, day: operating.dayKey, localTime: operating.localTime, reason: operating.reason });
      return;
    }

    if (location && !text) {'''
replace_once(worker, needle_hours, new_hours)

# Settings
replace_once(worker,
"    outOfRouteReply: typeof req.body?.outOfRouteReply === 'string' ? req.body.outOfRouteReply.trim().slice(0, 300) || 'Motorista fora de rota.' : undefined,",
"    outOfRouteReply: typeof req.body?.outOfRouteReply === 'string' ? req.body.outOfRouteReply.trim().slice(0, 300) || 'Motorista fora de rota.' : undefined,\n    operatingHoursEnabled: typeof req.body?.operatingHoursEnabled === 'boolean' ? req.body.operatingHoursEnabled : undefined,\n    operatingTimezone: typeof req.body?.operatingTimezone === 'string' ? req.body.operatingTimezone.trim().slice(0,80) || 'America/Sao_Paulo' : undefined,\n    weeklySchedule: req.body?.weeklySchedule && typeof req.body.weeklySchedule === 'object' ? sanitizeWeeklySchedule(req.body.weeklySchedule) : undefined,\n    outOfHoursReply: typeof req.body?.outOfHoursReply === 'string' ? req.body.outOfHoursReply.trim().slice(0,300) || 'Motorista fora de rota.' : undefined,\n    operationalBaseAddress: typeof req.body?.operationalBaseAddress === 'string' ? req.body.operationalBaseAddress.trim().slice(0,600) : undefined,")

# Billing API before tracker API
billing_api = r'''
app.get('/api/billing', async (_req, res) => {
  try {
    const state = await getManagement();
    const groups = await discoverGroups().catch(() => []);
    for (const group of groups) ensureBillingProfile(state, group.id, group.name || 'Grupo do WhatsApp');
    state.billingBatches = updateBatchTemporalStatuses(state.billingBatches || []);
    const saved = await saveManagement(state);
    const settings = await getSettings();
    return res.json({ ok: true, profiles: saved.billingProfiles || [], batches: saved.billingBatches || [], finance: saved.finance || [], baseAddress: settings.operationalBaseAddress || '' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error?.message || error) });
  }
});

app.post('/api/billing', async (req, res) => {
  try {
    const state = await getManagement();
    const action = String(req.body?.action || 'save_profile');
    if (action === 'save_profile' || action === 'approve_profile') {
      const incoming = sanitizeBillingProfile({ ...(req.body?.profile || {}), status: action === 'approve_profile' ? 'approved' : (req.body?.profile?.status || 'needs_review') });
      if (!incoming.groupId) throw new Error('group_required');
      const idx = (state.billingProfiles || []).findIndex((x) => x.groupId === incoming.groupId);
      if (idx >= 0) state.billingProfiles[idx] = incoming; else state.billingProfiles.push(incoming);
      if (incoming.status === 'approved') {
        for (const call of (state.calls || []).filter((x) => x.sourceGroupId === incoming.groupId && x.status === 'concluido')) maybeCreateFinanceFromCompletedCall(state, call);
      }
      const saved = await saveManagement(state);
      return res.json({ ok: true, profile: saved.billingProfiles.find((x) => x.groupId === incoming.groupId), data: saved });
    }
    if (['statement_sent','invoice_sent','received'].includes(action)) {
      const batch = (state.billingBatches || []).find((x) => x.id === String(req.body?.batchId || ''));
      if (!batch) throw new Error('batch_not_found');
      const now = new Date().toISOString();
      if (action === 'statement_sent') { batch.statementSentAt = now; batch.status = 'statement_sent'; }
      if (action === 'invoice_sent') { batch.invoiceSentAt = now; batch.status = 'awaiting_payment'; }
      if (action === 'received') {
        batch.receivedAt = now; batch.receivedAmount = Number(req.body?.amount || batch.totalAmount || 0); batch.status = 'received';
        state.finance = (state.finance || []).map((entry) => entry.billingBatchId === batch.id ? { ...entry, status: 'pago', paidAt: now, updatedAt: now } : entry);
      }
      const saved = await saveManagement(state);
      return res.json({ ok: true, batch: saved.billingBatches.find((x) => x.id === batch.id), data: saved });
    }
    throw new Error('action_invalid');
  } catch (error) {
    return res.status(400).json({ ok: false, error: String(error?.message || error) });
  }
});

app.get('/api/billing/export', async (req, res) => {
  try {
    const state = await getManagement();
    const batch = (state.billingBatches || []).find((x) => x.id === String(req.query.batchId || ''));
    if (!batch) return res.status(404).send('Lote não encontrado');
    const calls = (state.calls || []).filter((x) => (batch.callIds || []).includes(x.id));
    const cols = ['Data','Grupo/Seguradora','Protocolo','Veículo','Placa','Origem','Destino','KM até origem','KM serviço','KM retorno base','KM total','Valor'];
    const quote = (value) => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const rows = calls.map((call) => [
      call.completedAt || call.updatedAt || '', call.insurer || call.client || '', call.protocol || '', call.vehicle || '', call.plate || '', call.origin || '', call.destination || '',
      call.routeBreakdown?.legToOrigin?.km ?? '', call.routeBreakdown?.serviceLeg?.km ?? '', call.routeBreakdown?.returnToBase?.km ?? '', call.billableKm ?? call.totalKm ?? '', call.value || 0,
    ].map(quote).join(';'));
    const csv = '\uFEFF' + [cols.map(quote).join(';'), ...rows].join('\r\n');
    res.setHeader('content-type','text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="fechamento-${String(batch.groupName || 'grupo').replace(/[^a-z0-9]+/gi,'-').slice(0,40)}-${batch.periodEnd || 'periodo'}.csv"`);
    return res.send(csv);
  } catch (error) { return res.status(500).send(String(error?.message || error)); }
});
'''
p = ROOT / worker
text = p.read_text()
if "app.get('/api/billing'" not in text:
    needle = "app.get('/api/tracker', async (_req, res) => {"
    if needle not in text: raise SystemExit('BILLING_API_MARKER_NOT_FOUND')
    p.write_text(text.replace(needle, billing_api + '\n' + needle, 1))

# status inclui horário
replace_once(worker,
"    serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities },",
"    serviceArea: { state: configuredServiceState, priorityCities: configuredPriorityCities },\n    operatingHours: evaluateOperatingHours(settings),")

# Reload inclui novos módulos
reload_path = 'api/worker/reload.js'
replace_once(reload_path,
"  'tools/excluded-areas.mjs',\n];",
"  'tools/excluded-areas.mjs',\n  'tools/operating-hours.mjs',\n  'tools/financial-engine.mjs',\n];")

# Frontend: carrega configurações conforme página.
for app_path in ['app.js','public/app.js']:
    p = ROOT / app_path
    if not p.exists():
      if app_path.startswith('public/'): continue
      raise SystemExit(f'MISSING {app_path}')
    text = p.read_text()
    old = "if(name==='automations')loadExcludedAreas();if(name==='whatsapp')loadStatus();"
    new = "if(name==='automations'){loadExcludedAreas();loadOperatingHours();}if(name==='finance')loadBillingFinance();if(name==='whatsapp')loadStatus();"
    if old in text: text = text.replace(old,new,1)
    elif 'loadOperatingHours()' not in text: raise SystemExit(f'SHOW_PAGE_PATTERN_NOT_FOUND {app_path}')
    p.write_text(text)

frontend = r'''
// ===== Horário de funcionamento + faturamento por grupo =====
const BG_DAY_LABELS={mon:'Segunda',tue:'Terça',wed:'Quarta',thu:'Quinta',fri:'Sexta',sat:'Sábado',sun:'Domingo'};
function ensureOperatingHoursUI(){
  if($('operatingHoursConfig'))return;
  const page=$('automations');if(!page)return;
  page.insertAdjacentHTML('beforeend',`<div id="operatingHoursConfig" class="card section"><div class="head"><div><h3>Horário de funcionamento</h3><p>Fora desses períodos o robô responde “Motorista fora de rota.”</p></div><button class="btn" id="saveOperatingHours">Salvar horário</button></div><div class="switch section"><div><b>Usar horário de funcionamento</b><div class="muted">Desative para funcionar 24 horas.</div></div><input id="operatingHoursEnabled" type="checkbox"></div><div class="grid2 section"><div class="field"><label>Fuso horário</label><input id="operatingTimezone" value="America/Sao_Paulo"></div><div class="field"><label>Endereço da base do caminhão</label><input id="operationalBaseAddress" placeholder="Rua, número, bairro, cidade - UF"></div></div><div class="field section"><label>Resposta fora do horário</label><input id="outOfHoursReply" value="Motorista fora de rota."></div><div class="table-wrap section"><table class="table"><thead><tr><th>Dia</th><th>Funciona</th><th>Períodos</th></tr></thead><tbody id="operatingScheduleRows"></tbody></table></div><div class="notice section">Para horário de almoço, use dois períodos. Ex.: <b>08:00-12:00, 13:00-18:00</b>.</div><div id="operatingHoursNotice" class="notice section" style="display:none"></div></div>`);
  $('saveOperatingHours').onclick=saveOperatingHours;
}
function intervalsText(day){return(day?.intervals||[]).map(x=>`${x.start}-${x.end}`).join(', ')}
function parseIntervalsText(value){return String(value||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const m=x.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);return m?{start:m[1].padStart(5,'0'),end:m[2].padStart(5,'0')}:null}).filter(Boolean)}
async function loadOperatingHours(){
  ensureOperatingHoursUI();try{const s=await api('/api/worker/settings');$('operatingHoursEnabled').checked=s.operatingHoursEnabled===true;$('operatingTimezone').value=s.operatingTimezone||'America/Sao_Paulo';$('operationalBaseAddress').value=s.operationalBaseAddress||'';$('outOfHoursReply').value=s.outOfHoursReply||'Motorista fora de rota.';const schedule=s.weeklySchedule||{};$('operatingScheduleRows').innerHTML=Object.entries(BG_DAY_LABELS).map(([key,label])=>{const day=schedule[key]||{};return`<tr data-operating-day="${key}"><td><b>${label}</b></td><td><input class="day-enabled" type="checkbox" ${day.enabled?'checked':''}></td><td><input class="day-intervals" value="${esc(intervalsText(day))}" placeholder="08:00-12:00, 13:00-18:00"></td></tr>`}).join('')}catch(e){console.error(e)}}
async function saveOperatingHours(){
  const weeklySchedule={};$$('[data-operating-day]').forEach(row=>{const key=row.dataset.operatingDay;weeklySchedule[key]={enabled:row.querySelector('.day-enabled').checked,intervals:parseIntervalsText(row.querySelector('.day-intervals').value)}});const notice=$('operatingHoursNotice');try{await api('/api/worker/settings',{method:'POST',body:JSON.stringify({operatingHoursEnabled:$('operatingHoursEnabled').checked,operatingTimezone:$('operatingTimezone').value,operationalBaseAddress:$('operationalBaseAddress').value,outOfHoursReply:$('outOfHoursReply').value,weeklySchedule})});notice.style.display='block';notice.className='notice good section';notice.textContent='Horário salvo. A regra já vale para esta empresa.'}catch(e){notice.style.display='block';notice.className='notice bad section';notice.textContent='Erro ao salvar: '+e.message}}

function ensureBillingFinanceUI(){
  if($('billingFinanceConfig'))return;const page=$('finance');if(!page)return;
  page.insertAdjacentHTML('beforeend',`<div id="billingFinanceConfig" class="section"><div class="card"><div class="head"><div><h3>Faturamento por seguradora/grupo</h3><p>Ciclos de fechamento, planilha, nota fiscal e recebimento.</p></div><button class="btn secondary" id="refreshBilling">Atualizar</button></div><div class="notice warn section">O calendário só automatiza recebimentos depois de ser revisado e aprovado para aquele grupo.</div><div id="billingProfilesList" class="grid2 section"></div></div><div class="card section"><div class="head"><div><h3>Fechamentos e pagamentos</h3><p>Viagens agrupadas automaticamente por período.</p></div></div><div class="table-wrap section"><table class="table"><thead><tr><th>Grupo</th><th>Período</th><th>Viagens/KM</th><th>Total</th><th>Planilha</th><th>Pagamento</th><th>Status</th><th></th></tr></thead><tbody id="billingBatchesTable"></tbody></table></div></div></div>`);$('refreshBilling').onclick=loadBillingFinance;
}
let billingCache={profiles:[],batches:[]};
const billingModeLabel={monthly:'Mensal',semimonthly:'Quinzenal',per_call:'À vista / por chamado',dynamic_per_call:'À vista ou faturado por chamado',manual:'Manual'};
async function loadBillingFinance(){ensureBillingFinanceUI();try{billingCache=await api('/api/worker/billing');renderBillingFinance()}catch(e){console.error(e)}}
function renderBillingFinance(){const profiles=billingCache.profiles||[],batches=billingCache.batches||[];$('billingProfilesList').innerHTML=profiles.length?profiles.map(p=>`<div class="card"><div class="head"><div><h3>${esc(p.groupName||'Grupo')}</h3><p>${esc(billingModeLabel[p.paymentMode]||p.paymentMode)}</p></div>${tag(p.status==='approved'?'Aprovado':'Revisar')}</div><div class="small">Rota: ${p.routeBasis==='truck_origin_destination_base'?'Caminhão → origem → destino → base':esc(p.routeBasis)}</div>${p.sourceNote?`<p class="muted section">${esc(p.sourceNote)}</p>`:''}<div class="actions section"><button class="btn secondary small" onclick="editBillingProfile('${p.groupId}')">Configurar</button>${p.status!=='approved'?`<button class="btn small" onclick="approveBillingProfile('${p.groupId}')">Aprovar</button>`:''}</div></div>`).join(''):'<div class="empty">Os grupos aparecerão aqui depois de sincronizados.</div>';$('billingBatchesTable').innerHTML=batches.length?batches.map(b=>`<tr><td><b>${esc(b.groupName||'Grupo')}</b></td><td>${esc(b.periodStart||'—')}<br><span class="muted">até ${esc(b.periodEnd||'—')}</span></td><td>${b.callCount||0} viagens<br><span class="muted">${Number(b.totalKm||0).toLocaleString('pt-BR')} km</span></td><td>${money(b.totalAmount)}</td><td>${date(b.statementDue)}</td><td>${date(b.paymentDue)}</td><td>${tag(String(b.status||'accumulating').replaceAll('_',' '))}</td><td><div class="actions"><button class="btn ghost small" onclick="downloadBillingBatch('${b.id}')">Planilha</button>${!b.statementSentAt?`<button class="btn ghost small" onclick="billingBatchAction('${b.id}','statement_sent')">Enviada</button>`:''}${b.statementSentAt&&!b.invoiceSentAt?`<button class="btn ghost small" onclick="billingBatchAction('${b.id}','invoice_sent')">NF enviada</button>`:''}${b.status!=='received'?`<button class="btn small" onclick="billingBatchAction('${b.id}','received')">Recebido</button>`:''}</div></td></tr>`).join(''):'<tr><td colspan="8">Nenhum fechamento criado ainda.</td></tr>'}
window.editBillingProfile=groupId=>{const p=(billingCache.profiles||[]).find(x=>x.groupId===groupId);if(!p)return;const modeOpts=Object.entries(billingModeLabel).map(([v,l])=>`<option value="${v}" ${p.paymentMode===v?'selected':''}>${l}</option>`).join('');const routeOpts=[['truck_origin_destination_base','Caminhão → origem → destino → base'],['origin_destination','Somente origem → destino'],['insurer_reported','KM informado pela seguradora'],['manual','Manual']].map(([v,l])=>`<option value="${v}" ${p.routeBasis===v?'selected':''}>${l}</option>`).join('');const cycles=(p.cycles||[]);const rows=(cycles.length?cycles:[{}]).map((c,i)=>billingCycleRow(c,i)).join('');openModal('Regra financeira — '+(p.groupName||'Grupo'),`<div class="form-grid"><div class="field"><label>Modelo de pagamento</label><select name="paymentMode">${modeOpts}</select></div><div class="field"><label>KM cobrados</label><select name="routeBasis">${routeOpts}</select></div><div class="field"><label>Base específica do grupo (opcional)</label><input name="baseAddress" value="${esc(p.baseAddress||'')}"></div><div class="field"><label>Dias para pagar (à vista)</label><input name="daysToPay" type="number" value="${Number(p.daysToPay||0)}"></div></div><h4 class="section">Ciclos de faturamento</h4><p class="muted">Use um ciclo para mensal e dois para quinzenal. Campos vazios são permitidos enquanto estiver em revisão.</p><div id="billingCyclesEditor">${rows}</div><button type="button" class="btn secondary small section" onclick="addBillingCycleRow()">+ Adicionar ciclo</button><div class="field section"><label>Observações</label><textarea name="notes">${esc(p.notes||'')}</textarea></div>`,async()=>{const f=$('modalBody');const cycles=[...f.querySelectorAll('.billing-cycle-row')].map((row,i)=>({id:row.dataset.id||`cycle-${i+1}`,statementDay:row.querySelector('[name=statementDay]').value||null,lookbackDays:row.querySelector('[name=lookbackDays]').value||null,submitWindowStartDay:row.querySelector('[name=submitWindowStartDay]').value||null,submitWindowEndDay:row.querySelector('[name=submitWindowEndDay]').value||null,invoiceDeadlineDay:row.querySelector('[name=invoiceDeadlineDay]').value||null,paymentDay:row.querySelector('[name=paymentDay]').value||null,paymentMonthOffset:row.querySelector('[name=paymentMonthOffset]').value||0}));await api('/api/worker/billing',{method:'POST',body:JSON.stringify({action:'save_profile',profile:{...p,status:'needs_review',paymentMode:f.querySelector('[name=paymentMode]').value,routeBasis:f.querySelector('[name=routeBasis]').value,baseAddress:f.querySelector('[name=baseAddress]').value,daysToPay:Number(f.querySelector('[name=daysToPay]').value||0),cycles,notes:f.querySelector('[name=notes]').value}})});closeModal();await loadBillingFinance()})};
function billingCycleRow(c={},i=0){return`<div class="card section billing-cycle-row" data-id="${esc(c.id||`cycle-${i+1}`)}"><div class="form-grid"><div class="field"><label>Dia da planilha</label><input name="statementDay" type="number" min="1" max="31" value="${c.statementDay??''}"></div><div class="field"><label>Período anterior (dias)</label><input name="lookbackDays" type="number" value="${c.lookbackDays??''}"></div><div class="field"><label>Janela envio: início</label><input name="submitWindowStartDay" type="number" min="1" max="31" value="${c.submitWindowStartDay??''}"></div><div class="field"><label>Janela envio: fim</label><input name="submitWindowEndDay" type="number" min="1" max="31" value="${c.submitWindowEndDay??''}"></div><div class="field"><label>NF até dia</label><input name="invoiceDeadlineDay" type="number" min="1" max="31" value="${c.invoiceDeadlineDay??''}"></div><div class="field"><label>Pagamento dia</label><input name="paymentDay" type="number" min="1" max="31" value="${c.paymentDay??''}"></div><div class="field"><label>Pagamento em quantos meses</label><input name="paymentMonthOffset" type="number" min="0" max="3" value="${c.paymentMonthOffset??0}"></div></div></div>`}
window.addBillingCycleRow=()=>{$('billingCyclesEditor').insertAdjacentHTML('beforeend',billingCycleRow({},$('billingCyclesEditor').children.length))};
window.approveBillingProfile=async groupId=>{const p=(billingCache.profiles||[]).find(x=>x.groupId===groupId);if(!p)return;if(!confirm('Aprovar esta regra financeira? Depois disso os chamados concluídos poderão gerar valores e vencimentos automaticamente.'))return;await api('/api/worker/billing',{method:'POST',body:JSON.stringify({action:'approve_profile',profile:p})});await loadBillingFinance();await loadManagement()};
window.billingBatchAction=async(batchId,action)=>{let amount=null;if(action==='received'){const b=(billingCache.batches||[]).find(x=>x.id===batchId);const value=prompt('Valor recebido',String(b?.totalAmount||0));if(value===null)return;amount=Number(String(value).replace(',','.'))||0}await api('/api/worker/billing',{method:'POST',body:JSON.stringify({action,batchId,amount})});await loadBillingFinance();await loadManagement()};
window.downloadBillingBatch=async batchId=>{const u=new URL('/api/worker/billing/export',location.origin);u.searchParams.set('companyId',activeCompanyId);u.searchParams.set('batchId',batchId);const r=await fetch(u,{headers:{'x-botguincho-company-id':activeCompanyId,...(tenantAccessToken?{authorization:`Bearer ${tenantAccessToken}`}:{})}});if(!r.ok){alert('Não foi possível gerar a planilha.');return}const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='fechamento.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
'''
for app_path in ['app.js','public/app.js']:
    p=ROOT/app_path
    if p.exists():
        text=p.read_text()
        if '// ===== Horário de funcionamento + faturamento por grupo =====' not in text:
            p.write_text(text.rstrip()+'\n\n'+frontend.strip()+'\n')

# Cache PWA
for sw_path in ['sw.js','public/sw.js']:
    p=ROOT/sw_path
    if p.exists():
        text=p.read_text()
        import re
        text=re.sub(r"const CACHE='bot-guincho-pwa-v\\d+'", "const CACHE='bot-guincho-pwa-v8'", text, count=1)
        p.write_text(text)

print('SCHEDULE_FINANCE_PATCHED')
