import crypto from 'node:crypto';

function norm(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function clean(value = '', max = 500) { return String(value || '').trim().replace(/\s+/g,' ').slice(0,max); }
function clampDay(value, fallback = 1) { const n = Number(value); return Number.isInteger(n) ? Math.min(31,Math.max(1,n)) : fallback; }
function dateOnly(value = new Date()) { const d = value instanceof Date ? value : new Date(value); return d.toISOString().slice(0,10); }
function daysInMonth(year, monthIndex) { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }
function atDay(year, monthIndex, day) { return new Date(Date.UTC(year, monthIndex, Math.min(clampDay(day), daysInMonth(year, monthIndex)), 12,0,0)); }
function addMonths(date, count) { const d = new Date(date); return atDay(d.getUTCFullYear(), d.getUTCMonth() + Number(count || 0), d.getUTCDate()); }
function addDays(date, count) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + Number(count || 0)); return d; }
function money(value) { return Math.round(Number(value || 0) * 100) / 100; }

const OBSERVED_TEMPLATES = [
  {
    key: 'premium', match: /premium assistencia/,
    profile: {
      paymentMode: 'monthly', routeBasis: 'truck_origin_destination_base',
      cycles: [{ id: 'monthly-30-15', statementDay: 30, lookbackDays: 30, paymentDay: 15, paymentMonthOffset: 1 }],
      sourceNote: 'Histórico observado: planilha enviada no dia 30 e pagamento no dia 15 do mês seguinte.',
    },
  },
  {
    key: 'assistencia-segura', match: /assistencia segura/,
    profile: {
      paymentMode: 'semimonthly', routeBasis: 'truck_origin_destination_base',
      cycles: [
        { id: 'segura-15', submitWindowStartDay: 1, submitWindowEndDay: 5, invoiceDeadlineDay: 10, paymentDay: 15, paymentMonthOffset: 0 },
        { id: 'segura-30', submitWindowStartDay: 16, submitWindowEndDay: 20, invoiceDeadlineDay: 24, paymentDay: 30, paymentMonthOffset: 0 },
      ],
      sourceNote: 'Histórico observado: fechamento 01-05/NF até 10 para pagamento dia 15; fechamento 16-20/NF até 24 para pagamento dia 30.',
    },
  },
  {
    key: 'plus', match: /plus assistencia/,
    profile: {
      paymentMode: 'semimonthly', routeBasis: 'truck_origin_destination_base',
      cycles: [
        { id: 'plus-15', paymentDay: 15, paymentMonthOffset: 0 },
        { id: 'plus-30', paymentDay: 30, paymentMonthOffset: 0 },
      ],
      sourceNote: 'Histórico confirma fechamento quinzenal e pagamentos nos dias 15 e 30/31; janelas exatas de envio precisam ser confirmadas.',
    },
  },
  {
    key: 'socorre', match: /socorre assistencia|\bsocorre\b/,
    profile: { paymentMode: 'semimonthly', routeBasis: 'truck_origin_destination_base', cycles: [], sourceNote: 'Histórico confirma fechamento quinzenal; datas de envio/pagamento precisam ser confirmadas.' },
  },
  {
    key: 'saturno', match: /saturno|\bsb\b/,
    profile: { paymentMode: 'semimonthly', routeBasis: 'truck_origin_destination_base', cycles: [], sourceNote: 'Histórico registra operação quinzenal/faturada e base do prestador; datas exatas de pagamento precisam ser confirmadas.' },
  },
  {
    key: 'company-truck', match: /company truck/,
    profile: { paymentMode: 'per_call', routeBasis: 'truck_origin_destination_base', daysToPay: 0, cycles: [], sourceNote: 'Histórico mostra atendimentos à vista/por chamado, com evidências e NF em vários casos.' },
  },
  {
    key: 'power', match: /\bpower\b/,
    profile: { paymentMode: 'dynamic_per_call', routeBasis: 'truck_origin_destination_base', daysToPay: 0, cycles: [], sourceNote: 'Histórico alterna à vista e faturado; o modo deve ser definido por chamado quando a central informar.' },
  },
  {
    key: 'solucao', match: /solucao assistencia/,
    profile: { paymentMode: 'manual', routeBasis: 'truck_origin_destination_base', cycles: [], sourceNote: 'Fechamento com km e valor está bem documentado; calendário financeiro ainda precisa de confirmação.' },
  },
  {
    key: 'top-brasil', match: /top brasil/,
    profile: { paymentMode: 'manual', routeBasis: 'truck_origin_destination_base', cycles: [], sourceNote: 'Tabela/cotação está documentada; calendário financeiro ainda precisa de confirmação.' },
  },
  {
    key: 'horizonte', match: /horizonte/,
    profile: { paymentMode: 'manual', routeBasis: 'truck_origin_destination_base', cycles: [], sourceNote: 'Calendário financeiro não ficou suficientemente claro no histórico para ativação automática.' },
  },
];

