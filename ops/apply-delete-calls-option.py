from pathlib import Path
import shutil


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)


# ---------------- worker/backend ----------------
worker_path = Path('tools/vercel-whatsapp-worker.mjs')
worker = worker_path.read_text()

if 'async function deleteCallFromOwner(state, body = {})' not in worker:
    marker = 'async function applyManagementAction(body = {}) {'
    helper = r'''async function deleteCallFromOwner(state, body = {}) {
  const callId = String(body.callId || body.id || '');
  const index = (state.calls || []).findIndex((item) => item.id === callId);
  if (index < 0) throw new Error('call_not_found');
  const call = state.calls[index];
  const now = new Date().toISOString();
  const deletedBy = String(body.ownerName || body.deletedBy || 'Painel').trim().slice(0, 120) || 'Painel';
  const testMode = isTestCall(call);

  if (testMode) {
    state.calls.splice(index, 1);
    state.finance = (state.finance || []).filter((entry) => entry?.sourceCallId !== callId);
  } else {
    state.calls[index] = {
      ...call,
      status: 'excluido',
      operationalPhase: 'excluido',
      deletedAt: now,
      deletedBy,
      deletedPreviousStatus: call.status || null,
      updatedAt: now,
    };
    state.finance = (state.finance || []).map((entry) => entry?.sourceCallId === callId
      ? { ...entry, deletedAt: now, deletedBy, updatedAt: now }
      : entry);
  }

  syncDriverPayrolls(state);
  await saveManagement(state);
  await promoteQueuedCallAfter(callId).catch(() => undefined);
  logEvent('owner-delete', testMode
    ? 'Corrida de teste excluída definitivamente pelo painel.'
    : 'Corrida removida do painel e preservada para auditoria.',
    { callId, deletedBy, testMode, hardDeleted: testMode });
  return { callId, testMode, hardDeleted: testMode, deletedAt: now };
}

'''
    if marker not in worker:
        raise SystemExit('anchor not found: applyManagementAction')
    worker = worker.replace(marker, helper + marker, 1)

worker = replace_once(
    worker,
    """  if (action === 'close_call') {\n    const result = await closeCallFromOwner(state, body);\n    return { ...state, closeResult: result };\n  }\n\n  if (action === 'replace_company') {""",
    """  if (action === 'close_call') {\n    const result = await closeCallFromOwner(state, body);\n    return { ...state, closeResult: result };\n  }\n  if (action === 'delete_call') {\n    const result = await deleteCallFromOwner(state, body);\n    return { ...state, deleteResult: result };\n  }\n\n  if (action === 'replace_company') {""",
    'delete_call action',
)

worker = replace_once(
    worker,
    """  if (action === 'delete') {\n    const id = String(body.id || '');\n    state[collection] = state[collection].filter((x) => x.id !== id);\n    return saveManagement(state);\n  }""",
    """  if (action === 'delete') {\n    const id = String(body.id || '');\n    if (collection === 'calls') {\n      const result = await deleteCallFromOwner(state, { ...body, callId: id });\n      return { ...state, deleteResult: result };\n    }\n    state[collection] = state[collection].filter((x) => x.id !== id);\n    return saveManagement(state);\n  }""",
    'safe generic call delete',
)

# Block stale closing of a deleted real call.
close_marker = """  const call = state.calls[index];\n  // Fechamento idempotente: clique repetido não duplica timeline, financeiro ou repasse."""
close_replacement = """  const call = state.calls[index];\n  if (call.deletedAt || call.status === 'excluido') throw new Error('call_deleted');\n  // Fechamento idempotente: clique repetido não duplica timeline, financeiro ou repasse."""
worker = replace_once(worker, close_marker, close_replacement, 'close deleted guard')

