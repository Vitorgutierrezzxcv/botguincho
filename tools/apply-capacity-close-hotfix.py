from pathlib import Path
import re

# 1) Capacidade: lotação operacional não é "fora de rota".
worker = Path('tools/vercel-whatsapp-worker.mjs')
ws = worker.read_text()

helper = """function capacityFullReply(activeCount) {
  const count = Math.max(0, Number(activeCount || 0));
  if (count > 0) return `Indisponível no momento. Estamos com ${count} atendimento${count === 1 ? '' : 's'} em andamento.`;
  return 'Indisponível no momento. Motorista em atendimento.';
}

"""
helper_marker = 'async function handleDispatch(msg, groupName, readableText, location) {'
if 'function capacityFullReply(activeCount)' not in ws:
    if helper_marker not in ws:
        raise SystemExit('Ponto de inserção do helper de capacidade não encontrado')
    ws = ws.replace(helper_marker, helper + helper_marker, 1)

capacity_pattern = re.compile(
    r"(await replyAndRemember\(msg, groupName, readableText,\s*)'Motorista fora de rota\.'(,\s*\{\s*intent:\s*'capacity-full',\s*activeCount:\s*)([A-Za-z0-9_.]+)"
)

def capacity_repl(match):
    expr = match.group(3)
    return f"{match.group(1)}capacityFullReply({expr}){match.group(2)}{expr}"

ws, count = capacity_pattern.subn(capacity_repl, ws)
if count == 0 and 'capacityFullReply(capacity.activeCount)' not in ws and 'capacityFullReply(arrival.activeCount)' not in ws:
    raise SystemExit('Respostas de capacidade não encontradas')

worker.write_text(ws)

# 2) Fechamento: a confirmação do POST é a fonte primária. O envio do WhatsApp
# ocorre em segundo plano e não pode fazer o botão parecer travado.
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
      // O servidor persiste o fechamento antes de liberar fila/enviar WhatsApp.
      // Usa essa confirmação imediatamente para não depender de um segundo GET instantâneo.
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

# 3) Força o navegador/PWA a carregar o JS novo do fechamento.
index = Path('public/index.html')
html = index.read_text()
if 'src="/operation-command-center.js?v=20260908-1"' not in html:
    if 'src="/operation-command-center.js"' not in html:
        raise SystemExit('Script operation-command-center.js não encontrado no index')
    html = html.replace('src="/operation-command-center.js"', 'src="/operation-command-center.js?v=20260908-1"', 1)
    index.write_text(html)

print(f'Capacidade e fechamento corrigidos com sucesso. Respostas de capacidade alteradas: {count}.')

# trigger 2026-09-08: aplicar hotfix urgente de conclusão em produção
