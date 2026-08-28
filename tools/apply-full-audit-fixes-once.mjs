import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`${label}: trecho não encontrado`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}
function insertBefore(text, marker, insertion, label) {
  const index = text.indexOf(marker);
  if (index < 0) throw new Error(`${label}: marcador não encontrado`);
  return text.slice(0, index) + insertion + text.slice(index);
}

// 1) Funil, conversão e liberação da fila.
{
  const path = 'tools/business-orchestration.mjs';
  let s = read(path);
  s = replaceOnce(s,
`export function quoteOutcome(call = {}) {
  if (!isTrackedQuote(call)) return null;
  if (call.quoteOutcome === 'won' || call.quoteOutcome === 'lost' || call.quoteOutcome === 'open') return call.quoteOutcome;
  if (call.authorizedAt || WON_STATUSES.has(String(call.status || ''))) return 'won';
  if (call.status === 'cancelado' && call.cancellationChargeRequired !== true) return 'lost';
  return 'open';
}`,
`export function quoteOutcome(call = {}) {
  if (!isTrackedQuote(call)) return null;
  if (call.quoteOutcome === 'won') return 'won';
  // O estado operacional real tem prioridade sobre um quoteOutcome antigo/stale.
  if (call.authorizedAt || WON_STATUSES.has(String(call.status || ''))) return 'won';
  if (call.quoteOutcome === 'lost') return 'lost';
  if (call.status === 'cancelado' && call.cancellationChargeRequired !== true) return 'lost';
  if (call.quoteOutcome === 'open') return 'open';
  return 'open';
}`,
  'quoteOutcome aceita autorização real');

  s = replaceOnce(s,
`    conversionRate: decided ? Math.round((bucket.won / decided) * 10000) / 100 : 0,`,
`    conversionRate: bucket.requested ? Math.round((bucket.won / bucket.requested) * 10000) / 100 : 0,`,
  'conversão sobre solicitadas');

  const marker = `function inPeriod(call = {}, { from = '', to = '' } = {}) {`;
  const insertion = `export function releaseNextQueuedCall(state = {}, completedCallId = '', at = new Date()) {
  if (!Array.isArray(state.calls) || !completedCallId) return null;
  const releasedAt = new Date(at);
  const iso = Number.isFinite(releasedAt.getTime()) ? releasedAt.toISOString() : new Date().toISOString();
  const candidates = state.calls
    .filter((call) => call?.queued === true
      && (call?.queuedBehindCallId === completedCallId || call?.precedingCallId === completedCallId)
      && String(call?.status || '') === 'autorizado')
    .sort((a, b) => new Date(a.authorizedAt || a.createdAt || 0) - new Date(b.authorizedAt || b.createdAt || 0));
  const next = candidates[0] || null;
  if (!next) return null;
  next.queued = false;
  next.queuedBehindCallId = null;
  next.precedingCallId = null;
  next.queueReleasedAt = iso;
  next.operationalPhase = 'autorizado';
  next.updatedAt = iso;
  return next;
}

`;
  s = insertBefore(s, marker, insertion, 'liberação de fila');
  write(path, s);
}

// 2) Relatórios: somente definitivo como recebido e data de fechamento real.
{
  const path = 'tools/reporting-engine.mjs';
  let s = read(path);
  s = replaceOnce(s,
`function financialEntries(state = {}, filters = {}) {
  const callById = new Map((state.calls || []).map((call) => [call.id, call]));
  return (state.finance || []).filter((entry) => {
    const call = callById.get(entry.sourceCallId);
    const decorated = call ? { ...entry, insurerId: call.insurerId, sourceGroupId: call.sourceGroupId } : entry;
    return applyFilters(decorated, filters);
  });
}`,
`function financialEntries(state = {}, filters = {}) {
  const callById = new Map((state.calls || []).map((call) => [call.id, call]));
  return (state.finance || [])
    .map((entry) => {
      const call = callById.get(entry.sourceCallId);
      return call ? {
        ...entry,
        insurerId: call.insurerId,
        sourceGroupId: call.sourceGroupId,
        groupName: entry.groupName || call.groupName || '',
        ownerClosedAt: call.ownerClosedAt || null,
        completedAt: call.completedAt || null,
        authorizedAt: call.authorizedAt || null,
      } : entry;
    })
    .filter((entry) => applyFilters(entry, filters));
}`,
  'financeiro decorado por data da corrida');
  s = replaceOnce(s,
`  const received = finance.filter((entry) => entry.type === 'receita' && entry.status === 'pago').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);`,
`  const received = finance.filter((entry) => entry.type === 'receita' && entry.isFinal === true && entry.status === 'pago').reduce((sum, entry) => sum + Number(entry.amount || 0), 0);`,
  'recebido somente definitivo');
  s = replaceOnce(s,
`    Data: dateOnly(entry.createdAt),`,
`    Data: dateOnly(entry.ownerClosedAt || entry.updatedAt || entry.createdAt),`,
  'data financeiro na planilha');
  write(path, s);
}

