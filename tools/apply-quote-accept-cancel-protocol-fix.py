from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ops = ROOT / 'tools/operational-knowledge.mjs'
worker = ROOT / 'tools/vercel-whatsapp-worker.mjs'
owner = ROOT / 'public/owner-dashboard.js'

s = ops.read_text(encoding='utf-8')

needle = """  const administrativeContext = /\\b(nota fiscal|nfe?|pagamento|faturamento|cadastro|email|tabela)\\b/.test(value);\n"""
insert = needle + """\n  // Aceites curtos usados pelas centrais. Só valem quando já existe uma cotação\n  // aguardando decisão no mesmo grupo, evitando transformar um \"ok\" solto em corrida.\n  const pendingAuthorizationContext = ['cotacao','aguardando_aprovacao','aguardando_dados','agendado'].includes(recentCall?.status) && !recentCall?.authorizedAt;\n  const shortAuthorizationSignal = /^(?:ok(?:ay)?|certo|fechado|enviado|enviada|manda|pode mandar|pode enviar|segue|seguimos|blz|beleza|confirmado|confirmada|autorizado|autorizada)[.! ]*$/.test(value);\n  if (pendingAuthorizationContext && shortAuthorizationSignal && !administrativeContext) return 'authorization';\n"""
if needle not in s:
    raise SystemExit('authorization anchor not found')
s = s.replace(needle, insert, 1)

old_drop = """  const dropSignal = /\\bcancel(?:a|ar|ei|ou|ada|ado|amos|e|em|amento)\\b/.test(value)\n    || /\\bnao\\s+(?:vai|ira|sera)\\s+(?:mais\\s+)?(?:precisa\\w*|necessari\\w*)\\b/.test(value)\n    || /\\b(?:vai|ira)\\s+precisar\\s+mais\\s+nao\\b/.test(value)\n    || /\\bnao\\s+(?:e|sera)\\s+mais\\s+necessari\\w*\\b/.test(value)\n    || /\\bnao\\s+precisa\\s+(?:mais|nao)\\b/.test(value);\n"""
new_drop = """  const dropSignal = /\\bcancel(?:a|ar|ei|ou|ada|ado|amos|e|em|amento)\\b/.test(value)\n    || /\\bnao\\s+(?:vai|ira|sera)\\s+(?:mais\\s+)?(?:precisa\\w*|necessari\\w*)\\b/.test(value)\n    || /\\b(?:vai|ira)\\s+precisar\\s+mais\\s+nao\\b/.test(value)\n    || /\\bnao\\s+(?:e|sera)\\s+mais\\s+necessari\\w*\\b/.test(value)\n    || /\\bnao\\s+precisa\\s+(?:mais|nao)\\b/.test(value)\n    || /\\b(?:pode\\s+)?(?:desconsidera|desconsiderar|retira|retirar)\\b/.test(value)\n    || /\\bcliente\\s+(?:resolveu|solucionou|desistiu)\\b/.test(value)\n    || /\\bsem\\s+(?:necessidade|atendimento|saida)\\b/.test(value)\n    || /\\bpode\\s+deixar\\b/.test(value);\n"""
if old_drop not in s:
    raise SystemExit('cancellation anchor not found')
s = s.replace(old_drop, new_drop, 1)

old_proto = """  if (evidenceContext && /\\bprotocolo\\b/.test(value) && !hasQuoteSignals(text)) return 'protocol_update';\n"""
new_proto = """  const protocolLinkContext = evidenceContext || ['cotacao','aguardando_aprovacao','aguardando_dados','agendado'].includes(recentCall?.status);\n  if (protocolLinkContext && /\\bprotocolo\\b/.test(value) && !hasQuoteSignals(text)) return 'protocol_update';\n"""
if old_proto not in s:
    raise SystemExit('protocol classify anchor not found')
s = s.replace(old_proto, new_proto, 1)
ops.write_text(s, encoding='utf-8')

