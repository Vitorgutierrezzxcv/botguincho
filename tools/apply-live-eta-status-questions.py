from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = ROOT / 'tools/vercel-whatsapp-worker.mjs'
ops = ROOT / 'tools/operational-knowledge.mjs'

# 1) Broadens deterministic ETA/status recognition in the runtime classifier.
s = ops.read_text(encoding='utf-8')
anchor = """  // \"chegando?\", \"chegou?\", \"achou?\", \"proximo?\" sao perguntas de status, nunca\n  // o relato de chegada do proprio motorista.\n  if (/^(?:ja\\s+)?(?:chegou|chegando|chegaram)\\s*\\?+$/.test(value)\n    || /^(?:achou|localizou|encontrou)\\s*\\?+$/.test(value)\n    || /^proximos?\\s*\\?+$/.test(value)\n    || /^\\S{4,10}\\s+chegando\\s*\\?*$/.test(value)) return 'eta';\n"""
replacement = """  // Perguntas de acompanhamento do deslocamento precisam sempre recalcular o ETA\n  // usando a leitura atual do rastreador, nunca repetir a previsao antiga.\n  const liveEtaQuestion = /^(?:ja\\s+)?(?:chegou|chegando|chegaram)\\s*\\?+$/.test(value)\n    || /^(?:achou|localizou|encontrou)\\s*\\?+$/.test(value)\n    || /^proximos?\\s*\\?+$/.test(value)\n    || /^\\S{4,10}\\s+chegando\\s*\\?*$/.test(value)\n    || /\\b(?:ta|esta|estao)\\s+(?:chegando|a caminho|proximo|perto)\\b/.test(value)\n    || /\\b(?:qual|tem)\\s+(?:a\\s+)?(?:previa|previsao)(?:\\s+(?:de|pra|para))?\\s*(?:chegar|chegada)?\\b/.test(value)\n    || /\\b(?:previa|previsao)\\s+(?:pra|para)\\s+chegar\\b/.test(value)\n    || /\\b(?:quanto|qto)\\s+(?:tempo\\s+)?(?:falta|demora)\\b/.test(value)\n    || /\\bfalta\\s+quanto\\b/.test(value)\n    || /\\bdemora\\s+(?:muito|quanto)\\b/.test(value)\n    || /\\b(?:onde|aonde)\\s+(?:esta|ta)\\s+(?:o\\s+)?(?:guincho|prestador|motorista)\\b/.test(value)\n    || /\\b(?:guincho|prestador|motorista)\\s+(?:esta|ta)\\s+(?:onde|chegando|perto|proximo)\\b/.test(value);\n  if (liveEtaQuestion) return 'eta';\n"""
if anchor not in s:
    raise SystemExit('operational ETA anchor not found')
s = s.replace(anchor, replacement, 1)
ops.write_text(s, encoding='utf-8')

# 2) Broadens the legacy/fallback asksEta gate too, so both paths converge on handleEtaQuestion.
w = worker.read_text(encoding='utf-8')
needle = """function asksEta(text = '') {\n  const value = normalizeForIntent(text);\n"""
insert = """function asksEta(text = '') {\n  const value = normalizeForIntent(text);\n  // Perguntas naturais das centrais durante uma corrida. O handler abaixo sempre\n  // recalcula a rota a partir da leitura atual do rastreador ate a origem da corrida.\n  if (/\\b(?:ta|esta|estao)\\s+(?:chegando|a caminho|proximo|perto)\\b/.test(value)\n    || /\\b(?:qual|tem)\\s+(?:a\\s+)?(?:previa|previsao)(?:\\s+(?:de|pra|para))?\\s*(?:chegar|chegada)?\\b/.test(value)\n    || /\\b(?:previa|previsao)\\s+(?:pra|para)\\s+chegar\\b/.test(value)\n    || /\\b(?:quanto|qto)\\s+(?:tempo\\s+)?(?:falta|demora)\\b/.test(value)\n    || /\\bfalta\\s+quanto\\b/.test(value)\n    || /\\bdemora\\s+(?:muito|quanto)\\b/.test(value)\n    || /\\b(?:onde|aonde)\\s+(?:esta|ta)\\s+(?:o\\s+)?(?:guincho|prestador|motorista)\\b/.test(value)\n    || /\\b(?:guincho|prestador|motorista)\\s+(?:esta|ta)\\s+(?:onde|chegando|perto|proximo)\\b/.test(value)) return true;\n"""
if needle not in w:
    raise SystemExit('asksEta anchor not found')
w = w.replace(needle, insert, 1)

# 3) Make the ETA reply explicitly communicate live tracking for active calls.
old = """  const distance = Number.isFinite(Number(eta.distanceKm)) ? `${eta.distanceKm} km` : 'indisponível';\n  const reply = `Distância até o cliente: ${distance}.\nPrevisão de chegada: ${eta.minutes} min.`;\n"""
new = """  const distance = Number.isFinite(Number(eta.distanceKm)) ? `${eta.distanceKm} km` : 'indisponível';\n  const activeCall = context?.recentCall && ['autorizado','a_caminho','em_atendimento'].includes(context.recentCall.status);\n  const reply = activeCall\n    ? `Guincho em deslocamento ✅\\nPrevisão atual de chegada: ${eta.minutes} min.\\nDistância até o cliente: ${distance}.`\n    : `Distância até o cliente: ${distance}.\\nPrevisão de chegada: ${eta.minutes} min.`;\n"""
if old not in w:
    raise SystemExit('ETA reply anchor not found')
w = w.replace(old, new, 1)
worker.write_text(w, encoding='utf-8')

print('Live ETA/status question patch applied.')