// 3) Painel: conversão sobre total solicitado e status real prevalece.
for (const path of ['owner-dashboard.js', 'public/owner-dashboard.js']) {
  let s = read(path);
  s = replaceOnce(s,
`    if (call.quoteOutcome === 'lost') return 'lost';
    if (call.quoteOutcome === 'won') return 'won';
    if (acceptedStatuses.has(call.status) || call.authorizedAt) return 'won';`,
`    if (call.quoteOutcome === 'won') return 'won';
    if (acceptedStatuses.has(call.status) || call.authorizedAt) return 'won';
    if (call.quoteOutcome === 'lost') return 'lost';`,
  `${path}: resultado real da cotação`);
  s = replaceOnce(s,
`    const conversionBase = won.length + lost.length;
    const conversion = conversionBase ? (won.length / conversionBase) * 100 : 0;`,
`    const conversion = quotes.length ? (won.length / quotes.length) * 100 : 0;`,
  `${path}: conversão geral`);
  s = replaceOnce(s,
`    return [...map.values()].map((row) => ({ ...row, conversion: row.won + row.lost ? row.won / (row.won + row.lost) * 100 : 0 })).sort((a,b)=>b.requested-a.requested);`,
`    return [...map.values()].map((row) => ({ ...row, conversion: row.requested ? row.won / row.requested * 100 : 0 })).sort((a,b)=>b.requested-a.requested);`,
  `${path}: conversão tabela`);
  s = replaceOnce(s,
`    return { requested: quotes.length, won, conversion: won + lost ? won / (won + lost) * 100 : 0 };`,
`    return { requested: quotes.length, won, conversion: quotes.length ? won / quotes.length * 100 : 0 };`,
  `${path}: conversão seguradora`);
  write(path, s);
}

