import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(text, oldValue, newValue, label) {
  const index = text.indexOf(oldValue);
  if (index < 0) throw new Error(`${label}: trecho não encontrado`);
  if (text.indexOf(oldValue, index + oldValue.length) >= 0) throw new Error(`${label}: trecho duplicado`);
  return text.slice(0, index) + newValue + text.slice(index + oldValue.length);
}
function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: início não encontrado`);
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: fim não encontrado`);
  return text.slice(0, start) + replacement + text.slice(end);
}
function patchBoth(paths, fn) { for (const path of paths) write(path, fn(read(path), path)); }

// 1) Estados operacionais: aguardando fechamento continua sendo corrida aceita,
// mas deixa de ocupar vaga física e não vira definitivo até o dono fechar.
{
  let s = read('tools/simple-operation.mjs');
  s = replaceOnce(s,
    "const CONFIRMED_STATUSES = new Set(['autorizado', 'a_caminho', 'em_atendimento', 'concluido']);",
    "const CONFIRMED_STATUSES = new Set(['autorizado', 'a_caminho', 'em_atendimento', 'aguardando_fechamento', 'concluido']);",
    'simple confirmed statuses');
  s = replaceOnce(s,
    "    'Pode iniciar o deslocamento.',",
    "    call?.queued ? 'Corrida em fila. Finalize o atendimento anterior antes de iniciar este deslocamento.' : 'Pode iniciar o deslocamento.',",
    'driver queued message');
  write('tools/simple-operation.mjs', s);
}
{
  let s = read('tools/operational-knowledge.mjs');
  s = replaceOnce(s,
    "  const activeService = ['autorizado','a_caminho','em_atendimento'].includes(recentCall?.status);",
    "  const activeService = ['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(recentCall?.status);",
    'knowledge active service');
  s = replaceOnce(s,
    "    closure: 'concluido',",
    "    closure: 'aguardando_fechamento',",
    'knowledge closure state');
  write('tools/operational-knowledge.mjs', s);
}

// 2) Folha: cálculo previsto desde o aceite, mas somente fechamento do dono gera
// valor definitivo e despesa do motorista.
{
  let s = read('tools/driver-payroll.mjs');
  s = replaceOnce(s,
    "import { isConfirmedCall } from './simple-operation.mjs';\n",
    "import { isConfirmedCall } from './simple-operation.mjs';\nimport { isOwnerFinalizedCall } from './business-orchestration.mjs';\n",
    'driver finalization import');
  const newSync = `export function syncDriverPayrolls(state, now = new Date()) {
  const previous = new Map((Array.isArray(state.driverPayrolls) ? state.driverPayrolls : []).map((item) => [item.key, item]));
  const grouped = new Map();
  for (const call of Array.isArray(state.calls) ? state.calls : []) {
    const calculation = driverPayForCall(call);
    if (!calculation) continue;
    const settledAt = call.ownerClosedAt || call.completedAt || call.cancelledAt || call.authorizedAt || call.updatedAt || call.createdAt;
    if (!settledAt) continue;
    const period = driverPayrollPeriodFor(settledAt);
    const driver = driverForCall(state, call);
    const key = \`${'${driver.driverId}'}|${'${period.periodStart}'}|${'${period.periodEnd}'}\`;
    if (!grouped.has(key)) grouped.set(key, { key, ...driver, ...period, calls: [] });
    grouped.get(key).calls.push({ call, calculation, final: isOwnerFinalizedCall(call) });
  }

  const today = dateOnly(now);
  state.driverPayrolls = [...grouped.values()].map((group) => {
    const old = previous.get(group.key) || {};
    const finalItems = group.calls.filter((item) => item.final);
    const projectedItems = group.calls.filter((item) => !item.final);
    const callIds = finalItems.map(({ call }) => call.id);
    const projectedCallIds = projectedItems.map(({ call }) => call.id);
    const totalKm = money(finalItems.reduce((sum, item) => sum + item.calculation.billableKm, 0));
    const projectedKm = money(projectedItems.reduce((sum, item) => sum + item.calculation.billableKm, 0));
    const routeAmount = money(finalItems.reduce((sum, item) => sum + item.calculation.routeAmount, 0));
    const workedTimeAmount = money(finalItems.reduce((sum, item) => sum + item.calculation.workedTimeAmount, 0));
    const totalAmount = money(routeAmount + workedTimeAmount);
    const projectedRouteAmount = money(projectedItems.reduce((sum, item) => sum + item.calculation.routeAmount, 0));
    const projectedWorkedTimeAmount = money(projectedItems.reduce((sum, item) => sum + item.calculation.workedTimeAmount, 0));
    const projectedAmount = money(projectedRouteAmount + projectedWorkedTimeAmount);
    const status = old.paidAt ? 'paid'
      : totalAmount <= 0 && projectedAmount > 0 ? 'projected'
      : today > group.paymentDue ? 'overdue'
      : today >= group.paymentDue ? 'due' : 'accumulating';
    return {
      id: old.id || crypto.randomUUID(), key: group.key,
      driverId: group.driverId, driverName: group.driverName,
      periodStart: group.periodStart, periodEnd: group.periodEnd, paymentDue: group.paymentDue,
      callIds, callCount: callIds.length, totalKm, routeAmount, workedTimeAmount, totalAmount,
      projectedCallIds, projectedCallCount: projectedCallIds.length, projectedKm,
      projectedRouteAmount, projectedWorkedTimeAmount, projectedAmount,
      totalWithProjected: money(totalAmount + projectedAmount),
      status, paidAt: old.paidAt || null, paidAmount: old.paidAmount ?? null,
      createdAt: old.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }).sort((a, b) => String(b.periodEnd).localeCompare(String(a.periodEnd)));

  if (!Array.isArray(state.finance)) state.finance = [];
  const finalPayrollIds = new Set(state.driverPayrolls.filter((item) => item.totalAmount > 0).map((item) => item.id));
  state.finance = state.finance.filter((item) => item.source !== 'driver_payroll' || item.status === 'pago' || finalPayrollIds.has(item.driverPayrollId));
  for (const payroll of state.driverPayrolls) {
    if (!(payroll.totalAmount > 0)) continue;
    let entry = state.finance.find((item) => item.driverPayrollId === payroll.id);
    const patch = {
      description: \`Pagamento motorista · ${'${payroll.driverName}'} · ${'${payroll.periodStart}'} a ${'${payroll.periodEnd}'}\`,
      category: 'Pagamento do motorista', amount: payroll.totalAmount, type: 'despesa',
      status: payroll.paidAt ? 'pago' : (payroll.status === 'overdue' ? 'atrasado' : 'pendente'),
      dueDate: payroll.paymentDue, driverPayrollId: payroll.id, driverId: payroll.driverId,
      financialStage: 'definitivo', isFinal: true,
      paidAt: payroll.paidAt || null, source: 'driver_payroll', updatedAt: new Date().toISOString(),
    };
    if (entry) Object.assign(entry, patch);
    else state.finance.unshift({ id: crypto.randomUUID(), ...patch, createdAt: new Date().toISOString() });
  }
  return state.driverPayrolls;
}

`;
  s = replaceBetween(s, 'export function syncDriverPayrolls(state, now = new Date()) {', 'export function markDriverPayrollPaid', newSync, 'driver payroll sync');
  write('tools/driver-payroll.mjs', s);
}

