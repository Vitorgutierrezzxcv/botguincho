from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'tools/vercel-whatsapp-worker.mjs'
text = path.read_text(encoding='utf-8')

old_filter = """  const beforeCalls = state.calls.length;\n  state.calls = state.calls.filter((call) => operationalGroup(call?.sourceGroupId || '', call?.insurer || call?.client || ''));\n  if (state.calls.length !== beforeCalls) dirty = true;\n"""
new_filter = """  const beforeCalls = state.calls.length;\n  state.calls = state.calls.filter((call) => {\n    // Corridas do grupo de testes precisam sobreviver mesmo quando o grupo não\n    // está selecionado para operação real. Caso contrário a cotação é salva,\n    // mas some antes do próximo \"pode seguir\" e a autorização perde o vínculo.\n    if (isTestCall(call)) return true;\n    return operationalGroup(\n      call?.sourceGroupId || '',\n      call?.groupName || call?.insurer || call?.client || ''\n    );\n  });\n  if (state.calls.length !== beforeCalls) dirty = true;\n"""

old_auth = """  const pendingCall = pendingAuthorizationCallForGroup(context.management?.calls || [], msg.from);\n  const call = pendingCall || context.recentCall;\n"""
new_auth = """  let pendingCall = pendingAuthorizationCallForGroup(context.management?.calls || [], msg.from);\n  let call = pendingCall || context.recentCall;\n  // Proteção contra snapshot antigo: a cotação pode ter acabado de ser persistida\n  // pela mensagem anterior. Antes de dizer que faltam dados, releia a gestão uma vez.\n  if (!call) {\n    const freshManagement = await getManagement().catch(() => context.management || { calls: [] });\n    pendingCall = pendingAuthorizationCallForGroup(freshManagement?.calls || [], msg.from);\n    call = pendingCall || recentManagementCall(freshManagement, msg.from);\n    if (call) context.management = freshManagement;\n  }\n"""

if old_filter not in text:
    raise SystemExit('management filter block not found or already patched')
if old_auth not in text:
    raise SystemExit('authorization selection block not found or already patched')

text = text.replace(old_filter, new_filter, 1)
text = text.replace(old_auth, new_auth, 1)
path.write_text(text, encoding='utf-8')
print('Test call preservation and authorization context patch applied.')