// 4) Worker: tabela por seguradora, fechamento obrigatório, promoção da fila e mensagem de 15 min.
{
  const path = 'tools/vercel-whatsapp-worker.mjs';
  let s = read(path);
  s = replaceOnce(s,
`import { ensureInsurerForGroup, sanitizeInsurer, upsertInsurer, buildQuoteFunnel, quoteTrackingPatch, isOwnerFinalizedCall } from './business-orchestration.mjs';`,
`import { ensureInsurerForGroup, sanitizeInsurer, upsertInsurer, buildQuoteFunnel, quoteTrackingPatch, isOwnerFinalizedCall, releaseNextQueuedCall } from './business-orchestration.mjs';`,
  'import releaseNextQueuedCall');

  const commercialMarker = `function getAiClient() {`;
  const commercialInsertion = `async function resolveCommercialRulesForOperationalGroup(state = {}, groupId = '', groupName = '') {
  const knowledge = await getGroupKnowledgeEntry(groupId);
  const direct = commercialRulesForGroup(knowledge, groupName);
  if (direct.rules) return { ...direct, knowledge, sourceGroupId: groupId };

  const insurer = (state.insurers || []).find((item) => Array.isArray(item.groupIds) && item.groupIds.includes(groupId));
  if (insurer) {
    for (const linkedGroupId of insurer.groupIds || []) {
      if (!linkedGroupId || linkedGroupId === groupId) continue;
      const linkedKnowledge = await getGroupKnowledgeEntry(linkedGroupId);
      if (linkedKnowledge?.commercialStatus === 'approved' && linkedKnowledge?.approvedCommercialRules) {
        return {
          rules: linkedKnowledge.approvedCommercialRules,
          source: 'approved_insurer',
          sourceGroupId: linkedGroupId,
          knowledge,
        };
      }
    }
  }
  return { ...direct, knowledge, sourceGroupId: groupId };
}

`;
  s = insertBefore(s, commercialMarker, commercialInsertion, 'resolver tabela por seguradora');

  s = replaceOnce(s,
`    const knowledge = await getGroupKnowledgeEntry(groupId);`,
`    const commercialResolution = await resolveCommercialRulesForOperationalGroup(state, groupId, groupName);
    const knowledge = commercialResolution.knowledge;`,
  'record: resolve tabela vinculada');
  s = replaceOnce(s,
`    const resolvedRules = commercialRulesForGroup(knowledge, groupName);`,
`    const resolvedRules = commercialResolution;`,
  'record: usar tabela vinculada');

  s = replaceOnce(s,
`  const knowledge = await getGroupKnowledgeEntry(call.sourceGroupId);
  const resolution = commercialRulesForGroup(knowledge, call.groupName || call.insurer || call.client || '');`,
`  const resolution = await resolveCommercialRulesForOperationalGroup(state, call.sourceGroupId, call.groupName || call.insurer || call.client || '');`,
  'fechamento: tabela seguradora');

  s = replaceOnce(s,
`  const knowledge = await getGroupKnowledgeEntry(groupId);
  const commercialResolution = commercialRulesForGroup(knowledge, groupName);
  const approvedRules = commercialResolution.rules;`,
`  const commercialResolution = await resolveCommercialRulesForOperationalGroup(management, groupId, groupName);
  const knowledge = commercialResolution.knowledge;
  const approvedRules = commercialResolution.rules;`,
  'contexto: tabela seguradora');

  s = replaceOnce(s,
`      commercialRuleStatus: resolvedRules.source === 'test_default' ? 'test_default' : (knowledge?.commercialStatus || existing?.commercialRuleStatus || 'none'),`,
`      commercialRuleStatus: resolvedRules.source === 'test_default' ? 'test_default' : (resolvedRules.source.startsWith('approved') ? 'approved' : (knowledge?.commercialStatus || existing?.commercialRuleStatus || 'none')),`,
  'status de tabela herdada');

  s = replaceOnce(s,
`    amount ? 'O valor poderá ter acréscimos conforme a execução, como hora trabalhada após 15 min, pedágio e estrada de terra, quando aplicáveis.' : null,
  ].filter(Boolean);`,
`    amount ? 'O valor poderá ter acréscimos conforme a execução, como hora trabalhada após 15 min, pedágio e estrada de terra, quando aplicáveis.' : null,
    'Cancelamento sem custo em até 15 minutos após a confirmação. Após esse prazo, a saída e o deslocamento são cobrados conforme a regra vigente.',
  ].filter(Boolean);`,
  'mensagem de cancelamento na autorização');

  const promotionMarker = `async function handleDispatch(msg, groupName, readableText, location) {`;
  const promotionInsertion = `async function promoteQueuedCallAfter(completedCallId) {
  if (!completedCallId) return null;
  const state = await getManagement();
  const next = releaseNextQueuedCall(state, completedCallId, new Date());
  if (!next) return null;

  let eta = null;
  if (next.origin || next.originCoordinates) {
    eta = await computeEtaWithRetry({ targetAddress: next.origin || null, targetCoordinates: next.originCoordinates || null }).catch(() => null);
    if (eta) {
      next.etaMinutes = publicEtaMinutes(eta.rawMinutes ?? eta.minutes);
      next.rawEtaMinutes = eta.rawMinutes ?? eta.minutes ?? null;
      next.distanceKm = eta.distanceKm ?? next.distanceKm ?? null;
    }
  }
  await saveManagement(state);
  const driverNotification = await notifyDriverOfConfirmedCall(next, { force: true });

  let groupNoticeSent = false;
  if (waClient && waStatus === 'pronto' && next.sourceGroupId && !isTestCall(next)) {
    try {
      const lines = ['Guincho liberado para este atendimento ✅'];
      if (next.etaMinutes) lines.push(\`Nova previsão de chegada: \${next.etaMinutes} min.\`);
      const message = lines.join('\\n');
      botReplyFingerprints.set(\`\${next.sourceGroupId}|\${normalizeForIntent(message)}\`, Date.now());
      await waClient.sendMessage(next.sourceGroupId, message);
      groupNoticeSent = true;
    } catch (error) {
      logEvent('warning', 'A segunda corrida foi liberada, mas não foi possível avisar o grupo.', { callId: next.id, error: String(error) });
    }
  }
  logEvent('queue', 'Próxima corrida liberada automaticamente após finalizar a anterior.', {
    completedCallId, nextCallId: next.id, driverNotification: driverNotification.sent ? 'sent' : driverNotification.reason, groupNoticeSent,
  });
  return next;
}

`;
  s = insertBefore(s, promotionMarker, promotionInsertion, 'promoção automática da fila');

  s = replaceOnce(s,
`  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || facts.origin || null, destinationAddress: call?.destination || facts.destination || null,
    eta: call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: 'aguardando_fechamento', facts, commercial, estimatedTotalKm: automaticKm,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null, workedTime,
    eventType: 'execucao_finalizada', phase: 'aguardando_fechamento_dono',
  });
  const lines = ['Execução registrada ✅'];`,
`  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: call?.origin || facts.origin || null, destinationAddress: call?.destination || facts.destination || null,
    eta: call?.etaMinutes ? { minutes: call.etaMinutes, distanceKm: call.distanceKm } : null,
    status: 'aguardando_fechamento', facts, commercial, estimatedTotalKm: automaticKm,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null, workedTime,
    eventType: 'execucao_finalizada', phase: 'aguardando_fechamento_dono',
  });
  if (saved) await promoteQueuedCallAfter(saved.id);
  const lines = ['Execução registrada ✅'];`,
  'finalização libera fila');

  s = replaceOnce(s,
`  logEvent('cancellation-policy', \`${'${groupName}'}: cancelamento ${'${cancellation.chargeRequired ? \'após\' : \'dentro do\'}'} prazo de 15 minutos.\`, {`,
`  if (saved) await promoteQueuedCallAfter(saved.id);
  logEvent('cancellation-policy', \`${'${groupName}'}: cancelamento ${'${cancellation.chargeRequired ? \'após\' : \'dentro do\'}'} prazo de 15 minutos.\`, {`,
  'cancelamento libera fila');

  s = replaceOnce(s,
`  logEvent('arrival-without-tow', \`${'${groupName}'}: chegada confirmada, sem reboque e com deslocamento cobrável.\`, {`,
`  if (saved) await promoteQueuedCallAfter(saved.id);
  logEvent('arrival-without-tow', \`${'${groupName}'}: chegada confirmada, sem reboque e com deslocamento cobrável.\`, {`,
  'sem reboque libera fila');

  s = replaceOnce(s,
`  await saveManagement(state);
  let noticeSent = false;`,
`  await saveManagement(state);
  await promoteQueuedCallAfter(next.id);
  let noticeSent = false;`,
  'fechamento dono libera fila');

  const oldManual = `    if (collection === 'calls') {
      const savedCall = idx >= 0 ? state[collection][idx] : state[collection][0];
      if (body.item?.status === 'concluido' && Number(body.item?.value || 0) > 0) {
        savedCall.financeReviewRequired = false;
        savedCall.financeReviewReason = '';
        savedCall.financeReviewResolvedAt = new Date().toISOString();
        savedCall.valueSource = 'manual';
      }
      if (isConfirmedCall(savedCall)) ensureConfirmedFinanceTracking(state, savedCall, { finalized: savedCall.status === 'concluido' });
      else maybeCreateFinanceFromBillableCall(state, savedCall);
      if (savedCall.status === 'cancelado' && savedCall.cancellationChargeRequired !== true) removeUnbilledConfirmedTracking(state, savedCall.id);
      syncDriverPayrolls(state);
    }`;
  const newManual = `    if (collection === 'calls') {
      const savedCall = idx >= 0 ? state[collection][idx] : state[collection][0];
      if (body.item?.status === 'concluido' && !body.item?.ownerClosedAt && savedCall.historicalImport !== true) {
        savedCall.status = 'aguardando_fechamento';
        savedCall.ownerCloseRequired = true;
        savedCall.ownerReviewRequired = true;
        savedCall.operationalPhase = 'aguardando_fechamento_dono';
        savedCall.manual_conclusion_redirected_to_owner_close = true;
      }
      if (savedCall.ownerClosedAt && Number(savedCall.value || 0) > 0) {
        savedCall.financeReviewRequired = false;
        savedCall.financeReviewReason = '';
        savedCall.financeReviewResolvedAt = new Date().toISOString();
        savedCall.valueSource = savedCall.valueSource || 'manual';
      }
      if (isConfirmedCall(savedCall)) ensureConfirmedFinanceTracking(state, savedCall, { finalized: isOwnerFinalizedCall(savedCall) });
      else maybeCreateFinanceFromBillableCall(state, savedCall);
      if (savedCall.status === 'cancelado' && savedCall.cancellationChargeRequired !== true) removeUnbilledConfirmedTracking(state, savedCall.id);
      syncDriverPayrolls(state);
    }`;
  s = replaceOnce(s, oldManual, newManual, 'bloquear conclusão manual');

  write(path, s);
}