# Hide soft-deleted real calls/finance from normal management payloads while retaining audit access.
worker = replace_once(
    worker,
    """    const allCalls = data.calls || [];\n    const calls = allCalls.filter((item) => !isTestCall(item));\n    const testCalls = allCalls.filter((item) => isTestCall(item));\n    const allFinance = data.finance || [];\n    const finance = allFinance.filter((item) => item?.testMode !== true);\n    const testFinance = allFinance.filter((item) => item?.testMode === true);""",
    """    const allCalls = data.calls || [];\n    const deletedCalls = allCalls.filter((item) => Boolean(item?.deletedAt) || item?.status === 'excluido');\n    const visibleCalls = allCalls.filter((item) => !item?.deletedAt && item?.status !== 'excluido');\n    const calls = visibleCalls.filter((item) => !isTestCall(item));\n    const testCalls = visibleCalls.filter((item) => isTestCall(item));\n    const allFinance = data.finance || [];\n    const visibleFinance = allFinance.filter((item) => !item?.deletedAt);\n    const finance = visibleFinance.filter((item) => item?.testMode !== true);\n    const testFinance = visibleFinance.filter((item) => item?.testMode === true);""",
    'management visible filters',
)
worker = replace_once(
    worker,
    """      data: { ...data, calls, testCalls, finance, testFinance },""",
    """      data: { ...data, calls, testCalls, finance, testFinance, deletedCalls },""",
    'management deletedCalls payload',
)

worker = worker.replace(
    "finance: (saved.finance || []).filter((entry) => entry?.testMode !== true),\n      calls: (saved.calls || []).filter((call) => !isTestCall(call)),",
    "finance: (saved.finance || []).filter((entry) => entry?.testMode !== true && !entry?.deletedAt),\n      calls: (saved.calls || []).filter((call) => !isTestCall(call) && !call?.deletedAt && call?.status !== 'excluido'),",
)

worker = worker.replace(
    "const calls = (state.calls || []).filter((call) => (payroll.callIds || []).includes(call.id));",
    "const calls = (state.calls || []).filter((call) => !call?.deletedAt && call?.status !== 'excluido' && (payroll.callIds || []).includes(call.id));",
)

worker = worker.replace(
    "const { buffer, report } = buildPeriodWorkbook(state, filters);",
    "const visibleReportState = { ...state, calls: (state.calls || []).filter((call) => !call?.deletedAt && call?.status !== 'excluido'), finance: (state.finance || []).filter((entry) => !entry?.deletedAt) };\n    const { buffer, report } = buildPeriodWorkbook(visibleReportState, filters);",
)

worker_path.write_text(worker)


# ---------------- operation center ----------------
op_path = Path('operation-command-center.js')
op = op_path.read_text()
op = replace_once(
    op,
    """      <div class=\"op-actions\"><button class=\"btn secondary\" type=\"button\" onclick=\"event.stopPropagation();operationEditCall('${esc(call.id)}')\">Editar comanda</button><button class=\"btn\" type=\"button\" onclick=\"event.stopPropagation();operationCloseCall('${esc(call.id)}')\">Concluir corrida</button></div>""",
    """      <div class=\"op-actions\"><button class=\"btn secondary\" type=\"button\" onclick=\"event.stopPropagation();operationEditCall('${esc(call.id)}')\">Editar comanda</button><button class=\"btn\" type=\"button\" onclick=\"event.stopPropagation();operationCloseCall('${esc(call.id)}')\">Concluir corrida</button><button class=\"btn ghost\" type=\"button\" onclick=\"event.stopPropagation();operationDeleteCall('${esc(call.id)}')\">Excluir</button></div>""",
    'operation delete button',
)

if 'window.operationDeleteCall = async (id) =>' not in op:
    marker = "  window.operationCloseCall = (id) => {"
    helper = r'''  window.operationDeleteCall = async (id) => {
    const call = findCall(id); if (!call) return alert('Corrida não encontrada. Atualize a tela e tente novamente.');
    const test = isTestCall(call);
    const confirmed = confirm(test
      ? 'Excluir esta corrida de TESTE? Ela será removida definitivamente, junto com o financeiro de teste vinculado.'
      : 'Excluir esta corrida? Ela sairá do painel e dos totais, mas continuará preservada internamente para auditoria.');
    if (!confirmed) return;
    await api('/api/worker/management', { method:'POST', body: JSON.stringify({ action:'delete_call', callId:id, ownerName:'Thiago' }) });
    await loadManagement();
    if (typeof refreshBillingOnly === 'function') await refreshBillingOnly();
    renderManagement();
    alert(test ? 'Corrida de teste excluída.' : 'Corrida removida do painel. O histórico interno foi preservado.');
  };

'''
    if marker not in op:
        raise SystemExit('anchor not found: operationCloseCall')
    op = op.replace(marker, helper + marker, 1)

