from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
owner = ROOT / 'public/owner-dashboard.js'
worker = ROOT / 'tools/vercel-whatsapp-worker.mjs'

# 1) Painel: exibe "Feita" e oferece ação direta para corrigir corridas que o robô não fechou.
s = owner.read_text(encoding='utf-8')

old = """<td>${outcomeTag(call)}</td><td>${n(call.value) > 0 ? money(call.value) : '—'}</td><td>${ownerTag(sourceText(call), call.source === 'whatsapp' ? 'source' : '')}</td><td><button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button></td>"""
new = """<td>${ownerFinalized(call) ? ownerTag('Feita','won') : outcomeTag(call)}</td><td>${n(call.value) > 0 ? money(call.value) : '—'}</td><td>${ownerTag(sourceText(call), call.source === 'whatsapp' ? 'source' : '')}</td><td>${!ownerFinalized(call) && quoteOutcome(call) !== 'lost' && call.status !== 'cancelado' ? `<button class=\"btn small\" onclick=\"ownerCloseCall('${esc(call.id)}',{manualCorrection:true})\">Marcar como feita</button>` : ''}<button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button></td>"""
if old not in s:
    raise SystemExit('owner dashboard table anchor not found')
s = s.replace(old, new, 1)

old = """  window.ownerCloseCall = (id) => {
    const call = (mgmt.calls || []).find((x) => x.id === id); if (!call) return;
    const testClosure = call?.testMode === true;
    openModal('Conferir e fechar corrida', `<div class=\"notice warn\">Confira os dados antes de fechar. Depois deste botão o valor vira definitivo no Financeiro, entra no repasse do motorista e o resumo é enviado ao grupo do WhatsApp.</div>"""
new = """  window.ownerCloseCall = (id, options = {}) => {
    const call = (mgmt.calls || []).find((x) => x.id === id); if (!call) return;
    const testClosure = call?.testMode === true;
    const manualCorrection = options?.manualCorrection === true;
    const closeTitle = manualCorrection ? 'Marcar corrida como feita' : 'Conferir e fechar corrida';
    const closeNotice = manualCorrection
      ? 'Confira os dados e confirme a realização da corrida. O fechamento entra no Financeiro e no repasse do motorista. Como esta é uma correção manual, nenhuma mensagem será enviada ao grupo do WhatsApp.'
      : 'Confira os dados antes de fechar. Depois deste botão o valor vira definitivo no Financeiro, entra no repasse do motorista e o resumo é enviado ao grupo do WhatsApp.';
    openModal(closeTitle, `<div class=\"notice warn\">${closeNotice}</div>"""
if old not in s:
    raise SystemExit('owner close modal anchor not found')
s = s.replace(old, new, 1)

old = """body: JSON.stringify({ action: 'close_call', callId: id, ownerName: data.ownerName || 'Thiago', final: data })"""
new = """body: JSON.stringify({ action: 'close_call', callId: id, ownerName: data.ownerName || 'Thiago', final: data, manualCompletion: manualCorrection, suppressNotice: manualCorrection })"""
if old not in s:
    raise SystemExit('owner close request anchor not found')
s = s.replace(old, new, 1)

old = """        alert(pending
          ? 'Corrida concluída ✅ Financeiro e repasse atualizados. O resumo do WhatsApp será enviado em segundo plano.'
          : testClosure
            ? (sent ? 'Corrida de teste concluída ✅ Resumo enviado ao grupo.' : 'Corrida de teste concluída ✅')
            : (sent ? 'Corrida concluída ✅ Resumo enviado ao grupo.' : 'Corrida concluída ✅'));"""
new = """        alert(manualCorrection
          ? 'Corrida marcada como feita ✅ Financeiro e repasse atualizados. Nenhuma mensagem foi enviada ao WhatsApp.'
          : pending
            ? 'Corrida concluída ✅ Financeiro e repasse atualizados. O resumo do WhatsApp será enviado em segundo plano.'
            : testClosure
              ? (sent ? 'Corrida de teste concluída ✅ Resumo enviado ao grupo.' : 'Corrida de teste concluída ✅')
              : (sent ? 'Corrida concluída ✅ Resumo enviado ao grupo.' : 'Corrida concluída ✅'));"""
