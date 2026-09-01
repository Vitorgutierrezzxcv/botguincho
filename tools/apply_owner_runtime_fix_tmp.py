from pathlib import Path
import json

WORKER = Path('tools/vercel-whatsapp-worker.mjs')
APP = Path('app.js')
CSS = Path('app.css')
PKG = Path('package.json')


def replace_between(text, start, end, replacement):
    a = text.find(start)
    if a < 0:
        raise SystemExit(f'marker not found: {start}')
    b = text.find(end, a)
    if b < 0:
        raise SystemExit(f'end marker not found: {end}')
    return text[:a] + replacement.rstrip() + '\n\n' + text[b:]

# ---------- scheduling policy ----------
Path('tools/scheduling-policy.mjs').write_text(r'''export const SCHEDULE_SLOT_MINUTES = 60;

function ts(value) {
  const n = new Date(value || 0).getTime();
  return Number.isFinite(n) ? n : 0;
}

export function isFutureScheduledCall(value, now = new Date(), leadMinutes = 60) {
  const target = ts(value);
  const current = ts(now);
  return Boolean(target && current && target > current + Math.max(0, Number(leadMinutes) || 0) * 60000);
}

export function scheduledCapacitySnapshot(calls = [], scheduledAt, { maxConcurrentCalls = 2, excludeCallId = '', slotMinutes = SCHEDULE_SLOT_MINUTES } = {}) {
  const target = ts(scheduledAt);
  if (!target) return { maxConcurrentCalls, activeCount: 0, slotsAvailable: maxConcurrentCalls, canAccept: false, reason: 'invalid_schedule', scheduledCalls: [] };
  const windowMs = Math.max(15, Number(slotMinutes) || SCHEDULE_SLOT_MINUTES) * 60000;
  const scheduledCalls = (Array.isArray(calls) ? calls : [])
    .filter((call) => call && call.id !== excludeCallId && String(call.status || '') === 'agendado' && ts(call.scheduledAt))
    .filter((call) => Math.abs(ts(call.scheduledAt) - target) < windowMs)
    .sort((a, b) => ts(a.scheduledAt) - ts(b.scheduledAt));
  return {
    maxConcurrentCalls,
    activeCount: scheduledCalls.length,
    slotsAvailable: Math.max(0, maxConcurrentCalls - scheduledCalls.length),
    canAccept: scheduledCalls.length < maxConcurrentCalls,
    reason: scheduledCalls.length < maxConcurrentCalls ? 'available' : 'schedule_full',
    scheduledCalls,
  };
}

export function formatScheduledAtBr(value, timeZone = 'America/Sao_Paulo') {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
''')

Path('tools/test-runtime-regressions.mjs').write_text(r'''import assert from 'node:assert/strict';
import { evaluateOperatingHours } from './operating-hours.mjs';
import { capacitySnapshot } from './dispatch-capacity.mjs';
import { scheduledCapacitySnapshot, isFutureScheduledCall } from './scheduling-policy.mjs';
import { selectRecentUnprocessedMessages } from './whatsapp-recovery.mjs';

const closedSettings = {
  operatingHoursEnabled: true,
  operatingTimezone: 'America/Sao_Paulo',
  weeklySchedule: {
    mon:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    tue:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    wed:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    thu:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    fri:{enabled:true,intervals:[{start:'08:00',end:'18:00'}]},
    sat:{enabled:false,intervals:[]}, sun:{enabled:false,intervals:[]},
  },
};
assert.equal(evaluateOperatingHours(closedSettings, new Date('2026-09-01T04:48:00Z')).open, false, '01:48 em SP precisa estar fechado');
assert.equal(evaluateOperatingHours(closedSettings, new Date('2026-09-01T14:00:00Z')).open, true, '11:00 em SP precisa estar aberto');

let state={calls:[{id:'1',status:'autorizado',createdAt:'2026-09-01T12:00:00Z'}]};
assert.equal(capacitySnapshot(state).canAccept,true);
state.calls.push({id:'2',status:'a_caminho',createdAt:'2026-09-01T12:10:00Z'});
assert.equal(capacitySnapshot(state).activeCount,2);
assert.equal(capacitySnapshot(state).canAccept,false,'terceira corrida precisa ser bloqueada');

const slot='2026-09-02T10:00:00-03:00';
const sched=[{id:'a',status:'agendado',scheduledAt:slot},{id:'b',status:'agendado',scheduledAt:'2026-09-02T10:30:00-03:00'}];
assert.equal(scheduledCapacitySnapshot(sched, '2026-09-02T10:15:00-03:00').canAccept,false,'terceiro agendamento simultâneo precisa ser bloqueado');
assert.equal(isFutureScheduledCall(slot,new Date('2026-09-01T12:00:00Z'),60),true);

const now=Date.now();
const messages=[
  {id:{_serialized:'old-ok'},timestamp:Math.floor((now-40*60000)/1000),body:'pode seguir',fromMe:false},
  {id:{_serialized:'blank'},timestamp:Math.floor((now-10*60000)/1000),body:'',fromMe:false},
  {id:{_serialized:'mine'},timestamp:Math.floor((now-5*60000)/1000),body:'teste',fromMe:true},
];
const recovered=selectRecentUnprocessedMessages(messages,{sinceMs:now-60*60000,nowMs:now,maxWindowMs:60*60000,startupSkewMs:60000});
assert.deepEqual(recovered.map(x=>x.id._serialized),['old-ok']);
console.log('RUNTIME_REGRESSIONS_OK');
''')

