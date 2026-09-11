from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = ROOT / 'tools/vercel-whatsapp-worker.mjs'
ops = ROOT / 'tools/operational-knowledge.mjs'

w = worker.read_text(encoding='utf-8')

# 1) PREVIA_RESILIENTE: se o rastreador/roteador falhar por alguns segundos,
# reutiliza somente a ultima previsao valida da mesma corrida (ou do estado atual
# do grupo quando ainda nao ha corrida persistida). Nao inventa uma nova previsao.
old_eta_unavailable = """  if (!eta) {\n    await replyAndRemember(msg, groupName, readableText, 'Estou atualizando a localização para calcular a previsão. Tente novamente em alguns segundos.', { intent: 'eta-unavailable', targetSource: target.source });\n    return;\n  }\n"""
new_eta_unavailable = """  if (!eta) {\n    const fallbackCall = context?.recentCall || target.recentCall || null;\n    const callEtaMinutes = Number(fallbackCall?.etaMinutes);\n    const stateEtaMinutes = Number(target.state?.lastEta?.minutes);\n    const fallbackMinutes = Number.isFinite(callEtaMinutes) && callEtaMinutes > 0\n      ? Math.round(callEtaMinutes)\n      : (Number.isFinite(stateEtaMinutes) && stateEtaMinutes > 0 ? Math.round(stateEtaMinutes) : null);\n\n    if (fallbackMinutes) {\n      await replyAndRemember(\n        msg,\n        groupName,\n        readableText,\n        `Última previsão calculada: ${fallbackMinutes} min.\\nEstou atualizando a localização do guincho.`,\n        {\n          intent: 'eta-fallback',\n          etaMinutes: fallbackMinutes,\n          targetSource: target.source,\n          targetAddress: target.targetAddress,\n          fallbackSource: Number.isFinite(callEtaMinutes) && callEtaMinutes > 0 ? 'management-call' : 'dispatch-state',\n        },\n      );\n      return;\n    }\n\n    await replyAndRemember(msg, groupName, readableText, 'Estou atualizando a localização para calcular a previsão. Tente novamente em alguns segundos.', { intent: 'eta-unavailable', targetSource: target.source });\n    return;\n  }\n"""
if old_eta_unavailable in w:
    w = w.replace(old_eta_unavailable, new_eta_unavailable, 1)
elif 'PREVIA_RESILIENTE' not in w and "intent: 'eta-fallback'" not in w:
    raise SystemExit('ETA fallback anchor not found')

# Adiciona marcador legivel para auditoria/grep sem alterar comportamento.
eta_marker_anchor = "async function handleEtaQuestion(msg, groupName, readableText, quotedText = '', context = null) {\n"
if '// PREVIA_RESILIENTE_V2' not in w:
    if eta_marker_anchor not in w:
        raise SystemExit('ETA handler anchor not found')
    w = w.replace(eta_marker_anchor, eta_marker_anchor + "  // PREVIA_RESILIENTE_V2: falha transitória usa a última previsão da própria corrida.\n", 1)