if old not in s:
    raise SystemExit('owner close alert anchor not found')
s = s.replace(old, new, 1)

owner.write_text(s, encoding='utf-8')

# 2) Worker: permite que o fechamento manual também corrija uma cotação/corrida que ficou "Em aberto".
w = worker.read_text(encoding='utf-8')

old = """  // Corridas do grupo de testes também podem ser fechadas pelo dono para validar o fluxo completo.
  // A proteção de envio ao WhatsApp continua abaixo com !isTestCall(next).
  if (!(call.authorizedAt || isConfirmedCall(call) || ['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(String(call.status || '')) || call.cancellationChargeRequired === true)) throw new Error('call_not_authorized');
  const final = body.final || body.item || {};"""
new = """  // Uma correção manual significa que o dono confirmou que esta entrada realmente virou corrida.
  // Fazemos a conversão somente no clique final de fechamento para não deixar a cotação como ganha
  // caso o usuário apenas abra o modal e desista.
  const manualCompletion = body.manualCompletion === true;
  const acceptedBeforeClose = call.authorizedAt || isConfirmedCall(call) || ['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(String(call.status || '')) || call.cancellationChargeRequired === true;
  if (manualCompletion && !acceptedBeforeClose && call.status !== 'cancelado' && call.quoteOutcome !== 'lost') {
    const manualAt = new Date().toISOString();
    call = {
      ...call,
      status: 'autorizado',
      authorizedAt: call.authorizedAt || manualAt,
      quoteOutcome: 'won',
      quoteTracked: true,
      ownerCloseRequired: true,
      updatedAt: manualAt,
    };
    state.calls[index] = call;
  }
  // Corridas do grupo de testes também podem ser fechadas pelo dono para validar o fluxo completo.
  // A proteção de envio ao WhatsApp continua abaixo com !isTestCall(next).
  if (!(call.authorizedAt || isConfirmedCall(call) || ['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(String(call.status || '')) || call.cancellationChargeRequired === true)) throw new Error('call_not_authorized');
  const final = body.final || body.item || {};"""
if old not in w:
    raise SystemExit('worker manual completion anchor not found')
w = w.replace(old, new, 1)

old = """    ownerClosedBy: String(body.ownerName || final.ownerName || 'Thiago').trim().slice(0, 120) || 'Thiago',
    ownerClosingNotes: String(final.notes || '').trim().slice(0, 1200),"""
new = """    ownerClosedBy: String(body.ownerName || final.ownerName || 'Thiago').trim().slice(0, 120) || 'Thiago',
    manualCompletion: manualCompletion || call.manualCompletion === true,
    manualCompletionAt: manualCompletion ? now : (call.manualCompletionAt || null),
    manualCompletionBy: manualCompletion ? (String(body.ownerName || final.ownerName || 'Thiago').trim().slice(0, 120) || 'Thiago') : (call.manualCompletionBy || null),
    ownerClosingNotes: String(final.notes || '').trim().slice(0, 1200),"""
if old not in w:
    raise SystemExit('worker audit anchor not found')
w = w.replace(old, new, 1)

old = """  const allowCloseNotice = !isTestCall(next) || isTestGroupName(next.groupName || next.insurer || next.client || '');"""
new = """  const allowCloseNotice = body.suppressNotice !== true && (!isTestCall(next) || isTestGroupName(next.groupName || next.insurer || next.client || ''));"""
if old not in w:
    raise SystemExit('worker whatsapp notice anchor not found')
w = w.replace(old, new, 1)

old = """  return { call: next, noticeSent: null, noticePending: true, driverPay: driverPayForCall(next) };"""
new = """  return { call: next, noticeSent: null, noticePending: allowCloseNotice, driverPay: driverPayForCall(next) };"""
if old not in w:
    raise SystemExit('worker return anchor not found')
w = w.replace(old, new, 1)

worker.write_text(w, encoding='utf-8')
print('Manual call completion patch applied.')