# ---------- worker ----------
text = WORKER.read_text()
import_marker = "import { selectRecentUnprocessedMessages } from './whatsapp-recovery.mjs';\n"
if "./scheduling-policy.mjs" not in text:
    if import_marker not in text:
        raise SystemExit('worker import marker missing')
    text = text.replace(import_marker, import_marker + "import { scheduledCapacitySnapshot, isFutureScheduledCall, formatScheduledAtBr } from './scheduling-policy.mjs';\n", 1)

# Serialize messages per WhatsApp group. This prevents a slow previous quote from replying after a later schedule.
map_marker = "const botReplyFingerprints = new Map();\n"
if "const groupProcessingQueues = new Map();" not in text:
    text = text.replace(map_marker, map_marker + "const groupProcessingQueues = new Map();\n", 1)

if "function enqueueIncomingMessage(msg)" not in text:
    process_marker = "async function processIncomingMessage(msg) {"
    pos = text.find(process_marker)
    if pos < 0:
        raise SystemExit('processIncomingMessage marker missing')
    helper = r'''function enqueueIncomingMessage(msg) {
  const groupId = String(msg?.from || 'unknown');
  const previous = groupProcessingQueues.get(groupId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(() => processIncomingMessage(msg));
  groupProcessingQueues.set(groupId, current);
  current.finally(() => {
    if (groupProcessingQueues.get(groupId) === current) groupProcessingQueues.delete(groupId);
  }).catch(() => undefined);
  return current;
}

'''
    text = text[:pos] + helper + text[pos:]

text = text.replace("waClient.on('message', processIncomingMessage);", "waClient.on('message', (msg) => { void enqueueIncomingMessage(msg); });")

# A failed message must be retried, not remain marked as processed forever.
old_process = "async function processIncomingMessage(msg) {\n  try {\n    const messageId = msg?.id?._serialized || '';"
new_process = "async function processIncomingMessage(msg) {\n  const messageId = msg?.id?._serialized || '';\n  try {"
if old_process in text:
    text = text.replace(old_process, new_process, 1)
elif new_process not in text:
    raise SystemExit('process message header marker missing')
text = text.replace("if (processedMessageIds.size > 1000) {", "if (processedMessageIds.size > 10000) {")
old_catch = "  } catch (error) {\n    lastError = error instanceof Error ? error.message : String(error);\n    logEvent('error', 'Erro ao processar mensagem.', { error: lastError });"
new_catch = "  } catch (error) {\n    if (messageId) processedMessageIds.delete(messageId);\n    lastError = error instanceof Error ? error.message : String(error);\n    logEvent('error', 'Erro ao processar mensagem; ela poderá ser recuperada e tentada novamente.', { error: lastError, messageId });"
if old_catch in text:
    text = text.replace(old_catch, new_catch, 1)
elif new_catch not in text:
    raise SystemExit('process catch marker missing')