// 5) Central de Testes: ampliar cobertura dos fluxos de gestão que não usam WhatsApp real.
{
  const path = 'tools/test-center.mjs';
  let s = read(path);
  s = replaceOnce(s, `export const TEST_SUITE_VERSION = 'operational-v5.2-auto-pricing-tracker';`, `export const TEST_SUITE_VERSION = 'operational-v5.3-full-business-audit';`, 'versão testes');
  s = replaceOnce(s,
`      { send: 'Confirmado, pode seguir com o atendimento.', expect: ['confirmado', 'cancelamento', '15'] },`,
`      { send: 'Confirmado, pode seguir com o atendimento.', expect: ['confirmado', 'cancelamento', '15'], expectAll: true },`,
  'autorização crítica exige tudo');
  s = replaceOnce(s,
`      { send: 'O guincho chegou no local do cliente.', expect: ['chegada', '15', '80'] },`,
`      { send: 'O guincho chegou no local do cliente.', expect: ['chegada', '15', '80'], expectAll: true },`,
  'chegada crítica exige tudo');

  const marker = `  { id: 'driver_period', category: 'Motorista', name: 'Fechamento do dia 20 ao dia 20', mode: 'engine' },\n];`;
  const replacement = `  { id: 'driver_period', category: 'Motorista', name: 'Fechamento do dia 20 ao dia 20', mode: 'engine' },
  { id: 'capacity_two_calls', category: 'Capacidade', name: 'Máximo de duas corridas simultâneas', mode: 'engine' },
  { id: 'capacity_eta_cap', category: 'Capacidade', name: 'Prévia da segunda corrida limitada a 60 min', mode: 'engine' },
  { id: 'quote_funnel', category: 'Gestão', name: 'Funil solicitado, ganho, perdido e aberto', mode: 'engine' },
  { id: 'owner_close_required', category: 'Gestão', name: 'Fechamento definitivo somente pelo dono', mode: 'engine' },
  { id: 'driver_projection', category: 'Motorista', name: 'Repasse previsto vira definitivo no fechamento', mode: 'engine' },
  { id: 'report_final_only', category: 'Financeiro', name: 'Relatório não soma receita prevista', mode: 'engine' },
  { id: 'insurer_multi_group', category: 'Seguradoras', name: 'Uma seguradora vinculada a vários grupos', mode: 'engine' },
  { id: 'billing_calendar', category: 'Financeiro', name: 'Calendário de envio e pagamento', mode: 'engine' },
  { id: 'workbook_export', category: 'Relatórios', name: 'Planilha XLSX completa do período', mode: 'engine' },
];`;
  s = replaceOnce(s, marker, replacement, 'novos cenários de motor');
  write(path, s);
}

