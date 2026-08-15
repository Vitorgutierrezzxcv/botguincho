from pathlib import Path
p=Path('tools/vercel-whatsapp-worker.mjs')
s=p.read_text()

# 1. Add helpers before applyManagementAction
anchor="async function applyManagementAction(body = {}) {\n"
block=r'''function managementAutomationEnabled(state, id) {
  return (state.automations || []).some((x) => x.id === id && x.enabled !== false);
}

async function recordDispatchInManagement({ groupId, groupName, text, originAddress, destinationAddress, eta }) {
  try {
    const state = await getManagement();
    const vehicle = extractLabeledField(text, 'Veículo') || extractLabeledField(text, 'Veiculo') || '';
    const service = extractLabeledField(text, 'Serviço') || extractLabeledField(text, 'Servico') || 'Reboque';
    const now = Date.now();
    const existing = state.calls.find((call) => {
      const age = now - new Date(call.createdAt || 0).getTime();
      return call.sourceGroupId === groupId && age < 15 * 60 * 1000 && call.origin === (originAddress || '') && !['concluido','cancelado'].includes(call.status);
    });
    const patch = {
      id: existing?.id || crypto.randomUUID(),
      vehicle: vehicle || existing?.vehicle || 'Veículo não informado',
      service,
      client: groupName || existing?.client || 'Seguradora',
      insurer: groupName || existing?.insurer || '',
      origin: originAddress || existing?.origin || '',
      destination: destinationAddress || existing?.destination || '',
      status: existing?.status || 'novo',
      value: Number(existing?.value || 0),
      source: 'whatsapp',
      sourceGroupId: groupId,
      etaMinutes: eta?.minutes || existing?.etaMinutes || null,
      distanceKm: eta?.distanceKm || existing?.distanceKm || null,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existing) state.calls = state.calls.map((x) => x.id === existing.id ? { ...x, ...patch } : x);
    else state.calls.unshift(patch);
    await saveManagement(state);
    logEvent('management', `${groupName}: chamado ${existing ? 'atualizado' : 'criado'} automaticamente.`, { callId: patch.id });
    return patch;
  } catch (error) {
    logEvent('warning', 'Não foi possível registrar o acionamento na gestão.', { error: String(error) });
    return null;
  }
}

function maybeCreateFinanceFromCompletedCall(state, item) {
  if (!item || item.status !== 'concluido' || !managementAutomationEnabled(state, 'auto-finance')) return;
  if ((state.finance || []).some((entry) => entry.sourceCallId === item.id)) return;
  const amount = Number(item.value || 0);
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
}

'''
if 'function managementAutomationEnabled' not in s:
    if anchor not in s: raise SystemExit('applyManagementAction anchor missing')
    s=s.replace(anchor,block+anchor,1)

# 2. Wire completion -> finance in upsert
old="""    if (idx >= 0) state[collection][idx] = { ...state[collection][idx], ...item };
    else state[collection].unshift(item);
    return saveManagement(state);"""
new="""    if (idx >= 0) state[collection][idx] = { ...state[collection][idx], ...item };
    else state[collection].unshift(item);
    if (collection === 'calls') {
      const savedCall = idx >= 0 ? state[collection][idx] : state[collection][0];
      maybeCreateFinanceFromCompletedCall(state, savedCall);
    }
    return saveManagement(state);"""
if old in s:
    s=s.replace(old,new,1)
elif 'maybeCreateFinanceFromCompletedCall(state, savedCall)' not in s:
    raise SystemExit('upsert anchor missing')

# 3. Record dispatch after ETA has been calculated, before reply
old2="""  const reply = formatEtaReply(eta, true);
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'dispatch', etaMinutes: eta?.minutes ?? null });"""
new2="""  await recordDispatchInManagement({
    groupId: msg.from,
    groupName,
    text: readableText,
    originAddress: state.originAddress,
    destinationAddress: state.destinationAddress,
    eta,
  });

  const reply = formatEtaReply(eta, true);
  await replyAndRemember(msg, groupName, readableText, reply, { intent: 'dispatch', etaMinutes: eta?.minutes ?? null });"""
if old2 in s:
    s=s.replace(old2,new2,1)
elif 'await recordDispatchInManagement({' not in s:
    raise SystemExit('handleDispatch reply anchor missing')

p.write_text(s)
print('management automations connected')