op_path.write_text(op)


# ---------------- owner dashboard ----------------
owner_path = Path('owner-dashboard.js')
owner = owner_path.read_text()
owner = owner.replace(
    "<button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button></div>",
    "<button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button><button class=\"btn ghost small\" onclick=\"ownerDeleteCall('${esc(call.id)}')\">Excluir</button></div>",
)
owner = owner.replace(
    "<button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button>${!ownerFinalized(call) && isAccepted(call) ? `<button class=\"btn small\" onclick=\"ownerCloseCall('${esc(call.id)}')\">Fechar</button>` : ''}</td>",
    "<button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button>${!ownerFinalized(call) && isAccepted(call) ? `<button class=\"btn small\" onclick=\"ownerCloseCall('${esc(call.id)}')\">Fechar</button>` : ''}<button class=\"btn ghost small\" onclick=\"ownerDeleteCall('${esc(call.id)}')\">Excluir</button></td>",
)
if 'window.ownerDeleteCall = async (id) =>' not in owner:
    marker = "  window.ownerCloseCall = (id) => {"
    helper = r'''  window.ownerDeleteCall = async (id) => {
    const call = (mgmt.calls || []).find((x) => x.id === id); if (!call) return alert('Corrida não encontrada. Atualize a tela.');
    if (!confirm('Excluir esta corrida? Ela sairá do painel, Financeiro e totais visíveis, mas ficará preservada internamente para auditoria.')) return;
    await api('/api/worker/management', { method:'POST', body: JSON.stringify({ action:'delete_call', callId:id, ownerName:'Thiago' }) });
    await refreshOwner();
    alert('Corrida removida do painel. O histórico interno foi preservado.');
  };

'''
    if marker not in owner:
        raise SystemExit('anchor not found: ownerCloseCall')
    owner = owner.replace(marker, helper + marker, 1)
owner_path.write_text(owner)


# ---------------- core calls/history page ----------------
app_path = Path('app.js')
app = app_path.read_text()
old_button = "<td><button class=\"btn small ghost\" onclick=\"editItem('calls','${c.id}')\">Editar</button></td>"
new_button = "<td><button class=\"btn small ghost\" onclick=\"editItem('calls','${c.id}')\">Editar</button><button class=\"btn small ghost\" onclick=\"deleteCall('${c.id}')\">Excluir</button></td>"
if new_button not in app:
    if old_button not in app:
        raise SystemExit('anchor not found: calls table edit button')
    app = app.replace(old_button, new_button, 1)

if 'window.deleteCall=async id=>' not in app:
    marker = "window.toggleAutomation=(id,enabled)=>saveMgmt({action:'toggle_automation',collection:'automations',id,enabled});"
    helper = "window.deleteCall=async id=>{const call=(mgmt.calls||[]).find(x=>x.id===id);if(!call)return alert('Corrida não encontrada. Atualize a tela.');if(!confirm('Excluir esta corrida? Ela sairá do painel, Financeiro e totais visíveis, mas ficará preservada internamente para auditoria.'))return;await api('/api/worker/management',{method:'POST',body:JSON.stringify({action:'delete_call',callId:id,ownerName:'Thiago'})});await loadManagement();if(typeof refreshBillingOnly==='function')await refreshBillingOnly();alert('Corrida removida do painel. O histórico interno foi preservado.')};\n"
    if marker not in app:
        raise SystemExit('anchor not found: toggleAutomation')
    app = app.replace(marker, helper + marker, 1)
app_path.write_text(app)


# Keep public mirrors identical to source files.
for src, dst in [
    ('app.js', 'public/app.js'),
    ('operation-command-center.js', 'public/operation-command-center.js'),
    ('owner-dashboard.js', 'public/owner-dashboard.js'),
]:
    shutil.copyfile(src, dst)

print('delete calls option applied')