// 6) Motor dos novos cenários na Central de Testes.
{
  const path = 'tools/vercel-whatsapp-worker.mjs';
  let s = read(path);
  const marker = `  if (id === 'driver_period') { const first = driverPayrollPeriodFor('2026-08-20T12:00:00Z'); const second = driverPayrollPeriodFor('2026-08-21T12:00:00Z'); return { passed: first.periodStart === '2026-07-20' && first.periodEnd === '2026-08-20' && second.periodStart === '2026-08-20' && second.periodEnd === '2026-09-20', expected: '20/07–20/08 e 20/08–20/09', actual: { first, second } }; }\n  return { passed: false, expected: 'Cenário conhecido', actual: null };`;
  const replacement = `  if (id === 'driver_period') { const first = driverPayrollPeriodFor('2026-08-20T12:00:00Z'); const second = driverPayrollPeriodFor('2026-08-21T12:00:00Z'); return { passed: first.periodStart === '2026-07-20' && first.periodEnd === '2026-08-20' && second.periodStart === '2026-08-20' && second.periodEnd === '2026-09-20', expected: '20/07–20/08 e 20/08–20/09', actual: { first, second } }; }
  if (id === 'capacity_two_calls') { const actual = capacitySnapshot({ calls: [{ id:'1', status:'autorizado' }, { id:'2', status:'a_caminho' }] }); return { passed: actual.activeCount === 2 && actual.canAccept === false, expected: '2 ativas e terceira bloqueada', actual }; }
  if (id === 'capacity_eta_cap') { const actual = capSecondCallEta(93, 60); return { passed: actual.minutes === 60 && actual.rawMinutes === 93 && actual.cappedAtOneHour === true, expected: '93 min reais, 60 min públicos', actual }; }
  if (id === 'quote_funnel') { const insurerState = { insurers: [] }; const ins = ensureInsurerForGroup(insurerState, { groupId:'111@g.us', groupName:'Horizonte', profileKey:'horizonte' }); const calls = [{id:'a',sourceGroupId:'111@g.us',groupName:'Horizonte',insurerId:ins.id,quoteTracked:true,quoteOutcome:'won',quoteRequestedAt:'2026-08-01T12:00:00Z',status:'autorizado'},{id:'b',sourceGroupId:'111@g.us',groupName:'Horizonte',insurerId:ins.id,quoteTracked:true,quoteOutcome:'lost',quoteRequestedAt:'2026-08-02T12:00:00Z',status:'cancelado'},{id:'c',sourceGroupId:'111@g.us',groupName:'Horizonte',insurerId:ins.id,quoteTracked:true,quoteOutcome:'open',quoteRequestedAt:'2026-08-03T12:00:00Z',status:'cotacao'}]; const actual = buildQuoteFunnel(calls, insurerState.insurers, {}); return { passed: actual.overall.requested === 3 && actual.overall.won === 1 && actual.overall.lost === 1 && actual.overall.open === 1 && Math.abs(actual.overall.conversionRate - 33.33) < 0.01, expected:'3 solicitadas · 1 ganha · 1 perdida · 1 aberta · 33,33%', actual }; }
  if (id === 'owner_close_required') { const pending = { status:'concluido', ownerCloseRequired:true }; const closed = { ...pending, ownerClosedAt:'2026-08-20T14:00:00Z' }; return { passed: !isOwnerFinalizedCall(pending) && isOwnerFinalizedCall(closed), expected:'Só ownerClosedAt torna definitivo', actual:{ pending:isOwnerFinalizedCall(pending), closed:isOwnerFinalizedCall(closed) } }; }
  if (id === 'driver_projection') { const state={calls:[{id:'c',status:'autorizado',authorizedAt:'2026-08-21T12:00:00Z',billableKm:80,driverId:'mauro',driverName:'Mauro'}],fleet:[],driverPayrolls:[],finance:[]}; syncDriverPayrolls(state,new Date('2026-08-22T12:00:00Z')); const before={...state.driverPayrolls[0]}; state.calls[0].status='concluido';state.calls[0].ownerCloseRequired=true;state.calls[0].ownerClosedAt='2026-08-21T13:00:00Z';syncDriverPayrolls(state,new Date('2026-08-22T12:00:00Z')); const after=state.driverPayrolls[0]; return { passed: before.projectedAmount===61 && before.totalAmount===0 && after.projectedAmount===0 && after.totalAmount===61, expected:'R$61 previsto → R$61 definitivo', actual:{before,after} }; }
  if (id === 'report_final_only') { const call={id:'f',status:'concluido',ownerCloseRequired:true,ownerClosedAt:'2026-08-20T13:00:00Z',billableKm:50,value:180,driverName:'Mauro',sourceGroupId:'111@g.us',groupName:'Horizonte'}; const projected={id:'p',status:'autorizado',authorizedAt:'2026-08-20T14:00:00Z',billableKm:30,calculatedValue:140,sourceGroupId:'111@g.us',groupName:'Horizonte'}; const actual=buildPeriodReport({calls:[call,projected],finance:[{id:'1',type:'receita',isFinal:true,status:'pago',amount:180,sourceCallId:'f',createdAt:call.ownerClosedAt},{id:'2',type:'receita',isFinal:false,status:'pago',amount:140,sourceCallId:'p',createdAt:projected.authorizedAt}],insurers:[]},{from:'2026-08-01',to:'2026-08-31'}); return { passed: actual.revenue===180 && actual.received===180 && actual.finalCalls===1, expected:'Somente R$180 definitivos', actual }; }
  if (id === 'insurer_multi_group') { const state={insurers:[]}; const a=ensureInsurerForGroup(state,{groupId:'111@g.us',groupName:'Horizonte A',profileKey:'horizonte'}); const b=ensureInsurerForGroup(state,{groupId:'222@g.us',groupName:'Horizonte B',profileKey:'horizonte'}); return { passed:a.id===b.id && b.groupIds.length===2, expected:'1 seguradora com 2 grupos', actual:b }; }
  if (id === 'billing_calendar') { const profile=sanitizeBillingProfile({groupId:'111@g.us',groupName:'Premium Assistência',status:'approved',paymentMode:'monthly',cycles:[{id:'m',statementDay:30,paymentDay:15,paymentMonthOffset:1}]}); const actual=settlementForCall(profile,{},'2026-08-10T12:00:00Z'); return { passed:actual.status==='ok' && actual.batch?.statementDue==='2026-08-30' && actual.dueDate==='2026-09-15', expected:'Envio 30/08 · pagamento 15/09', actual }; }
  if (id === 'workbook_export') { const call={id:'f',status:'concluido',ownerCloseRequired:true,ownerClosedAt:'2026-08-20T13:00:00Z',billableKm:50,value:180,driverName:'Mauro',sourceGroupId:'111@g.us',groupName:'Horizonte'}; const actual=buildPeriodWorkbook({calls:[call],finance:[{id:'1',type:'receita',isFinal:true,status:'pendente',amount:180,sourceCallId:'f',createdAt:call.ownerClosedAt}],insurers:[]},{from:'2026-08-01',to:'2026-08-31'}); return { passed:Buffer.isBuffer(actual.buffer) && actual.buffer.length>1000, expected:'XLSX válido com múltiplas abas', actual:{bytes:actual.buffer.length} }; }
  return { passed: false, expected: 'Cenário conhecido', actual: null };`;
  s = replaceOnce(s, marker, replacement, 'motor cenários adicionais');
  write(path, s);
}

// 7) Scripts npm para auditoria recorrente.
{
  const path = 'package.json';
  const pkg = JSON.parse(read(path));
  pkg.scripts['test:full'] = 'node tools/test-full-business-flow.mjs';
  pkg.scripts['test:all'] = 'npm run build && npm run test:operational && npm run test:cancellation && npm run test:business && npm run test:full';
  write(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log('FULL_AUDIT_FIXES_APPLIED');
