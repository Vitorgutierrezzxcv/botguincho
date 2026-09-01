from pathlib import Path

old = """      const d = await api('/api/worker/management', { method: 'POST', body: JSON.stringify({ action: 'close_call', callId: id, ownerName: data.ownerName || 'Thiago', final: data }) });
      const sent = d.data?.closeResult?.noticeSent;
      await refreshOwner();
      alert(testClosure ? 'Corrida de teste concluída. Valores, KM e fechamento foram processados; o resumo não é enviado ao grupo de teste.' : (sent ? 'Corrida fechada e resumo enviado ao grupo.' : 'Corrida fechada. O WhatsApp não confirmou o envio do resumo; confira o grupo.'));
"""

new = """      const saveButton = document.getElementById('modalSave');
      if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Concluindo...'; }
      try {
        const d = await api('/api/worker/management', { method: 'POST', body: JSON.stringify({ action: 'close_call', callId: id, ownerName: data.ownerName || 'Thiago', final: data }) });
        const sent = d.data?.closeResult?.noticeSent;
        await refreshOwner();
        closeModal();
        alert(testClosure ? 'Corrida de teste concluída ✅ Os dados foram processados e ela saiu dos atendimentos em aberto.' : (sent ? 'Corrida concluída ✅ Resumo enviado ao grupo.' : 'Corrida concluída ✅ O fechamento foi salvo. O WhatsApp não confirmou o resumo; confira o grupo.'));
      } catch (error) {
        if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Concluir corrida'; }
        throw error;
      }
"""

for filename in ['owner-dashboard.js', 'public/owner-dashboard.js']:
    path = Path(filename)
    text = path.read_text()
    if new in text:
        continue
    if old not in text:
        raise SystemExit(f'Bloco esperado não encontrado: {filename}')
    path.write_text(text.replace(old, new, 1))

worker = Path('tools/vercel-whatsapp-worker.mjs')
text = worker.read_text()
needle = """  const call = state.calls[index];
  // Corridas do grupo de testes também podem ser fechadas pelo dono para validar o fluxo completo.
"""
replacement = """  const call = state.calls[index];
  // Fechamento idempotente: clique repetido não duplica timeline, financeiro ou repasse.
  if (call.ownerClosedAt) {
    return { call, noticeSent: false, driverPay: driverPayForCall(call), alreadyClosed: true };
  }
  // Corridas do grupo de testes também podem ser fechadas pelo dono para validar o fluxo completo.
"""
if replacement not in text:
    if needle not in text:
        raise SystemExit('Ponto esperado não encontrado no worker')
    worker.write_text(text.replace(needle, replacement, 1))