# Recover a much wider backlog after reconnect/restart.
old_recovery = "const recent = await chat.fetchMessages({ limit: 25 });\n      const pending = selectRecentUnprocessedMessages(recent, {\n        sinceMs,\n        processedIds,\n      });"
new_recovery = "const recent = await chat.fetchMessages({ limit: 500 });\n      const recoveryWindowMs = Math.min(24 * 60 * 60 * 1000, Math.max(15 * 60 * 1000, Date.now() - Number(sinceMs || Date.now()) + 60_000));\n      const pending = selectRecentUnprocessedMessages(recent, {\n        sinceMs,\n        processedIds,\n        maxWindowMs: recoveryWindowMs,\n        startupSkewMs: 60_000,\n      });"
if old_recovery in text:
    text = text.replace(old_recovery, new_recovery, 1)
elif new_recovery not in text:
    raise SystemExit('recovery marker missing')

# Allow the scheduling command itself while currently closed; its FUTURE slot is validated below.
old_active = "const activeFlowIntents = new Set([\n      'cancellation', 'arrival_without_tow', 'arrival', 'departure', 'waiting_customer', 'loaded',"
new_active = "const activeFlowIntents = new Set([\n      'scheduled_dispatch', 'cancellation', 'arrival_without_tow', 'arrival', 'departure', 'waiting_customer', 'loaded',"
if old_active in text:
    text = text.replace(old_active, new_active)
elif new_active not in text:
    raise SystemExit('activeFlowIntents marker missing')

# Replace scheduling runtime with slot validation + visible persistence.
new_schedule = r'''async function handleScheduledRuntime(msg, groupName, readableText, context) {
  const pendingCall = pendingAuthorizationCallForGroup(context.management?.calls || [], msg.from);
  const call = pendingCall || context.recentCall;
  const scheduledAt = context.facts.scheduledAt || call?.scheduledAt || null;
  const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
  if (!scheduledDate || !Number.isFinite(scheduledDate.getTime())) {
    await replyAndRemember(msg, groupName, readableText, 'Para agendar, informe o dia e o horário.', { intent: 'scheduled_dispatch_missing_time' });
    return;
  }
  if (scheduledDate.getTime() < Date.now() - 5 * 60000) {
    await replyAndRemember(msg, groupName, readableText, 'Esse horário já passou. Envie um novo dia e horário para o agendamento.', { intent: 'scheduled_dispatch_past' });
    return;
  }

  const settings = await getSettings();
  const slotCoverage = evaluateOperatingHours(settings, scheduledDate);
  const label = formatScheduledAtBr(scheduledAt, settings.operatingTimezone || 'America/Sao_Paulo');
  if (settings.operatingHoursEnabled === true && !slotCoverage.open) {
    const baseReply = String(settings.outOfHoursReply || 'Atendimento fora do horário configurado.').trim();
    await replyAndRemember(msg, groupName, readableText, `${baseReply}\nO horário ${label || 'informado'} está fora do funcionamento configurado.`, { intent: 'scheduled_out_of_hours', scheduledAt, reason: slotCoverage.reason });
    return;
  }

  const scheduledCapacity = scheduledCapacitySnapshot(context.management?.calls || [], scheduledAt, { maxConcurrentCalls: MAX_CONCURRENT_CALLS, excludeCallId: call?.id || '' });
  if (!scheduledCapacity.canAccept) {
    await replyAndRemember(msg, groupName, readableText, `Esse horário já está com ${MAX_CONCURRENT_CALLS} corridas agendadas. Indisponível nesse horário.`, { intent: 'scheduled_capacity_full', scheduledAt, activeCount: scheduledCapacity.activeCount });
    return;
  }

  const facts = { ...context.facts, scheduledAt };
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: context.facts.origin || call?.origin || null,
    destinationAddress: context.facts.destination || call?.destination || null,
    eta: null, status: 'agendado', facts,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call?.id || null,
    eventType: 'agendamento', phase: 'agendado',
  });
  await replyAndRemember(msg, groupName, readableText, `Agendamento registrado ✅${label ? `\n${label}` : ''}`, { intent: 'scheduled_dispatch', scheduledAt, callId: saved?.id || call?.id || null });
}

async function handleScheduledDetailsRuntime(msg, groupName, readableText, context, call) {
  if (!call?.id || call.status !== 'agendado') return false;
  const facts = { ...context.facts, scheduledAt: call.scheduledAt || context.facts.scheduledAt || null };
  const saved = await recordDispatchInManagement({
    groupId: msg.from, groupName, text: readableText,
    originAddress: context.facts.origin || call.origin || null,
    destinationAddress: context.facts.destination || call.destination || null,
    eta: null, status: 'agendado', facts,
    evidenceChecklist: buildEvidenceChecklist(groupName, readableText), existingCallId: call.id,
    eventType: 'agendamento_dados_atualizados', phase: 'agendado',
  });
  await replyAndRemember(msg, groupName, readableText, 'Dados do agendamento atualizados ✅', { intent: 'scheduled_details', callId: saved?.id || call.id, scheduledAt: call.scheduledAt || null });
  return true;
}'''
text = replace_between(text, 'async function handleScheduledRuntime(', 'async function handleDepartureRuntime(', new_schedule)

