from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = ROOT / 'tools/vercel-whatsapp-worker.mjs'
ops = ROOT / 'public/operation-command-center.js'

s = worker.read_text(encoding='utf-8')

old = """  const call = state.calls[index];
  if (call.deletedAt || call.status === 'excluido') throw new Error('call_deleted');
"""
new = """  let call = state.calls[index];
  if (call.deletedAt || call.status === 'excluido') throw new Error('call_deleted');
  // Corridas manuais antigas do grupo Tests guincho não são testes automáticos.
  // Só um testRunId da Central de Testes mantém o fechamento isolado.
  if (call.testMode === true && !call.testRunId) {
    call = { ...call, testMode: false };
    state.calls[index] = call;
  }
"""
if old not in s:
    raise SystemExit('worker anchor 1 not found')
s = s.replace(old, new, 1)

old = """  if (!(call.authorizedAt || isConfirmedCall(call) || call.cancellationChargeRequired === true)) throw new Error('call_not_authorized');
"""
new = """  if (!(call.authorizedAt || isConfirmedCall(call) || ['autorizado','a_caminho','em_atendimento','aguardando_fechamento'].includes(String(call.status || '')) || call.cancellationChargeRequired === true)) throw new Error('call_not_authorized');
"""
if old not in s:
    raise SystemExit('worker anchor 2 not found')
s = s.replace(old, new, 1)

old = """    ownerCloseRequired: true,
    ownerReviewRequired: false,
    ownerClosedAt: now,
"""
new = """    ownerCloseRequired: false,
    ownerReviewRequired: false,
    ownerClosedAt: now,
    completedAt: call.completedAt || now,
    financeReviewRequired: false,
    financeReviewReason: '',
    financeReviewResolvedAt: now,
    testMode: Boolean(call.testRunId),
"""
if old not in s:
    raise SystemExit('worker anchor 3 not found')
s = s.replace(old, new, 1)

old = """  state.calls[index] = next;
  if (isTestCall(next)) ensureTestFinanceTracking(state, next, { finalized: true });
  else ensureConfirmedFinanceTracking(state, next, { finalized: true });
  syncDriverPayrolls(state);
  await saveManagement(state);
"""
new = """  state.calls[index] = next;
  if (isTestCall(next)) ensureTestFinanceTracking(state, next, { finalized: true });
  else ensureConfirmedFinanceTracking(state, next, { finalized: true });
  syncDriverPayrolls(state);
  const savedAfterClose = await saveManagement(state);
  const persisted = (savedAfterClose.calls || []).find((item) => item.id === next.id);
  if (!persisted || persisted.status !== (next.status === 'cancelado' ? 'cancelado' : 'concluido') || !persisted.ownerClosedAt) {
    throw new Error('close_not_persisted');
  }
"""
if old not in s:
    raise SystemExit('worker anchor 4 not found')
s = s.replace(old, new, 1)
worker.write_text(s, encoding='utf-8')

p = ops.read_text(encoding='utf-8')
old = """      const closedState = response?.data && typeof response.data === 'object' ? response.data : response;
      if (closedState && Array.isArray(closedState.calls)) mgmt = { ...mgmt, ...closedState };
      if (typeof window.refreshOwner === 'function') await window.refreshOwner();
      else {
        await loadManagement();
        if (typeof window.refreshBillingOnly === 'function') await window.refreshBillingOnly();
        renderManagement();
      }
        const sent = response?.data?.closeResult?.noticeSent;
"""
new = """      const closedState = response?.data && typeof response.data === 'object' ? response.data : response;
      if (closedState && Array.isArray(closedState.calls)) mgmt = { ...mgmt, ...closedState };
      // Sempre refaz a leitura completa após concluir; não deixa a tela presa em snapshot antigo.
      await loadManagement();
      if (typeof window.refreshBillingOnly === 'function') await window.refreshBillingOnly();
      if (typeof window.refreshOwner === 'function') await window.refreshOwner();
      renderManagement();
      const persisted = (mgmt.calls || []).find((entry) => entry.id === id);
      if (persisted && persisted.status !== 'concluido' && persisted.status !== 'cancelado') {
        throw new Error('O servidor não confirmou o fechamento da corrida.');
      }
      const sent = response?.data?.closeResult?.noticeSent ?? response?.closeResult?.noticeSent;
"""
if old not in p:
    raise SystemExit('operation center anchor not found')
p = p.replace(old, new, 1)
ops.write_text(p, encoding='utf-8')

print('Owner close fix applied.')
