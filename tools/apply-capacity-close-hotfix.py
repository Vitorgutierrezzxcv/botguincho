from pathlib import Path
import re

# 1) Capacidade: nunca chamar lotação operacional de "fora de rota".
worker = Path('tools/vercel-whatsapp-worker.mjs')
ws = worker.read_text()

capacity_pattern = re.compile(
    r"(?P<prefix>\s*: )second\?\.destination\s*\n\s*\? 'Motorista fora de rota\.'\s*\n\s*: `No momento já existem \$\{capacity\.activeCount\} corridas ativas\. Só conseguimos trabalhar com \$\{MAX_CONCURRENT_CALLS\} atendimentos ao mesmo tempo\.`;"
)
capacity_replacement = r"\g<prefix>`Indisponível no momento. Estamos com ${capacity.activeCount} atendimentos em andamento.`;"
ws2, count = capacity_pattern.subn(capacity_replacement, ws, count=1)
if count == 0:
    if 'Indisponível no momento. Estamos com ${capacity.activeCount} atendimentos em andamento.' not in ws:
        raise SystemExit('Bloco de resposta por capacidade não encontrado')
else:
    worker.write_text(ws2)

# 2) Fechamento: usar a confirmação devolvida pelo POST como fonte primária e
# não transformar atraso de refresh/WhatsApp em falha de conclusão.
ui = Path('public/operation-command-center.js')
s = ui.read_text()

old_confirm = """      const closedState = response?.data && typeof response.data === 'object' ? response.data : response;
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
new_confirm = """      const closedState = response?.data && typeof response.data === 'object' ? response.data : response;
      if (closedState && Array.isArray(closedState.calls)) mgmt = { ...mgmt, ...closedState };
      const closeResult = response?.data?.closeResult ?? response?.closeResult ?? null;
      const closedCall = closeResult?.call || null;
      // O POST de close_call já persiste o status antes de iniciar notificações em segundo plano.
      // Atualiza o snapshot local imediatamente para não depender de uma segunda leitura instantânea.
      if (closedCall?.id) {
        const index = (mgmt.calls || []).findIndex((entry) => entry.id === closedCall.id);
        if (index >= 0) mgmt.calls[index] = { ...mgmt.calls[index], ...closedCall };
      }
      await loadManagement();
      if (typeof window.refreshBillingOnly === 'function') await window.refreshBillingOnly();
      if (typeof window.refreshOwner === 'function') await window.refreshOwner();
      renderManagement();
      const persisted = (mgmt.calls || []).find((entry) => entry.id === id);
      const confirmedStatus = String(closedCall?.status || persisted?.status || '').toLowerCase();
      if (!['concluido','cancelado'].includes(confirmedStatus)) {
        throw new Error('O servidor não confirmou o fechamento da corrida.');
      }
      const sent = closeResult?.noticeSent;
      const noticePending = closeResult?.noticePending === true;
"""
if old_confirm in s:
    s = s.replace(old_confirm, new_confirm, 1)
elif 'const noticePending = closeResult?.noticePending === true;' not in s:
    raise SystemExit('Bloco de confirmação do fechamento não encontrado')

old_alert = """        alert(isTestCall(call)
          ? (sent ? 'Corrida de teste concluída ✅ Financeiro de teste atualizado e resumo enviado ao grupo.' : 'Corrida de teste concluída, mas o WhatsApp não confirmou o envio do resumo. Confira o grupo.')
          : (sent ? 'Corrida concluída ✅ Financeiro atualizado e resumo enviado ao grupo.' : 'Corrida concluída e financeiro atualizado. O WhatsApp não confirmou o resumo; confira o grupo.'));
      } catch (error) {
        if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Concluir corrida'; }
        throw error;
      }
"""
new_alert = """        alert(isTestCall(call)
          ? (sent ? 'Corrida de teste concluída ✅ Financeiro de teste atualizado e resumo enviado ao grupo.' : noticePending ? 'Corrida de teste concluída ✅ Financeiro de teste atualizado. O resumo do WhatsApp está sendo enviado.' : 'Corrida de teste concluída ✅ Financeiro de teste atualizado. Confira o grupo se o resumo não aparecer.')
          : (sent ? 'Corrida concluída ✅ Financeiro atualizado e resumo enviado ao grupo.' : noticePending ? 'Corrida concluída ✅ Financeiro atualizado. O resumo do WhatsApp está sendo enviado.' : 'Corrida concluída ✅ Financeiro atualizado. Confira o grupo se o resumo não aparecer.'));
      } catch (error) {
        console.error('Falha ao concluir corrida', error);
        if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Concluir corrida'; }
        alert(`Não foi possível concluir a corrida: ${error?.message || error}`);
      }
"""
if old_alert in s:
    s = s.replace(old_alert, new_alert, 1)
elif "console.error('Falha ao concluir corrida', error);" not in s:
    raise SystemExit('Bloco de alerta/catch do fechamento não encontrado')

ui.write_text(s)
print('Capacidade e fechamento corrigidos com sucesso.')