# A future schedule confirmation must NOT activate the truck immediately.
auth_start = text.find('async function handleAuthorizationRuntime(')
auth_end = text.find('async function ', auth_start + 20)
if auth_start < 0 or auth_end < 0:
    raise SystemExit('authorization function boundaries missing')
auth = text[auth_start:auth_end]
needle = "  const call = pendingCall || context.recentCall;\n"
if 'agendamento_confirmado' not in auth:
    if needle not in auth:
        raise SystemExit('authorization call marker missing')
    insert = needle + r'''  if (call?.status === 'agendado' && isFutureScheduledCall(call.scheduledAt, new Date(), 60)) {
    const settings = await getSettings();
    const label = formatScheduledAtBr(call.scheduledAt, settings.operatingTimezone || 'America/Sao_Paulo');
    const saved = await recordDispatchInManagement({
      groupId: msg.from, groupName, text: readableText,
      originAddress: call.origin || context.facts.origin || null,
      destinationAddress: call.destination || context.facts.destination || null,
      eta: null, status: 'agendado', facts: { ...context.facts, scheduledAt: call.scheduledAt },
      existingCallId: call.id, eventType: 'agendamento_confirmado', phase: 'agendado',
    });
    await replyAndRemember(msg, groupName, readableText, `Agendamento confirmado ✅${label ? `\n${label}` : ''}`, { intent: 'scheduled_confirmation', callId: saved?.id || call.id, scheduledAt: call.scheduledAt });
    return;
  }
'''
    auth = auth.replace(needle, insert, 1)
    text = text[:auth_start] + auth + text[auth_end:]

# After a schedule, immediate protocol/data follow-ups update that appointment instead of creating an immediate quote.
route_needle = "    if (runtimeIntent === 'protocol_received' || runtimeIntent === 'protocol_update') {"
route_insert = r'''    const scheduledFollowup = operationalContext.recentCall?.status === 'agendado'
      && operationalContext.recentCall?.scheduledAt
      && Date.now() - new Date(operationalContext.recentCall.updatedAt || operationalContext.recentCall.createdAt || 0).getTime() < 20 * 60 * 1000;
    if (scheduledFollowup && ['quote','dispatch','protocol_received','protocol_update','incomplete_dispatch'].includes(runtimeIntent)) {
      await handleScheduledDetailsRuntime(msg, groupName, readableText, operationalContext, operationalContext.recentCall);
      return;
    }
'''
if 'const scheduledFollowup = operationalContext.recentCall?.status' not in text:
    if route_needle not in text:
        raise SystemExit('runtime routing marker missing')
    text = text.replace(route_needle, route_insert + route_needle, 1)

# Status must reflect BOTH truck state and the two-call capacity limit.
old_operation = "operation: { available: availability.available, reason: availability.reason || null, until: availability.until || null, truck: availability.truck || null },"
new_operation = "operation: { available: availability.available && capacity.canAccept, reason: !capacity.canAccept ? `Limite de ${MAX_CONCURRENT_CALLS} corridas ativas atingido.` : (availability.reason || null), until: availability.until || null, truck: availability.truck || null },"
if old_operation in text:
    text = text.replace(old_operation, new_operation)
elif new_operation not in text:
    raise SystemExit('status operation marker missing')

WORKER.write_text(text)