function sanitizeCycle(raw = {}, idx = 0) {
  const out = {
    id: clean(raw.id || `cycle-${idx+1}`, 80),
    statementDay: raw.statementDay == null || raw.statementDay === '' ? null : clampDay(raw.statementDay),
    lookbackDays: raw.lookbackDays == null || raw.lookbackDays === '' ? null : Math.min(120,Math.max(1,Number(raw.lookbackDays) || 30)),
    submitWindowStartDay: raw.submitWindowStartDay == null || raw.submitWindowStartDay === '' ? null : clampDay(raw.submitWindowStartDay),
    submitWindowEndDay: raw.submitWindowEndDay == null || raw.submitWindowEndDay === '' ? null : clampDay(raw.submitWindowEndDay),
    invoiceDeadlineDay: raw.invoiceDeadlineDay == null || raw.invoiceDeadlineDay === '' ? null : clampDay(raw.invoiceDeadlineDay),
    paymentDay: raw.paymentDay == null || raw.paymentDay === '' ? null : clampDay(raw.paymentDay),
    paymentMonthOffset: Math.min(3,Math.max(0,Number(raw.paymentMonthOffset) || 0)),
  };
  return out;
}

export function sanitizeBillingProfile(raw = {}) {
  const modes = new Set(['monthly','semimonthly','per_call','dynamic_per_call','manual']);
  const routeBases = new Set(['truck_origin_destination_base','origin_destination','insurer_reported','manual']);
  return {
    id: clean(raw.id || crypto.randomUUID(), 100),
    groupId: clean(raw.groupId, 160),
    groupName: clean(raw.groupName, 200),
    status: raw.status === 'approved' ? 'approved' : 'needs_review',
    paymentMode: modes.has(raw.paymentMode) ? raw.paymentMode : 'manual',
    routeBasis: routeBases.has(raw.routeBasis) ? raw.routeBasis : 'truck_origin_destination_base',
    baseAddress: clean(raw.baseAddress, 600),
    daysToPay: Math.min(180,Math.max(0,Number(raw.daysToPay) || 0)),
    cycles: (Array.isArray(raw.cycles) ? raw.cycles : []).slice(0,6).map(sanitizeCycle),
    sourceNote: clean(raw.sourceNote, 1000),
    notes: clean(raw.notes, 1000),
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvedAt: raw.status === 'approved' ? (raw.approvedAt || new Date().toISOString()) : null,
  };
}

export function suggestBillingProfile(groupId = '', groupName = '') {
  const name = norm(groupName);
  const found = OBSERVED_TEMPLATES.find((item) => item.match.test(name));
  return sanitizeBillingProfile({
    id: `billing-${String(groupId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80)}`,
    groupId,
    groupName,
    status: 'needs_review',
    ...(found?.profile || { paymentMode: 'manual', routeBasis: 'truck_origin_destination_base', cycles: [], sourceNote: 'Configure e aprove o calendário de faturamento deste grupo.' }),
  });
}

export function ensureBillingProfile(state, groupId, groupName) {
  if (!Array.isArray(state.billingProfiles)) state.billingProfiles = [];
  let profile = state.billingProfiles.find((item) => item.groupId === groupId);
  if (!profile) {
    profile = suggestBillingProfile(groupId, groupName);
    state.billingProfiles.push(profile);
  }
  return profile;
}

export function resolvePaymentModeFromText(text = '', profile = {}) {
  const value = norm(text);
  if (/\b(a vista|avista|pagamento imediato|pix na hora)\b/.test(value)) return 'per_call';
  if (/\b(faturado|faturamento|a prazo|prazo pagamento)\b/.test(value)) return profile.paymentMode === 'dynamic_per_call' ? 'manual' : profile.paymentMode;
  return profile.paymentMode;
}