// 3) Worker: seguradora ↔ grupo, funil, fechamento pelo dono, valor previsto x definitivo,
// planilha por período e reconciliação do rastreador mesmo sem IA.
{
  let s = read('tools/vercel-whatsapp-worker.mjs');
  s = replaceOnce(s,
    "import { trackerAgeSeconds } from './tracker-freshness.mjs';\n",
    "import { trackerAgeSeconds } from './tracker-freshness.mjs';\nimport { ensureInsurerForGroup, sanitizeInsurer, upsertInsurer, buildQuoteFunnel, quoteTrackingPatch, isOwnerFinalizedCall } from './business-orchestration.mjs';\nimport { buildPeriodReport, buildPeriodWorkbook } from './reporting-engine.mjs';\n",
    'worker orchestration imports');

  s = replaceOnce(s,
    "  clients: [],\n  finance: [],",
    "  clients: [],\n  insurers: [],\n  finance: [],",
    'default insurers');
  s = replaceOnce(s,
    "    clients: Array.isArray(data.clients) ? data.clients : [],\n    finance: Array.isArray(data.finance) ? data.finance : [],",
    "    clients: Array.isArray(data.clients) ? data.clients : [],\n    insurers: Array.isArray(data.insurers) ? data.insurers.map(sanitizeInsurer) : [],\n    finance: Array.isArray(data.finance) ? data.finance : [],",
    'normalize insurers');

  s = replaceOnce(s,
`  if (knowledge?.draftCommercialRules?.detected) {
    return { rules: knowledge.draftCommercialRules, source: 'group_description' };
  }
  if (isTestGroupName(groupName)) {`,
`  // Regra observada/histórica nunca vira preço automaticamente. Para produção,
  // somente tabela explicitamente aprovada no app pode precificar.
  if (isTestGroupName(groupName)) {`,
    'approved commercial only');

  s = replaceOnce(s,
    "    const billingProfile = ensureBillingProfile(state, groupId, groupName);\n    const routeOrigin = originAddress || parsed.origin || '';",
    "    const billingProfile = ensureBillingProfile(state, groupId, groupName);\n    const insurerRecord = ensureInsurerForGroup(state, { groupId, groupName, profileKey: resolveGroupProfile(groupName).key });\n    const routeOrigin = originAddress || parsed.origin || '';",
    'ensure insurer record');

  s = replaceOnce(s,
`    const operationalTimeline = appendOperationalTimeline(existing?.operationalTimeline || [], {
      at: transitionAt,`,
`    const quoteFields = quoteTrackingPatch(existing || {}, {
      status, eventType: derivedEventType, at: transitionAt,
      calculatedValue: commercial?.calculatedAmount ?? existing?.calculatedValue ?? null,
      estimatedKm: autoBillableKm ?? estimatedTotalKm ?? routeSnapshot?.totalKm ?? existing?.estimatedTotalKm ?? null,
    });
    const operationalTimeline = appendOperationalTimeline(existing?.operationalTimeline || [], {
      at: transitionAt,`,
    'quote tracking fields');

  s = replaceOnce(s,
`      client: groupName || existing?.client || 'Seguradora',
      insurer: groupName || existing?.insurer || '',`,
`      client: insurerRecord.name || existing?.client || 'Seguradora',
      insurer: insurerRecord.name || existing?.insurer || '',
      insurerId: insurerRecord.id,
      insurerName: insurerRecord.name,
      groupName: groupName || existing?.groupName || '',`,
    'canonical insurer call fields');

  s = replaceOnce(s,
`      operationalTimeline,
      operationalPhase: phase || existing?.operationalPhase || null,`,
`      operationalTimeline,
      ...quoteFields,
      ownerCloseRequired: existing?.ownerCloseRequired ?? !(existing?.status === 'concluido' && existing?.completedAt),
      ownerReviewRequired: status === 'aguardando_fechamento' ? true : (status === 'concluido' ? false : existing?.ownerReviewRequired === true),
      ownerClosedAt: existing?.ownerClosedAt || null,
      ownerClosedBy: existing?.ownerClosedBy || null,
      queued: eta?.queued === true ? true : (status === 'concluido' || status === 'cancelado' ? false : existing?.queued === true),
      queuedBehindCallId: eta?.precedingCallId || existing?.queuedBehindCallId || null,
      rawEtaMinutes: eta?.rawMinutes ?? existing?.rawEtaMinutes ?? eta?.minutes ?? null,
      operationalPhase: phase || existing?.operationalPhase || null,`,
    'owner and queue fields');

  s = replaceOnce(s,
`    if (existing) state.calls = state.calls.map((x) => x.id === existing.id ? { ...x, ...patch } : x);
    else state.calls.unshift(patch);
    if (isConfirmedCall(patch)) ensureConfirmedFinanceTracking(state, patch, { finalized: status === 'concluido' });
    if (isBillableCancellation) maybeCreateFinanceFromBillableCall(state, patch);
    if (status === 'cancelado' && !isBillableCancellation) removeUnbilledConfirmedTracking(state, patch.id);
    if (isConfirmedCall(patch) || status === 'cancelado') syncDriverPayrolls(state);`,
`    if (existing) state.calls = state.calls.map((x) => x.id === existing.id ? { ...x, ...patch } : x);
    else state.calls.unshift(patch);
    if (isConfirmedCall(patch) || isBillableCancellation) ensureConfirmedFinanceTracking(state, patch, { finalized: isOwnerFinalizedCall(patch) });
    if (status === 'cancelado' && !isBillableCancellation) removeUnbilledConfirmedTracking(state, patch.id);
    if (isConfirmedCall(patch) || isBillableCancellation || status === 'cancelado') syncDriverPayrolls(state);`,
    'predicted finance tracking');

  const newFinanceTracking = `function ensureConfirmedFinanceTracking(state, item, { finalized = false } = {}) {
  if (!item || item?.historicalImport === true || isTestCall(item) || !managementAutomationEnabled(state, 'auto-finance')) return null;
  const amount = confirmedFinanceAmount(item);
  const profile = ensureBillingProfile(state, item.sourceGroupId || '', item.groupName || item.insurer || item.client || '');
  const now = new Date().toISOString();
  let entry = (state.finance || []).find((candidate) => candidate.sourceCallId === item.id && candidate.type === 'receita');
  const effectiveFinal = finalized === true || isOwnerFinalizedCall(item) || entry?.isFinal === true;
  let settlement = { status: 'pending_owner_close', dueDate: null, batch: null };
  let batch = null;
  if (effectiveFinal) {
    const settlementAt = item.ownerClosedAt || item.completedAt || item.cancelledAt || item.updatedAt || item.createdAt || new Date();
    settlement = settlementForCall(profile, item, settlementAt);
    batch = settlement.status === 'ok' ? upsertBillingBatch(state, { ...item, value: amount }, profile, settlement) : null;
  }
  const patch = {
    description: \`Corrida ${'${effectiveFinal ? \'fechada\' : \'aberta\'}'} · ${'${item.insurerName || item.insurer || item.client || \'Seguradora\'}'} · ${'${item.vehicle || \'Veículo\'}'}\`,
    category: effectiveFinal ? 'Serviço de guincho' : 'Corrida aberta',
    amount,
    type: 'receita',
    status: entry?.status === 'pago' ? 'pago' : 'pendente',
    financialStage: effectiveFinal ? 'faturado' : 'previsto',
    isFinal: effectiveFinal,
    needsValueReview: !(amount > 0),
    dueDate: effectiveFinal ? (settlement.dueDate || entry?.dueDate || null) : null,
    client: item.insurerName || item.client || item.insurer || '',
    insurer: item.insurerName || item.insurer || item.client || '',
    insurerId: item.insurerId || '',
    groupId: item.sourceGroupId || '',
    groupName: item.groupName || '',
    protocol: item.protocol || '',
    sourceCallId: item.id,
    billingBatchId: effectiveFinal ? (batch?.id || entry?.billingBatchId || null) : null,
    billableKm: Number(item.billableKm ?? item.totalKm ?? item.estimatedTotalKm ?? 0),
    billingPeriodStart: effectiveFinal ? (settlement.batch?.periodStart || entry?.billingPeriodStart || null) : null,
    billingPeriodEnd: effectiveFinal ? (settlement.batch?.periodEnd || entry?.billingPeriodEnd || null) : null,
    statementDue: effectiveFinal ? (settlement.batch?.statementDue || entry?.statementDue || null) : null,
    invoiceDue: effectiveFinal ? (settlement.batch?.invoiceDue || entry?.invoiceDue || null) : null,
    paymentDue: effectiveFinal ? (settlement.batch?.paymentDue || settlement.dueDate || entry?.paymentDue || null) : null,
    source: 'confirmation_automation',
    updatedAt: now,
  };
  if (entry) Object.assign(entry, patch);
  else {
    entry = { id: crypto.randomUUID(), ...patch, createdAt: now };
    state.finance.unshift(entry);
  }

  const call = (state.calls || []).find((candidate) => candidate.id === item.id);
  if (call) {
    call.billingProfileId = profile.id;
    call.billingBatchId = effectiveFinal ? (batch?.id || call.billingBatchId || null) : null;
    call.paymentRuleStatus = effectiveFinal ? settlement.status : 'pending_owner_close';
    call.paymentDue = effectiveFinal ? (settlement.dueDate || null) : null;
    call.billingPeriodStart = effectiveFinal ? (settlement.batch?.periodStart || null) : null;
    call.billingPeriodEnd = effectiveFinal ? (settlement.batch?.periodEnd || null) : null;
    call.driverPayStatus = effectiveFinal ? 'definitivo' : 'previsto';
  }
  return entry;
}

`;
  s = replaceBetween(s, 'function ensureConfirmedFinanceTracking(state, item, { finalized = false } = {}) {', 'function removeUnbilledConfirmedTracking', newFinanceTracking, 'finance predicted/final');

  const newMaybe = `function maybeCreateFinanceFromBillableCall(state, item) {
  if (!item || item?.historicalImport === true || isTestCall(item)) return null;
  if (!(isConfirmedCall(item) || item.cancellationChargeRequired === true)) return null;
  return ensureConfirmedFinanceTracking(state, item, { finalized: isOwnerFinalizedCall(item) });
}

`;
  s = replaceBetween(s, 'function maybeCreateFinanceFromBillableCall(state, item) {', 'async function applyManagementAction(body = {}) {', newMaybe, 'finance billable delegator');

  const managementHelpers = `function insurerBillingCycles(insurer = {}, existing = {}) {
  const hasConfiguredCycle = insurer.statementDay || insurer.submitWindowStartDay || insurer.submitWindowEndDay || insurer.invoiceDeadlineDay || insurer.paymentDay;
  if (!hasConfiguredCycle) return existing.cycles || [];
  return [{
    id: 'owner-configured',
    statementDay: insurer.statementDay || insurer.submitWindowEndDay || null,
    lookbackDays: insurer.statementDay ? 30 : null,
    submitWindowStartDay: insurer.submitWindowStartDay || null,
    submitWindowEndDay: insurer.submitWindowEndDay || null,
    invoiceDeadlineDay: insurer.invoiceDeadlineDay || null,
    paymentDay: insurer.paymentDay || null,
    paymentMonthOffset: insurer.paymentMonthOffset || 0,
  }];
}

async function saveInsurerConfiguration(state, raw = {}) {
  const insurer = upsertInsurer(state, raw);
  const registry = await getRegistry();
  for (const groupId of insurer.groupIds || []) {
    const groupName = registry[groupId]?.name || insurer.groupNames?.find(Boolean) || insurer.name;
    const current = ensureBillingProfile(state, groupId, groupName);
    const next = sanitizeBillingProfile({
      ...current,
      groupId, groupName,
      status: insurer.paymentMode === 'manual' || !insurer.paymentDay ? current.status : 'approved',
      paymentMode: insurer.paymentMode || current.paymentMode,
      baseAddress: insurer.baseAddress || current.baseAddress,
      cycles: insurerBillingCycles(insurer, current),
      sourceNote: \`Calendário configurado no cadastro da seguradora ${'${insurer.name}'}.\`,
    });
    const index = state.billingProfiles.findIndex((item) => item.groupId === groupId);
    if (index >= 0) state.billingProfiles[index] = next; else state.billingProfiles.push(next);
  }
  return insurer;
}

function closingNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function finalGroupMessage(call = {}) {
  const lines = ['Corrida finalizada ✅'];
  if (call.protocol) lines.push(\`Protocolo: ${'${call.protocol}'}\`);
  if (Number.isFinite(Number(call.billableKm))) lines.push(\`Quilometragem total: ${'${Number(call.billableKm).toLocaleString(\'pt-BR\', { maximumFractionDigits: 1 })}'} km.\`);
  if (Number(call.value) > 0) lines.push(\`Valor final: ${'${formatCurrency(call.value)}'}.\`);
  const extras = [];
  if (Number(call.workedTimeAmount) > 0) extras.push(\`hora trabalhada ${'${formatCurrency(call.workedTimeAmount)}'}\`);
  if (Number(call.dirtRoadChargeAmount) > 0) extras.push(\`estrada de terra ${'${formatCurrency(call.dirtRoadChargeAmount)}'}\`);
  if (Number(call.finalTollAmount) > 0) extras.push(\`pedágio ${'${formatCurrency(call.finalTollAmount)}'}\`);
  if (Number(call.finalOtherExtras) > 0) extras.push(\`outros adicionais ${'${formatCurrency(call.finalOtherExtras)}'}\`);
  if (extras.length) lines.push(\`Adicionais confirmados: ${'${extras.join(\' · \')}.'}\`);
  return lines.join('\\n');
}

async function closeCallFromOwner(state, body = {}) {
  const callId = String(body.callId || body.id || body.item?.id || '');
  const index = state.calls.findIndex((item) => item.id === callId);
  if (index < 0) throw new Error('call_not_found');
  const call = state.calls[index];
  if (isTestCall(call)) throw new Error('test_call_cannot_be_closed');
  if (!(call.authorizedAt || isConfirmedCall(call) || call.cancellationChargeRequired === true)) throw new Error('call_not_authorized');
  const final = body.final || body.item || {};
  const billableKm = closingNumber(final.billableKm, closingNumber(call.billableKm, closingNumber(call.totalKm, call.estimatedTotalKm)));
  const workedHours = closingNumber(final.workedTimeChargedHours, call.workedTimeChargedHours || 0);
  const workedAmount = closingNumber(final.workedTimeAmount, workedHours > 0 ? workedHours * WORKED_HOUR_RATE : (call.workedTimeAmount || 0));
  const dirtRoadKm = closingNumber(final.dirtRoadBillableKm, call.dirtRoadBillableKm || 0);
  const dirtRoadAmount = closingNumber(final.dirtRoadChargeAmount, dirtRoadKm > 0 ? dirtRoadKm * 3.8 : (call.dirtRoadChargeAmount || 0));
  const toll = closingNumber(final.toll, call.finalTollAmount || 0);
  const invoiceExtra = closingNumber(final.invoiceExtra, 0);
  const otherExtras = closingNumber(final.otherExtras, call.finalOtherExtras || 0);
  const knowledge = await getGroupKnowledgeEntry(call.sourceGroupId);
  const resolution = commercialRulesForGroup(knowledge, call.groupName || call.insurer || call.client || '');
  let commercial = reconcileCommercial({
    approvedRules: resolution.rules,
    facts: {
      vehicleType: final.vehicleType || call.vehicleType || null,
      totalKm: billableKm,
      extras: { dirtRoadKm, toll, invoiceExtra },
      centralReportedValue: null,
    },
    estimatedTotalKm: billableKm,
  });
  if (workedAmount > 0) commercial = addWorkedTimeToCommercial(commercial, {
    chargeRequired: true, chargedHours: workedHours || Math.max(1, Math.ceil(workedAmount / WORKED_HOUR_RATE)), hourlyRate: WORKED_HOUR_RATE, amount: workedAmount,
  });
  const manualValue = closingNumber(final.value, null);
  const calculated = Number(commercial.calculatedAmount || 0) + otherExtras;
  const finalValue = manualValue !== null && manualValue > 0 ? manualValue : (calculated > 0 ? Math.round(calculated * 100) / 100 : 0);
  if (!(finalValue > 0)) throw new Error('final_value_required');
  if (!(Number(billableKm) >= 0)) throw new Error('final_km_required');
  const now = new Date().toISOString();
  const next = {
    ...call,
    status: call.status === 'cancelado' ? 'cancelado' : 'concluido',
    operationalPhase: 'concluido',
    ownerCloseRequired: true,
    ownerReviewRequired: false,
    ownerClosedAt: now,
    ownerClosedBy: String(body.ownerName || final.ownerName || 'Thiago').trim().slice(0, 120) || 'Thiago',
    ownerClosingNotes: String(final.notes || '').trim().slice(0, 1200),
    completedAt: call.status === 'cancelado' ? (call.completedAt || null) : now,
    billableKm: Number(billableKm), totalKm: Number(billableKm),
    value: finalValue,
    calculatedValue: Number(commercial.calculatedAmount || call.calculatedValue || 0) || null,
    finalTollAmount: toll,
    finalOtherExtras: otherExtras,
    dirtRoadBillableKm: dirtRoadKm,
    dirtRoadChargeAmount: Math.round(dirtRoadAmount * 100) / 100,
    workedTimeChargedHours: workedHours,
    workedTimeAmount: Math.round(workedAmount * 100) / 100,
    workedTimeChargeRequired: workedAmount > 0,
    financeReviewRequired: false,
    financeReviewReason: '',
    commercialReviewRequired: false,
    commercialReviewReason: '',
    driverPayStatus: 'definitivo',
    quoteOutcome: call.quoteTracked ? 'won' : call.quoteOutcome,
    queued: false,
    updatedAt: now,
    operationalTimeline: appendOperationalTimeline(call.operationalTimeline || [], {
      at: now, type: 'fechamento_dono', fromStatus: call.status, toStatus: call.status === 'cancelado' ? 'cancelado' : 'concluido',
      text: \`Fechamento conferido por ${'${String(body.ownerName || final.ownerName || \'Thiago\')}'} no aplicativo.\`,
      meta: { billableKm, finalValue, workedAmount, dirtRoadKm, toll, otherExtras },
    }),
  };
  state.calls[index] = next;
  ensureConfirmedFinanceTracking(state, next, { finalized: true });
  syncDriverPayrolls(state);
  await saveManagement(state);
  let noticeSent = false;
  if (waClient && waStatus === 'pronto' && next.sourceGroupId && !isTestCall(next)) {
    try {
      const message = finalGroupMessage(next);
      botReplyFingerprints.set(\`${'${next.sourceGroupId}'}|${'${normalizeForIntent(message)}'}\`, Date.now());
      await waClient.sendMessage(next.sourceGroupId, message);
      noticeSent = true;
      logEvent('owner-close', \`${'${next.groupName || next.insurer}'}: fechamento final enviado ao grupo.\`, { callId: next.id, value: next.value, billableKm: next.billableKm });
    } catch (error) {
      logEvent('warning', 'Corrida fechada, mas não foi possível enviar o resumo final ao grupo.', { callId: next.id, error: String(error) });
    }
  }
  return { call: next, noticeSent, driverPay: driverPayForCall(next) };
}

`;
  s = s.replace('async function applyManagementAction(body = {}) {', managementHelpers + 'async function applyManagementAction(body = {}) {');

  s = replaceOnce(s,
`  const action = String(body.action || 'get');
  const collection = String(body.collection || '');
  const allowed = new Set(['calls','clients','finance','fleet','automations']);`,
`  const action = String(body.action || 'get');
  const collection = String(body.collection || '');
  const allowed = new Set(['calls','clients','finance','fleet','automations']);

  if (action === 'upsert_insurer') {
    await saveInsurerConfiguration(state, body.insurer || body.item || {});
    return saveManagement(state);
  }
  if (action === 'close_call') {
    const result = await closeCallFromOwner(state, body);
    return { ...state, closeResult: result };
  }`,
    'management insurer and close actions');

  // Disponibilidade simples também é uma oportunidade/cotação rastreada.
  const newAvailability = `async function handleAvailabilityRuntime(msg, groupName, readableText, incomingLocation, context) {
  const capacity = capacitySnapshot(context.management);
  if (!capacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, 'Indisponível no momento.', { intent: 'capacity-full', activeCount: capacity.activeCount, maxConcurrentCalls: MAX_CONCURRENT_CALLS });
    return;
  }

  const facts = context.facts;
  const pending = pendingOpportunityCall(context.recentCall);
  const hasOpportunityData = Boolean(facts.origin || facts.destination || facts.vehicle || facts.plate || facts.protocol || extractLabeledField(readableText, 'Origem') || enderecoEmTextoLivre(readableText));
  let route = null;
  if (hasOpportunityData) {
    route = await estimateQuoteRoute(msg.from, readableText, facts, incomingLocation, pendingRouteContext(context.recentCall)).catch(() => ({ eta: null }));
    if (capacity.activeCount === 1 && (route.originAddress || route.originCoordinates)) {
      const queued = await estimateSecondCallArrival({ management: context.management, targetAddress: route.originAddress, targetCoordinates: route.originCoordinates });
      if (queued.eta) route.eta = queued.eta;
    }
    await setDispatchState(msg.from, {
      originAddress: route.originAddress || null, originCoordinates: route.originCoordinates || null,
      destinationAddress: route.destinationAddress || null, originUpdatedAt: new Date().toISOString(),
      lastEta: route.eta || null, lastEtaAt: route.eta ? new Date().toISOString() : null,
    });
  }
  await recordDispatchInManagement({
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
  if (route?.eta?.minutes) lines.push(formatEtaReply(route.eta, false));
  else if (hasOpportunityData) lines.push('Estou atualizando a localização para calcular a previsão.');
  await replyAndRemember(msg, groupName, readableText, lines.join('\\n'), {
    intent: 'availability', activeCount: capacity.activeCount,
    slotsAfterAccept: Math.max(0, capacity.slotsAvailable - 1),
    etaMinutes: route?.eta?.minutes ?? null, estimatedTotalKm: route?.estimatedTotalKm ?? null,
  });
}

`;
  s = replaceBetween(s, 'async function handleAvailabilityRuntime(msg, groupName, readableText, incomingLocation, context) {', 'async function handleQuoteRuntime', newAvailability, 'availability quote tracking');

  s = replaceOnce(s,
`    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    eventType: 'cotacao', phase: 'cotacao',
  });`,
`    evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    existingCallId: pendingOpportunityCall(context.recentCall)?.id || null,
    eventType: 'cotacao', phase: 'cotacao',
  });`,
    'quote attach pending');
  s = replaceOnce(s,
`  if (commercial.status === 'ok' && commercial.calculatedAmount != null) lines.push(\`Valor estimado: R$ ${'${Number(commercial.calculatedAmount).toFixed(2).replace(\'.\', \',\')}.'}\`);
  else if (/\\b(valor|pre[cç]o|quanto fica)\\b/i.test(readableText)) lines.push('Valor: em conferência pela tabela comercial.');`,
`  if (commercial.status === 'ok' && commercial.calculatedAmount != null) {
    lines.push(\`Valor estimado: R$ ${'${Number(commercial.calculatedAmount).toFixed(2).replace(\'.\', \',\')}.'}\`);
    lines.push('O valor poderá ter acréscimos conforme a execução, como hora trabalhada após 15 min, pedágio e estrada de terra, quando aplicáveis.');
  } else if (/\\b(valor|pre[cç]o|quanto fica)\\b/i.test(readableText)) lines.push('Valor: aguardando tabela comercial aprovada no aplicativo.');`,
    'quote caveat');

  const newDispatchDetails = `async function handleDispatchDetailsRuntime(msg, groupName, readableText, incomingLocation, context) {
  const call = pendingOpportunityCall(context.recentCall);
  const route = await estimateQuoteRoute(msg.from, readableText, context.facts, incomingLocation, pendingRouteContext(context.recentCall)).catch(() => ({
    eta: null, estimatedTotalKm: null, originAddress: context.facts.origin || call?.origin || null,
    destinationAddress: context.facts.destination || call?.destination || null, originCoordinates: incomingLocation || call?.originCoordinates || null,
  }));
  if (capacitySnapshot(context.management).activeCount === 1 && (route.originAddress || route.originCoordinates)) {
    const queued = await estimateSecondCallArrival({ management: context.management, targetAddress: route.originAddress, targetCoordinates: route.originCoordinates });
    if (queued.eta) route.eta = queued.eta;
  }
  const combinedFacts = {
    ...context.facts,
    origin: route.originAddress || call?.origin || '', destination: route.destinationAddress || call?.destination || '',
    vehicle: context.facts.vehicle || call?.vehicle || '',
  };
  const missing = missingDispatchData(combinedFacts);
  if (missing.length) {
    await handleIncompleteDispatchRuntime(msg, groupName, readableText, { ...context, facts: combinedFacts });
    return;
  }
  const associationMissing = context.profile.associationRequired === true && !(combinedFacts.association || call?.association);
  const pricingKm = context.billingProfile?.routeBasis === 'origin_destination'
    ? (route.secondLeg?.distanceKm ?? null)
    : context.billingProfile?.routeBasis === 'insurer_reported'
      ? (combinedFacts.totalKm ?? null)
      : context.billingProfile?.routeBasis === 'manual' ? null : route.estimatedTotalKm;
  const commercial = reconcileCommercial({ approvedRules: context.approvedRules, facts: { ...combinedFacts, totalKm: pricingKm ?? combinedFacts.totalKm }, estimatedTotalKm: pricingKm });
  await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: route.originAddress || call?.origin || null, originCoordinates: route.originCoordinates || call?.originCoordinates || null,
    destinationAddress: route.destinationAddress || call?.destination || null,
    eta: route.eta, status: 'aguardando_aprovacao', facts: combinedFacts, commercial,
    estimatedTotalKm: route.estimatedTotalKm, evidenceChecklist: buildEvidenceChecklist(groupName, readableText),
    existingCallId: call?.id || null, eventType: 'dados_do_atendimento', phase: 'aguardando_autorizacao',
  });
  const lines = ['Dados do atendimento recebidos ✅'];
  if (route.eta?.minutes) lines.push(\`Previsão até a origem: ${'${publicEtaMinutes(route.eta.rawMinutes ?? route.eta.minutes)}'} min.\`);
  if (route.estimatedTotalKm != null) lines.push(\`Percurso estimado do atendimento: ${'${route.estimatedTotalKm}'} km.\`);
  if (commercial.status === 'ok' && commercial.calculatedAmount != null) {
    lines.push(\`Valor estimado: ${'${formatCurrency(commercial.calculatedAmount)}'}.\`);
    lines.push('O valor poderá ter acréscimos conforme a execução, como hora trabalhada após 15 min, pedágio e estrada de terra, quando aplicáveis.');
  } else lines.push('Valor aguardando tabela comercial aprovada no aplicativo.');
  if (associationMissing) lines.push('Informe também a associação responsável.');
  lines.push('Aguardando autorização expressa para seguir.');
  await replyAndRemember(msg, groupName, readableText, lines.join('\\n'), { intent: 'dispatch_details', authorizationRequired: true, associationMissing, commercialStatus: commercial.status });
}

`;
  s = replaceBetween(s, 'async function handleDispatchDetailsRuntime(msg, groupName, readableText, incomingLocation, context) {', 'async function handleProtocolRuntime', newDispatchDetails, 'dispatch details pricing');

  // Persistir a fila e responder corretamente na autorização da segunda corrida.
  s = replaceOnce(s,
`  if (saved && eta?.queued) {
    saved.queued = true;
    saved.queuedBehindCallId = eta.precedingCallId || null;
    saved.queueRawEtaMinutes = eta.rawMinutes ?? null;
  }`,
`  // Os dados de fila já são persistidos por recordDispatchInManagement a partir do ETA.
  if (saved && eta?.queued) {
    saved.queued = true;
    saved.queuedBehindCallId = eta.precedingCallId || null;
    saved.queueRawEtaMinutes = eta.rawMinutes ?? null;
  }`,
    'authorization queue comment');

  s = replaceOnce(s,
`  const confirmation = formatEtaReply(eta, true) || 'Confirmado ✅';`,
`  const confirmation = eta?.queued
    ? \`Confirmado ✅\\nCorrida em fila após o atendimento atual.\\nPrevisão informada: ${'${publicEtaMinutes(eta.rawMinutes ?? eta.minutes) || 60}'} min.\`
    : (formatEtaReply(eta, true) || 'Confirmado ✅');`,
    'queued authorization reply');
  s = replaceOnce(s,
`  if (saved?.calculatedValue) details.push(\`Valor estimado: ${'${formatCurrency(saved.calculatedValue)}'}.\`);`,
`  if (saved?.calculatedValue) {
    details.push(\`Valor estimado: ${'${formatCurrency(saved.calculatedValue)}'}.\`);
    details.push('O valor poderá ter acréscimos conforme a execução, como hora trabalhada após 15 min, pedágio e estrada de terra, quando aplicáveis.');
  }`,
    'authorization value caveat');

  const newClosure = `async function handleClosureRuntime(msg, groupName, readableText, context) {
  const call = context.recentCall;
  if (!call) {
    await replyAndRemember(msg, groupName, readableText, 'Não encontrei atendimento ativo para registrar a finalização. Informe o protocolo da corrida.', { intent: 'closure-without-call' });
    return;
  }
  const reportedTotalKm = context.facts.totalKm ?? null;
  const automaticKm = call?.billableKm ?? call?.routeBreakdown?.totalKm ?? null;
  const facts = {
    ...context.facts,
    extras: { ...(context.facts.extras || {}), dirtRoadKm: context.facts.extras?.dirtRoadKm ?? call?.dirtRoadBillableKm ?? 0 },
    vehicleType: context.facts.vehicleType || call?.vehicleType || null,
    reportedTotalKm,
    totalKm: automaticKm ?? reportedTotalKm ?? call?.totalKm ?? null,
  };
  const workedTime = evaluateWorkedTime({ arrivedAt: call?.arrivalConfirmedAt || null, finishedAt: new Date(), reportedMinutes: context.facts.onSiteMinutes });
  const commercial = addWorkedTimeToCommercial(reconcileCommercial({ approvedRules: context.approvedRules, facts, estimatedTotalKm: automaticKm }), workedTime);
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || facts.origin || null, destinationAddress: call?.destination || facts.destination || null,
    eta: call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: 'aguardando_fechamento', facts, commercial, estimatedTotalKm: automaticKm,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null, workedTime,
    eventType: 'execucao_finalizada', phase: 'aguardando_fechamento_dono',
  });
  const lines = ['Execução registrada ✅'];
  const km = saved?.billableKm ?? automaticKm ?? facts.totalKm;
  if (Number.isFinite(Number(km))) lines.push(\`Quilometragem para conferência: ${'${Number(km).toLocaleString(\'pt-BR\', { maximumFractionDigits: 1 })}'} km.\`);
  if (Number(saved?.calculatedValue || commercial.calculatedAmount) > 0) lines.push(\`Valor calculado para conferência: ${'${formatCurrency(saved?.calculatedValue || commercial.calculatedAmount)}'}.\`);
  lines.push('A corrida ficou aberta para conferência e fechamento no aplicativo. O financeiro e o repasse do motorista só ficam definitivos após esse fechamento.');
  await replyAndRemember(msg, groupName, readableText, lines.join('\\n'), { intent: 'closure_pending_owner', callId: saved?.id, ownerReviewRequired: true });
}

`;
  s = replaceBetween(s, 'async function handleClosureRuntime(msg, groupName, readableText, context) {', 'async function processIncomingMessage(msg) {', newClosure, 'owner closure workflow');

  // Tracker operacional é obrigatório para ETA/chegada/tempo mesmo com IA desligada.
  s = replaceOnce(s,
`    const settings = await getSettings();
    if (settings.simpleMode === false) {
      await reconcileTrackerOperations(reading).catch((error) => {
        logEvent('warning', 'Falha ao reconciliar o atendimento com a localização do caminhão.', { error: String(error) });
      });
    }`,
`    await reconcileTrackerOperations(reading).catch((error) => {
      logEvent('warning', 'Falha ao reconciliar o atendimento com a localização do caminhão.', { error: String(error) });
    });`,
    'tracker reconcile without AI');

  const managementGet = `app.get('/api/management', async (req, res) => {
  try {
    const data = await getManagement();
    const calls = (data.calls || []).filter((item) => !isTestCall(item));
    const filters = { from: String(req.query.from || ''), to: String(req.query.to || ''), groupId: String(req.query.groupId || ''), insurerId: String(req.query.insurerId || '') };
    return res.json({ ok: true, data: { ...data, calls }, quoteFunnel: buildQuoteFunnel(calls, data.insurers || [], filters), periodReport: buildPeriodReport({ ...data, calls }, filters) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

`;
  s = replaceBetween(s, "app.get('/api/management', async (_req, res) => {", "app.post('/api/management'", managementGet, 'management GET funnel');

  const exportRoute = `app.get('/api/billing/export', async (req, res) => {
  try {
    const state = await getManagement();
    const batchId = String(req.query.batchId || '');
    let filters = {
      from: String(req.query.from || ''), to: String(req.query.to || ''),
      groupId: String(req.query.groupId || ''), insurerId: String(req.query.insurerId || ''),
    };
    if (batchId) {
      const batch = (state.billingBatches || []).find((x) => x.id === batchId);
      if (!batch) return res.status(404).send('Lote não encontrado');
      filters = { ...filters, from: batch.periodStart || filters.from, to: batch.periodEnd || filters.to, groupId: batch.groupId || filters.groupId };
    }
    const { buffer, report } = buildPeriodWorkbook(state, filters);
    const suffix = [filters.from || 'inicio', filters.to || 'hoje'].join('-');
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('content-disposition', \`attachment; filename="bot-guincho-fechamento-${'${suffix}'}.xlsx"\`);
    res.setHeader('x-botguincho-quotes', String(report.quotes.requested || 0));
    res.setHeader('x-botguincho-calls', String(report.finalCalls || 0));
    return res.end(buffer);
  } catch (error) { return res.status(500).send(String(error?.message || error)); }
});

`;
  s = replaceBetween(s, "app.get('/api/billing/export', async (req, res) => {", "app.get('/api/billing/driver-export'", exportRoute, 'period xlsx export');

  write('tools/vercel-whatsapp-worker.mjs', s);
}