# 2) ACEITE_CURTO: o momento do "pode seguir" nao repete KM, valor, previsão,
# acrescimos ou texto comercial. Esses dados ja foram apresentados na cotacao e
# voltam a ser informados somente quando a central perguntar ou no fechamento.
old_authorization_reply = """  const driverNotification = saved ? await notifyDriverOfConfirmedCall(saved) : { sent: false, reason: 'call_not_saved' };\n  const km = formatKm(saved?.billableKm ?? saved?.routeBreakdown?.totalKm ?? saved?.estimatedTotalKm);\n  const amount = formatCurrency(saved?.calculatedValue);\n  const calculationLines = [\n    km ? `Quilometragem total calculada: ${km} km.` : null,\n    amount ? `Valor estimado: ${amount}.` : null,\n    amount ? 'O valor poderá ter acréscimos conforme a execução, como hora trabalhada após 15 min, pedágio e estrada de terra, quando aplicáveis.' : null,\n    'Cancelamento sem custo em até 15 minutos após a confirmação. Após esse prazo, a saída e o deslocamento são cobrados conforme a regra vigente.',\n  ].filter(Boolean);\n  const confirmation = eta?.queued\n    ? `Confirmado ✅\\nCorrida em fila após o atendimento atual.\\nPrevisão informada: ${eta.minutes || 60} min.`\n    : (eta ? formatEtaReply(eta, true) : 'Confirmado ✅\\nGuincho em deslocamento.');\n  await replyAndRemember(msg, groupName, readableText, [confirmation, ...calculationLines].join('\\n'), {\n    intent: 'authorization', etaMinutes: eta?.minutes ?? null, queued: eta?.queued === true,\n    rawEtaMinutes: eta?.rawMinutes ?? eta?.minutes ?? null, precedingCallId: eta?.precedingCallId ?? null,\n    callId: saved?.id || null, billableKm: saved?.billableKm ?? null,\n    calculatedValue: saved?.calculatedValue ?? null,\n    driverNotification: driverNotification.sent ? 'sent' : driverNotification.reason,\n  });\n"""
new_authorization_reply = """  const driverNotification = saved ? await notifyDriverOfConfirmedCall(saved) : { sent: false, reason: 'call_not_saved' };\n\n  // ACEITE_CURTO_V2: a cotação já mostrou ETA/KM/valor. No aceite, só confirma a\n  // operação. Quando a corrida entra em fila, não publica um ETA que pode ficar\n  // obsoleto conforme o atendimento anterior evolui.\n  const confirmation = eta?.queued\n    ? 'Confirmado ✅\\nCorrida em fila após o atendimento atual.\\nA previsão será atualizada conforme o andamento da corrida anterior.'\n    : 'Confirmado ✅\\nGuincho em deslocamento.';\n  await replyAndRemember(msg, groupName, readableText, confirmation, {\n    intent: 'authorization', etaMinutes: eta?.minutes ?? null, queued: eta?.queued === true,\n    rawEtaMinutes: eta?.rawMinutes ?? eta?.minutes ?? null, precedingCallId: eta?.precedingCallId ?? null,\n    callId: saved?.id || null, billableKm: saved?.billableKm ?? null,\n    calculatedValue: saved?.calculatedValue ?? null,\n    driverNotification: driverNotification.sent ? 'sent' : driverNotification.reason,\n    shortConfirmation: true,\n  });\n"""
if old_authorization_reply in w:
    w = w.replace(old_authorization_reply, new_authorization_reply, 1)
elif 'ACEITE_CURTO_V2' not in w:
    raise SystemExit('authorization reply anchor not found')

# 3) DISTANCIA: corrige referencia a `context` inexistente no handler de distancia.
# Nao e o bug principal do print, mas podia derrubar respostas de rota por ReferenceError.
old_distance_call = """  const distance = Number.isFinite(Number(eta.distanceKm)) ? `${eta.distanceKm} km` : 'indisponível';\n  const activeCall = context?.recentCall && ['autorizado','a_caminho','em_atendimento'].includes(context.recentCall.status);\n  const reply = activeCall\n"""
new_distance_call = """  const distance = Number.isFinite(Number(eta.distanceKm)) ? `${eta.distanceKm} km` : 'indisponível';\n  const activeCall = target.recentCall && ['autorizado','a_caminho','em_atendimento'].includes(target.recentCall.status);\n  const reply = activeCall\n"""
if old_distance_call in w:
    w = w.replace(old_distance_call, new_distance_call, 1)
elif "const activeCall = target.recentCall" not in w:
    raise SystemExit('distance active-call anchor not found')

# 4) CANCELAMENTO: reforca deterministicamente a frase observada no print.
# O classificador ja reconhecia `pode deixar`, mas mantemos uma regra explícita
# para "atendimento cancelado" antes de qualquer fallback/IA.
s = ops.read_text(encoding='utf-8')
old_drop_tail = """    || /\\bsem\\s+(?:necessidade|atendimento|saida)\\b/.test(value)\n    || /\\bpode\\s+deixar\\b/.test(value);\n"""
new_drop_tail = """    || /\\bsem\\s+(?:necessidade|atendimento|saida)\\b/.test(value)\n    || /\\bpode\\s+deixar\\b/.test(value)\n    || /\\batendimento\\s+(?:foi\\s+)?cancelad[oa]\\b/.test(value);\n"""
if old_drop_tail in s:
    s = s.replace(old_drop_tail, new_drop_tail, 1)
elif "atendimento\\s+(?:foi\\s+)?cancelad[oa]" not in s:
    raise SystemExit('cancellation classifier anchor not found')

worker.write_text(w, encoding='utf-8')
ops.write_text(s, encoding='utf-8')
print('Authorization / ETA / cancellation hotfix applied.')