w = worker.read_text(encoding='utf-8')
old_call = """  const call = selectProtocolTargetCall({\n    calls: context.management?.calls || [],\n    groupId: msg.from,\n    identity: protocolIdentity,\n    fallbackCall: context.recentCall,\n  });\n  const protocolIsNewRequest = protocolHasStrongIdentity(protocolIdentity) && !call;\n"""
new_call = """  let call = selectProtocolTargetCall({\n    calls: context.management?.calls || [],\n    groupId: msg.from,\n    identity: protocolIdentity,\n    fallbackCall: context.recentCall,\n  });\n  // Se a central manda o protocolo depois da cotação, vincula ao atendimento pendente\n  // do mesmo grupo. Só bloqueia o fallback quando há placa explicitamente conflitante.\n  if (!call && context.recentCall && ['cotacao','aguardando_aprovacao','aguardando_dados','agendado'].includes(context.recentCall.status)) {\n    const recentPlate = String(context.recentCall.plate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();\n    const incomingPlate = String(protocolIdentity.plate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();\n    if (!recentPlate || !incomingPlate || recentPlate === incomingPlate) call = context.recentCall;\n  }\n  const protocolIsNewRequest = protocolHasStrongIdentity(protocolIdentity) && !call;\n"""
if old_call not in w:
    raise SystemExit('protocol worker anchor not found')
w = w.replace(old_call, new_call, 1)

mgmt_anchor = """  if (!allowed.has(collection)) throw new Error('collection_invalid');\n"""
mgmt_insert = """  if (action === 'convert_quote') {\n    const callId = String(body.callId || '');\n    const call = (state.calls || []).find((item) => item.id === callId && !item.deletedAt);\n    if (!call) throw new Error('call_not_found');\n    const now = new Date().toISOString();\n    call.status = 'autorizado';\n    call.authorizedAt = call.authorizedAt || now;\n    call.quoteOutcome = 'won';\n    call.quoteTracked = true;\n    call.ownerCloseRequired = true;\n    call.updatedAt = now;\n    call.operationalTimeline = appendOperationalTimeline(call.operationalTimeline || [], {\n      at: now, type: 'autorizacao_manual', fromStatus: call.status, toStatus: 'autorizado', source: 'owner_app'\n    });\n    await saveManagement(state);\n    logEvent('management', 'Cotação convertida manualmente em corrida.', { callId });\n    return state;\n  }\n  if (!allowed.has(collection)) throw new Error('collection_invalid');\n"""
if mgmt_anchor not in w:
    raise SystemExit('management action anchor not found')
w = w.replace(mgmt_anchor, mgmt_insert, 1)
worker.write_text(w, encoding='utf-8')

o = owner.read_text(encoding='utf-8')
old_side = """<div class=\"owner-row-side\"><b>${n(call.value) > 0 ? money(call.value) : '—'}</b><button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button><button class=\"btn ghost small\" onclick=\"ownerDeleteCall('${esc(call.id)}')\">Excluir</button></div>\n"""
new_side = """<div class=\"owner-row-side\"><b>${n(call.value) > 0 ? money(call.value) : '—'}</b>${quoteOutcome(call) === 'open' ? `<button class=\"btn small\" onclick=\"ownerConvertQuote('${esc(call.id)}')\">Converter em corrida</button>` : ''}<button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button><button class=\"btn ghost small\" onclick=\"ownerDeleteCall('${esc(call.id)}')\">Excluir</button></div>\n"""
if old_side in o:
    o = o.replace(old_side, new_side, 1)
else:
    print('warning: compact quote-list button anchor not found')

old_full = """<td><button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button></td>\n"""
new_full = """<td>${quoteOutcome(call) === 'open' ? `<button class=\"btn small\" onclick=\"ownerConvertQuote('${esc(call.id)}')\">Converter em corrida</button>` : ''}<button class=\"btn ghost small\" onclick=\"ownerEditCall('${esc(call.id)}')\">Editar</button></td>\n"""
if old_full in o:
    o = o.replace(old_full, new_full, 1)
else:
    print('warning: full quote-list button anchor not found')

insert_before = """  window.ownerDeleteCall = async (id) => {\n"""
convert_fn = """  window.ownerConvertQuote = async (id) => {\n    const call = (mgmt.calls || []).find((x) => x.id === id);\n    if (!call) return alert('Cotação não encontrada. Atualize a tela.');\n    if (!confirm('Converter esta cotação em corrida aceita? Ela passará a aparecer na Operação e no cálculo do motorista.')) return;\n    try {\n      await api('/api/worker/management', { method:'POST', body: JSON.stringify({ action:'convert_quote', callId:id, ownerName:'Thiago' }) });\n      await refreshOwner();\n      alert('Cotação convertida em corrida ✅');\n    } catch (error) {\n      alert(`Não foi possível converter a cotação: ${error?.message || error}`);\n    }\n  };\n\n  window.ownerDeleteCall = async (id) => {\n"""
if insert_before not in o:
    raise SystemExit('owner conversion function anchor not found')
o = o.replace(insert_before, convert_fn, 1)
owner.write_text(o, encoding='utf-8')

print('Quote acceptance/cancellation/protocol/manual conversion patch applied.')