function nextMonthlyStatement(profile, completedAt) {
  const cycle = profile.cycles[0];
  if (!cycle?.statementDay || !cycle?.paymentDay) return null;
  const done = new Date(completedAt);
  let statement = atDay(done.getUTCFullYear(), done.getUTCMonth(), cycle.statementDay);
  // O fechamento vale pelo dia civil inteiro: um serviço concluído no próprio dia 30
  // pertence ao fechamento do dia 30, mesmo que tenha ocorrido depois do meio-dia.
  if (dateOnly(done) > dateOnly(statement)) statement = atDay(done.getUTCFullYear(), done.getUTCMonth()+1, cycle.statementDay);
  const periodEnd = statement;
  // Para fechamento mensal ancorado em um dia fixo, o período é entre um fechamento
  // e o próximo (ex.: 30/07 -> 30/08), preservando a regra comercial por calendário.
  const periodStart = atDay(statement.getUTCFullYear(), statement.getUTCMonth()-1, cycle.statementDay);
  const payBase = addMonths(statement, cycle.paymentMonthOffset || 0);
  const paymentDue = atDay(payBase.getUTCFullYear(), payBase.getUTCMonth(), cycle.paymentDay);
  const invoiceDeadline = cycle.invoiceDeadlineDay ? atDay(statement.getUTCFullYear(), statement.getUTCMonth(), cycle.invoiceDeadlineDay) : null;
  return { cycleId: cycle.id, periodStart: dateOnly(periodStart), periodEnd: dateOnly(periodEnd), statementDue: dateOnly(statement), invoiceDue: invoiceDeadline ? dateOnly(invoiceDeadline) : null, paymentDue: dateOnly(paymentDue) };
}

function semimonthlyCandidates(profile, completedAt) {
  const done = new Date(completedAt);
  const candidates = [];
  for (let monthOffset=0; monthOffset<=2; monthOffset++) {
    const year = done.getUTCFullYear();
    const month = done.getUTCMonth() + monthOffset;
    for (const cycle of profile.cycles || []) {
      const anchorDay = cycle.submitWindowEndDay || cycle.statementDay || cycle.paymentDay;
      if (!anchorDay || !cycle.paymentDay) continue;
      const statement = atDay(year, month, anchorDay);
      if (statement.getTime() < done.getTime()) continue;
      const payBase = addMonths(statement, cycle.paymentMonthOffset || 0);
      let payment = atDay(payBase.getUTCFullYear(), payBase.getUTCMonth(), cycle.paymentDay);
      if (payment.getTime() < statement.getTime()) payment = atDay(payBase.getUTCFullYear(), payBase.getUTCMonth()+1, cycle.paymentDay);
      candidates.push({ cycle, statement, payment });
    }
  }
  candidates.sort((a,b) => a.statement - b.statement);
  return candidates;
}

function nextSemiMonthly(profile, completedAt) {
  const candidate = semimonthlyCandidates(profile, completedAt)[0];
  if (!candidate) return null;
  const { cycle, statement, payment } = candidate;
  const invoice = cycle.invoiceDeadlineDay ? atDay(statement.getUTCFullYear(), statement.getUTCMonth(), cycle.invoiceDeadlineDay) : null;
  const previousAnchors = semimonthlyCandidates(profile, addDays(new Date(completedAt), -45)).filter((x) => x.statement < statement);
  const prev = previousAnchors.length ? previousAnchors[previousAnchors.length-1].statement : addDays(statement,-15);
  return {
    cycleId: cycle.id,
    periodStart: dateOnly(addDays(prev,1)),
    periodEnd: dateOnly(statement),
    statementDue: dateOnly(statement),
    invoiceDue: invoice ? dateOnly(invoice) : null,
    paymentDue: dateOnly(payment),
  };
}

export function settlementForCall(profileRaw = {}, call = {}, completedAt = new Date()) {
  const profile = sanitizeBillingProfile(profileRaw);
  const paymentMode = resolvePaymentModeFromText(call.lastOperationalText || '', profile);
  const done = completedAt instanceof Date ? completedAt : new Date(completedAt || call.completedAt || call.updatedAt || call.createdAt || Date.now());
  if (profile.status !== 'approved') return { status: 'profile_not_approved', paymentMode, dueDate: null, batch: null };
  if (paymentMode === 'manual' || paymentMode === 'dynamic_per_call') return { status: 'manual_payment_rule', paymentMode, dueDate: null, batch: null };
  if (paymentMode === 'per_call') {
    const due = addDays(done, profile.daysToPay || 0);
    return { status: 'ok', paymentMode, dueDate: dateOnly(due), batch: { cycleId: 'per-call', periodStart: dateOnly(done), periodEnd: dateOnly(done), statementDue: dateOnly(done), invoiceDue: null, paymentDue: dateOnly(due) } };
  }
  const batch = paymentMode === 'monthly' ? nextMonthlyStatement(profile, done) : nextSemiMonthly(profile, done);
  if (!batch) return { status: 'cycle_incomplete', paymentMode, dueDate: null, batch: null };
  return { status: 'ok', paymentMode, dueDate: batch.paymentDue, batch };
}