# ---------- owner app: clearer dashboard + explicit Agenda ----------
app = APP.read_text()
if 'OWNER_RUNTIME_HUB_V1' not in app:
    app += r'''

// ===== OWNER_RUNTIME_HUB_V1: agenda, capacidade e horário efetivo =====
(function ownerRuntimeHub(){
  pageMeta.schedule=['Agenda','Agendamentos e próximos atendimentos.'];
  const operationsButton=document.querySelector('[data-page="operations"]');
  if(operationsButton&&!document.querySelector('[data-page="schedule"]')){
    const button=document.createElement('button');button.dataset.page='schedule';button.innerHTML='<span class="ico">◷</span>Agenda';
    button.addEventListener('click',()=>{showPage('schedule');loadManagement().catch(()=>{});loadOwnerRuntimeSummary().catch(()=>{})});
    operationsButton.insertAdjacentElement('afterend',button);
  }
  if(!document.getElementById('schedule')){
    const callsPage=document.getElementById('calls');
    const section=document.createElement('section');section.id='schedule';section.className='page';section.innerHTML=`<div class="head"><div><h2>Agenda</h2><p>Corridas futuras separadas da operação em andamento.</p></div></div><div class="metrics"><div class="metric-card"><span>Agendados</span><strong id="scheduleCount">0</strong><small>Próximos atendimentos</small></div><div class="metric-card"><span>Confirmados</span><strong id="scheduleConfirmed">0</strong><small>Agenda confirmada</small></div><div class="metric-card"><span>Próximo</span><strong id="scheduleNext">—</strong><small>Horário do atendimento</small></div></div><div class="card section"><div class="head"><div><h3>Próximos atendimentos</h3><p>Agendamento não ocupa uma vaga ativa antes da hora.</p></div></div><div id="scheduleList" class="events section"><div class="empty">Nenhum agendamento.</div></div></div>`;
    callsPage?.parentNode?.insertBefore(section,callsPage);
  }
  if(!document.getElementById('ownerRuntimeHub')){
    const dash=document.getElementById('dashboard'),metrics=dash?.querySelector('.metrics');
    metrics?.insertAdjacentHTML('afterend',`<div id="ownerRuntimeHub" class="owner-runtime-hub section"><div class="owner-runtime-card"><span>Horário agora</span><strong id="ownerHoursStatus">Verificando…</strong><small id="ownerHoursDetail">Regra configurada</small></div><div class="owner-runtime-card"><span>Capacidade</span><strong id="ownerCapacityStatus">0/2</strong><small id="ownerCapacityDetail">Corridas ativas</small></div><div class="owner-runtime-card"><span>Próximo agendamento</span><strong id="ownerNextSchedule">—</strong><small id="ownerNextScheduleDetail">Sem agenda futura</small></div></div>`);
  }

  window.renderOwnerSchedule=function(){
    const now=Date.now();
    const scheduled=(mgmt.calls||[]).filter(c=>c.status==='agendado'&&c.scheduledAt&&new Date(c.scheduledAt).getTime()>now-5*60000).sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));
    const confirmed=scheduled.filter(c=>(c.operationalTimeline||[]).some(e=>e.type==='agendamento_confirmado'));
    if($('scheduleCount'))$('scheduleCount').textContent=scheduled.length;if($('scheduleConfirmed'))$('scheduleConfirmed').textContent=confirmed.length;
    if($('scheduleNext'))$('scheduleNext').textContent=scheduled[0]?new Date(scheduled[0].scheduledAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
    if($('scheduleList'))$('scheduleList').innerHTML=scheduled.length?scheduled.map(c=>{const conf=(c.operationalTimeline||[]).some(e=>e.type==='agendamento_confirmado');return `<div class="event schedule-event"><div class="head"><div><b>${esc(new Date(c.scheduledAt).toLocaleString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))}</b><p>${esc(c.insurer||c.client||c.groupName||'Atendimento')}</p></div><span class="tag ${conf?'green':'yellow'}">${conf?'Confirmado':'Agendado'}</span></div><div class="small"><b>${esc(c.vehicle||'Veículo não informado')}</b></div><div class="small">${esc(c.origin||'Origem não informada')} → ${esc(c.destination||'Destino não informado')}</div></div>`}).join(''):'<div class="empty">Nenhum agendamento futuro.</div>';
    if($('ownerNextSchedule'))$('ownerNextSchedule').textContent=scheduled[0]?new Date(scheduled[0].scheduledAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
    if($('ownerNextScheduleDetail'))$('ownerNextScheduleDetail').textContent=scheduled[0]?esc(scheduled[0].vehicle||scheduled[0].insurer||'Atendimento agendado'):'Sem agenda futura';
  };

  renderOps=function(){const active=(mgmt.calls||[]).filter(x=>['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(String(x.status||'')));$('opsList').innerHTML=active.length?active.map(c=>`<div class="event"><div class="head"><div><b>${esc(c.vehicle||'Chamado')}</b><p>${esc(c.client||c.insurer||'')}</p></div>${tag(c.status||'novo')}</div><div class="small">${esc(c.origin||'Origem não informada')} → ${esc(c.destination||'Destino não informado')}</div>${c.queued?'<div class="notice warn section">2ª corrida em fila operacional.</div>':''}</div>`).join(''):'<div class="empty">Nenhuma corrida ativa agora. Agendamentos ficam na aba Agenda.</div>'};
  const originalRenderManagement=renderManagement;
  renderManagement=function(){originalRenderManagement();renderOwnerSchedule()};

  window.loadOwnerRuntimeSummary=async function(){try{const s=await api('/api/worker/status');const op=s.operatingHours||{},cap=s.capacity||{};if($('ownerHoursStatus')){$('ownerHoursStatus').textContent=op.enabled?(op.open?'ABERTO':'FECHADO'):'24 HORAS';$('ownerHoursStatus').className=op.enabled?(op.open?'owner-ok':'owner-bad'):'owner-ok'}if($('ownerHoursDetail'))$('ownerHoursDetail').textContent=op.enabled?`${op.localTime||''} · ${op.reason==='within_interval'?'dentro do horário':'fora do horário configurado'}`:'Regra de horário desativada';if($('ownerCapacityStatus'))$('ownerCapacityStatus').textContent=`${cap.activeCount||0}/${cap.maxConcurrentCalls||2}`;if($('ownerCapacityDetail'))$('ownerCapacityDetail').textContent=cap.canAccept===false?'Limite atingido · próxima deve ser recusada':`${cap.slotsAvailable??2} vaga(s) disponível(is)`;const box=$('operatingHoursConfig');if(box){let badge=$('effectiveOperatingStatus');if(!badge){badge=document.createElement('div');badge.id='effectiveOperatingStatus';badge.className='notice section';box.querySelector('.head')?.insertAdjacentElement('afterend',badge)}badge.className='notice '+(!op.enabled||op.open?'good':'bad')+' section';badge.textContent=!op.enabled?'Regra efetiva agora: 24 horas.':`Regra efetiva agora: ${op.open?'ABERTO':'FECHADO'} · ${op.localTime||''} · ${op.timeZone||'America/Sao_Paulo'}`}}catch(e){console.error('owner runtime summary',e)}};
  $('saveOperatingHours')?.addEventListener('click',()=>setTimeout(()=>loadOwnerRuntimeSummary().catch(()=>{}),700));
  loadOwnerRuntimeSummary().catch(()=>{});loadManagement().catch(()=>{});
  setInterval(()=>{loadOwnerRuntimeSummary().catch(()=>{});const current=localStorage.getItem('bg-page');if(['dashboard','operations','schedule'].includes(current))loadManagement().catch(()=>{})},15000);
  if(localStorage.getItem('bg-page')==='schedule'){showPage('schedule');loadManagement().catch(()=>{})}
})();
'''
APP.write_text(app)

css = CSS.read_text()
if 'OWNER_RUNTIME_HUB_V1' not in css:
    css += r'''

/* OWNER_RUNTIME_HUB_V1 */
.owner-runtime-hub{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.owner-runtime-card{background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:5px}.owner-runtime-card span,.owner-runtime-card small{color:var(--muted,#667085)}.owner-runtime-card strong{font-size:1.28rem}.owner-ok{color:#16803c}.owner-bad{color:#b42318}.schedule-event{border-left:3px solid currentColor}@media(max-width:760px){.owner-runtime-hub{grid-template-columns:1fr}.owner-runtime-card{padding:14px}}
'''
CSS.write_text(css)

pkg=json.loads(PKG.read_text())
op=pkg.get('scripts',{}).get('test:operational','')
if 'test-runtime-regressions.mjs' not in op:
    pkg['scripts']['test:operational']=op + ' && node tools/test-runtime-regressions.mjs'
PKG.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')

print('OWNER_RUNTIME_FIX_APPLIED')