// 4) Runtime reload/sandbox precisa conhecer os novos módulos, embora a produção
// principal esteja na VPS.
{
  let s = read('api/worker/reload.js');
  s = replaceOnce(s,
    "  'tools/training-runtime-index.mjs',\n",
    "  'tools/training-runtime-index.mjs',\n  'tools/business-orchestration.mjs',\n  'tools/reporting-engine.mjs',\n",
    'reload new modules');
  write('api/worker/reload.js', s);
}

// 5) Painel do dono: funil por seguradora/grupo, cadastro ligado ao WhatsApp,
// fechamento definitivo e download XLSX do período.
patchBoth(['owner-dashboard.js', 'public/owner-dashboard.js'], (s) => {
  s = replaceOnce(s,
    "  const ownerState = { billing: { profiles: [], batches: [], insurerSummaries: [], driverPayrolls: [] }, period: 'month' };",
    "  const ownerState = { billing: { profiles: [], batches: [], insurerSummaries: [], driverPayrolls: [] }, groups: [], period: 'month' };",
    'owner state groups');
  s = replaceOnce(s,
    "  const activeStatuses = new Set(['autorizado', 'a_caminho', 'em_atendimento']);",
    "  const activeStatuses = new Set(['autorizado', 'a_caminho', 'em_atendimento', 'aguardando_fechamento']);\n  const ownerFinalized = (call) => Boolean(call?.ownerClosedAt) || (call?.status === 'concluido' && call?.ownerCloseRequired !== true);",
    'owner finalized helper');

  const oldMetrics = `  function metrics() {
    const calls = (mgmt.calls || []).filter(inPeriod);
    const quotes = calls.filter(isQuote);
    const won = quotes.filter((call) => quoteOutcome(call) === 'won');
    const lost = quotes.filter((call) => quoteOutcome(call) === 'lost');
    const open = quotes.filter((call) => quoteOutcome(call) === 'open');
    const accepted = calls.filter(isAccepted);
    const billed = accepted.reduce((sum, call) => sum + n(call.value), 0);
    const finance = (mgmt.finance || []).filter((entry) => entry.type === 'receita' && inPeriod(entry));
    const received = finance.filter((entry) => entry.status === 'pago').reduce((sum, entry) => sum + n(entry.amount), 0);
    const receivable = finance.filter((entry) => entry.status !== 'pago').reduce((sum, entry) => sum + n(entry.amount), 0);
    const conversionBase = won.length + lost.length;
    const conversion = conversionBase ? (won.length / conversionBase) * 100 : 0;
    const payroll = currentPayroll();
    return { calls, quotes, won, lost, open, accepted, billed, received, receivable, conversion, payroll };
  }`;
  const newMetrics = `  function metrics() {
    const calls = (mgmt.calls || []).filter(inPeriod);
    const quotes = calls.filter(isQuote);
    const won = quotes.filter((call) => quoteOutcome(call) === 'won');
    const lost = quotes.filter((call) => quoteOutcome(call) === 'lost');
    const open = quotes.filter((call) => quoteOutcome(call) === 'open');
    const accepted = calls.filter(isAccepted);
    const finalized = accepted.filter(ownerFinalized);
    const projected = accepted.filter((call) => !ownerFinalized(call));
    const billed = finalized.reduce((sum, call) => sum + n(call.value), 0);
    const projectedValue = projected.reduce((sum, call) => sum + n(call.value || call.calculatedValue || call.quoteCalculatedValue), 0);
    const finance = (mgmt.finance || []).filter((entry) => entry.type === 'receita' && entry.isFinal === true && inPeriod(entry));
    const received = finance.filter((entry) => entry.status === 'pago').reduce((sum, entry) => sum + n(entry.amount), 0);
    const receivable = finance.filter((entry) => entry.status !== 'pago').reduce((sum, entry) => sum + n(entry.amount), 0);
    const conversionBase = won.length + lost.length;
    const conversion = conversionBase ? (won.length / conversionBase) * 100 : 0;
    const payroll = currentPayroll();
    return { calls, quotes, won, lost, open, accepted, finalized, projected, billed, projectedValue, received, receivable, conversion, payroll };
  }`;
  s = replaceOnce(s, oldMetrics, newMetrics, 'owner definitive metrics');

  s = replaceOnce(s,
    '<button class="btn secondary" onclick="ownerEditCall(null,\'quote\')">+ Cotação / corrida</button>\n          <button class="btn" onclick="newItem(\'finance\')">+ Lançamento financeiro</button>',
    '<button class="btn secondary" onclick="ownerEditCall(null,\'quote\')">+ Cotação / corrida</button>\n          <button class="btn secondary" onclick="ownerDownloadPeriodReport()">Baixar planilha</button>\n          <button class="btn" onclick="newItem(\'finance\')">+ Lançamento financeiro</button>',
    'owner report button');

  s = replaceOnce(s,
    '<div class="owner-kpi money-card"><span>Faturado</span><strong id="ownerBilled">R$ 0</strong><small>Valor das corridas aceitas</small></div>',
    '<div class="owner-kpi money-card"><span>Faturado definitivo</span><strong id="ownerBilled">R$ 0</strong><small>Somente corridas fechadas no app</small></div><div class="owner-kpi"><span>Previsto em abertas</span><strong id="ownerProjected">R$ 0</strong><small>Ainda pode ser corrigido no fechamento</small></div>',
    'owner projected KPI');

  s = replaceOnce(s,
`      <div hidden><span id="callsKpi"></span><span id="revenueKpi"></span><span id="balanceKpi"></span><span id="pendingKpi"></span></div>` ,
`      <div class="owner-grid section"><div class="card owner-panel"><div class="head"><div><h3>Conversão por seguradora</h3><p>Cotações solicitadas x ganhas.</p></div></div><div id="ownerInsurerFunnel" class="table-wrap section"></div></div><div class="card owner-panel"><div class="head"><div><h3>Conversão por grupo</h3><p>Performance individual de cada WhatsApp.</p></div></div><div id="ownerGroupFunnel" class="table-wrap section"></div></div></div><div hidden><span id="callsKpi"></span><span id="revenueKpi"></span><span id="balanceKpi"></span><span id="pendingKpi"></span></div>` ,
    'owner funnel cards');

  s = replaceOnce(s,
    "    set('ownerConversion', `${pct(m.conversion)} conversão`); set('ownerAccepted', m.accepted.length); set('ownerBilled', money(m.billed)); set('ownerReceivable', money(m.receivable)); set('ownerReceived', money(m.received));",
    "    set('ownerConversion', `${pct(m.conversion)} conversão`); set('ownerAccepted', m.accepted.length); set('ownerBilled', money(m.billed)); set('ownerProjected', money(m.projectedValue)); set('ownerReceivable', money(m.receivable)); set('ownerReceived', money(m.received));",
    'owner projected render');
  s = replaceOnce(s,
    "    renderQuoteList(m.quotes); renderAcceptedList(m.accepted); renderDriverCard(m.payroll); renderPending(m.calls);",
    "    renderQuoteList(m.quotes); renderAcceptedList(m.accepted); renderDriverCard(m.payroll); renderPending(m.calls); renderFunnelTables(m.quotes);",
    'render funnel tables call');

  s = replaceOnce(s,
    "<td>${fmtKm(call.billableKm ?? call.totalKm)}</td><td><b>${n(call.value) > 0 ? money(call.value) : 'A calcular'}</b>${call.financeReviewRequired ? '<br><span class=\"owner-alert\">Revisar</span>' : ''}</td><td>${money(driverPayForCall(call))}</td><td><button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button></td></tr>",
    "<td>${fmtKm(call.billableKm ?? call.totalKm)}</td><td><b>${n(call.value || call.calculatedValue) > 0 ? money(call.value || call.calculatedValue) : 'A calcular'}</b><br>${ownerFinalized(call) ? ownerTag('Definitivo','won') : ownerTag('Previsto','open')}${call.financeReviewRequired ? '<br><span class=\"owner-alert\">Revisar</span>' : ''}</td><td>${money(driverPayForCall(call))}</td><td><button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button>${!ownerFinalized(call) && isAccepted(call) ? `<button class=\"btn small\" onclick=\"ownerCloseCall('${esc(call.id)}')\">Fechar</button>` : ''}</td></tr>",
    'accepted close button');

  s = replaceOnce(s,
    "      <div class=\"owner-pay-total\"><span>Total previsto</span><strong>${money(payroll.totalAmount)}</strong></div>",
    "      <div class=\"owner-pay-total\"><span>Total definitivo</span><strong>${money(payroll.totalAmount)}</strong></div><div class=\"kpi-line\"><span>Ainda previsto em corridas abertas</span><b>${money(payroll.projectedAmount || 0)}</b></div>",
    'driver definitive/projected');

  const insertion = `
  function funnelRows(quotes, dimension) {
    const map = new Map();
    for (const call of quotes) {
      const key = dimension === 'insurer' ? (call.insurerId || call.insurer || call.client || 'Seguradora') : (call.sourceGroupId || call.groupName || call.insurer || 'Grupo');
      const name = dimension === 'insurer' ? (call.insurerName || call.insurer || call.client || 'Seguradora') : (call.groupName || call.insurer || call.client || 'Grupo');
      if (!map.has(key)) map.set(key, { name, requested: 0, won: 0, lost: 0, open: 0 });
      const row = map.get(key); row.requested += 1; row[quoteOutcome(call)] += 1;
    }
    return [...map.values()].map((row) => ({ ...row, conversion: row.won + row.lost ? row.won / (row.won + row.lost) * 100 : 0 })).sort((a,b)=>b.requested-a.requested);
  }

  function funnelTable(rows) {
    return rows.length ? \`<table class="table owner-table"><thead><tr><th>Nome</th><th>Solicitadas</th><th>Ganhas</th><th>Perdidas</th><th>Abertas</th><th>Conversão</th></tr></thead><tbody>${'${rows.map((row)=>`<tr><td><b>${esc(row.name)}</b></td><td>${row.requested}</td><td>${row.won}</td><td>${row.lost}</td><td>${row.open}</td><td>${pct(row.conversion)}</td></tr>`).join(\'\')}'}</tbody></table>\` : '<div class="empty">Sem cotações no período.</div>';
  }

  function renderFunnelTables(quotes) {
    const insurer = document.getElementById('ownerInsurerFunnel'); if (insurer) insurer.innerHTML = funnelTable(funnelRows(quotes, 'insurer'));
    const group = document.getElementById('ownerGroupFunnel'); if (group) group.innerHTML = funnelTable(funnelRows(quotes, 'group'));
  }

  function ensureInsurerOverview() {
    const page = document.getElementById('clients'); if (!page) return;
    const head = page.querySelector(':scope > .head');
    const h2 = head?.querySelector('h2'), p = head?.querySelector('p'), button = head?.querySelector('.btn');
    if (h2) h2.textContent = 'Seguradoras e grupos';
    if (p) p.textContent = 'Conecte cada seguradora aos grupos do WhatsApp, calendário de fechamento e tabela comercial.';
    if (button) { button.textContent = '+ Nova seguradora'; button.setAttribute('onclick', 'ownerEditInsurer()'); }
    const oldTable = page.querySelector(':scope > .table-wrap'); if (oldTable) oldTable.style.display = 'none';
    if (!document.getElementById('ownerInsurers')) head?.insertAdjacentHTML('afterend', '<div id="ownerInsurers" class="table-wrap section"></div>');
  }

  function insurerStats(insurer) {
    const groups = new Set(insurer.groupIds || []);
    const quotes = (mgmt.calls || []).filter((call) => inPeriod(call) && isQuote(call) && (call.insurerId === insurer.id || groups.has(call.sourceGroupId)));
    const won = quotes.filter((call) => quoteOutcome(call) === 'won').length;
    const lost = quotes.filter((call) => quoteOutcome(call) === 'lost').length;
    return { requested: quotes.length, won, conversion: won + lost ? won / (won + lost) * 100 : 0 };
  }

  function renderInsurers() {
    ensureInsurerOverview(); const target = document.getElementById('ownerInsurers'); if (!target) return;
    const items = mgmt.insurers || [];
    target.innerHTML = items.length ? \`<table class="table owner-table"><thead><tr><th>Seguradora</th><th>Grupos WhatsApp</th><th>Cotações</th><th>Conversão</th><th>Envio planilha</th><th>Pagamento</th><th></th></tr></thead><tbody>${'${items.map((item)=>{const st=insurerStats(item);const names=(item.groupNames||[]).length?(item.groupNames||[]): (item.groupIds||[]);return `<tr><td><b>${esc(item.name)}</b><br>${ownerTag(item.status===\'inactive\'?\'Inativa\':\'Ativa\',item.status===\'inactive\'?\'lost\':\'won\')}</td><td>${names.length?names.map((name)=>`<div class="small">${esc(name)}</div>`).join(\'\'):\'Nenhum grupo\'}</td><td>${st.requested} solicitadas · ${st.won} ganhas</td><td>${pct(st.conversion)}</td><td>${item.statementDay?`Dia ${item.statementDay}`:item.submitWindowStartDay?`Dias ${item.submitWindowStartDay}–${item.submitWindowEndDay||item.submitWindowStartDay}`:\'Configurar\'}</td><td>${item.paymentDay?`Dia ${item.paymentDay}`:\'Configurar\'}</td><td><button class="btn ghost small" onclick="ownerEditInsurer(\'${esc(item.id)}\')">Editar</button>${item.groupIds?.[0]?`<button class="btn secondary small" onclick="ownerOpenTable(\'${esc(item.groupIds[0])}\')">Tabela</button>`:\'\'}</td></tr>`}).join(\'\')}'}</tbody></table>\` : '<div class="empty">Nenhuma seguradora cadastrada. Os grupos conhecidos também são cadastrados automaticamente quando entra uma cotação.</div>';
  }

  window.ownerOpenTable = (groupId) => { showPage('groups'); setTimeout(() => { if (typeof configurarTabela === 'function') configurarTabela(groupId); }, 350); };

  window.ownerEditInsurer = (id = null) => {
    const item = (mgmt.insurers || []).find((x) => x.id === id) || {};
    const groups = (ownerState.groups || []).filter((g) => g.selected || (item.groupIds || []).includes(g.id));
    const groupHtml = groups.length ? groups.map((g) => \`<label class="group"><input type="checkbox" name="insurerGroup" value="${'${esc(g.id)}'}" ${(item.groupIds||[]).includes(g.id)?'checked':''}><div><b>${'${esc(g.name||\'Grupo\')}'}</b><div class="small">${'${esc(g.id)}'}</div></div></label>\`).join('') : '<div class="empty">Sincronize e autorize os grupos do WhatsApp primeiro.</div>';
    openModal(id ? 'Editar seguradora' : 'Nova seguradora', \`<div class="form-grid"><div class="field"><label>Nome</label><input name="name" value="${'${esc(item.name||\'\')}' }" required></div><div class="field"><label>Status</label><select name="status"><option value="active">Ativa</option><option value="inactive" ${'${item.status===\'inactive\'?\'selected\':\'\'}'}>Inativa</option></select></div><div class="field"><label>Modelo de pagamento</label><select name="paymentMode"><option value="manual">Manual</option><option value="monthly" ${'${item.paymentMode===\'monthly\'?\'selected\':\'\'}'}>Mensal</option><option value="semimonthly" ${'${item.paymentMode===\'semimonthly\'?\'selected\':\'\'}'}>Quinzenal</option><option value="per_call" ${'${item.paymentMode===\'per_call\'?\'selected\':\'\'}'}>Por corrida</option></select></div><div class="field"><label>Dia de envio da planilha</label><input name="statementDay" type="number" min="1" max="31" value="${'${item.statementDay||\'\'}'}"></div><div class="field"><label>Início janela de envio</label><input name="submitWindowStartDay" type="number" min="1" max="31" value="${'${item.submitWindowStartDay||\'\'}'}"></div><div class="field"><label>Fim janela de envio</label><input name="submitWindowEndDay" type="number" min="1" max="31" value="${'${item.submitWindowEndDay||\'\'}'}"></div><div class="field"><label>Prazo da NF</label><input name="invoiceDeadlineDay" type="number" min="1" max="31" value="${'${item.invoiceDeadlineDay||\'\'}'}"></div><div class="field"><label>Dia de pagamento</label><input name="paymentDay" type="number" min="1" max="31" value="${'${item.paymentDay||\'\'}'}"></div><div class="field"><label>Base usada no cálculo</label><input name="baseAddress" value="${'${esc(item.baseAddress||\'\')}' }"></div><div class="field"><label>Contato financeiro</label><input name="contactName" value="${'${esc(item.contactName||\'\')}' }"></div><div class="field"><label>E-mail financeiro</label><input name="contactEmail" type="email" value="${'${esc(item.contactEmail||\'\')}' }"></div></div><div class="section"><label><b>Grupos do WhatsApp ligados a esta seguradora</b></label><div class="groups section">${'${groupHtml}'}</div></div><div class="field section"><label>Observações</label><textarea name="notes">${'${esc(item.notes||\'\')}'}</textarea></div><div class="notice good section">A tabela de preço continua versionada por grupo. Use o botão “Tabela” depois de salvar para configurar/confirmar os valores que o robô pode usar.</div>\`, async () => {
      const form = document.getElementById('modalForm'); const data = Object.fromEntries(new FormData(form).entries());
      const selectedGroups = [...form.querySelectorAll('input[name="insurerGroup"]:checked')].map((input) => input.value);
      const groupNames = selectedGroups.map((groupId) => (ownerState.groups || []).find((g) => g.id === groupId)?.name || groupId);
      for (const key of ['statementDay','submitWindowStartDay','submitWindowEndDay','invoiceDeadlineDay','paymentDay']) data[key] = data[key] ? Number(data[key]) : null;
      data.id = item.id || undefined; data.groupIds = selectedGroups; data.groupNames = groupNames;
      await api('/api/worker/management', { method: 'POST', body: JSON.stringify({ action: 'upsert_insurer', insurer: data }) });
      await refreshOwner();
    });
  };

  window.ownerCloseCall = (id) => {
    const call = (mgmt.calls || []).find((x) => x.id === id); if (!call) return;
    openModal('Conferir e fechar corrida', \`<div class="notice warn">Confira os dados antes de fechar. Depois deste botão o valor vira definitivo no Financeiro, entra no repasse do motorista e o resumo é enviado ao grupo do WhatsApp.</div><div class="form-grid section"><div class="field"><label>Protocolo</label><input value="${'${esc(call.protocol||\'Aguardando\')}' }" disabled></div><div class="field"><label>Motorista</label><input value="${'${esc(call.driverName||driverName())}' }" disabled></div><div class="field"><label>KM cobrados</label><input name="billableKm" type="number" step="0.1" value="${'${n(call.billableKm??call.totalKm??call.estimatedTotalKm)||\'\'}'}"></div><div class="field"><label>Valor final</label><input name="value" type="number" step="0.01" value="${'${n(call.value||call.calculatedValue)||\'\'}'}"></div><div class="field"><label>Horas trabalhadas</label><input name="workedTimeChargedHours" type="number" step="1" min="0" value="${'${n(call.workedTimeChargedHours)||0}'}"></div><div class="field"><label>Valor hora trabalhada</label><input name="workedTimeAmount" type="number" step="0.01" min="0" value="${'${n(call.workedTimeAmount)||0}'}"></div><div class="field"><label>KM estrada de terra</label><input name="dirtRoadBillableKm" type="number" step="0.1" min="0" value="${'${n(call.dirtRoadBillableKm)||0}'}"></div><div class="field"><label>Pedágio</label><input name="toll" type="number" step="0.01" min="0" value="${'${n(call.finalTollAmount)||0}'}"></div><div class="field"><label>Outros adicionais</label><input name="otherExtras" type="number" step="0.01" min="0" value="${'${n(call.finalOtherExtras)||0}'}"></div><div class="field"><label>Fechado por</label><input name="ownerName" value="Thiago"></div></div><div class="field section"><label>Observações do fechamento</label><textarea name="notes">${'${esc(call.ownerClosingNotes||\'\')}'}</textarea></div>\`, async () => {
      const data = Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());
      for (const key of ['billableKm','value','workedTimeChargedHours','workedTimeAmount','dirtRoadBillableKm','toll','otherExtras']) data[key] = data[key] === '' ? null : Number(data[key]);
      const d = await api('/api/worker/management', { method: 'POST', body: JSON.stringify({ action: 'close_call', callId: id, ownerName: data.ownerName || 'Thiago', final: data }) });
      const sent = d.data?.closeResult?.noticeSent;
      await refreshOwner(); alert(sent ? 'Corrida fechada e resumo enviado ao grupo.' : 'Corrida fechada. O WhatsApp não confirmou o envio do resumo; confira o grupo.');
    });
  };

  window.ownerDownloadPeriodReport = () => {
    const now = new Date(); const start = periodStart();
    const fromDefault = start ? start.toISOString().slice(0,10) : ''; const toDefault = now.toISOString().slice(0,10);
    const insurers = (mgmt.insurers || []).map((item)=>\`<option value="${'${esc(item.id)}'}">${'${esc(item.name)}'}</option>\`).join('');
    const groups = (ownerState.groups || []).filter((g)=>g.selected).map((g)=>\`<option value="${'${esc(g.id)}'}">${'${esc(g.name||g.id)}'}</option>\`).join('');
    openModal('Gerar planilha do período', \`<div class="form-grid"><div class="field"><label>De</label><input name="from" type="date" value="${'${fromDefault}'}"></div><div class="field"><label>Até</label><input name="to" type="date" value="${'${toDefault}'}"></div><div class="field"><label>Seguradora</label><select name="insurerId"><option value="">Todas</option>${'${insurers}'}</select></div><div class="field"><label>Grupo</label><select name="groupId"><option value="">Todos</option>${'${groups}'}</select></div></div><div class="notice good section">A planilha XLSX sai com Resumo, Corridas, Cotações, Por seguradora, Por grupo, Financeiro e Motoristas.</div>\`, async () => {
      const data = Object.fromEntries(new FormData(document.getElementById('modalForm')).entries());
      const url = new URL('/api/worker/billing/export', location.origin); url.searchParams.set('companyId', activeCompanyId);
      for (const key of ['from','to','insurerId','groupId']) if (data[key]) url.searchParams.set(key, data[key]);
      const response = await fetch(url, { cache: 'no-store', headers: { 'x-botguincho-company-id': activeCompanyId, ...(tenantAccessToken ? { authorization: \`Bearer ${'${tenantAccessToken}'}\` } : {}) } });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = \`bot-guincho-${'${data.from||\'inicio\'}'}-${'${data.to||\'hoje\'}'}.xlsx\`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    });
  };

`;
  s = s.replace('  function renderOwnerViews() {', insertion + '  function renderOwnerViews() {');
  s = replaceOnce(s,
    "  function renderOwnerViews() {\n    renderDashboard(); renderCallsOverview(); renderFinanceOverview(); renderFleetOverview(); renderFriendlyAutomations();\n  }",
    "  function renderOwnerViews() {\n    renderDashboard(); renderCallsOverview(); renderFinanceOverview(); renderFleetOverview(); renderFriendlyAutomations(); renderInsurers();\n  }",
    'owner render insurers');
  s = replaceOnce(s,
    "  async function refreshOwner() {\n    try { await Promise.all([loadManagement(), refreshBillingOnly()]); renderOwnerViews(); } catch (error) { console.error('owner dashboard', error); }\n  }",
    "  async function refreshOwner() {\n    try { const [, , groups] = await Promise.all([loadManagement(), refreshBillingOnly(), api('/api/worker/groups').catch(()=>({groups:[]}))]); ownerState.groups = groups?.groups || []; renderOwnerViews(); } catch (error) { console.error('owner dashboard', error); }\n  }",
    'owner refresh groups');
  s = replaceOnce(s,
    "  pageMeta.calls = ['Cotações e corridas', 'Veja o que entrou pelo WhatsApp, o que foi ganho, perdido e executado.'];",
    "  pageMeta.calls = ['Cotações e corridas', 'Veja o que entrou pelo WhatsApp, o que foi ganho, perdido e executado.'];\n  pageMeta.clients = ['Seguradoras e grupos', 'Cadastros, grupos do WhatsApp, tabelas e calendário financeiro.'];",
    'owner clients meta');
  return s;
});

// 6) Testes/package.
{
  const pkg = JSON.parse(read('package.json'));
  pkg.scripts ||= {};
  pkg.scripts['test:business'] = 'node tools/test-business-orchestration.mjs';
  if (!String(pkg.scripts['test:operational'] || '').includes('test-business-orchestration')) {
    pkg.scripts['test:operational'] = `${pkg.scripts['test:operational']} && node tools/test-business-orchestration.mjs`;
  }
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');
}

console.log('BUSINESS_ORCHESTRATION_PATCH_APPLIED');