export function upsertBillingBatch(state, call, profileRaw, settlement) {
  if (!settlement?.batch || settlement.status !== 'ok') return null;
  if (!Array.isArray(state.billingBatches)) state.billingBatches = [];
  const profile = sanitizeBillingProfile(profileRaw);
  const b = settlement.batch;
  const key = `${call.sourceGroupId}|${b.cycleId}|${b.periodStart}|${b.periodEnd}`;
  let batch = state.billingBatches.find((item) => item.key === key);
  if (!batch) {
    batch = {
      id: crypto.randomUUID(), key,
      groupId: call.sourceGroupId, groupName: call.insurer || call.client || profile.groupName,
      cycleId: b.cycleId, periodStart: b.periodStart, periodEnd: b.periodEnd,
      statementDue: b.statementDue, invoiceDue: b.invoiceDue, paymentDue: b.paymentDue,
      status: 'accumulating', callIds: [], totalAmount: 0, totalKm: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    state.billingBatches.unshift(batch);
  }
  if (!batch.callIds.includes(call.id)) batch.callIds.push(call.id);
  const callsById = new Map((state.calls || []).map((item) => [item.id,item]));
  callsById.set(call.id, call);
  const included = batch.callIds.map((id) => callsById.get(id)).filter(Boolean);
  batch.totalAmount = money(included.reduce((sum,item) => sum + Number(item.value || 0),0));
  batch.totalKm = money(included.reduce((sum,item) => sum + Number(item.billableKm || item.totalKm || 0),0));
  batch.callCount = included.length;
  batch.updatedAt = new Date().toISOString();
  return batch;
}

export function financeEntryFromCall(call, settlement, batch = null) {
  if (!call || settlement?.status !== 'ok' || !(Number(call.value) > 0)) return null;
  return {
    id: crypto.randomUUID(),
    description: `Serviço de guincho · ${call.insurer || call.client || 'Seguradora'} · ${call.vehicle || 'Veículo'}`,
    category: 'Serviço de guincho',
    amount: money(call.value),
    type: 'receita', status: 'pendente', dueDate: settlement.dueDate,
    client: call.client || call.insurer || '', insurer: call.insurer || call.client || '',
    sourceCallId: call.id, billingBatchId: batch?.id || null,
    billingPeriodStart: settlement.batch?.periodStart || null,
    billingPeriodEnd: settlement.batch?.periodEnd || null,
    statementDue: settlement.batch?.statementDue || null,
    invoiceDue: settlement.batch?.invoiceDue || null,
    paymentDue: settlement.batch?.paymentDue || settlement.dueDate || null,
    source: 'automation', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

export function sanitizeBillingBatch(raw = {}) {
  return {
    ...raw,
    id: clean(raw.id || crypto.randomUUID(),100), key: clean(raw.key,400),
    groupId: clean(raw.groupId,160), groupName: clean(raw.groupName,200),
    status: ['accumulating','statement_due','statement_sent','invoice_due','invoice_sent','awaiting_payment','received','overdue'].includes(raw.status) ? raw.status : 'accumulating',
    statementSentAt: raw.statementSentAt || null,
    invoiceSentAt: raw.invoiceSentAt || null,
    receivedAt: raw.receivedAt || null,
    receivedAmount: raw.receivedAmount == null ? null : money(raw.receivedAmount),
    updatedAt: new Date().toISOString(),
  };
}

export function updateBatchTemporalStatuses(batches = [], now = new Date()) {
  const today = dateOnly(now);
  return (Array.isArray(batches) ? batches : []).map((raw) => {
    const item = { ...raw };
    if (item.status === 'received') return item;
    if (item.statementSentAt && item.invoiceSentAt) item.status = today > String(item.paymentDue || '9999-12-31') ? 'overdue' : 'awaiting_payment';
    else if (item.statementSentAt && item.invoiceDue && today >= item.invoiceDue) item.status = 'invoice_due';
    else if (item.statementSentAt) item.status = 'statement_sent';
    else if (item.statementDue && today >= item.statementDue) item.status = 'statement_due';
    return item;
  });
}

export function closureReply({ totalKm = null, amount = null, reviewRequired = false } = {}) {
  const lines = [];
  if (Number.isFinite(Number(totalKm))) lines.push(`Finalizado em ${Number(totalKm).toLocaleString('pt-BR',{maximumFractionDigits:1})} km.`);
  if (!reviewRequired && Number(amount) > 0) lines.push(`Valor total: ${Number(amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.`);
  else if (reviewRequired) lines.push('Valor em conferência financeira.');
  return lines.length ? lines.join('\n') : 'Finalização registrada ✅';
}
